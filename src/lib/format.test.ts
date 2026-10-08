import { describe, expect, it } from 'vitest'
import { formatIops, formatTB, formatTiB } from './format'
import { parseDecimal, snapStep } from './stepping'

describe('formatTB', () => {
  it('switches to GB below 1 TB and keeps 3 significant digits', () => {
    expect(formatTB(0.001)).toBe('1 GB')
    expect(formatTB(0.04)).toBe('40 GB')
    expect(formatTB(0.5)).toBe('500 GB')
    expect(formatTB(72.533)).toBe('72.5 TB')
    expect(formatTB(1500)).toBe('1.5 PB')
    expect(formatTB(0)).toBe('0 TB')
  })
})

describe('formatTiB', () => {
  it('converts decimal TB to binary units', () => {
    expect(formatTiB(1)).toBe('931 GiB')
    expect(formatTiB(72.533)).toBe('66 TiB')
    expect(formatTiB(9070)).toBe('8.06 PiB')
    expect(formatTiB(0.001)).toBe('0.931 GiB')
    expect(formatTiB(0)).toBe('0 TiB')
  })
})

describe('formatIops', () => {
  it('keeps 3 significant digits in compact notation', () => {
    expect([57.14, 240, 800, 2400, 48_456, 1_234_567].map(formatIops)).toEqual(['57', '240', '800', '2.4K', '48.5K', '1.23M'])
  })
})

describe('snapStep', () => {
  it('snaps to whole steps', () => {
    expect(snapStep(0.001, 1, 1)).toBe(1)
    expect(snapStep(0.5, 1, 1)).toBe(1)
    expect(snapStep(1.3, 1, 1)).toBe(2)
    expect(snapStep(1.3, -1, 1)).toBe(1)
    expect(snapStep(3, 1, 1)).toBe(4)
    expect(snapStep(3, -1, 1)).toBe(2)
    expect(snapStep(1, -1, 1)).toBe(1)
  })
})

describe('parseDecimal', () => {
  it('accepts comma and dot as decimal separator', () => {
    expect(parseDecimal('0,85')).toBe(0.85)
    expect(parseDecimal('0.85')).toBe(0.85)
    expect(parseDecimal(' 14.508 ')).toBe(14.508)
    expect(parseDecimal('8')).toBe(8)
    expect(parseDecimal('.5')).toBe(0.5)
    expect(parseDecimal('5.')).toBe(5)
  })
  it('rejects incomplete or invalid input', () => {
    for (const bad of ['', '-', ',', 'abc', '1,2,3', '0.8x']) expect(parseDecimal(bad)).toBeNaN()
  })
})
