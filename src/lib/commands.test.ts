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
  includeClusterSettings: true,
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
    const s = script(input({ kind: 'replicated', size: 3, minSize: 2 }, pool, { includeClusterSettings: false }))
    expect(s).not.toContain('set-full-ratio')
    expect(s).toContain('ceph osd pool create data 512 512')
    expect(s).toContain('--autoscale-mode=off')
    expect(s).not.toContain('autoscaler')
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

  it('applies recommended ratios, even without the other cluster-wide ratios', () => {
    const overrides = { ratioOverrides: { nearfull: 0.68 } }
    const all = script(input({ kind: 'replicated', size: 3, minSize: 2 }, defaultPoolOptions(), overrides))
    expect(all).toContain('ceph osd set-nearfull-ratio 0.68  # recommended (planning value 0.85)')
    expect(all).toContain('ceph osd set-backfillfull-ratio 0.90\nceph osd set-full-ratio 0.95')
    const only = script(
      input({ kind: 'replicated', size: 3, minSize: 2 }, defaultPoolOptions(), { ...overrides, includeClusterSettings: false }),
    )
    expect(only).toContain('# Cluster-wide settings')
    expect(only).toContain('ceph osd set-nearfull-ratio 0.68')
    expect(only).not.toContain('set-backfillfull-ratio')
    const none = script(input({ kind: 'replicated', size: 3, minSize: 2 }, defaultPoolOptions(), { includeClusterSettings: false }))
    expect(none).not.toContain('Cluster-wide settings')
  })

  it('emits config settings from applied recommendations before the pool is created', () => {
    const configSettings = [{ option: 'mon_warn_on_pool_no_redundancy', value: 'false' }]
    const s = script(input({ kind: 'replicated', size: 1, minSize: 1 }, defaultPoolOptions(), { configSettings }))
    expect(s).toContain(
      '# Recommended settings\n# From the Recommendations panel; they apply to the whole cluster.\n' +
        'ceph config set global mon_warn_on_pool_no_redundancy false',
    )
    expect(s.indexOf('# Recommended settings')).toBeLessThan(s.indexOf('ceph osd pool create'))
    expect(s).toContain('ceph config set global mon_allow_pool_size_one true  # single-copy pools are blocked by default')
    expect(script(input({ kind: 'replicated', size: 1, minSize: 1 }))).not.toContain('Recommended settings')
  })

  it('enables EC optimizations only when chosen', () => {
    const pool = { ...defaultPoolOptions(), ecOptimizations: true }
    expect(script(input({ kind: 'ec', k: 4, m: 2 }, pool))).toContain(
      'ceph osd pool set data allow_ec_optimizations true  # Ceph Tentacle or later; cannot be disabled',
    )
    expect(script(input({ kind: 'ec', k: 4, m: 2 }))).not.toContain('allow_ec_optimizations')
    expect(script(input({ kind: 'replicated', size: 3, minSize: 2 }, pool))).not.toContain('allow_ec_optimizations')
  })

  it('sets min_size of EC pools only when it differs from the default', () => {
    const pool = { ...defaultPoolOptions(), ecOverwrites: false, fastRead: false }
    expect(script(input({ kind: 'ec', k: 4, m: 2, minSize: 4 }, pool))).toContain(
      '# Redundancy\nceph osd pool set data min_size 4',
    )
    expect(script(input({ kind: 'ec', k: 4, m: 2, minSize: 5 }, pool))).not.toContain('min_size')
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

describe('placement groups', () => {
  const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }

  it('creates the pool with its own pg_num when the autoscaler only warns', () => {
    const s = script(input(rep3, { ...defaultPoolOptions(), autoscaleMode: 'warn' }))
    expect(s).toContain('ceph osd pool create data 32 32')
    expect(s).toContain('# The autoscaler only warns when pg_num is more than 3× off its target')
    const on = script(input(rep3, { ...defaultPoolOptions(), pgNum: 512 }))
    expect(on).toContain('ceph osd pool create data 32 32')
    expect(on).toContain('the autoscaler adjusts pg_num')
  })

  it('sets the PG target on the cluster only when it differs from the default', () => {
    expect(script(input(rep3, defaultPoolOptions(), { pgTargetPerOsd: 100 }))).not.toContain('mon_target_pg_per_osd')
    const s = script(input(rep3, defaultPoolOptions(), { pgTargetPerOsd: 200 }))
    expect(s).toContain('# Cluster-wide settings')
    expect(s).toContain('ceph config set global mon_target_pg_per_osd 200  # PG replicas per OSD (Ceph default 100)')
    expect(script(input(rep3, defaultPoolOptions(), { pgTargetPerOsd: 200, includeClusterSettings: false }))).not.toContain(
      'mon_target_pg_per_osd',
    )
  })
})

describe('usage examples', () => {
  const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }
  const ec42: Scheme = { kind: 'ec', k: 4, m: 2 }
  const examples = (scheme: Scheme, application: 'rbd' | 'cephfs' | 'rgw', objectSizeKiB?: number) => {
    const sections = buildCommands(input(scheme, { ...defaultPoolOptions(), application }, { objectSizeKiB }))
    return sections.find((x) => x.id === 'examples')
  }
  const lines = (section: ReturnType<typeof examples>) => section!.lines.map((l) => l.parts.join(' '))

  it('creates an RBD image, with the object size only when it is not the default', () => {
    expect(lines(examples(rep3, 'rbd'))).toEqual(['rbd create --size 100G data/image01'])
    expect(lines(examples(rep3, 'rbd', 1024))).toEqual(['rbd create --size 100G --object-size 1M data/image01'])
    // EC: the data pool next to a replicated image pool
    expect(lines(examples(ec42, 'rbd', 4096))).toEqual(['rbd create --size 100G --data-pool data rbd/image01'])
    expect(examples(rep3, 'rbd')!.lines.every((l) => l.example)).toBe(true)
  })

  it('creates a CephFS file system and sets the object size in a directory layout', () => {
    expect(lines(examples(rep3, 'cephfs'))).toEqual(['ceph fs new cephfs cephfs_metadata data'])
    // smaller than the default stripe_unit (4M): shrink it first
    expect(lines(examples(rep3, 'cephfs', 1024))).toEqual([
      'ceph fs new cephfs cephfs_metadata data',
      'setfattr -n ceph.dir.layout.stripe_unit -v 1048576 /mnt/cephfs/<dir>',
      'setfattr -n ceph.dir.layout.object_size -v 1048576 /mnt/cephfs/<dir>',
    ])
    // larger: the 4M stripe_unit still fits
    expect(lines(examples(rep3, 'cephfs', 8192)).slice(1)).toEqual([
      'setfattr -n ceph.dir.layout.object_size -v 8388608 /mnt/cephfs/<dir>',
    ])
    // EC: an additional data pool for a directory, not the default one
    expect(lines(examples(ec42, 'cephfs'))).toEqual([
      'ceph fs add_data_pool cephfs data',
      'setfattr -n ceph.dir.layout.pool -v data /mnt/cephfs/<dir>',
    ])
  })

  it('has no examples for other applications', () => {
    expect(examples(rep3, 'rgw')).toBeUndefined()
  })

  it('comments the examples out in the script', () => {
    const s = script(input(rep3, { ...defaultPoolOptions(), application: 'rbd' }, { objectSizeKiB: 1024 }))
    expect(s).toContain('# Examples\n# Commented out: adjust the names, sizes and paths, then run them.\n# rbd create --size 100G --object-size 1M data/image01\n')
  })
})

