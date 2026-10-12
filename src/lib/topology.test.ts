import { describe, expect, it } from 'vitest'
import {
  BUCKET_TYPES,
  buildBasicTopology,
  buildExampleTopology,
  childTypesFor,
  collectNames,
  deviceClassUsage,
  duplicateBucket,
  failureDomains,
  filterDeviceClass,
  isValidDeviceClass,
  sortDeviceClasses,
  newBucket,
  newOsdGroup,
  nextFreeName,
  presentTypes,
  renameForType,
  splitBucket,
  SPLIT_LIMIT,
  topologyStats,
  TOPOLOGY_EXAMPLES,
  UNBALANCED_SPREAD,
  domainBalance,
} from './topology'
import { decodeState, defaultState, encodeState } from './urlState'
import { computeCapacity, DEFAULT_RATIOS } from './ceph'

const example = (id: string) => TOPOLOGY_EXAMPLES.find((e) => e.id === id)!.build()

describe('topology', () => {
  it('expands multipliers in the 2-datacenter example', () => {
    const t = buildExampleTopology()
    const stats = topologyStats(t)
    expect(stats.counts.datacenter).toBe(2)
    expect(stats.counts.row).toBe(10)
    expect(stats.counts.rack).toBe(200)
    expect(stats.counts.host).toBe(4000)
    expect(stats.counts.osd).toBe(40000)
    expect(stats.rawTB).toBe(640000)
    expect(failureDomains(t, 'rack').groups).toEqual([{ capTB: 3200, mult: 200 }])
    expect(failureDomains(t, 'datacenter').groups).toEqual([
      { capTB: 448000, mult: 1 },
      { capTB: 192000, mult: 1 },
    ])
    expect(failureDomains(t, 'osd').groups).toEqual([{ capTB: 16, mult: 40000 }])
    expect(presentTypes(t)).toEqual(['host', 'rack', 'row', 'datacenter'])
  })

  it('reports hosts outside the failure-domain type as unplaced', () => {
    const rack = newBucket('rack', 'rack1', {
      children: [newBucket('host', 'h1', { count: 3, osds: [newOsdGroup(4, 10)] })],
    })
    const stray = newBucket('host', 'h9', { osds: [newOsdGroup(2, 10)] })
    const d = failureDomains([rack, stray], 'rack')
    expect(d.groups).toEqual([{ capTB: 120, mult: 1 }])
    expect(d.unplacedTB).toBe(20)
    expect(d.unplacedHosts).toBe(1)
  })

  it('counts failure domains without OSD capacity separately', () => {
    const empty = newBucket('rack', 'rack01', { count: 4, children: [newBucket('host', 'host01', { osds: [] })] })
    expect(failureDomains([empty], 'rack')).toMatchObject({ groups: [], emptyDomains: 4 })
    const filled = newBucket('rack', 'rack05', { count: 2, children: [newBucket('host', 'host05', { osds: [newOsdGroup(2, 8)] })] })
    const half = newBucket('rack', 'rack01', { count: 2, children: [newBucket('host', 'host01', { osds: [] })] })
    expect(failureDomains([half, filled], 'rack')).toMatchObject({ groups: [{ capTB: 16, mult: 2 }], emptyDomains: 2 })
    const zeroOsds = newBucket('host', 'host01', { osds: [newOsdGroup(3, 0), newOsdGroup(2, 4)] })
    expect(failureDomains([zeroOsds], 'osd')).toMatchObject({ groups: [{ capTB: 4, mult: 2 }], emptyDomains: 3 })
  })

  it('builds the basic hosts as one host with a multiplier', () => {
    const small = buildBasicTopology({ hosts: 5, osdsPerHost: 8, osdSizeTB: 8 })
    expect(small).toHaveLength(1)
    expect(small[0]).toMatchObject({ type: 'host', name: 'host01', count: 5 })
    expect(topologyStats(small)).toMatchObject({ rawTB: 320, counts: { host: 5, osd: 40 } })
    const big = buildBasicTopology({ hosts: 100, osdsPerHost: 8, osdSizeTB: 8 })
    expect(big).toHaveLength(1)
    expect(big[0]).toMatchObject({ name: 'host001', count: 100 })
    expect(topologyStats(big).counts.osd).toBe(800)
    expect(buildBasicTopology({ hosts: 0, osdsPerHost: 8, osdSizeTB: 8 })).toEqual([])
  })

  it('generates unique names and ids when duplicating and splitting', () => {
    const t = [newBucket('rack', 'rack01', { children: [newBucket('host', 'host01')] })]
    const used = collectNames(t)
    const copy = duplicateBucket(t, 0, used)
    expect(copy.name).toBe('rack02')
    expect(copy.children[0].name).toBe('host02')
    expect(copy.id).not.toBe(t[0].id)
    t[1].count = 3
    expect(splitBucket(t, 1, used)).toBe(3)
    expect(t.map((b) => b.name)).toEqual(['rack01', 'rack02', 'rack03', 'rack04'])
    expect(t.every((b) => b.count === 1)).toBe(true)
    expect(nextFreeName('dc', new Set(['dc']))).toBe('dc2')
  })

  it('never loses copies when splitting above the limit', () => {
    const big = [newBucket('rack', 'rack01', { count: 1000, children: [newBucket('host', 'host01', { count: 4 })] })]
    const before = topologyStats(big)
    expect(splitBucket(big, 0, collectNames(big))).toBe(SPLIT_LIMIT)
    expect(big).toHaveLength(SPLIT_LIMIT)
    expect(big.reduce((n, b) => n + b.count, 0)).toBe(1000)
    expect(big[big.length - 1].count).toBe(1000 - (SPLIT_LIMIT - 1))
    expect(topologyStats(big)).toEqual(before)

    const small = [newBucket('rack', 'rack01', { count: 300 })]
    expect(splitBucket(small, 0, collectNames(small))).toBe(300)
    expect(small.every((b) => b.count === 1)).toBe(true)
  })

  it('renames generated names when the bucket type changes', () => {
    const used = new Set(['room1', 'room1-row1', 'room1-host1'])
    // the name the + button generated follows the new type, kept unique
    expect(renameForType('room1-row1', 'row', 'host', used)).toBe('room1-host2')
    expect(renameForType('row3', 'row', 'rack', new Set())).toBe('rack3')
    // only the type as a word, the last one: room1 contains no "row", and the parent's type stays
    expect(renameForType('row1-row2', 'row', 'pdu', new Set())).toBe('row1-pdu2')
    expect(renameForType('growth1', 'row', 'host', new Set())).toBe('growth1')
    // names of your own are kept
    expect(renameForType('ceph-node-a', 'host', 'rack', new Set())).toBe('ceph-node-a')
  })

  it('restricts child types to lower CRUSH types', () => {
    expect(childTypesFor('rack')).toEqual(['host', 'chassis'])
    expect(childTypesFor('host')).toEqual([])
    expect(childTypesFor(null)).toHaveLength(10)
  })

  it('measures the size spread of failure domains', () => {
    const unbalanced = failureDomains(example('unbalanced'), 'rack').groups
    expect(domainBalance(unbalanced)).toEqual({ smallestTB: 384, largestTB: 1152, averageTB: 864, spread: 0.5555555555555556 })
    const even = failureDomains(example('racks'), 'rack').groups
    expect(domainBalance(even)!.spread).toBe(0)
    expect(domainBalance([{ capTB: 10, mult: 1 }])).toBeNull()
    // single host: OSDs are the failure domain; 5 × 4 TB + 1 × 1 TB
    const osds = failureDomains(example('single-host'), 'osd').groups
    expect(osds).toEqual([
      { capTB: 4, mult: 5 },
      { capTB: 1, mult: 1 },
    ])
    expect(domainBalance(osds)!.spread).toBeGreaterThan(UNBALANCED_SPREAD)
  })

  it('provides valid example topologies', () => {
    expect(TOPOLOGY_EXAMPLES).toHaveLength(9)
    for (const ex of TOPOLOGY_EXAMPLES) {
      const t = ex.build()
      expect(topologyStats(t).rawTB).toBeGreaterThan(0)
      const types = presentTypes(t)
      if (ex.domain !== 'osd') expect(types).toContain(ex.domain)
      // every capacity sits under a bucket of the suggested failure domain
      expect(failureDomains(t, ex.domain).unplacedTB).toBe(0)
      // its redundancy and headroom settings fit the topology
      const r = computeCapacity(failureDomains(t, ex.domain), ex.scheme, {
        fullRatio: DEFAULT_RATIOS.full,
        backfillfullRatio: DEFAULT_RATIOS.backfillfull,
        nearfullRatio: DEFAULT_RATIOS.nearfull,
        recoveryReserve: ex.recoveryReserve,
      })
      expect(r.valid, ex.id).toBe(true)
      expect(ex.recoveryReserve, ex.id).toBeGreaterThanOrEqual(1)
    }
    expect(topologyStats(example('chassis')).counts).toMatchObject({ rack: 2, chassis: 6, host: 24 })
    // Same numbers as the FAQ's mixed-size example.
    const unbalanced = TOPOLOGY_EXAMPLES.find((e) => e.id === 'unbalanced-hosts')!
    const r = computeCapacity(failureDomains(unbalanced.build(), 'host'), unbalanced.scheme, {
      fullRatio: DEFAULT_RATIOS.full,
      backfillfullRatio: DEFAULT_RATIOS.backfillfull,
      nearfullRatio: DEFAULT_RATIOS.nearfull,
      recoveryReserve: unbalanced.recoveryReserve,
    })
    expect(r.usableTB).toBeCloseTo(8.5, 9)
    expect(r.unusable.strandedTB).toBeCloseTo(5, 9)
    expect(r.reserved.recoveryReserveTB).toBeCloseTo(15, 9)
  })

  it('starts a first visit with replication 3x and no recovery reserve', () => {
    expect(defaultState().scheme).toEqual({ kind: 'replicated', size: 3, minSize: 2 })
    expect(defaultState().recoveryReserve).toBe(0)
  })

  it('stores the price per TB in shared links', () => {
    expect(defaultState().pricePerTB).toBe(0)
    const state = defaultState()
    state.pricePerTB = 650
    expect(decodeState(encodeState(state))!.pricePerTB).toBe(650)
  })

  it('cuts the currency in shared links to the input length', () => {
    const state = defaultState()
    state.currency = 'Dollars'
    expect(decodeState(encodeState(state))!.currency).toBe('Dollar')
  })

  it('keeps ratios of 0 and 1 in shared links', () => {
    const state = defaultState()
    state.nearfullRatio = 0
    state.backfillfullRatio = 0.4
    state.fullRatio = 1
    const decoded = decodeState(encodeState(state))!
    expect([decoded.nearfullRatio, decoded.backfillfullRatio, decoded.fullRatio]).toEqual([0, 0.4, 1])
  })

  it('stores the per-OSD IOPS in shared links only when set', () => {
    const state = defaultState()
    expect([state.osdReadIops, state.osdWriteIops]).toEqual([0, 0])
    expect(encodeState(state)).toBe(encodeState(decodeState(encodeState(state))!))
    state.osdReadIops = 5000
    state.osdWriteIops = 99_000_000
    state.ioSizeKiB = 64
    const decoded = decodeState(encodeState(state))!
    expect([decoded.osdReadIops, decoded.osdWriteIops, decoded.ioSizeKiB]).toEqual([5000, 10_000_000, 64])
    state.ioSizeKiB = 12 // not a supported size
    expect(decodeState(encodeState(state))!.ioSizeKiB).toBe(4)
  })

  it('stores the virtual CRUSH map switch in shared links only when on', () => {
    const state = defaultState()
    const packed = (st: typeof state) => JSON.parse(Buffer.from(encodeState(st), 'base64url').toString())
    expect(packed(state).cm).toBeUndefined()
    state.crushMap = true
    expect(packed(state).cm).toBe(1)
    expect(decodeState(encodeState(state))!.crushMap).toBe(true)
  })

  it('raises k = 1 from a shared link to the Ceph minimum of 2', () => {
    const state = defaultState()
    state.scheme = { kind: 'ec', k: 1, m: 1 }
    expect(decodeState(encodeState(state))!.scheme).toEqual({ kind: 'ec', k: 2, m: 1 })
  })

  it('stores a non-default EC min_size in shared links', () => {
    const state = defaultState()
    state.scheme = { kind: 'ec', k: 4, m: 2, minSize: 4 }
    expect(decodeState(encodeState(state))!.scheme).toEqual({ kind: 'ec', k: 4, m: 2, minSize: 4 })
    state.scheme = { kind: 'ec', k: 4, m: 2, minSize: 5 } // Ceph's default: not stored
    expect(decodeState(encodeState(state))!.scheme).toEqual({ kind: 'ec', k: 4, m: 2 })
  })

  it('clamps all ratios to 0–1 when encoding a link', () => {
    const state = defaultState()
    state.nearfullRatio = -0.2
    state.backfillfullRatio = 1.4
    state.fullRatio = 7
    const decoded = decodeState(encodeState(state))!
    expect([decoded.nearfullRatio, decoded.backfillfullRatio, decoded.fullRatio]).toEqual([0, 1, 1])
  })

  it('has an example using every bucket type', () => {
    const t = example('all-types')
    expect(presentTypes(t)).toEqual([...BUCKET_TYPES])
    expect(topologyStats(t).counts).toMatchObject({
      region: 1, zone: 2, datacenter: 2, room: 4, pod: 4, pdu: 8, row: 8, rack: 16, chassis: 32, host: 64, osd: 768,
    })
    expect(topologyStats(t).rawTB).toBe(64 * 12 * 16)
  })

  it('round-trips through the URL encoding', () => {
    const state = defaultState()
    state.tab = 'advanced'
    state.advanced = buildExampleTopology()
    state.failureDomain = 'rack'
    state.scheme = { kind: 'ec', k: 8, m: 3 }
    const decoded = decodeState(encodeState(state))!
    expect(decoded.tab).toBe('advanced')
    expect(decoded.failureDomain).toBe('rack')
    expect(decoded.scheme).toEqual(state.scheme)
    expect(topologyStats(decoded.advanced!)).toEqual(topologyStats(state.advanced))
  })
})

describe('device classes', () => {
  // rack1: 3 ssd hosts + 1 mixed host; rack2: 2 hdd hosts; rack3: empty from the start
  const tree = () => [
    newBucket('rack', 'rack1', {
      children: [
        newBucket('host', 'ssd1', { count: 3, osds: [newOsdGroup(8, 4)] }),
        newBucket('host', 'mixed1', { osds: [newOsdGroup(2, 4), newOsdGroup(6, 16, 'hdd')] }),
      ],
    }),
    newBucket('rack', 'rack2', { children: [newBucket('host', 'hdd1', { count: 2, osds: [newOsdGroup(8, 16, 'hdd')] })] }),
    newBucket('rack', 'rack3'),
  ]

  it('gives new OSD groups the ssd class and seeds basic hosts with a given class', () => {
    expect(newOsdGroup().deviceClass).toBe('ssd')
    expect(buildBasicTopology({ hosts: 3, osdsPerHost: 4, osdSizeTB: 8 })[0].osds[0].deviceClass).toBe('ssd')
    expect(buildBasicTopology({ hosts: 3, osdsPerHost: 4, osdSizeTB: 8 }, 'hdd')[0].osds[0].deviceClass).toBe('hdd')
  })

  it('keeps only the OSDs of the rule class and the buckets that contain them', () => {
    const ssd = filterDeviceClass(tree(), 'ssd')
    // rack2 lost all its OSDs and is dropped; rack3 was empty already and stays
    expect(ssd.map((b) => b.name)).toEqual(['rack1', 'rack3'])
    expect(failureDomains(ssd, 'host').groups).toEqual([
      { capTB: 32, mult: 3 },
      { capTB: 8, mult: 1 },
    ])
    expect(failureDomains(ssd, 'rack')).toMatchObject({ groups: [{ capTB: 104, mult: 1 }], emptyDomains: 1 })
    expect(failureDomains(filterDeviceClass(tree(), 'hdd'), 'host').groups).toEqual([
      { capTB: 128, mult: 2 },
      { capTB: 96, mult: 1 },
    ])
    // nothing of that class: only the bucket that was empty already remains
    expect(filterDeviceClass(tree(), 'nvme').map((b) => b.name)).toEqual(['rack3'])
  })

  it('leaves the tree itself unchanged', () => {
    const t = tree()
    const before = topologyStats(t)
    filterDeviceClass(t, 'hdd')
    expect(topologyStats(t)).toEqual(before)
  })

  it('ignores OSD groups left on a bucket that is no host any more', () => {
    const former = newBucket('rack', 'rack9', { osds: [newOsdGroup(4, 4, 'hdd')] })
    expect(deviceClassUsage([...tree(), former]).hdd).toEqual({ osds: 22, tb: 352 })
  })

  it('counts OSDs and capacity per class with multipliers', () => {
    expect(deviceClassUsage(tree())).toEqual({
      ssd: { osds: 26, tb: 104 },
      hdd: { osds: 22, tb: 352 },
    })
  })

  it('accepts custom device classes with valid CRUSH names', () => {
    for (const name of ['fast', 'ssd-cache', 'tier_2', 'nvme.4k']) expect(isValidDeviceClass(name)).toBe(true)
    for (const name of ['', '-x', 'a b', 'x;rm', 'é', 'x'.repeat(33)]) expect(isValidDeviceClass(name)).toBe(false)
    const t = [...tree(), newBucket('host', 'fast1', { count: 2, osds: [newOsdGroup(4, 2, 'fast')] })]
    expect(failureDomains(filterDeviceClass(t, 'fast'), 'host').groups).toEqual([{ capTB: 8, mult: 2 }])
    expect(sortDeviceClasses(['fast', 'nvme', 'archive', 'hdd', 'fast'])).toEqual(['hdd', 'nvme', 'archive', 'fast'])
  })

  it('stores the class in shared links only when it is not ssd', () => {
    const state = defaultState()
    state.tab = 'advanced'
    state.advanced = tree()
    const encoded = encodeState(state)
    const packed = JSON.parse(Buffer.from(encoded, 'base64url').toString())
    expect(packed.a[0][3][1][4]).toEqual([[2, 4], [6, 16, 'hdd']])
    const decoded = decodeState(encoded)!
    expect(deviceClassUsage(decoded.advanced!)).toEqual(deviceClassUsage(state.advanced))
    // custom classes survive, invalid names from a link fall back to ssd
    packed.a[0][3][1][4][1][2] = 'tape'
    const custom = decodeState(Buffer.from(JSON.stringify(packed)).toString('base64url'))!
    expect(custom.advanced![0].children[1].osds[1].deviceClass).toBe('tape')
    packed.a[0][3][1][4][1][2] = 'x; rm -rf /'
    const tampered = decodeState(Buffer.from(JSON.stringify(packed)).toString('base64url'))!
    expect(tampered.advanced![0].children[1].osds[1].deviceClass).toBe('ssd')
  })
})
