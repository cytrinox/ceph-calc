// Pure capacity math for a Ceph pool on a set of failure domains.

import { formatInt } from './format'
import { plural, type DomainGroup, type DomainType } from './topology'

export type Scheme =
  | { kind: 'replicated'; size: number; minSize: number }
  | { kind: 'ec'; k: number; m: number }

export interface Tunables {
  /** OSD full ratio: writes stop when an OSD reaches this fill level. */
  fullRatio: number
  /** OSD backfillfull ratio: recovery/backfill stops above this fill level. */
  backfillfullRatio: number
  /** OSD nearfull ratio: HEALTH_WARN above this fill level. */
  nearfullRatio: number
  /** Failure domains that can be lost while keeping room to recover (recovery reserve). */
  healDomains: number
}

/** Ceph defaults (mon_osd_*_ratio). */
export const DEFAULT_RATIOS = { nearfull: 0.85, backfillfull: 0.9, full: 0.95 } as const

/** Ceph requires nearfull ≤ backfillfull ≤ full. */
export function ratiosOrdered(t: Pick<Tunables, 'nearfullRatio' | 'backfillfullRatio' | 'fullRatio'>): boolean {
  return t.nearfullRatio <= t.backfillfullRatio && t.backfillfullRatio <= t.fullRatio
}

const clampRatio = (r: number) => Math.min(1, Math.max(0, r || 0))

export interface CapacityInput {
  groups: DomainGroup[]
  unplacedTB: number
}

export interface ReservedBreakdown {
  healTB: number
  strandedTB: number
  fullMarginTB: number
  unplacedTB: number
}

export interface CapacityResult {
  valid: boolean
  /** Number of usable failure domains. */
  domainCount: number
  /** Failure domains required (width + recovery reserve). */
  minDomains: number
  /** Shards/replicas per object. */
  width: number
  dataFraction: number
  minSize: number
  rawTB: number
  usableTB: number
  protectionTB: number
  reservedTB: number
  reserved: ReservedBreakdown
  /** Fill level of healthy OSDs when the pool holds its usable capacity. */
  healthyFill: number
  /** Raw capacity a healthy cluster can fill (all domains, after imbalance). */
  healthyPlaceableTB: number
  /** Effective (clamped) fill ratios. */
  fillRatios: { nearfull: number; backfillfull: number; full: number }
  /** usable / raw */
  efficiency: number
  /** Failure domains that can be lost without losing data. */
  failuresTolerated: number
  /** Failure domains that can be lost while the pool stays writable. */
  ioFailuresTolerated: number
}

export function schemeWidth(s: Scheme): number {
  return s.kind === 'replicated' ? s.size : s.k + s.m
}

export function schemeDataFraction(s: Scheme): number {
  return s.kind === 'replicated' ? 1 / s.size : s.k / (s.k + s.m)
}

/**
 * Ceph defaults (OSDMonitor::prepare_pool_size):
 * replicated min_size = size - floor(size/2); EC min_size = k + min(1, m - 1),
 * i.e. k + 1 when m >= 2 and k when m = 1.
 */
export function defaultMinSize(size: number): number {
  return size - Math.floor(size / 2)
}

export function schemeMinSize(s: Scheme): number {
  return s.kind === 'replicated' ? s.minSize : s.k + Math.min(1, s.m - 1)
}

export function isSchemeValid(s: Scheme): boolean {
  if (s.kind === 'replicated') {
    return (
      Number.isInteger(s.size) &&
      s.size >= 1 &&
      Number.isInteger(s.minSize) &&
      s.minSize >= 1 &&
      s.minSize <= s.size
    )
  }
  return Number.isInteger(s.k) && s.k >= 1 && Number.isInteger(s.m) && s.m >= 1
}

/** The `count` largest domain capacities, descending. Groups must be sorted descending. */
export function largestDomains(groups: DomainGroup[], count: number): number[] {
  const out: number[] = []
  for (const g of groups) {
    for (let i = 0; i < g.mult && out.length < count; i++) out.push(g.capTB)
    if (out.length >= count) break
  }
  return out
}

/**
 * Raw capacity that can actually be filled when every object places one shard
 * in each of `width` distinct domains ("water-filling"): no domain can hold
 * more than 1/width of the stored shards, so oversized domains strand space.
 *
 * @param largest the largest domain capacities, descending (at least `width` entries)
 * @param total   total capacity of all domains
 */
export function placeableCapacity(largest: number[], total: number, width: number): number {
  let capped = 0
  for (let j = 0; j < width; j++) {
    const s = ((total - capped) * width) / (width - j)
    if (largest[j] <= s / width + 1e-9) return s
    capped += largest[j]
  }
  return total
}

export function computeCapacity(input: CapacityInput, scheme: Scheme, tunables: Tunables): CapacityResult {
  const width = schemeWidth(scheme)
  const dataFraction = schemeDataFraction(scheme)
  const minSize = schemeMinSize(scheme)
  const heal = Math.max(0, Math.floor(tunables.healDomains || 0))
  const fullRatio = clampRatio(tunables.fullRatio)
  const backfillfullRatio = Math.min(fullRatio, clampRatio(tunables.backfillfullRatio))
  const nearfullRatio = Math.min(fullRatio, clampRatio(tunables.nearfullRatio))
  const groups = [...input.groups].sort((a, b) => b.capTB - a.capTB)
  const domainCount = groups.reduce((n, g) => n + g.mult, 0)
  const placedTB = groups.reduce((sum, g) => sum + g.capTB * g.mult, 0)
  const rawTB = placedTB + input.unplacedTB
  const minDomains = width + heal

  const failuresTolerated = scheme.kind === 'replicated' ? scheme.size - 1 : scheme.m
  const ioFailuresTolerated = Math.max(0, width - minSize)

  const base = {
    domainCount,
    minDomains,
    width,
    dataFraction,
    minSize,
    rawTB,
    failuresTolerated,
    ioFailuresTolerated,
    fillRatios: { nearfull: nearfullRatio, backfillfull: backfillfullRatio, full: fullRatio },
  }

  if (!isSchemeValid(scheme) || domainCount < minDomains || placedTB <= 0) {
    return {
      ...base,
      valid: false,
      usableTB: 0,
      protectionTB: 0,
      reservedTB: rawTB,
      reserved: { healTB: 0, strandedTB: 0, fullMarginTB: 0, unplacedTB: input.unplacedTB },
      healthyFill: 0,
      healthyPlaceableTB: 0,
      efficiency: 0,
    }
  }

  const largest = largestDomains(groups, heal + width)

  // Capacity a healthy cluster can fill (all domains, after imbalance); used for the ratio markers.
  const healthyPlaceableTB = placeableCapacity(largest.slice(0, width), placedTB, width)

  // Planning limit: after losing the `heal` largest domains and re-replicating
  // their data onto the rest, the surviving OSDs must still be below nearfull.
  // The nearfull headroom is never used to absorb recovery data. With heal = 0
  // this is simply the healthy cluster staying below nearfull.
  const healTB = largest.slice(0, heal).reduce((a, b) => a + b, 0)
  const remainingTB = placedTB - healTB
  const placeableTB = placeableCapacity(largest.slice(heal), remainingTB, width)
  const writableTB = placeableTB * nearfullRatio
  const reserved = {
    healTB,
    strandedTB: Math.max(0, remainingTB - placeableTB),
    fullMarginTB: placeableTB - writableTB,
    unplacedTB: input.unplacedTB,
  }
  const usableTB = writableTB * dataFraction
  const protectionTB = writableTB - usableTB

  return {
    ...base,
    valid: true,
    usableTB,
    protectionTB,
    reservedTB: reserved.healTB + reserved.strandedTB + reserved.fullMarginTB + reserved.unplacedTB,
    reserved,
    healthyFill: healthyPlaceableTB > 0 ? writableTB / healthyPlaceableTB : 0,
    healthyPlaceableTB,
    efficiency: rawTB > 0 ? usableTB / rawTB : 0,
  }
}

/**
 * Raw space between the stored data (usable + protection) and the point where a healthy
 * cluster reaches the given ratio, i.e. the distance from the planned fill to that marker.
 */
export function rawUntilRatio(result: CapacityResult, ratio: 'backfillfull' | 'full'): number {
  if (!result.valid) return 0
  return Math.max(0, result.healthyPlaceableTB * result.fillRatios[ratio] - (result.usableTB + result.protectionTB))
}

/**
 * Additional data (net, after replication / EC overhead) that fits before a healthy cluster
 * reaches the given ratio: the raw distance to that marker × the data fraction.
 */
export function dataUntilRatio(result: CapacityResult, ratio: 'backfillfull' | 'full'): number {
  return rawUntilRatio(result, ratio) * result.dataFraction
}

export interface PlacementHint {
  /** e.g. "needs 8 hosts" */
  needs: string
  /** e.g. "+ 2 recovery reserve" when only the recovery reserve is missing, else null. */
  reserve: string | null
}

/**
 * Why a layout cannot be used, as a short hint (null when it can): the domains the layout itself
 * needs (its width), plus the recovery reserve as a separate part when one is set,
 * e.g. "needs 9 hosts" + "+ 1 recovery reserve".
 */
export function placementHint(result: CapacityResult, domain: DomainType): PlacementHint | null {
  if (result.valid) return null
  const { domainCount, width, minDomains } = result
  // Enough domains for layout and reserve, so the scheme itself must be invalid (e.g. min_size > size).
  if (domainCount >= minDomains) return { needs: 'invalid layout', reserve: null }
  const reserve = minDomains - width
  return {
    needs: `needs ${formatInt(width)} ${plural(domain, width)}`,
    reserve: reserve > 0 ? `+ ${formatInt(reserve)} recovery reserve` : null,
  }
}

/**
 * Full sentence for a layout that cannot be used (null when it can), worded like the
 * comparison hint: "Not enough hosts: needs 8 hosts (+ 2 recovery reserve), you have 7."
 */
export function placementMessage(result: CapacityResult, domain: DomainType): string | null {
  const hint = placementHint(result, domain)
  if (!hint) return null
  if (result.domainCount >= result.minDomains) return 'The pool layout is not valid.'
  const reserve = hint.reserve ? ` (${hint.reserve})` : ''
  return `Not enough ${plural(domain)}: ${hint.needs}${reserve}, you have ${formatInt(result.domainCount)}.`
}
