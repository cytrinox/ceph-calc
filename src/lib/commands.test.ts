import { describe, expect, it } from 'vitest'
import { DEFAULT_RATIOS, type Scheme } from './ceph'
import { buildCommands, commandsToScript, stripeUnitArg, tbToBytes, type CommandInput } from './commands'
import { defaultPoolOptions } from './pool'

const tunables = {
  fullRatio: DEFAULT_RATIOS.full,
  backfillfullRatio: DEFAULT_RATIOS.backfillfull,
  nearfullRatio: DEFAULT_RATIOS.nearfull,
  recoveryReserve: 1,
}

const input = (scheme: Scheme, pool = defaultPoolOptions(), extra: Partial<CommandInput> = {}): CommandInput => ({
  pool,
  scheme,
  domain: 'host',
  tunables,
  includeClusterRatios: true,
  ...extra,
})

const script = (i: CommandInput) => commandsToScript(buildCommands(i))

describe('buildCommands', () => {
  it('creates a replicated pool with its rule, size and application', () => {
    const s = script(input({ kind: 'replicated', size: 3, minSize: 2 }))
    expect(s).toContain('ceph osd set-backfillfull-ratio 0.90')
    expect(s).toContain('ceph osd crush rule create-replicated rep3_host default host\n')
    expect(s).toContain('ceph osd pool create data 32 32 \\\n    replicated rep3_host \\\n    --autoscale-mode=on')
    expect(s).toContain('ceph osd pool set data size 3')
    expect(s).toContain('ceph osd pool set data min_size 2')
    expect(s).toContain('ceph osd pool application enable data rbd')
    expect(s).toContain('rbd pool init data')
    expect(s).not.toContain('erasure')
  })

  it('creates an EC profile and erasure rule with all profile options', () => {
    const pool = {
      ...defaultPoolOptions(),
      name: 'vms',
      deviceClass: 'nvme' as const,
      ecTechnique: 'cauchy_good' as const,
      stripeUnitKiB: 1024,
      fastRead: true,
    }
    const s = script(input({ kind: 'ec', k: 4, m: 2 }, pool, { domain: 'rack' }))
    expect(s).toContain(
      'ceph osd erasure-code-profile set ec-4-2-rack-nvme \\\n    k=4 m=2 \\\n    plugin=jerasure technique=cauchy_good \\\n    stripe_unit=1M \\\n    crush-root=default crush-failure-domain=rack crush-device-class=nvme',
    )
    expect(s).toContain('ceph osd crush rule create-erasure ec4-2_rack_nvme ec-4-2-rack-nvme')
    expect(s).toContain('erasure ec-4-2-rack-nvme ec4-2_rack_nvme')
    expect(s).not.toContain('min_size')
    expect(s).toContain('# EC options\nceph osd pool set vms allow_ec_overwrites true')
    expect(s).toContain('ceph osd pool set vms allow_ec_overwrites true')
    expect(s).toContain('ceph osd pool set vms fast_read 1')
    expect(s).toContain('--data-pool vms')
    expect(s).not.toContain('rbd pool init vms')
  })

  it('uses a fixed pg_num when the autoscaler is off and emits optional settings', () => {
    const pool = {
      ...defaultPoolOptions(),
      autoscaleMode: 'off' as const,
      pgNum: 512,
      compressionMode: 'aggressive' as const,
      compressionAlgorithm: 'zstd' as const,
      quotaMaxTB: 1.5,
      quotaMaxObjects: 1000,
      noDelete: true,
      noSizeChange: true,
      application: 'none' as const,
    }
    const s = script(input({ kind: 'replicated', size: 3, minSize: 2 }, pool, { includeClusterRatios: false }))
    expect(s).not.toContain('set-full-ratio')
    expect(s).toContain('ceph osd pool create data 512 512')
    expect(s).toContain('--autoscale-mode=off')
    expect(s).toContain('compression_mode aggressive')
    expect(s).toContain('compression_algorithm zstd')
    expect(s).toContain('set-quota data max_bytes 1500000000000  # 1.5 TB')
    expect(s).toContain('set-quota data max_objects 1000')
    expect(s.indexOf('nosizechange')).toBeLessThan(s.indexOf('nodelete'))
    expect(s).not.toContain('application enable')
  })

  it('emits autoscaler hints', () => {
    const pool = { ...defaultPoolOptions(), bulk: true, targetSizeRatio: 0.2, targetSizeTB: 100 }
    const s = script(input({ kind: 'replicated', size: 3, minSize: 2 }, pool))
    expect(s).toContain('ceph osd pool set data bulk true')
    expect(s).toContain('ceph osd pool set data target_size_ratio 0.20')
    expect(s).toContain('ceph osd pool set data target_size_bytes 100000000000000')
  })

  it('allows and confirms single-copy pools', () => {
    const s = script(input({ kind: 'replicated', size: 1, minSize: 1 }))
    expect(s).toContain('ceph config set global mon_allow_pool_size_one true')
    expect(s).toContain('ceph osd pool set data size 1 --yes-i-really-mean-it')
    expect(s).not.toContain('pool set data size 1\n')
  })

  it('leaves min_size of EC pools to Ceph', () => {
    const pool = { ...defaultPoolOptions(), ecOverwrites: false, fastRead: false }
    const s = script(input({ kind: 'ec', k: 2, m: 1 }, pool))
    expect(s).not.toContain('min_size')
    expect(s).not.toContain('# EC options')
    expect(s).not.toContain('# Redundancy')
  })
})

describe('helpers', () => {
  it('formats stripe units and bytes', () => {
    expect(stripeUnitArg(4)).toBe('4K')
    expect(stripeUnitArg(2048)).toBe('2M')
    expect(tbToBytes(1000000)).toBe('1000000000000000000')
  })

  it('adds a shebang for downloadable scripts', () => {
    const s = commandsToScript(buildCommands(input({ kind: 'replicated', size: 2, minSize: 1 })), true)
    expect(s.startsWith('#!/bin/sh\nset -e\n')).toBe(true)
  })
})
