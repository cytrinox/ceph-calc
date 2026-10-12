// Rough random IOPS ceiling of a pool for one client I/O size, from the read and write IOPS a single
// OSD sustains at that size.

import type { Scheme } from './ceph'
import { formatInt, formatTB } from './format'
import type { PoolOptions } from './pool'

/** Upper bound for the per-OSD inputs (also used for shared links). */
export const MAX_OSD_IOPS = 10_000_000

/** Client I/O sizes the estimate supports, in KiB. */
export const IO_SIZES_KIB = [4, 8, 16, 32, 64, 128, 256, 512, 1024] as const
export const DEFAULT_IO_SIZE_KIB = 4

/** "4K", "64K", "1M". */
export function ioSizeLabel(kib: number): string {
  return kib >= 1024 && kib % 1024 === 0 ? `${kib / 1024}M` : `${kib}K`
}

/** Random IOPS one OSD sustains at the chosen I/O size; 0 = not set. */
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

export type IopsPoolOptions = Pick<PoolOptions, 'fastRead' | 'ecOptimizations' | 'stripeUnitKiB'>

/**
 * OSD reads and writes per client read / write of `ioSizeKiB` (requests aligned to their size;
 * strips of one shard are contiguous, so a shard counts once per request):
 * - replication: a read hits the primary only, a write goes to every copy;
 * - classic EC: a read fetches whole stripes (k shards, all k+m with fast_read); a write of part
 *   of a stripe reads the k data shards and rewrites all k+m (read-modify-write);
 * - EC optimizations (allow_ec_optimizations, Tentacle): a read touches only the d data shards
 *   holding the data; a partial-stripe write uses parity-delta (d+m reads) or partial writes
 *   (k-d reads), whichever reads less, and writes the d changed data shards plus m parity shards;
 * - whole stripes are written without reading (k+m writes); a remainder beyond them is partial.
 */
export function opCosts(scheme: Scheme, pool: IopsPoolOptions, ioSizeKiB: number = DEFAULT_IO_SIZE_KIB): OpCosts {
  if (scheme.kind === 'replicated') {
    return { read: { reads: 1, writes: 0 }, write: { reads: 0, writes: scheme.size } }
  }
  const { k, m } = scheme
  const unit = Math.max(1, pool.stripeUnitKiB)
  const size = Math.max(1, ioSizeKiB)
  const width = k * unit
  /** Data shards a request of `kib` touches. */
  const shards = (kib: number) => Math.min(k, Math.ceil(kib / unit))
  const partialReads = (kib: number) => {
    const d = shards(kib)
    return pool.ecOptimizations ? Math.max(0, Math.min(d + m, k - d)) : k
  }
  const read = { reads: pool.ecOptimizations ? shards(size) : pool.fastRead ? k + m : k, writes: 0 }
  if (size >= width) {
    const rest = size % width
    return { read, write: { reads: rest === 0 ? 0 : partialReads(rest), writes: k + m } }
  }
  return { read, write: { reads: partialReads(size), writes: pool.ecOptimizations ? shards(size) + m : k + m } }
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

/** One device class among the OSDs the pool uses. */
export interface ClassIops {
  cls: string
  /** Per-OSD IOPS of this class (step 5). */
  osd: OsdIops
  /** Capacity of the class's largest OSD: it gets the most I/O of the class and saturates first. */
  largestOsdTB: number
  /** All placed capacity ÷ `largestOsdTB`: the capacity-weighted OSD count relative to that OSD. */
  equivalents: number
}

/** What the estimate is based on; null when no per-OSD IOPS are set at all. */
export interface IopsBasis {
  classes: ClassIops[]
  /** Capacity of the OSDs the pool uses (all its classes). */
  placedTB: number
  ioSizeKiB: number
}

export const hasIops = (osd: OsdIops) => osd.read > 0 || osd.write > 0

/**
 * The basis of the estimate: the device classes of the OSDs the pool uses, each with its per-OSD IOPS and its
 * largest OSD. Null while no IOPS are `entered` (for any class, also those the pool doesn't use): the estimate is
 * opt-in.
 */
export function iopsBasis(
  classes: { cls: string; osd: OsdIops; largestOsdTB: number }[],
  placedTB: number,
  ioSizeKiB: number = DEFAULT_IO_SIZE_KIB,
  entered: boolean = classes.some((c) => hasIops(c.osd)),
): IopsBasis | null {
  if (!entered || classes.length === 0) return null
  return {
    classes: classes.map((c) => ({ ...c, equivalents: osdEquivalents(placedTB, c.largestOsdTB) })),
    placedTB,
    ioSizeKiB,
  }
}

export interface OpEstimate {
  /** Client IOPS when the first OSDs saturate; null when an input is missing. */
  value: number | null
  /** The class whose OSDs saturate first. */
  limiting: ClassIops | null
  /** The ceiling each class alone would allow. */
  perClass: { cls: string; value: number | null }[]
  /** Classes without the per-OSD IOPS this operation needs. */
  missing: string[]
}

export interface IopsEstimate {
  read: number | null
  write: number | null
  costs: OpCosts
  basis: IopsBasis
  ops: { read: OpEstimate; write: OpEstimate }
}

/**
 * CRUSH spreads the OSD operations by capacity over all OSDs the pool uses, whatever their class. Each class's
 * largest OSD saturates at its own rate, so the pool's ceiling is the lowest of the classes' ceilings.
 */
function estimateOp(basis: IopsBasis, cost: OpCost): OpEstimate {
  const perClass = basis.classes.map((c) => ({ c, value: clusterIops(c.equivalents, cost, c.osd) }))
  const missing = basis.classes
    .filter((c) => (cost.reads > 0 && !(c.osd.read > 0)) || (cost.writes > 0 && !(c.osd.write > 0)))
    .map((c) => c.cls)
  const known = perClass.filter((p): p is { c: ClassIops; value: number } => p.value !== null)
  const lowest = known.length === perClass.length && known.length > 0
    ? known.reduce((a, b) => (b.value < a.value ? b : a))
    : null
  return {
    value: lowest?.value ?? null,
    limiting: lowest?.c ?? null,
    perClass: perClass.map((p) => ({ cls: p.c.cls, value: p.value })),
    missing,
  }
}

export function estimateIops(basis: IopsBasis, scheme: Scheme, pool: IopsPoolOptions): IopsEstimate {
  const costs = opCosts(scheme, pool, basis.ioSizeKiB)
  const read = estimateOp(basis, costs.read)
  const write = estimateOp(basis, costs.write)
  return { read: read.value, write: write.value, costs, basis, ops: { read, write } }
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "1 OSD read", "3 OSD writes", "4 reads + 6 writes". */
export function describeCost(cost: OpCost): string {
  if (cost.reads > 0 && cost.writes > 0) return `${count(cost.reads, 'read')} + ${count(cost.writes, 'write')}`
  return cost.reads > 0 ? `${count(cost.reads, 'OSD read')}` : `${count(cost.writes, 'OSD write')}`
}

/** "8 OSDs", or "42.5 capacity-weighted OSDs" when the OSD sizes differ. */
function osdCount(equivalents: number): string {
  const whole = Math.round(equivalents)
  return Math.abs(equivalents - whole) < 1e-9
    ? `${formatInt(whole)} ${whole === 1 ? 'OSD' : 'OSDs'}`
    : `${equivalents.toFixed(1)} capacity-weighted OSDs`
}

/**
 * The arithmetic behind one estimate, e.g. "8 OSDs × 100 IOPS ÷ 1 OSD read = 800" or
 * "8 OSDs ÷ (4 reads ÷ 100 + 6 writes ÷ 100 IOPS) = 80"; null when there is no value. With several device
 * classes it names the class that saturates first, its capacity-weighted count as "448 TB ÷ 16 TB", and the
 * ceilings of the others.
 */
export function explainIops(estimate: IopsEstimate, op: 'read' | 'write'): string | null {
  const { value, limiting, perClass } = estimate.ops[op]
  if (value === null || !limiting) return null
  const cost = estimate.costs[op]
  const { osd, equivalents } = limiting
  const several = estimate.basis.classes.length > 1
  const osds = several
    ? `(${formatTB(estimate.basis.placedTB)} ÷ ${formatTB(limiting.largestOsdTB)})`
    : osdCount(equivalents)
  const result = formatInt(Math.round(value))
  const sum =
    cost.reads > 0 && cost.writes > 0
      ? `${osds} ÷ (${count(cost.reads, 'read')} ÷ ${formatInt(osd.read)} + ${count(cost.writes, 'write')} ÷ ${formatInt(osd.write)} IOPS) = ${result}`
      : `${osds} × ${formatInt(cost.reads > 0 ? osd.read : osd.write)} IOPS ÷ ${describeCost(cost)} = ${result}`
  if (!several) return sum
  const others = perClass
    .filter((p) => p.cls !== limiting.cls)
    .map((p) => `${p.cls}: ${p.value === null ? '—' : formatInt(Math.round(p.value))}`)
    .join(', ')
  return `${limiting.cls} OSDs saturate first: ${sum} (${others})`
}
