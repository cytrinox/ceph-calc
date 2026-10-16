// Parts of the raw capacity, shared by the distribution bar and its legend.

import type { CapacityResult } from './ceph'
import { formatShares } from './format'

export type SegmentKey = 'usable' | 'protection' | 'reserved' | 'unusable'

export interface Segment {
  key: SegmentKey
  label: string
  note: string
  tb: number
  /** Share of the raw capacity, as shown (formatShares: one decimal when whole percents wouldn't add up). */
  pct: string
}

export function distributionSegments(result: CapacityResult): Segment[] {
  const parts = [
    { key: 'usable', label: 'Usable data', note: 'what you can store', tb: result.usableTB },
    { key: 'protection', label: 'Protection overhead', note: 'replicas / parity', tb: result.protectionTB },
    { key: 'reserved', label: 'Reserved headroom', note: 'kept free on purpose', tb: result.reservedTB },
    { key: 'unusable', label: 'Unusable', note: 'can never be filled', tb: result.unusableTB },
  ] as const
  const pcts = formatShares(parts.map((p) => (result.rawTB > 0 ? p.tb / result.rawTB : 0)))
  return parts.map((p, i) => ({ ...p, pct: pcts[i] }))
}
