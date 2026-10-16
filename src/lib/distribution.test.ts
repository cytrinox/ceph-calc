import { describe, expect, it } from 'vitest'
import { computeCapacity, DEFAULT_RATIOS } from './ceph'
import { distributionSegments } from './distribution'
import { buildBasicTopology, failureDomains } from './topology'

const tunables = {
  fullRatio: DEFAULT_RATIOS.full,
  backfillfullRatio: DEFAULT_RATIOS.backfillfull,
  nearfullRatio: DEFAULT_RATIOS.nearfull,
  recoveryReserve: 0,
}
const input = failureDomains(buildBasicTopology({ hosts: 5, osdsPerHost: 8, osdSizeTB: 8 }), 'host')
const pcts = (size: number) =>
  distributionSegments(computeCapacity(input, { kind: 'replicated', size, minSize: 1 }, tunables)).map((s) => s.pct)

describe('distributionSegments', () => {
  it('labels the parts so they add up to 100%', () => {
    // 85% stored: ÷ 2 is 42.5% each, which whole percents would show as 43% + 43% + 15%
    expect(pcts(2)).toEqual(['42.5%', '42.5%', '15%', '0%'])
    // 28.3 + 56.7 + 15 → 28 + 57 + 15 = 100
    expect(pcts(3)).toEqual(['28%', '57%', '15%', '0%'])
  })
})
