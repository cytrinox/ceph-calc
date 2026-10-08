import { describe, expect, it } from 'vitest'
import { clusterPrice, formatPrice, localCurrency, pricePerUsableTB } from './pricing'

describe('pricing', () => {
  it('prices raw capacity per decimal TB', () => {
    expect(clusterPrice(320, 500)).toBe(160000)
    expect(clusterPrice(0.001, 500)).toBeCloseTo(0.5, 9)
    expect(pricePerUsableTB(160000, 90.667)).toBeCloseTo(1764.7, 1)
    expect(pricePerUsableTB(160000, 0)).toBeNull()
  })

  it('derives the default currency from the locale', () => {
    expect(['de-DE', 'de', 'de-AT', 'fr-FR'].map((l) => localCurrency(l))).toEqual(['€', '€', '€', '€'])
    expect(['en-US', 'en-GB', 'de-CH', 'pl-PL', 'hi-IN'].map((l) => localCurrency(l))).toEqual(['$', '£', 'CHF', 'zł', '₹'])
    // unknown region: the euro
    expect(localCurrency('xx-ZZ')).toBe('€')
  })

  it('formats with the user currency text', () => {
    expect(formatPrice(160000, 'EUR')).toBe('160,000 EUR')
    expect(formatPrice(160000, '$')).toBe('$160,000')
    expect(formatPrice(160000, '€')).toBe('€160,000')
    expect(formatPrice(1764.7, 'USD')).toBe('1,765 USD')
    expect(formatPrice(99.5, '')).toBe('99.50')
  })
})
