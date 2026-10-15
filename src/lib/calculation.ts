// The capacity calculation spelled out with the current setup's numbers, for the FAQ entry "How is this
// calculated?". Only formats what computeCapacity() already computed; it doesn't calculate anything new.

import {
  dataUntilRatio,
  largestDomains,
  placementMessage,
  rawUntilRatio,
  schemeWidth,
  type CapacityInput,
  type CapacityResult,
  type Scheme,
  type Tunables,
} from './ceph'
import { formatInt, formatPct } from './format'
import { compressedCapacityTB, type PoolOptions } from './pool'
import { clusterPrice, formatPrice, pricePerUsable } from './pricing'
import { nearfullRecommendation } from './recommendations'
import { schemeLabel } from './schemes'
import { plural, type DomainGroup, type DomainType } from './topology'
import { capacityUnit, formatCapacity, unitPerTB } from './units'

export interface CalculationRow {
  label: string
  /** The arithmetic with the setup's numbers, e.g. "30 TB × 0.85". */
  formula: string
  value: string
}

export interface CalculationExample {
  /** "Replication 3x across 4 hosts (1 × 20 TB + 3 × 10 TB), recovery reserve 1" */
  setup: string
  /** "w = 3, f = 1/3, N = 1" */
  symbols: string
  /** Why the setup can't be placed; then there are no rows. */
  problem: string | null
  /** Steps 1–5. */
  steps: CalculationRow[]
  /** The other values derived from them. */
  others: CalculationRow[]
}

export interface CalculationInput {
  input: CapacityInput
  result: CapacityResult
  scheme: Scheme
  tunables: Tunables
  domain: DomainType
  pool?: PoolOptions
  /** Price per decimal TB of raw capacity; 0 = not set. */
  pricePerTB?: number
  currency?: string
}

/** Domain groups listed at most this many sizes deep; more are summarised. */
const MAX_LISTED_SIZES = 3

/** "1 × 20 TB + 3 × 10 TB"; with more sizes "2 × 20 TB + 3 × 10 TB + 5 more". */
function domainList(groups: DomainGroup[]): string {
  const sorted = [...groups].sort((a, b) => b.capTB - a.capTB)
  const part = (g: DomainGroup) => `${formatInt(g.mult)} × ${formatCapacity(g.capTB)}`
  if (sorted.length <= MAX_LISTED_SIZES) return sorted.map(part).join(' + ')
  const shown = sorted.slice(0, MAX_LISTED_SIZES - 1)
  const rest = sorted.slice(MAX_LISTED_SIZES - 1).reduce((n, g) => n + g.mult, 0)
  return `${shown.map(part).join(' + ')} + ${formatInt(rest)} more`
}

/** The N largest domains as groups, e.g. 2 × 20 TB. */
function largestGroups(groups: DomainGroup[], count: number): DomainGroup[] {
  const out: DomainGroup[] = []
  for (const cap of largestDomains([...groups].sort((a, b) => b.capTB - a.capTB), count)) {
    const last = out.at(-1)
    if (last && last.capTB === cap) last.mult++
    else out.push({ capTB: cap, mult: 1 })
  }
  return out
}

const ratio = (r: number) => r.toFixed(2)
/** Capacities this small next to raw are rounding noise of the water-filling. */
const isZero = (tb: number, rawTB: number) => tb <= rawTB * 1e-9

export function explainCalculation({
  input,
  result: r,
  scheme,
  tunables,
  domain,
  pool,
  pricePerTB = 0,
  currency = '',
}: CalculationInput): CalculationExample {
  const n = Math.max(0, Math.floor(tunables.recoveryReserve || 0))
  const w = schemeWidth(scheme)
  const f = scheme.kind === 'replicated' ? `1/${scheme.size}` : `${scheme.k}/${scheme.k + scheme.m}`
  const cap = formatCapacity
  const domains = (count: number) => `${formatInt(count)} ${plural(domain, count)}`
  const list = input.groups.length ? ` (${domainList(input.groups)})` : ''
  const setup = `${schemeLabel(scheme)} across ${domains(r.domainCount)}${list}, recovery reserve ${n}`
  const symbols = `w = ${w}, f = ${f}, N = ${n}`
  const problem = placementMessage(r, domain)
  if (problem || !r.valid) {
    return { setup, symbols, problem: problem ?? 'The pool layout is not valid.', steps: [], others: [] }
  }

  const P = r.healthyPlaceableTB
  const stored = r.usableTB + r.protectionTB
  // P_N is not part of the result, but it is stored + nearfull headroom (and P − recovery reserve).
  const pN = stored + r.reserved.nearfullHeadroomTB
  const { nearfull, backfillfull, full } = r.fillRatios
  const outside = r.unusable.unplacedTB
  const stranded = r.unusable.strandedTB
  const hasOutside = !isZero(outside, r.rawTB)

  const steps: CalculationRow[] = [
    {
      label: 'Raw',
      formula: domainList(input.groups) + (hasOutside ? ` + ${cap(outside)} outside` : ''),
      value: cap(r.rawTB),
    },
  ]
  if (hasOutside) {
    steps.push({ label: 'Outside', formula: `hosts outside every ${plural(domain, 1)}`, value: cap(outside) })
  }
  steps.push({
    label: 'P',
    formula: isZero(stranded, r.rawTB)
      ? `every ${plural(domain, 1)} fills completely`
      : `no ${plural(domain, 1)} holds more than P ÷ ${w} = ${cap(P / w)}`,
    value: cap(P),
  })
  if (!isZero(stranded, r.rawTB)) {
    steps.push({
      label: 'Stranded',
      formula: hasOutside ? `${cap(r.rawTB)} − ${cap(outside)} − ${cap(P)}` : `${cap(r.rawTB)} − ${cap(P)}`,
      value: cap(stranded),
    })
  }
  steps.push(
    {
      label: 'P_N',
      formula: n === 0 ? 'N = 0: the same as P' : `P without the ${n} largest (${domainList(largestGroups(input.groups, n))})`,
      value: cap(pN),
    },
    { label: 'Recovery reserve', formula: `${cap(P)} − ${cap(pN)}`, value: cap(r.reserved.recoveryReserveTB) },
    { label: 'Stored', formula: `${cap(pN)} × ${ratio(nearfull)}`, value: cap(stored) },
    { label: 'Nearfull headroom', formula: `${cap(pN)} − ${cap(stored)}`, value: cap(r.reserved.nearfullHeadroomTB) },
    { label: 'Real net', formula: `${cap(stored)} × ${f}`, value: cap(r.usableTB) },
    { label: 'Protection', formula: `${cap(stored)} − ${cap(r.usableTB)}`, value: cap(r.protectionTB) },
  )

  const others: CalculationRow[] = [
    { label: 'Healthy OSD fill', formula: `${cap(stored)} ÷ ${cap(P)}`, value: formatPct(r.healthyFill) },
    { label: 'Nearfull marker', formula: `${cap(P)} × ${ratio(nearfull)}`, value: `${cap(P * nearfull)} raw` },
  ]
  const markers = [['backfillfull', 'Backfillfull', backfillfull], ['full', 'Full', full]] as const
  for (const [key, name, value] of markers) {
    others.push({ label: `${name} marker`, formula: `${cap(P)} × ${ratio(value)}`, value: `${cap(P * value)} raw` })
    // Only while there is room left up to the marker.
    if (rawUntilRatio(r, key) > 0) {
      others.push({
        label: `+X until ${key}`,
        formula: `(${cap(P * value)} − ${cap(stored)}) × ${f}`,
        value: cap(dataUntilRatio(r, key)),
      })
    }
  }
  others.push(
    { label: 'Storage efficiency', formula: `${cap(r.usableTB)} ÷ ${cap(r.rawTB)}`, value: formatPct(r.efficiency) },
    {
      label: 'Survives losing',
      formula: scheme.kind === 'replicated' ? `size − 1 = ${scheme.size} − 1` : `m = ${scheme.m}`,
      value: domains(r.failuresTolerated),
    },
    { label: 'Operational losing', formula: `w − min_size = ${w} − ${r.minSize}`, value: domains(r.ioFailuresTolerated) },
    { label: 'Needs', formula: `w + N = ${w} + ${n}`, value: domains(r.minDomains) },
  )
  const recommended = nearfullRecommendation({ input, result: r, tunables, scheme, domain })?.ratios?.nearfull
  if (recommended !== undefined) {
    // One truncated decimal, not formatPct: rounding 56.7% up to 57% would contradict "rounded down → 0.56".
    const pct = Math.floor(r.healthyFill * 1000 + 1e-6) / 10
    others.push({
      label: 'Recommended nearfull ratio',
      formula: `${pct % 1 ? pct.toFixed(1) : pct}% rounded down`,
      value: ratio(recommended),
    })
  }
  if (pricePerTB > 0) {
    // The price is per decimal TB of raw capacity, as drives are sold; the cost per usable unit follows the toggle.
    const total = clusterPrice(r.rawTB, pricePerTB)
    const perUsable = pricePerUsable(total, r.usableTB * unitPerTB())
    others.push({
      label: 'Price',
      formula: `${cap(r.rawTB)} × ${formatPrice(pricePerTB, currency)} per TB`,
      value: formatPrice(total, currency),
    })
    if (perUsable !== null) {
      others.push({
        label: `Per usable ${capacityUnit.value}`,
        formula: `${formatPrice(total, currency)} ÷ ${cap(r.usableTB)}`,
        value: formatPrice(perUsable, currency),
      })
    }
  }
  const compressed = pool ? compressedCapacityTB(r.usableTB, pool) : null
  if (pool && compressed !== null) {
    others.push({
      label: 'With compression',
      formula: `${cap(r.usableTB)} ÷ ${ratio(pool.compressionRatio)}`,
      value: cap(compressed),
    })
  }
  return { setup, symbols, problem: null, steps, others }
}
