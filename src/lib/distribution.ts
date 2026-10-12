// Parts of the raw capacity, shared by the distribution bar and its legend.

import type { CapacityResult } from './ceph'

export type SegmentKey = 'usable' | 'protection' | 'reserved' | 'unusable'

export interface Segment {
  key: SegmentKey
  label: string
  note: string
  tb: number
}

export function distributionSegments(result: CapacityResult): Segment[] {
  return [
    { key: 'usable', label: 'Usable data', note: 'what you can store', tb: result.usableTB },
    { key: 'protection', label: 'Protection overhead', note: 'replicas / parity', tb: result.protectionTB },
    { key: 'reserved', label: 'Reserved headroom', note: 'kept free on purpose', tb: result.reservedTB },
    { key: 'unusable', label: 'Unusable', note: 'can never be filled', tb: result.unusableTB },
  ]
}
