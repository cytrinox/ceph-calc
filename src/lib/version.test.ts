import { describe, expect, it } from 'vitest'
import { versionLabel } from './version'

describe('versionLabel', () => {
  it('shows the nearest version tag, with the commit distance after it', () => {
    expect(versionLabel(undefined, 'v1.2.3-0-gabc1234')).toBe('v1.2.3')
    expect(versionLabel(undefined, 'v1.2.3-5-gabc1234\n')).toBe('v1.2.3+5')
    expect(versionLabel(undefined, 'v2.0.0-rc.1-3-g1234abcd')).toBe('v2.0.0-rc.1+3')
  })

  it('prefers a non-empty override, as-is', () => {
    expect(versionLabel(' v9.9.9 ', 'v1.2.3-5-gabc1234')).toBe('v9.9.9')
    expect(versionLabel('nightly', null)).toBe('nightly')
    expect(versionLabel('', 'v1.2.3-0-gabc1234')).toBe('v1.2.3')
  })

  it('has no label without a matching tag', () => {
    expect(versionLabel(undefined, null)).toBe('')
    expect(versionLabel(undefined, '')).toBe('')
    expect(versionLabel(undefined, 'v1.x-2-gabc1234')).toBe('')
    expect(versionLabel(undefined, 'release-2024-0-gabc1234')).toBe('')
    expect(versionLabel(undefined, 'v1.2.3')).toBe('') // not --long output
  })
})
