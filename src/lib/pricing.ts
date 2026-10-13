// Hardware price estimate from a price per TB of raw drive capacity (decimal TB, as drives are sold).

/** No price by default: the cost badge appears once a price per TB is entered. */
export const DEFAULT_PRICE_PER_TB = 0
/** Longest currency text (input field and shared links). */
export const CURRENCY_MAX_LENGTH = 6

/** Currency of a region (ISO 3166 code); regions not listed fall back to the euro. */
const CURRENCY_BY_REGION: Record<string, string> = {
  // Euro area (Bulgaria since 2026) and countries using the euro
  ...Object.fromEntries(
    'AD AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MC ME MT NL PT SI SK SM VA XK'.split(' ').map((r) => [r, 'EUR']),
  ),
  AE: 'AED', AR: 'ARS', AU: 'AUD', BR: 'BRL', CA: 'CAD', CH: 'CHF', CL: 'CLP', CN: 'CNY', CO: 'COP', CZ: 'CZK',
  DK: 'DKK', EG: 'EGP', GB: 'GBP', HK: 'HKD', HU: 'HUF', ID: 'IDR', IL: 'ILS', IN: 'INR', IS: 'ISK', JP: 'JPY',
  KR: 'KRW', LI: 'CHF', MX: 'MXN', MY: 'MYR', NG: 'NGN', NO: 'NOK', NZ: 'NZD', PH: 'PHP', PL: 'PLN', RO: 'RON',
  RS: 'RSD', RU: 'RUB', SA: 'SAR', SE: 'SEK', SG: 'SGD', TH: 'THB', TR: 'TRY', TW: 'TWD', UA: 'UAH', US: 'USD',
  VN: 'VND', ZA: 'ZAR',
}

/**
 * Default currency text for a locale: the symbol where it has one (€, $, £, ₹, zł), else the code
 * (CHF). The region comes from the locale (de-DE → DE; plain "de" → its likely region DE).
 */
export function localCurrency(locale?: string): string {
  try {
    const tag = locale ?? (typeof navigator !== 'undefined' ? navigator.language : undefined) ?? 'en-US'
    const region = new Intl.Locale(tag).maximize().region ?? ''
    const code = CURRENCY_BY_REGION[region] ?? 'EUR'
    const symbol = new Intl.NumberFormat(tag, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
      .formatToParts(1)
      .find((p) => p.type === 'currency')?.value
    return (symbol ?? code).trim().slice(0, CURRENCY_MAX_LENGTH) || code
  } catch {
    return '€'
  }
}

/** Total drive cost of the cluster. */
export function clusterPrice(rawTB: number, pricePerTB: number): number {
  return Math.max(0, rawTB) * Math.max(0, pricePerTB)
}

/**
 * Effective cost per unit of usable capacity, in the unit `usable` is given in (TB, or TiB for the unit toggle);
 * null when nothing is usable.
 */
export function pricePerUsable(totalPrice: number, usable: number): number | null {
  return usable > 0 ? totalPrice / usable : null
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
