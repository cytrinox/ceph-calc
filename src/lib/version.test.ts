import { describe, expect, it } from 'vitest'
import { channelLabel, channelTitle, versionLabel, versionLink } from './version'

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

describe('versionLink', () => {
  it('links to the GitHub release of the tag', () => {
    expect(versionLink('v1.2.3')).toEqual({
      url: 'https://github.com/cytrinox/ceph-calc/releases/tag/v1.2.3',
      title: 'Release v1.2.3 on GitHub',
    })
    expect(versionLink('v1.2.3+5')).toEqual({
      url: 'https://github.com/cytrinox/ceph-calc/releases/tag/v1.2.3',
      title: 'Release v1.2.3 on GitHub, 5 commits later',
    })
    expect(versionLink('v2.0.0-rc.1+1').url).toBe('https://github.com/cytrinox/ceph-calc/releases/tag/v2.0.0-rc.1')
  })

  it('links other labels to the release list', () => {
    expect(versionLink('nightly')).toEqual({
      url: 'https://github.com/cytrinox/ceph-calc/releases',
      title: 'Version nightly: releases on GitHub',
    })
  })
})

describe('release channel', () => {
  it('uses the build value, "dev" when none is given', () => {
    expect([undefined, '', '  '].map(channelLabel)).toEqual(['dev', 'dev', 'dev'])
    expect(channelLabel(' beta ')).toBe('beta')
    expect(channelLabel('rc1')).toBe('rc1')
  })

  it('explains the channel in the tooltip', () => {
    expect(channelTitle('dev')).toMatch(/^Development build/)
    expect(channelTitle('beta')).toBe('Experimental: results are estimates, please verify them before ordering hardware')
    expect(channelTitle('BETA')).toBe(channelTitle('beta'))
    expect(channelTitle('stable')).toMatch(/^Stable release/)
    expect(channelTitle('rc1')).toBe('Release channel: rc1')
  })
})
