import { describe, expect, it } from 'vitest'
import { clusterIops, describeCost, estimateIops, iopsBasis, opCosts, osdEquivalents } from './iops'
import { defaultPoolOptions } from './pool'
import { buildBasicTopology, topologyStats, TOPOLOGY_EXAMPLES } from './topology'
import type { Scheme } from './ceph'

const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }
const ec = (k: number, m: number): Scheme => ({ kind: 'ec', k, m })
const classic = defaultPoolOptions()
const optimized = { ...classic, ecOptimizations: true }

describe('opCosts', () => {
  it('counts OSD operations per client read and write', () => {
    expect(opCosts(rep3, classic)).toEqual({ read: { reads: 1, writes: 0 }, write: { reads: 0, writes: 3 } })
    // classic EC: whole-stripe reads and read-modify-write
    expect(opCosts(ec(4, 2), classic)).toEqual({ read: { reads: 4, writes: 0 }, write: { reads: 4, writes: 6 } })
    expect(opCosts(ec(4, 2), { ...classic, fastRead: true }).read).toEqual({ reads: 6, writes: 0 })
  })

  it('uses partial reads and the cheaper small-write method with EC optimizations', () => {
    // Ceph FastEC blog: 6+2 small write = parity delta 3 reads + 3 writes (partial write would read 5)
    expect(opCosts(ec(6, 2), optimized)).toEqual({ read: { reads: 1, writes: 0 }, write: { reads: 3, writes: 3 } })
    // 2+2: a partial write reads the one other data shard
    expect(opCosts(ec(2, 2), optimized).write).toEqual({ reads: 1, writes: 3 })
    expect(opCosts(ec(4, 2), optimized).write).toEqual({ reads: 3, writes: 3 })
  })
})

describe('cluster IOPS', () => {
  const basis = iopsBasis({ read: 200, write: 200 }, 12 * 8, 8)!

  it('matches the FAQ example: 12 OSDs at 200 IOPS', () => {
    expect(basis.equivalents).toBe(12)
    const rep = estimateIops(basis, rep3, classic)
    expect([rep.read, rep.write]).toEqual([2400, 800])
    const ecClassic = estimateIops(basis, ec(4, 2), classic)
    expect([ecClassic.read, ecClassic.write]).toEqual([600, 240])
    const ecOptimized = estimateIops(basis, ec(4, 2), optimized)
    expect([ecOptimized.read, ecOptimized.write]).toEqual([2400, 400])
  })

  it('weights mixed OSD sizes by capacity: the largest OSDs saturate first', () => {
    const mixed = TOPOLOGY_EXAMPLES.find((e) => e.id === 'mixed')!.build() // 36 × 8 TB + 24 × 16 TB
    const stats = topologyStats(mixed)
    expect(stats.largestOsdTB).toBe(16)
    expect(osdEquivalents(stats.rawTB, stats.largestOsdTB)).toBe(42)
    const r = estimateIops(iopsBasis({ read: 200, write: 200 }, stats.rawTB, stats.largestOsdTB)!, rep3, classic)
    expect([r.read, r.write]).toEqual([8400, 2800])
  })

  it('needs the inputs an operation uses', () => {
    expect(iopsBasis({ read: 0, write: 0 }, 96, 8)).toBeNull()
    const readOnly = iopsBasis({ read: 500, write: 0 }, 96, 8)!
    expect(estimateIops(readOnly, rep3, classic)).toMatchObject({ read: 6000, write: null })
    // classic EC writes read and write
    expect(estimateIops(iopsBasis({ read: 0, write: 300 }, 96, 8)!, ec(4, 2), classic).write).toBeNull()
    expect(clusterIops(0, { reads: 1, writes: 0 }, { read: 100, write: 100 })).toBeNull()
  })

  it('combines reads and writes on the same OSDs', () => {
    // 10 OSDs, R = 1000, W = 250: 4 reads + 6 writes = 4/1000 + 6/250 = 0.028 s per op and OSD
    expect(clusterIops(10, { reads: 4, writes: 6 }, { read: 1000, write: 250 })).toBeCloseTo(10 / 0.028, 9)
  })

  it('uses the Basic OSD size as the largest OSD', () => {
    expect(topologyStats(buildBasicTopology({ hosts: 5, osdsPerHost: 8, osdSizeTB: 8 })).largestOsdTB).toBe(8)
    expect(topologyStats([]).largestOsdTB).toBe(0)
  })
})

describe('describeCost', () => {
  it('names the OSD operations per client operation', () => {
    expect(describeCost({ reads: 1, writes: 0 })).toBe('1 OSD read')
    expect(describeCost({ reads: 0, writes: 3 })).toBe('3 OSD writes')
    expect(describeCost({ reads: 4, writes: 6 })).toBe('4 reads + 6 writes')
    expect(describeCost({ reads: 1, writes: 3 })).toBe('1 read + 3 writes')
  })
})
