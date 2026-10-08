// Rough 4k random IOPS ceiling of a pool, from the read and write IOPS a single OSD sustains.

import type { Scheme } from './ceph'
import type { PoolOptions } from './pool'

/** Upper bound for the per-OSD inputs (also used for shared links). */
export const MAX_OSD_IOPS = 10_000_000

/** 4k random IOPS one OSD sustains; 0 = not set. */
export interface OsdIops {
  read: number
  write: number
}

/** OSD operations caused by one client operation. */
export interface OpCost {
  reads: number
  writes: number
}

export interface OpCosts {
  read: OpCost
  write: OpCost
}

/**
 * OSD reads and writes per 4k client read / write:
 * - replication: a read hits the primary only, a write goes to every copy;
 * - classic EC: a read fetches the whole stripe (k shards, all k+m with fast_read); a small
 *   overwrite reads the k data shards and rewrites all k+m (read-modify-write);
 * - EC optimizations (allow_ec_optimizations, Tentacle): a partial read touches one shard; a small
 *   write uses parity-delta (1+m reads) or partial writes (k-1 reads), whichever reads less, and
 *   writes the changed data shard plus the m parity shards.
 */
export function opCosts(scheme: Scheme, pool: Pick<PoolOptions, 'fastRead' | 'ecOptimizations'>): OpCosts {
  if (scheme.kind === 'replicated') {
    return { read: { reads: 1, writes: 0 }, write: { reads: 0, writes: scheme.size } }
  }
  const { k, m } = scheme
  if (pool.ecOptimizations) {
    return { read: { reads: 1, writes: 0 }, write: { reads: Math.max(0, Math.min(1 + m, k - 1)), writes: 1 + m } }
  }
  return { read: { reads: pool.fastRead ? k + m : k, writes: 0 }, write: { reads: k, writes: k + m } }
}

/**
 * Capacity-weighted OSD count: CRUSH spreads data, and with it I/O, by weight (capacity), so the
 * largest OSDs saturate first. Equal OSDs give the plain OSD count.
 */
export function osdEquivalents(placedTB: number, largestOsdTB: number): number {
  return largestOsdTB > 0 && placedTB > 0 ? placedTB / largestOsdTB : 0
}

/**
 * Client operations per second at which the largest OSDs are fully busy: every client op keeps an
 * OSD busy for reads/R + writes/W seconds, shared by the capacity-weighted OSD count. Null when an
 * input the operation needs is not set.
 */
export function clusterIops(equivalents: number, cost: OpCost, osd: OsdIops): number | null {
  if (!(equivalents > 0)) return null
  if ((cost.reads > 0 && !(osd.read > 0)) || (cost.writes > 0 && !(osd.write > 0))) return null
  const busy = (cost.reads > 0 ? cost.reads / osd.read : 0) + (cost.writes > 0 ? cost.writes / osd.write : 0)
  return busy > 0 ? equivalents / busy : null
}

/** What the estimate is based on; null when no per-OSD IOPS are set. */
export interface IopsBasis {
  osd: OsdIops
  equivalents: number
}

export function iopsBasis(osd: OsdIops, placedTB: number, largestOsdTB: number): IopsBasis | null {
  if (!(osd.read > 0) && !(osd.write > 0)) return null
  return { osd, equivalents: osdEquivalents(placedTB, largestOsdTB) }
}

export interface IopsEstimate {
  read: number | null
  write: number | null
  costs: OpCosts
}

export function estimateIops(
  basis: IopsBasis,
  scheme: Scheme,
  pool: Pick<PoolOptions, 'fastRead' | 'ecOptimizations'>,
): IopsEstimate {
  const costs = opCosts(scheme, pool)
  return {
    read: clusterIops(basis.equivalents, costs.read, basis.osd),
    write: clusterIops(basis.equivalents, costs.write, basis.osd),
    costs,
  }
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "1 OSD read", "3 OSD writes", "4 reads + 6 writes". */
export function describeCost(cost: OpCost): string {
  if (cost.reads > 0 && cost.writes > 0) return `${count(cost.reads, 'read')} + ${count(cost.writes, 'write')}`
  return cost.reads > 0 ? `${count(cost.reads, 'OSD read')}` : `${count(cost.writes, 'OSD write')}`
}
