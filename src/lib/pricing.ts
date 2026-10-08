// Hardware price estimate from a price per TB of raw drive capacity (decimal TB, as drives are sold).

export const DEFAULT_PRICE_PER_TB = 500
export const DEFAULT_CURRENCY = 'EUR'
/** Longest currency text (input field and shared links). */
export const CURRENCY_MAX_LENGTH = 6

/** Total drive cost of the cluster. */
export function clusterPrice(rawTB: number, pricePerTB: number): number {
  return Math.max(0, rawTB) * Math.max(0, pricePerTB)
}

/** Effective cost per usable TB (null when nothing is usable). */
export function pricePerUsableTB(totalPrice: number, usableTB: number): number | null {
  return usableTB > 0 ? totalPrice / usableTB : null
}

/**
 * Amount with grouping and the user's currency text: single-character symbols go in front
 * ($112,000), codes and words after (112,000 EUR). Large amounts are rounded to whole units.
 */
export function formatPrice(amount: number, currency: string): string {
  const fractionDigits = Math.abs(amount) >= 100 ? 0 : 2
  const number = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
  const unit = currency.trim()
  if (!unit) return number
  return [...unit].length === 1 ? `${unit}${number}` : `${number} ${unit}`
}
