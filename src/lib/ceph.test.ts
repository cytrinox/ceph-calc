import { describe, expect, it } from 'vitest'
import { computeCapacity, defaultMinSize, dataUntilRatio, placeableCapacity, placementHint, placementMessage, rawUntilRatio, ratiosOrdered, schemeMinSize, type Scheme } from './ceph'
import { buildBasicTopology, failureDomains } from './topology'
import { DEFAULT_SCHEME, PRESETS } from './schemes'

const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }
const ec42: Scheme = { kind: 'ec', k: 4, m: 2 }
const ec21: Scheme = { kind: 'ec', k: 2, m: 1 }

const basic = (hosts: number, osdsPerHost: number, osdSizeTB: number) =>
  failureDomains(buildBasicTopology({ hosts, osdsPerHost, osdSizeTB }), 'host')

describe('computeCapacity', () => {
  it('matches the mockup: 5 × 8 × 8 TB, 3x, fill limit 0.85, one host recovery reserve', () => {
    const r = computeCapacity(basic(5, 8, 8), rep3, { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85, healDomains: 1 })
    expect(r.valid).toBe(true)
    expect(r.rawTB).toBe(320)
    expect(r.usableTB).toBeCloseTo(72.533, 2)
    expect(Math.round(r.efficiency * 100)).toBe(23)
    expect(r.failuresTolerated).toBe(2)
    expect(r.ioFailuresTolerated).toBe(1)
    expect(r.minDomains).toBe(4)
    expect(r.protectionTB).toBeCloseTo(145.07, 1)
    expect(r.reserved.healTB).toBe(64)
    expect(r.reserved.nearfullHeadroomTB).toBeCloseTo(38.4, 6)
    expect(r.usableTB + r.protectionTB + r.reservedTB).toBeCloseTo(r.rawTB, 6)
  })

  it('reduces to raw × (D−N)/D × nearfull × k/(k+m) for uniform EC', () => {
    const r = computeCapacity(basic(10, 12, 16), ec42, { fullRatio: 0.95, backfillfullRatio: 0.95, nearfullRatio: 0.85, healDomains: 2 })
    expect(r.usableTB).toBeCloseTo(1920 * (8 / 10) * 0.85 * (4 / 6), 6)
  })

  it('flags schemes that need more failure domains', () => {
    const domains = basic(5, 8, 8)
    expect(computeCapacity(domains, ec42, { fullRatio: 0.95, backfillfullRatio: 0.95, nearfullRatio: 0.85, healDomains: 1 })).toMatchObject({
      valid: false,
      minDomains: 7,
    })
    expect(computeCapacity(domains, ec21, { fullRatio: 0.95, backfillfullRatio: 0.95, nearfullRatio: 0.85, healDomains: 1 }).valid).toBe(true)
    expect(computeCapacity(basic(3, 8, 8), ec21, { fullRatio: 0.95, backfillfullRatio: 0.95, nearfullRatio: 0.85, healDomains: 1 }).valid).toBe(false)
    expect(computeCapacity(basic(3, 8, 8), ec21, { fullRatio: 0.95, backfillfullRatio: 0.95, nearfullRatio: 0.85, healDomains: 0 }).valid).toBe(true)
  })

  it('strands capacity of oversized domains (water-filling)', () => {
    const input = {
      groups: [
        { capTB: 100, mult: 1 },
        { capTB: 10, mult: 2 },
      ],
      unplacedTB: 0,
    }
    const r = computeCapacity(input, rep3, { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 1, healDomains: 0 })
    expect(r.reserved.strandedTB).toBeCloseTo(90, 6)
    expect(r.usableTB).toBeCloseTo(10, 6)
  })

  it('reserves the largest domain for the recovery reserve', () => {
    const input = {
      groups: [
        { capTB: 50, mult: 1 },
        { capTB: 20, mult: 4 },
      ],
      unplacedTB: 0,
    }
    const r = computeCapacity(input, rep3, { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 1, healDomains: 1 })
    expect(r.reserved.healTB).toBe(50)
    expect(r.reserved.strandedTB).toBeCloseTo(0, 6)
    expect(r.usableTB).toBeCloseTo(80 / 3, 6)
  })

  it('counts unplaced capacity as reserved', () => {
    const r = computeCapacity({ groups: [{ capTB: 10, mult: 3 }], unplacedTB: 20 }, rep3, {
      fullRatio: 1,
      backfillfullRatio: 1,
      nearfullRatio: 1,
      healDomains: 0,
    })
    expect(r.rawTB).toBe(50)
    expect(r.usableTB).toBeCloseTo(10, 6)
    expect(r.reservedTB).toBe(20)
  })
})

describe('presets', () => {
  it('lists replication 2x–4x first, then EC by k and m, with 3x as default', () => {
    expect(PRESETS.map((p) => p.label)).toEqual([
      'Replication 2x', 'Replication 3x', 'Replication 4x',
      'EC 2+1', 'EC 2+2', 'EC 4+2', 'EC 4+3', 'EC 6+2', 'EC 6+3', 'EC 8+2', 'EC 8+3',
    ])
    expect(DEFAULT_SCHEME).toEqual({ kind: 'replicated', size: 3, minSize: 2 })
  })
})

describe('FAQ example', () => {
  it('4 hosts × 10 TB, 3x: full 13.3 TB, real 11.3 TB, with recovery reserve 1: 8.5 TB', () => {
    const domains = basic(4, 1, 10)
    const ratios = { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85 }
    const full = computeCapacity(domains, rep3, { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 1, healDomains: 0 })
    expect(full.usableTB).toBeCloseTo(40 / 3, 9)
    const real = computeCapacity(domains, rep3, { ...ratios, healDomains: 0 })
    expect(real.usableTB).toBeCloseTo((40 / 3) * 0.85, 9)
    const reserved = computeCapacity(domains, rep3, { ...ratios, healDomains: 1 })
    expect(reserved.usableTB).toBeCloseTo(8.5, 9)
  })
})

describe('FAQ mixed-size example', () => {
  it('hosts 20 + 10 + 10 + 10 TB, 3x: full 15 TB, real 12.75 TB, with recovery reserve 1: 8.5 TB', () => {
    const mixed = { groups: [{ capTB: 20, mult: 1 }, { capTB: 10, mult: 3 }], unplacedTB: 0 }
    const ratios = { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85 }
    const full = computeCapacity(mixed, rep3, { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 1, healDomains: 0 })
    expect(full.usableTB).toBeCloseTo(15, 9)
    expect(full.reserved.strandedTB).toBeCloseTo(5, 9)
    expect(computeCapacity(mixed, rep3, { ...ratios, healDomains: 0 }).usableTB).toBeCloseTo(12.75, 9)
    const reserved = computeCapacity(mixed, rep3, { ...ratios, healDomains: 1 })
    expect(reserved.reserved.healTB).toBe(20)
    expect(reserved.usableTB).toBeCloseTo(8.5, 9)
  })
})

describe('FAQ recovery reserve example', () => {
  it('5 hosts × 40 TB, 3x: 56.7 TB without reserve, 45.3 TB with reserve 1', () => {
    const domains = basic(5, 1, 40)
    const ratios = { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85 }
    const none = computeCapacity(domains, rep3, { ...ratios, healDomains: 0 })
    expect(none.usableTB).toBeCloseTo((200 * 0.85) / 3, 9)
    expect(none.usableTB * 3).toBeCloseTo(170, 9) // raw data stored; > 160 TB left after one host fails
    const one = computeCapacity(domains, rep3, { ...ratios, healDomains: 1 })
    expect(one.usableTB).toBeCloseTo((160 * 0.85) / 3, 9)
    expect((one.usableTB * 3) / 160).toBeCloseTo(0.85, 9) // fits on the remaining hosts at nearfull
  })
})

describe('rawUntilRatio', () => {
  const ratios = { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85 }
  it('measures raw space from the planned fill to backfillfull and full', () => {
    const r0 = computeCapacity(basic(5, 8, 8), rep3, { ...ratios, healDomains: 0 })
    expect(rawUntilRatio(r0, 'backfillfull')).toBeCloseTo(320 * 0.9 - 320 * 0.85, 9) // 16 TB
    expect(rawUntilRatio(r0, 'full')).toBeCloseTo(320 * 0.95 - 320 * 0.85, 9) // 32 TB
    const r1 = computeCapacity(basic(5, 8, 8), rep3, { ...ratios, healDomains: 1 })
    expect(rawUntilRatio(r1, 'backfillfull')).toBeCloseTo(288 - 256 * 0.85, 9) // 70.4 TB
    expect(rawUntilRatio(r1, 'full')).toBeCloseTo(304 - 256 * 0.85, 9) // 86.4 TB
  })
})

describe('dataUntilRatio', () => {
  it('3 hosts × 10 TB, 3x: 0.5 TB of data until backfillfull, 1 TB until full', () => {
    const r = computeCapacity(basic(3, 1, 10), rep3, { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85, healDomains: 0 })
    expect(r.usableTB).toBeCloseTo(8.5, 9)
    expect(rawUntilRatio(r, 'full')).toBeCloseTo(3, 9)
    expect(dataUntilRatio(r, 'backfillfull')).toBeCloseTo(0.5, 9)
    expect(dataUntilRatio(r, 'full')).toBeCloseTo(1, 9)
    // never beyond the full net capacity (10 TB)
    expect(r.usableTB + dataUntilRatio(r, 'full')).toBeLessThanOrEqual(10)
  })
})

describe('placementHint', () => {
  const eight = basic(8, 4, 8)
  const t = { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85, healDomains: 2 }

  it('names the recovery reserve when only the reserve is missing', () => {
    const r = computeCapacity(eight, { kind: 'ec', k: 6, m: 2 }, t)
    expect(placementHint(r, 'host')).toEqual({ needs: 'needs 8 hosts', reserve: '+ 2 recovery reserve' })
  })

  it('also splits off the reserve when the layout itself does not fit', () => {
    const r = computeCapacity(eight, { kind: 'ec', k: 8, m: 3 }, t)
    expect(placementHint(r, 'host')).toEqual({ needs: 'needs 11 hosts', reserve: '+ 2 recovery reserve' })
    const one = computeCapacity(eight, { kind: 'ec', k: 6, m: 3 }, { ...t, healDomains: 1 })
    expect(placementHint(one, 'host')).toEqual({ needs: 'needs 9 hosts', reserve: '+ 1 recovery reserve' })
  })

  it('shows only the layout requirement without a reserve', () => {
    const r = computeCapacity(eight, { kind: 'ec', k: 6, m: 3 }, { ...t, healDomains: 0 })
    expect(placementHint(r, 'host')).toEqual({ needs: 'needs 9 hosts', reserve: null })
  })

  it('builds the same sentence for the result card and the commands panel', () => {
    const r = computeCapacity(eight, { kind: 'ec', k: 6, m: 2 }, t)
    expect(placementMessage(r, 'host')).toBe('Not enough hosts: needs 8 hosts (+ 2 recovery reserve), you have 8.')
    const plain = computeCapacity(eight, { kind: 'ec', k: 6, m: 3 }, { ...t, healDomains: 0 })
    expect(placementMessage(plain, 'host')).toBe('Not enough hosts: needs 9 hosts, you have 8.')
    const badScheme = computeCapacity(eight, { kind: 'replicated', size: 2, minSize: 3 }, { ...t, healDomains: 0 })
    expect(placementMessage(badScheme, 'host')).toBe('The pool layout is not valid.')
    expect(placementMessage(computeCapacity(eight, rep3, t), 'host')).toBeNull()
  })

  it('returns null for placeable layouts', () => {
    expect(placementHint(computeCapacity(eight, rep3, t), 'host')).toBeNull()
  })
})

describe('min_size defaults', () => {
  it('uses k+1 for EC with m >= 2 and k for m = 1', () => {
    expect(schemeMinSize({ kind: 'ec', k: 4, m: 2 })).toBe(5)
    expect(schemeMinSize({ kind: 'ec', k: 8, m: 3 })).toBe(9)
    expect(schemeMinSize({ kind: 'ec', k: 2, m: 1 })).toBe(2)
    const r = computeCapacity(basic(5, 8, 8), ec21, { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85, healDomains: 1 })
    expect(r.minSize).toBe(2)
    expect(r.ioFailuresTolerated).toBe(1)
  })

  it('uses size - floor(size/2) for replication', () => {
    expect([1, 2, 3, 4, 5].map(defaultMinSize)).toEqual([1, 1, 2, 2, 3])
  })
})

describe('fill ratios', () => {
  const ratios = { fullRatio: 0.95, backfillfullRatio: 0.9, nearfullRatio: 0.85 }
  const ec82: Scheme = { kind: 'ec', k: 8, m: 2 }
  const twenty = basic(20, 4, 5) // 400 TB raw

  it('keeps OSDs below nearfull after recovery: every reserved host costs capacity', () => {
    const reserved = [0, 1, 2, 3].map((heal) => {
      const r = computeCapacity(twenty, ec82, { ...ratios, healDomains: heal })
      expect(r.usableTB + r.protectionTB).toBeCloseTo((400 - heal * 20) * 0.85, 6)
      return r.reservedTB / r.rawTB
    })
    expect(reserved.map((x) => Math.round(x * 1000) / 10)).toEqual([15, 19.3, 23.5, 27.8])
  })

  it('never lets stored data pass the nearfull marker', () => {
    for (const hosts of [4, 5, 8, 20, 100, 1000]) {
      for (const heal of [0, 1]) {
        const r = computeCapacity(basic(hosts, 8, 8), rep3, { ...ratios, healDomains: heal })
        expect(r.usableTB + r.protectionTB).toBeLessThanOrEqual(r.healthyPlaceableTB * r.fillRatios.nearfull + 1e-9)
        expect(r.usableTB + r.protectionTB + r.reservedTB).toBeCloseTo(r.rawTB, 6)
      }
    }
  })

  it('reports how full healthy OSDs get', () => {
    const r = computeCapacity(basic(5, 8, 8), rep3, { ...ratios, healDomains: 1 })
    expect(r.healthyFill).toBeCloseTo((256 * 0.85) / 320, 6) // 68%
    expect(r.healthyPlaceableTB).toBe(320)
  })

  it('handles the full 0–1 ratio range', () => {
    const zero = computeCapacity(basic(5, 8, 8), rep3, { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 0, healDomains: 1 })
    expect(zero.valid).toBe(true)
    expect(zero.usableTB).toBe(0)
    expect(zero.usableTB + zero.protectionTB + zero.reservedTB).toBeCloseTo(320, 6)
    const one = computeCapacity(basic(5, 8, 8), rep3, { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 1, healDomains: 0 })
    expect(one.usableTB).toBeCloseTo(320 / 3, 6)
  })

  it('clamps backfillfull and nearfull to full', () => {
    const r = computeCapacity(basic(5, 8, 8), rep3, {
      fullRatio: 0.9,
      backfillfullRatio: 0.95,
      nearfullRatio: 0.97,
      healDomains: 1,
    })
    expect(r.fillRatios).toEqual({ nearfull: 0.9, backfillfull: 0.9, full: 0.9 })
    expect(ratiosOrdered({ fullRatio: 0.9, backfillfullRatio: 0.95, nearfullRatio: 0.85 })).toBe(false)
  })
})

describe('placeableCapacity', () => {
  it('returns the total for balanced domains', () => {
    expect(placeableCapacity([10, 10, 10], 50, 3)).toBe(50)
  })
  it('caps several oversized domains', () => {
    // [100, 100, 10, 10] with width 3: two capped domains, S = 20 * 3 / 1 = 60
    expect(placeableCapacity([100, 100, 10], 220, 3)).toBe(60)
  })
})
