import { describe, expect, it } from 'vitest'
import {
  CRUSH_WEIGHT_MAX,
  crushTreeLines,
  crushTreeRowCount,
  crushTreeText,
  crushWeightOverflow,
  formatCrushWeight,
  initialWeightFor,
  osdCrushWeight,
  printfFixed,
  treeClasses,
} from './crushTree'
import { buildBasicTopology, buildExampleTopology, newBucket, newOsdGroup } from './topology'

const text = (...args: Parameters<typeof crushTreeLines>) => crushTreeText(crushTreeLines(...args))

describe('virtual CRUSH tree', () => {
  it('weighs OSDs by their size in TiB, as the OSD registers it', () => {
    // 1 TB = 0.90949 TiB, registered as "0.9095", stored as (int)(0.9095f × 65536) = 59604
    expect(osdCrushWeight(1)).toBe(59604)
    // 8 TB = 7.27596 TiB → "7.2760" → 476839 → printed 7.27599
    expect(formatCrushWeight(osdCrushWeight(8))).toBe('7.27599')
    expect(osdCrushWeight(0)).toBe(0)
    expect(formatCrushWeight(0)).toBe('0')
  })

  it('rounds like printf and prints weights in single precision', () => {
    expect(printfFixed(7.27595761418, 4)).toBe('7.2760')
    // exact binary ties go to the even digit
    expect(printfFixed(0.015625, 5)).toBe('0.01562')
    expect(printfFixed(0.046875, 5)).toBe('0.04688')
    expect(printfFixed(0.03125, 4)).toBe('0.0312')
    // a float has 24 bits: 2^25 + 1 (512.00002 TiB) prints as 512.00000
    expect(formatCrushWeight(2 ** 25 + 1)).toBe('512.00000')
  })

  it('prints the tree like ceph osd crush tree', () => {
    expect(text(buildBasicTopology({ hosts: 3, osdsPerHost: 2, osdSizeTB: 1 }), false)).toBe(
      [
        'ID  CLASS  WEIGHT   TYPE NAME',
        '-1         5.45691  root default',
        '-3         1.81897      host host01',
        ' 0    ssd  0.90948          osd.0',
        ' 1    ssd  0.90948          osd.1',
        '-5         1.81897      host host02',
        ' 2    ssd  0.90948          osd.2',
        ' 3    ssd  0.90948          osd.3',
        '-7         1.81897      host host03',
        ' 4    ssd  0.90948          osd.4',
        ' 5    ssd  0.90948          osd.5',
      ].join('\n'),
    )
  })

  it('prints a shadow tree per device class first, with every bucket and only its class', () => {
    const topology = [
      newBucket('host', 'a', { osds: [newOsdGroup(1, 1, 'hdd'), newOsdGroup(1, 1)] }),
      newBucket('host', 'b', { osds: [newOsdGroup(1, 1, 'hdd')] }),
    ]
    expect(treeClasses(topology)).toEqual(['hdd', 'ssd'])
    // root default -1, default~hdd -2, default~ssd -3; host a -4 (-5, -6); host b -7 (-8, -9)
    expect(text(topology, true)).toBe(
      [
        'ID  CLASS  WEIGHT   TYPE NAME',
        '-3    ssd  0.90948  root default~ssd',
        '-6    ssd  0.90948      host a~ssd',
        ' 1    ssd  0.90948          osd.1',
        '-9    ssd        0      host b~ssd',
        '-2    hdd  1.81897  root default~hdd',
        '-5    hdd  0.90948      host a~hdd',
        ' 0    hdd  0.90948          osd.0',
        '-8    hdd  0.90948      host b~hdd',
        ' 2    hdd  0.90948          osd.2',
        '-1         2.72845  root default',
        '-4         1.81897      host a',
        ' 0    hdd  0.90948          osd.0',
        ' 1    ssd  0.90948          osd.1',
        '-7         0.90948      host b',
        ' 2    hdd  0.90948          osd.2',
      ].join('\n'),
    )
  })

  it('names every copy of a bucket uniquely', () => {
    const rack = newBucket('rack', 'r1', {
      count: 2,
      children: [newBucket('host', 'h1', { count: 2, osds: [newOsdGroup(1, 1)] })],
    })
    const names = crushTreeLines([rack], false)
      .filter((l) => l.type)
      .map((l) => `${l.type} ${l.name}`)
    expect(names).toEqual(['root default', 'rack r1', 'host h1', 'host h2', 'rack r2', 'host h3', 'host h4'])
  })

  it('shows a limited number of rows per tree and counts the rest', () => {
    const lines = crushTreeLines(buildBasicTopology({ hosts: 3, osdsPerHost: 2, osdSizeTB: 1 }), true, 4)
    expect(lines.filter((l) => l.more !== undefined).map((l) => l.more)).toEqual([6, 6])
    expect(crushTreeText(lines).split('\n')).toContain(`${' '.repeat(24)}… 6 more`)
  })

  it('stays fast for huge clusters', () => {
    // 2 datacenters, 40 000 OSDs
    const lines = crushTreeLines(buildExampleTopology(), true)
    expect(lines.length).toBeLessThanOrEqual(2 * 501)
    expect(lines.at(-1)!.more).toBeGreaterThan(40_000)
  })

  it('counts and prints the complete output for copying', () => {
    const t = buildExampleTopology()
    // root + 2 datacenters + 10 rows + 200 racks + 4 000 hosts + 40 000 OSDs, twice with the ssd shadow tree
    expect(crushTreeRowCount(t, false)).toBe(44_213)
    expect(crushTreeRowCount(t, true)).toBe(88_426)
    const all = crushTreeLines(t, true, Infinity)
    expect(all).toHaveLength(88_426)
    expect(all.some((l) => l.more !== undefined)).toBe(false)
    expect(all.at(-1)!.name).toBe('osd.39999')
    expect(crushTreeText(all).split('\n')).toHaveLength(88_427)
    // more lines than a function call takes arguments
    const huge = [newBucket('host', 'h', { count: 30_000, osds: [newOsdGroup(10, 8)] })]
    expect(crushTreeText(crushTreeLines(huge, false, Infinity)).split('\n')).toHaveLength(330_002)
  })

  it('detects buckets heavier than CRUSH can store', () => {
    expect(crushWeightOverflow(buildBasicTopology({ hosts: 3, osdsPerHost: 2, osdSizeTB: 1 }))).toBeNull()
    // 40 000 × 16 TB = 582 076 TiB; dc1 (3 rows) and dc2 (7 rows) overflow too, a row (58 208 TiB) doesn't
    const over = crushWeightOverflow(buildExampleTopology())!
    expect(Math.round(over.rootWeight / 0x10000)).toBe(582_076)
    expect(over.buckets).toEqual([{ type: 'datacenter', count: 2 }])
    expect(over).toMatchObject({ osds: 40_000, smallestTB: 16, largestTB: 16 })
    // 7 206 OSDs of 10 TB: just above the limit (Ceph refused the 7 206th)
    const host = (count: number) => [newBucket('host', 'h', { count, osds: [newOsdGroup(1, 10)] })]
    expect(crushWeightOverflow(host(7205))).toBeNull()
    expect(crushWeightOverflow(host(7206))!.rootWeight).toBeGreaterThan(CRUSH_WEIGHT_MAX)
  })

  it('picks the largest initial weight that fits', () => {
    expect(initialWeightFor(40_000)).toBe('1')
    expect(initialWeightFor(65_535)).toBe('1')
    expect(initialWeightFor(65_536)).toBe('0.9999')
    expect(initialWeightFor(100_000)).toBe('0.6553')
  })
})
