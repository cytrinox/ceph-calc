import { describe, expect, it } from 'vitest'
import {
  compressedCapacityTB,
  defaultPoolOptions,
  defaultProfileName,
  defaultRuleName,
  effectiveRuleName,
  isValidName,
  nearestPowerOfTwo,
  pgReplicasPerOsd,
  poolIssues,
  suggestPgNum,
  usesPgNum,
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

  it('rounds to the nearest power of two like the autoscaler', () => {
    expect(nearestPowerOfTwo(2667)).toBe(2048) // 619 above 2048, 1429 below 4096
    expect(nearestPowerOfTwo(200)).toBe(256) // 72 above 128, 56 below 256
    expect(nearestPowerOfTwo(1333)).toBe(1024)
    expect(nearestPowerOfTwo(192)).toBe(256) // halfway goes up
    expect(nearestPowerOfTwo(1024)).toBe(1024)
    expect(nearestPowerOfTwo(0.5)).toBe(1)
  })

  it('suggests the pg_num the autoscaler aims for: target PG replicas per OSD × OSDs ÷ width', () => {
    expect(suggestPgNum(40, rep3)).toBe(1024) // 40 × 100 ÷ 3 = 1333 (Ceph's default target up to Tentacle)
    expect(suggestPgNum(40, rep3, 200)).toBe(2048) // 2667 (Ceph's development branch)
    expect(suggestPgNum(8, ec42)).toBe(128) // 8 × 100 ÷ 6 = 133
    expect(suggestPgNum(10_000, rep3)).toBe(65536) // 333,333 → 262,144, capped at mon_max_pool_pg_num
    expect(suggestPgNum(8, rep3, 1)).toBe(32) // 2.7 → 2, raised to the autoscaler's PG_NUM_MIN
    expect(pgReplicasPerOsd(2048, rep3, 40)).toBeCloseTo(153.6, 9)
  })

  it("starts with Ceph's default pg_num and uses it with the autoscaler off or warning", () => {
    expect(defaultPoolOptions().pgNum).toBe(32)
    expect(usesPgNum({ autoscaleMode: 'on' })).toBe(false)
    expect(usesPgNum({ autoscaleMode: 'warn' })).toBe(true)
    expect(poolIssues({ ...defaultPoolOptions(), autoscaleMode: 'warn', pgNum: 100 }, rep3)).toEqual([
      'pg_num should be a power of two.',
    ])
    expect(poolIssues({ ...defaultPoolOptions(), autoscaleMode: 'on', pgNum: 100 }, rep3)).toEqual([])
  })

  it('reports pool issues', () => {
    const pool = { ...defaultPoolOptions(), name: 'bad name', ecOverwrites: false, autoscaleMode: 'off' as const, pgNum: 100 }
    const issues = poolIssues(pool, ec42)
    expect(issues).toHaveLength(3)
    expect(poolIssues(defaultPoolOptions(), rep3)).toEqual([])
    expect(poolIssues({ ...defaultPoolOptions(), deviceClass: 'fast-ssd' }, rep3)).toEqual([])
    expect(poolIssues({ ...defaultPoolOptions(), deviceClass: 'fast ssd' }, rep3)).toEqual([
      'Device class: use letters, digits, ".", "_" or "-".',
    ])
  })

  it('checks EC technique against plugin and m', () => {
    const base = defaultPoolOptions()
    expect(poolIssues({ ...base, ecTechnique: 'liberation' }, ec42)).toEqual([])
    expect(poolIssues({ ...base, ecTechnique: 'liberation' }, { kind: 'ec', k: 4, m: 3 })).toEqual([
      'Technique liberation requires m = 2.',
    ])
    expect(poolIssues({ ...base, ecPlugin: 'isa', ecTechnique: 'cauchy_good' }, ec42)[0]).toMatch(/not available/)
    // clay (scalar_mds jerasure) accepts neither liberation nor blaum_roth
    expect(poolIssues({ ...base, ecPlugin: 'clay', ecTechnique: 'liberation' }, ec42)[0]).toMatch(/not available/)
    expect(poolIssues({ ...base, ecPlugin: 'clay', ecTechnique: 'blaum_roth' }, ec42)[0]).toMatch(/not available/)
    expect(poolIssues({ ...base, ecPlugin: 'clay', ecTechnique: 'liber8tion' }, ec42)).toEqual([])
  })

  it('checks EC optimizations against plugin and technique', () => {
    const opt = { ...defaultPoolOptions(), ecOptimizations: true, stripeUnitKiB: 16 }
    expect(poolIssues(opt, ec42)).toEqual([])
    expect(poolIssues({ ...opt, ecPlugin: 'isa' }, ec42)).toEqual([])
    const unsupported = 'EC optimizations need the jerasure or isa plugin with reed_sol_van.'
    expect(poolIssues({ ...opt, ecPlugin: 'clay' }, ec42)).toEqual([unsupported])
    expect(poolIssues({ ...opt, ecTechnique: 'cauchy_good' }, ec42)).toEqual([unsupported])
    // a small stripe_unit is a recommendation, not an issue
    expect(poolIssues({ ...opt, stripeUnitKiB: 4 }, ec42)).toEqual([])
    // replicated pools ignore EC settings
    expect(poolIssues({ ...opt, ecPlugin: 'clay' }, rep3)).toEqual([])
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
      deviceClass: 'fast-ssd',
    }
    expect(decodeState(encodeState(state))!.pool).toEqual(state.pool)
    expect(sanitizePool({ deviceClass: 'x; rm -rf /' }).deviceClass).toBe('')
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
