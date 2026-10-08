import { describe, expect, it } from 'vitest'
import {
  BUCKET_TYPES,
  buildBasicTopology,
  buildExampleTopology,
  childTypesFor,
  collectNames,
  duplicateBucket,
  failureDomains,
  newBucket,
  newOsdGroup,
  nextFreeName,
  presentTypes,
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
    expect(defaultState().pricePerTB).toBe(500)
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
