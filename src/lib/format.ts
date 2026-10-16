const UNITS = ['GB', 'TB', 'PB', 'EB', 'ZB']

/** Decimal capacity with 3 significant digits: 40 GB, 72.5 TB, 109 TB, 1.2 PB. */
export function formatTB(tb: number): string {
  if (!Number.isFinite(tb) || tb <= 0) return '0 TB'
  // Below 1 TB switch to GB; otherwise start at TB.
  let value = tb < 1 ? tb * 1000 : tb
  let unit = tb < 1 ? 0 : 1
  while (value >= 999.5 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  if (value < 0.01) return `${value.toExponential(1)} ${UNITS[unit]}`
  return `${Number(value.toPrecision(3))} ${UNITS[unit]}`
}

export function formatPct(fraction: number): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${shownPct(fraction * 100)}%`
}

/** The number formatPct shows: whole percent, one decimal below 1%. */
function shownPct(pct: number): number {
  return pct > 0 && pct < 1 ? Number(pct.toFixed(1)) : Math.round(pct)
}

/**
 * Parts of a whole as percentages, like formatPct, but with one decimal for every part when the whole percents
 * wouldn't add up to 100 (42.5 + 42.5 + 15 shows as 43 + 43 + 15). A trailing ".0" is left out: 15%, not 15.0%.
 */
export function formatShares(fractions: number[]): string[] {
  const pcts = fractions.map((f) => (Number.isFinite(f) ? f * 100 : 0))
  const whole = pcts.map(shownPct)
  const total = whole.reduce((a, b) => a + b, 0)
  const addsUp = Math.abs(total - 100) < 1e-6 || total === 0
  return pcts.map((pct, i) => `${addsUp ? whole[i] : Number(pct.toFixed(1))}%`)
}

const intFormat = new Intl.NumberFormat('en-US')
const iopsFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 })

/** IOPS as whole numbers below 1,000, else 3 significant digits: 57, 240, 2.4K, 48.5K, 1.23M. */
export function formatIops(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n < 999.5 ? formatInt(Math.round(n)) : iopsFormat.format(n)
}

export function formatInt(n: number): string {
  return intFormat.format(n)
}

const BINARY_UNITS = ['GiB', 'TiB', 'PiB', 'EiB', 'ZiB']

/** TiB per decimal TB (10^12 / 2^40 ≈ 0.909). */
export const TIB_PER_TB = 1e12 / 2 ** 40

/** Binary capacity with 3 significant digits: 37.3 GiB, 66 TiB, 8.06 PiB. Input is decimal TB. */
export function formatTiB(tb: number): string {
  if (!Number.isFinite(tb) || tb <= 0) return '0 TiB'
  const tib = tb * TIB_PER_TB
  let value = tib < 1 ? tib * 1024 : tib
  let unit = tib < 1 ? 0 : 1
  while (value >= 1023.5 && unit < BINARY_UNITS.length - 1) {
    value /= 1024
    unit++
  }
  if (value < 0.01) return `${value.toExponential(1)} ${BINARY_UNITS[unit]}`
  return `${Number(value.toPrecision(3))} ${BINARY_UNITS[unit]}`
}
