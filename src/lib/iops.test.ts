import { describe, expect, it } from 'vitest'
import { BASIC_IOPS, clusterIops, describeCost, estimateIops, explainIops, iopsBasis, opCosts, osdEquivalents, type OsdIops } from './iops'
import { defaultPoolOptions } from './pool'
import { buildBasicTopology, deviceClassUsage, newBucket, newOsdGroup, topologyStats, TOPOLOGY_EXAMPLES } from './topology'
import type { Scheme } from './ceph'

const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }
const ec = (k: number, m: number): Scheme => ({ kind: 'ec', k, m })
const classic = defaultPoolOptions()
const optimized = { ...classic, ecOptimizations: true }

/** One device class: all OSDs alike in their IOPS. */
const one = (osd: OsdIops, placedTB: number, largestOsdTB: number, ioSizeKiB?: number) =>
  iopsBasis([{ cls: 'ssd', osd, largestOsdTB }], placedTB, ioSizeKiB)

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

describe('opCosts with a client I/O size', () => {
  const su = (stripeUnitKiB: number, ecOptimizations = false) => ({ ...classic, stripeUnitKiB, ecOptimizations })

  it('writes whole stripes without reading (classic EC)', () => {
    // EC 4+2, stripe_unit 4K: stripe width 16K
    expect(opCosts(ec(4, 2), su(4), 8).write).toEqual({ reads: 4, writes: 6 })
    expect(opCosts(ec(4, 2), su(4), 16).write).toEqual({ reads: 0, writes: 6 })
    expect(opCosts(ec(4, 2), su(4), 64).write).toEqual({ reads: 0, writes: 6 })
    // EC 6+2, stripe_unit 4K: 32K = one 24K stripe + an 8K remainder that needs read-modify-write
    expect(opCosts(ec(6, 2), su(4), 32).write).toEqual({ reads: 6, writes: 8 })
    expect(opCosts(ec(4, 2), su(4), 64).read).toEqual({ reads: 4, writes: 0 })
  })

  it('matches the FastEC table for EC 6+2 with stripe_unit 16K', () => {
    for (const size of [4, 8, 16]) expect(opCosts(ec(6, 2), su(16, true), size).write).toEqual({ reads: 3, writes: 3 })
    expect(opCosts(ec(6, 2), su(16, true), 32).write).toEqual({ reads: 4, writes: 4 })
  })

  it('reads only the data shards a request touches with EC optimizations', () => {
    expect(opCosts(ec(4, 2), su(4, true), 8).read).toEqual({ reads: 2, writes: 0 })
    expect(opCosts(ec(4, 2), su(4, true), 16).read).toEqual({ reads: 4, writes: 0 })
    expect(opCosts(ec(4, 2), su(16, true), 16).read).toEqual({ reads: 1, writes: 0 })
  })

  it('leaves replication alone (the per-OSD IOPS are given at the I/O size)', () => {
    expect(opCosts(rep3, classic, 1024)).toEqual(opCosts(rep3, classic, 4))
  })

  it('makes stripe_unit matter for 16K writes on 8 OSDs at 100 IOPS', () => {
    const basis = one({ read: 100, write: 100 }, 8, 1, 16)!
    expect(estimateIops(basis, ec(4, 2), su(4)).write).toBeCloseTo(800 / 6, 9) // whole stripe
    expect(estimateIops(basis, ec(4, 2), su(16)).write).toBe(80) // read-modify-write
  })
})

describe('cluster IOPS', () => {
  const basis = one({ read: 200, write: 200 }, 12 * 8, 8)!

  it('matches the FAQ example: 12 OSDs at 200 IOPS', () => {
    expect(basis.classes[0].equivalents).toBe(12)
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
    const r = estimateIops(one({ read: 200, write: 200 }, stats.rawTB, stats.largestOsdTB)!, rep3, classic)
    expect([r.read, r.write]).toEqual([8400, 2800])
  })

  it('needs the inputs an operation uses', () => {
    expect(one({ read: 0, write: 0 }, 96, 8)).toBeNull()
    const readOnly = one({ read: 500, write: 0 }, 96, 8)!
    expect(estimateIops(readOnly, rep3, classic)).toMatchObject({ read: 6000, write: null })
    // classic EC writes read and write
    expect(estimateIops(one({ read: 0, write: 300 }, 96, 8)!, ec(4, 2), classic).write).toBeNull()
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

describe('explainIops', () => {
  it('writes out the arithmetic of an estimate', () => {
    const basis = one({ read: 100, write: 100 }, 8 * 4, 4)!
    const optimized = estimateIops(basis, ec(4, 2), { ...classic, ecOptimizations: true })
    expect(explainIops(optimized, 'read')).toBe('8 OSDs × 100 IOPS ÷ 1 OSD read = 800')
    expect(explainIops(optimized, 'write')).toBe('8 OSDs ÷ (3 reads ÷ 100 + 3 writes ÷ 100 IOPS) = 133')
    const rep = estimateIops(basis, rep3, classic)
    expect(explainIops(rep, 'write')).toBe('8 OSDs × 100 IOPS ÷ 3 OSD writes = 267')
    const mixed = estimateIops(one({ read: 100, write: 0 }, 85, 2)!, rep3, classic)
    expect(explainIops(mixed, 'read')).toBe('42.5 capacity-weighted OSDs × 100 IOPS ÷ 1 OSD read = 4,250')
    expect(explainIops(mixed, 'write')).toBeNull()
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

describe('mixed device classes', () => {
  // any device class: 3 hosts × 8 ssd OSDs of 8 TB and 2 hosts × 8 hdd OSDs of 16 TB = 448 TB
  const tree = [
    newBucket('host', 'ssd01', { count: 3, osds: [newOsdGroup(8, 8)] }),
    newBucket('host', 'hdd01', { count: 2, osds: [newOsdGroup(8, 16, 'hdd')] }),
  ]
  const usage = deviceClassUsage(tree)
  const basis = (ssd: OsdIops, hdd: OsdIops) =>
    iopsBasis(
      [
        { cls: 'hdd', osd: hdd, largestOsdTB: usage.hdd.largestTB },
        { cls: 'ssd', osd: ssd, largestOsdTB: usage.ssd.largestTB },
      ],
      448,
    )!

  it('limits the pool to the class whose OSDs saturate first', () => {
    expect([usage.ssd.largestTB, usage.hdd.largestTB]).toEqual([8, 16])
    // ssd: 448 ÷ 8 = 56 × 50 000; hdd: 448 ÷ 16 = 28 × 200 → the hdd OSDs limit reads to 5 600
    const r = estimateIops(basis({ read: 50_000, write: 20_000 }, { read: 200, write: 150 }), rep3, classic)
    expect(r.read).toBe(5600)
    expect(r.ops.read.limiting?.cls).toBe('hdd')
    expect(r.ops.read.perClass).toEqual([
      { cls: 'hdd', value: 5600 },
      { cls: 'ssd', value: 2_800_000 },
    ])
    expect(r.write).toBe(1400) // 28 × 150 ÷ 3
    expect(explainIops(r, 'read')).toBe('hdd OSDs saturate first: (448 TB ÷ 16 TB) × 200 IOPS ÷ 1 OSD read = 5,600 (ssd: 2,800,000)')
  })

  it('needs the values of every class the pool uses', () => {
    const r = estimateIops(basis({ read: 50_000, write: 20_000 }, { read: 0, write: 0 }), rep3, classic)
    expect([r.read, r.write]).toEqual([null, null])
    expect(r.ops.read.missing).toEqual(['hdd'])
    expect(explainIops(r, 'read')).toBeNull()
  })

  it('treats the Basic tab as one set of values without a class', () => {
    const basic = iopsBasis([{ cls: BASIC_IOPS, osd: { read: 200, write: 0 }, largestOsdTB: 8 }], 320)!
    const r = estimateIops(basic, rep3, classic)
    expect(explainIops(r, 'read')).toBe('40 OSDs × 200 IOPS ÷ 1 OSD read = 8,000')
    expect(r.ops.write.missing).toEqual([BASIC_IOPS])
  })

  it('stays hidden until IOPS are entered for some class', () => {
    const none = { read: 0, write: 0 }
    expect(basis(none, none)).toBeNull()
    // values only for a class the rule doesn't use still show the estimate (with its gaps)
    expect(iopsBasis([{ cls: 'ssd', osd: none, largestOsdTB: 8 }], 192, 4, true)).not.toBeNull()
  })
})

