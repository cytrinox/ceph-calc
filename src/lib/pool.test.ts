import { describe, expect, it } from 'vitest'
import {
  compressedCapacityTB,
  defaultPoolOptions,
  defaultProfileName,
  defaultRuleName,
  effectiveRuleName,
  isValidName,
  poolIssues,
  suggestPgNum,
} from './pool'
import { decodeState, defaultState, encodeState, sanitizePool } from './urlState'

const rep3 = { kind: 'replicated', size: 3, minSize: 2 } as const
const ec42 = { kind: 'ec', k: 4, m: 2 } as const

describe('pool options', () => {
  it('derives rule and profile names from scheme, domain and device class', () => {
    expect(defaultRuleName(rep3, 'host', '')).toBe('rep3_host')
    expect(defaultRuleName(ec42, 'rack', 'nvme')).toBe('ec4-2_rack_nvme')
    expect(defaultRuleName({ kind: 'ec', k: 2, m: 11 }, 'host', '')).not.toBe(
      defaultRuleName({ kind: 'ec', k: 21, m: 1 }, 'host', ''),
    )
    expect(defaultProfileName(ec42, 'host', 'hdd')).toBe('ec-4-2-host-hdd')
    expect(defaultProfileName(rep3, 'host', '')).toBe('')
    const pool = { ...defaultPoolOptions(), crushRule: 'fast' }
    expect(effectiveRuleName(pool, rep3, 'host')).toBe('fast')
  })

  it('validates names', () => {
    expect(isValidName('rbd-data_01.x')).toBe(true)
    expect(isValidName('my pool')).toBe(false)
    expect(isValidName('-x')).toBe(false)
    expect(isValidName('')).toBe(false)
  })

  it('suggests a power-of-two pg_num (round up when >25% above the lower power)', () => {
    expect(suggestPgNum(40, rep3)).toBe(2048) // 40*100/3 ≈ 1333 → 1024 + 30% → 2048
    expect(suggestPgNum(40, ec42)).toBe(1024) // 667 → 512 + 30% → 1024
    expect(suggestPgNum(8, rep3)).toBe(256) // 267 → 256 + 4% → 256
  })

  it('reports pool issues', () => {
    const pool = { ...defaultPoolOptions(), name: 'bad name', ecOverwrites: false, autoscaleMode: 'off' as const, pgNum: 100 }
    const issues = poolIssues(pool, ec42)
    expect(issues).toHaveLength(3)
    expect(poolIssues(defaultPoolOptions(), rep3)).toEqual([])
  })

  it('checks EC technique against plugin and m', () => {
    const base = defaultPoolOptions()
    expect(poolIssues({ ...base, ecTechnique: 'liberation' }, ec42)).toEqual([])
    expect(poolIssues({ ...base, ecTechnique: 'liberation' }, { kind: 'ec', k: 4, m: 3 })).toEqual([
      'Technique liberation requires m = 2.',
    ])
    expect(poolIssues({ ...base, ecPlugin: 'isa', ecTechnique: 'cauchy_good' }, ec42)[0]).toMatch(/not available/)
  })

  it('warns when both target size hints are set', () => {
    const pool = { ...defaultPoolOptions(), targetSizeRatio: 0.2, targetSizeTB: 100 }
    expect(poolIssues(pool, rep3)).toEqual(['Both target size ratio and bytes are set; Ceph uses the ratio.'])
  })

  it('estimates the effective capacity with compression', () => {
    const base = defaultPoolOptions()
    expect(base.compressionRatio).toBe(0.9)
    expect(compressedCapacityTB(90, base)).toBeNull() // compression off by default
    const on = { ...base, compressionMode: 'aggressive' as const }
    expect(compressedCapacityTB(90, on)).toBeCloseTo(100, 9)
    expect(compressedCapacityTB(90, { ...on, compressionRatio: 0.5 })).toBeCloseTo(180, 9)
    expect(compressedCapacityTB(90, { ...on, compressionRatio: 1 })).toBeNull()
    expect(compressedCapacityTB(0, on)).toBeNull()
  })

  it('round-trips through the URL and sanitizes garbage', () => {
    const state = defaultState()
    state.pool = {
      ...state.pool,
      name: 'vms',
      application: 'cephfs',
      compressionMode: 'aggressive',
      noDelete: true,
      ecTechnique: 'cauchy_good',
      stripeUnitKiB: 64,
      fastRead: true,
      targetSizeTB: 250,
    }
    expect(decodeState(encodeState(state))!.pool).toEqual(state.pool)
    const dirty = sanitizePool({ name: 42, application: 'evil', pgNum: -5, bulk: 'yes', stripeUnitKiB: 3, ecTechnique: 'x', compressionRatio: -1 })
    expect(dirty.compressionRatio).toBe(0.9)
    expect(dirty.stripeUnitKiB).toBe(4)
    expect(dirty.ecTechnique).toBe('reed_sol_van')
    expect(dirty.name).toBe('data')
    expect(dirty.application).toBe('rbd')
    expect(dirty.pgNum).toBe(1)
    expect(dirty.bulk).toBe(false)
  })
})
