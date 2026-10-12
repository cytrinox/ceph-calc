import { describe, expect, it } from 'vitest'
import { computeCapacity, DEFAULT_RATIOS, type CapacityInput, type Scheme, type Tunables } from './ceph'
import { crushWeightOverflow } from './crushTree'
import { iopsBasis } from './iops'
import { defaultPoolOptions, type PoolOptions } from './pool'
import { isApplicable, recommendations } from './recommendations'
import { buildBasicTopology, buildExampleTopology, failureDomains, newBucket, newOsdGroup, TOPOLOGY_EXAMPLES, type DomainType } from './topology'

const rep3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }
const ratios = { fullRatio: DEFAULT_RATIOS.full, backfillfullRatio: DEFAULT_RATIOS.backfillfull, nearfullRatio: DEFAULT_RATIOS.nearfull }
const hosts = (n: number) => failureDomains(buildBasicTopology({ hosts: n, osdsPerHost: 8, osdSizeTB: 8 }), 'host')

function recs(input: CapacityInput, scheme: Scheme, tunables: Tunables, domain: DomainType = 'host') {
  return recommendations({ input, result: computeCapacity(input, scheme, tunables), tunables, scheme, domain })
}

const ids = (list: { id: string }[]) => list.map((r) => r.id)

describe('nearfull recommendation', () => {
  it('is not needed without a recovery reserve', () => {
    expect(ids(recs(hosts(5), rep3, { ...ratios, recoveryReserve: 0 }))).not.toContain('nearfull-ratio')
  })

  it('recommends the healthy fill of the plan as the cluster nearfull ratio', () => {
    const [one] = recs(hosts(5), rep3, { ...ratios, recoveryReserve: 1 }) // 4/5 × 0.85
    expect(one.ratios).toEqual({ nearfull: 0.68 })
    expect(one.title).toBe("Set the cluster's nearfull ratio to 0.68")
    expect(one.severity).toBe('info')
    expect(one.toggleLabel).toBe('nearfull_ratio 0.68 instead of 0.85')
    expect(one.changes).toMatchObject([
      { parameter: 'nearfull_ratio', from: '0.85', to: '0.68', fromMarker: 'nearfull', toMarker: 'recommended' },
    ])
    expect(one.details.join(' ')).toContain('1 failed host')
    expect(one.details.join(' ')).toContain('nearfull_ratio is cluster-wide, not per pool')
    expect(one.distribution).toEqual({ nearfull: 0.68 })
    expect(recs(hosts(5), rep3, { ...ratios, recoveryReserve: 2 })[0].ratios).toEqual({ nearfull: 0.51 }) // 3/5 × 0.85
  })

  it('rounds down for unbalanced layouts', () => {
    const ex = TOPOLOGY_EXAMPLES.find((e) => e.id === 'unbalanced-hosts')!
    const input = failureDomains(ex.build(), ex.domain)
    // 30 TB placeable after losing the 20 TB host × 0.85 / 45 TB healthy placeable = 0.5667
    expect(recs(input, ex.scheme, { ...ratios, recoveryReserve: 1 })[0].ratios).toEqual({ nearfull: 0.56 })
  })

  it('follows the planning ratio and names the failure domain', () => {
    const allOne = { fullRatio: 1, backfillfullRatio: 1, nearfullRatio: 1, recoveryReserve: 1 }
    expect(recs(hosts(5), rep3, allOne)[0].ratios).toEqual({ nearfull: 0.8 })
    const racks = TOPOLOGY_EXAMPLES.find((e) => e.id === 'racks')!
    const [rack] = recs(failureDomains(racks.build(), 'rack'), racks.scheme, { ...ratios, recoveryReserve: 1 }, 'rack')
    expect(rack.changes[0].fromNote).toBe('planning value (step 3): highest OSD fill after recovering 1 failed rack')
  })

  it('has nothing to say about invalid layouts', () => {
    expect(recs(hosts(3), rep3, { ...ratios, recoveryReserve: 1 })).toEqual([])
  })
})

describe('single-copy recommendation', () => {
  const size1: Scheme = { kind: 'replicated', size: 1, minSize: 1 }

  it('recommends silencing the no-redundancy warning for size 1', () => {
    const list = recs(hosts(5), size1, { ...ratios, recoveryReserve: 0 })
    expect(ids(list)).toEqual(['replication', 'single-copy'])
    const single = list[1]
    expect(single.config).toEqual([{ option: 'mon_warn_on_pool_no_redundancy', value: 'false' }])
    expect(single.changes.map((c) => `${c.parameter}: ${c.from} -> ${c.to}`)).toEqual([
      'mon_allow_pool_size_one: false -> true',
      'mon_warn_on_pool_no_redundancy: true -> false',
    ])
    expect(single.details.join(' ')).not.toContain('recovery reserve')
  })

  it('explains that a recovery reserve does not help, without a nearfull recommendation', () => {
    const list = recs(hosts(5), size1, { ...ratios, recoveryReserve: 1 })
    expect(ids(list)).toEqual(['replication', 'single-copy'])
    expect(list[1].details.join(' ')).toContain("A recovery reserve of 1 host doesn't help a single-copy pool")
  })

  it('is only for replication size 1', () => {
    for (const scheme of [{ kind: 'replicated', size: 2, minSize: 1 }, rep3, { kind: 'ec', k: 4, m: 2 }] as Scheme[]) {
      expect(recs(hosts(8), scheme, { ...ratios, recoveryReserve: 0 }).map((r) => r.id)).not.toContain('single-copy')
    }
  })
})

describe('adoptable recommendations', () => {
  const size1: Scheme = { kind: 'replicated', size: 1, minSize: 1 }

  it('recommends a recovery reserve of 1 when none is planned and a spare domain exists', () => {
    const rec = recs(hosts(5), rep3, { ...ratios, recoveryReserve: 0 }).find((r) => r.id === 'recovery-reserve')!
    expect(rec.title).toBe('Plan a recovery reserve of 1 host')
    expect(rec.severity).toBe('info')
    expect(rec.adopt).toEqual({ summary: 'recovery reserve of 1 host', setup: { recoveryReserve: 1 } })
    // 5 × 64 TB × 0.85 / 3 = 90.7 TB without, 4/5 of it (72.5 TB) with the reserve
    expect(rec.changes[0]).toMatchObject({ from: '0', to: '1', fromNote: '90.7 TB real net capacity', toNote: '72.5 TB real net capacity' })
    expect(isApplicable(rec)).toBe(false)
    // no spare host (3 hosts, 3 copies), nothing planned already, or nothing to recover (size 1)
    expect(ids(recs(hosts(3), rep3, { ...ratios, recoveryReserve: 0 }))).not.toContain('recovery-reserve')
    expect(ids(recs(hosts(5), rep3, { ...ratios, recoveryReserve: 1 }))).not.toContain('recovery-reserve')
    expect(ids(recs(hosts(5), size1, { ...ratios, recoveryReserve: 0 }))).not.toContain('recovery-reserve')
  })

  it('recommends 3 copies instead of 1, or 2 when only 2 domains exist', () => {
    const three = recs(hosts(5), size1, { ...ratios, recoveryReserve: 0 })[0]
    expect(three.title).toBe('Keep 3 copies instead of 1')
    expect(three.severity).toBe('critical')
    expect(three.adopt).toEqual({ summary: 'replication 3x', setup: { scheme: rep3 } })
    expect(three.changes[0].toNote).toContain('survives 2 failed hosts')
    const two = recs(hosts(2), size1, { ...ratios, recoveryReserve: 0 })[0]
    expect(two.adopt?.setup.scheme).toEqual({ kind: 'replicated', size: 2, minSize: 1 })
    // a single host offers no second domain: only the Ceph settings for size 1 remain
    expect(ids(recs(hosts(1), size1, { ...ratios, recoveryReserve: 0 }))).toEqual(['single-copy'])
  })

  it('keeps the applied recommendations applicable', () => {
    const list = recs(hosts(5), rep3, { ...ratios, recoveryReserve: 1 })
    expect(list.filter(isApplicable).map((r) => r.id)).toEqual(['nearfull-ratio'])
  })
})

describe('failure-domain recommendation', () => {
  const size1: Scheme = { kind: 'replicated', size: 1, minSize: 1 }
  const ec42: Scheme = { kind: 'ec', k: 4, m: 2 }

  /** Spread across OSDs of n hosts (8 × 8 TB each), with the host-level domains the recommendation needs. */
  function osdRecs(n: number, scheme: Scheme, tunables: Tunables, withHosts = true) {
    const topology = buildBasicTopology({ hosts: n, osdsPerHost: 8, osdSizeTB: 8 })
    const input = failureDomains(topology, 'osd')
    const hostInput = withHosts ? failureDomains(topology, 'host') : undefined
    return recommendations({ input, result: computeCapacity(input, scheme, tunables), tunables, scheme, domain: 'osd', hostInput })
  }

  it('recommends hosts instead of OSDs as failure domain, as a risk of data loss', () => {
    const list = osdRecs(5, rep3, { ...ratios, recoveryReserve: 0 })
    expect(ids(list)).toEqual(['failure-domain', 'recovery-reserve'])
    const [rec] = list
    expect(rec.title).toBe('Spread the copies across hosts instead of OSDs')
    expect(rec.severity).toBe('critical')
    expect(rec.changes).toMatchObject([
      { parameter: 'spread across (step 2)', from: 'OSDs', to: 'hosts', toNote: '90.7 TB real net capacity, survives 2 failed hosts' },
    ])
    expect(rec.details.join(' ')).toContain('The real net capacity stays the same.')
    expect(rec.adopt).toEqual({ summary: 'spread across hosts', setup: { failureDomain: 'host' } })
    expect(isApplicable(rec)).toBe(false)
  })

  it('speaks of chunks for EC and keeps a reserve that fits', () => {
    const rec = osdRecs(8, ec42, { ...ratios, recoveryReserve: 1 })[0]
    expect(rec.title).toBe('Spread the chunks across hosts instead of OSDs')
    expect(rec.changes).toHaveLength(1)
    expect(rec.details.join(' ')).toContain('it keeps room for 1 failed host instead of 1 OSD')
    expect(rec.adopt?.setup).toEqual({ failureDomain: 'host' })
  })

  it('lowers the recovery reserve when there is no spare host for it', () => {
    const rec = osdRecs(3, rep3, { ...ratios, recoveryReserve: 1 })[0]
    expect(rec.id).toBe('failure-domain')
    expect(rec.changes).toMatchObject([
      { from: 'OSDs', to: 'hosts' },
      { parameter: 'recovery reserve (step 3)', from: '1', to: '0', toNote: 'no spare host for a reserve' },
    ])
    expect(rec.details.join(' ')).toContain('With 3 hosts there is no spare host for a recovery reserve of 1, so it drops to 0.')
    // 23 × 8 TB × 0.85 / 3 = 52.1 TB with 1 OSD reserved, 3 × 64 TB × 0.85 / 3 = 54.4 TB without a reserve
    expect(rec.details.join(' ')).toContain('It gives 2.27 TB more real net capacity, as the recovery reserve drops.')
    expect(rec.adopt).toEqual({
      summary: 'spread across hosts, recovery reserve 0',
      setup: { failureDomain: 'host', recoveryReserve: 0 },
    })
  })

  it('is only offered when hosts can hold the layout and it protects anything', () => {
    const none = { ...ratios, recoveryReserve: 0 }
    expect(ids(osdRecs(2, rep3, none))).not.toContain('failure-domain') // 3 copies need 3 hosts
    expect(ids(osdRecs(1, rep3, none))).not.toContain('failure-domain')
    expect(ids(osdRecs(5, size1, none))).not.toContain('failure-domain')
    expect(ids(osdRecs(5, rep3, none, false))).not.toContain('failure-domain')
    expect(ids(recs(hosts(5), rep3, none))).not.toContain('failure-domain')
  })
})

describe('CRUSH weight recommendation', () => {
  const none = { ...ratios, recoveryReserve: 0 }
  const withOverflow = (topology: ReturnType<typeof buildExampleTopology>) => {
    const input = failureDomains(topology, 'host')
    const result = computeCapacity(input, rep3, none)
    return recommendations({ input, result, tunables: none, scheme: rep3, domain: 'host', crushOverflow: crushWeightOverflow(topology) })
  }

  it('recommends osd_crush_initial_weight = 1 when a bucket would overflow', () => {
    const rec = withOverflow(buildExampleTopology()).find((r) => r.id === 'crush-initial-weight')!
    expect(rec.title).toBe('Set osd_crush_initial_weight to 1')
    expect(rec.severity).toBe('info')
    expect(rec.config).toEqual([{ option: 'osd_crush_initial_weight', value: '1' }])
    expect(rec.changes).toMatchObject([{ parameter: 'osd_crush_initial_weight', from: '-1', to: '1' }])
    expect(rec.changes[0].fromNote).toContain('582,076 TiB, above the 65,536 TiB limit')
    expect(rec.changes[0].toNote).toBe('every OSD weighs 1; root 40,000')
    expect(rec.details.join(' ')).toContain('ceph osd crush reweight-subtree default 1')
    expect(rec.details.join(' ')).not.toContain('differ in size')
    expect(isApplicable(rec)).toBe(true)
  })

  it('warns that equal weights ignore different OSD sizes', () => {
    const topology = [
      newBucket('host', 'big', { count: 4000, osds: [newOsdGroup(1, 16)] }),
      newBucket('host', 'small', { count: 4000, osds: [newOsdGroup(1, 8)] }),
    ]
    const rec = withOverflow(topology).find((r) => r.id === 'crush-initial-weight')!
    expect(rec.details.join(' ')).toContain('Your OSDs differ in size (8 to 16 TB)')
  })

  it('is not needed while the weights fit', () => {
    expect(ids(withOverflow(buildBasicTopology({ hosts: 5, osdsPerHost: 8, osdSizeTB: 8 })))).not.toContain('crush-initial-weight')
  })
})

describe('EC optimizations recommendation', () => {
  const ec42: Scheme = { kind: 'ec', k: 4, m: 2 }
  const none = { ...ratios, recoveryReserve: 0 }
  const ecRecs = (scheme: Scheme, pool: Partial<PoolOptions> = {}, withIops = false) => {
    const input = hosts(8)
    const result = computeCapacity(input, scheme, none)
    // 64 OSDs of 8 TB, 200 IOPS each
    const iops = withIops ? iopsBasis([{ cls: 'ssd', osd: { read: 200, write: 200 }, largestOsdTB: 8 }], 512, 4) : null
    return recommendations({
      input,
      result,
      tunables: none,
      scheme,
      domain: 'host',
      pool: { ...defaultPoolOptions(), ...pool },
      ioSizeKiB: 4,
      iops,
    })
  }
  const find = (list: ReturnType<typeof ecRecs>) => list.find((r) => r.id === 'ec-optimizations')

  it('recommends allow_ec_optimizations with the 16K stripe_unit for a classic EC pool', () => {
    const rec = find(ecRecs(ec42))!
    expect(rec.title).toBe('Enable EC optimizations')
    expect(rec.severity).toBe('info')
    expect(rec.changes).toMatchObject([
      {
        parameter: 'allow_ec_optimizations (step 4)',
        from: 'false',
        to: 'true',
        fromNote: '4K: read 4 OSD reads, write 4 reads + 6 writes',
        toNote: '4K: read 1 OSD read, write 3 reads + 3 writes',
      },
      { parameter: 'stripe_unit (step 4)', from: '4K', to: '16K' },
    ])
    expect(rec.details.join(' ')).toContain('Only available from Ceph Tentacle (v20) on')
    expect(rec.details.join(' ')).toContain('cannot be switched off')
    expect(rec.adopt).toEqual({
      summary: 'EC optimizations, stripe_unit 16K',
      setup: { pool: { ecOptimizations: true, stripeUnitKiB: 16 } },
    })
    expect(isApplicable(rec)).toBe(false)
  })

  it('shows the IOPS it gains when per-OSD IOPS are set', () => {
    const rec = find(ecRecs(ec42, {}, true))!
    // 64 OSDs × 200: classic 3,200 read / 1,280 write; optimized 12,800 / 2,133
    expect(rec.changes[0].fromNote).toBe('4K: read 4 OSD reads, write 4 reads + 6 writes; 3.2K / 1.28K IOPS')
    expect(rec.changes[0].toNote).toBe('4K: read 1 OSD read, write 3 reads + 3 writes; 12.8K / 2.13K IOPS')
  })

  it('keeps a stripe_unit of 16K or more', () => {
    const rec = find(ecRecs(ec42, { stripeUnitKiB: 64 }))!
    expect(rec.changes).toHaveLength(1)
    expect(rec.adopt).toEqual({ summary: 'EC optimizations', setup: { pool: { ecOptimizations: true } } })
  })

  it('recommends a 16K stripe_unit once EC optimizations are on', () => {
    const rec = ecRecs(ec42, { ecOptimizations: true, stripeUnitKiB: 4 }).find((r) => r.id === 'stripe-unit')!
    expect(find(ecRecs(ec42, { ecOptimizations: true, stripeUnitKiB: 4 }))).toBeUndefined()
    expect(rec.title).toBe('Raise stripe_unit to 16K')
    // a 4K request fits one strip either way; at 16K the shards differ: 4 (4K strips) vs 1
    expect(rec.changes).toEqual([
      {
        parameter: 'stripe_unit (step 4)',
        from: '4K',
        // 4 strips of 4K: a whole stripe, written without reading
        fromNote: '16K: read 4 OSD reads, write 6 OSD writes',
        to: '16K',
        toNote: '16K: read 1 OSD read, write 3 reads + 3 writes',
      },
    ])
    expect(rec.details.join(' ')).toContain('with 4K a 16K request spreads over 4 shards, with 16K over 1 shard')
    expect(rec.adopt).toEqual({ summary: 'stripe_unit 16K', setup: { pool: { stripeUnitKiB: 16 } } })
    // not with 16K or more, without optimizations, or with an unsupported plugin
    const ids = (pool: Partial<PoolOptions>) => ecRecs(ec42, pool).map((r) => r.id)
    expect(ids({ ecOptimizations: true, stripeUnitKiB: 16 })).not.toContain('stripe-unit')
    expect(ids({ ecOptimizations: false, stripeUnitKiB: 4 })).not.toContain('stripe-unit')
    expect(ids({ ecOptimizations: true, stripeUnitKiB: 4, ecPlugin: 'clay' })).not.toContain('stripe-unit')
  })

  it('shows the IOPS of the stripe_unit change at the client I/O size', () => {
    const input = hosts(8)
    const pool = { ...defaultPoolOptions(), ecOptimizations: true, stripeUnitKiB: 4 }
    const iops = iopsBasis([{ cls: 'ssd', osd: { read: 200, write: 200 }, largestOsdTB: 8 }], 512, 16)
    const rec = recommendations({ input, result: computeCapacity(input, ec42, none), tunables: none, scheme: ec42, domain: 'host', pool, ioSizeKiB: 16, iops })
      .find((r) => r.id === 'stripe-unit')!
    expect(rec.changes[0].toNote).toMatch(/^16K: read 1 OSD read, write 3 reads \+ 3 writes; .* IOPS$/)
  })

  it('is only for EC pools whose plugin supports it and that do not have it yet', () => {
    expect(find(ecRecs(rep3))).toBeUndefined()
    expect(find(ecRecs(ec42, { ecOptimizations: true, stripeUnitKiB: 16 }))).toBeUndefined()
    expect(find(ecRecs(ec42, { ecPlugin: 'clay' }))).toBeUndefined()
    expect(find(ecRecs(ec42, { ecTechnique: 'cauchy_good' }))).toBeUndefined()
    expect(find(ecRecs(ec42, { ecPlugin: 'isa' }))).toBeDefined()
  })
})

describe('pg_num recommendation', () => {
  const none = { ...ratios, recoveryReserve: 0 }
  // 5 hosts × 8 OSDs = 40 OSDs
  const pgRecs = (pool: Partial<PoolOptions>, pgTargetPerOsd?: number, scheme: Scheme = rep3) => {
    const input = hosts(5)
    return recommendations({
      input,
      result: computeCapacity(input, scheme, none),
      tunables: none,
      scheme,
      domain: 'host',
      pool: { ...defaultPoolOptions(), ...pool },
      osdCount: 40,
      pgTargetPerOsd,
    })
  }
  const find = (list: ReturnType<typeof pgRecs>) => list.find((r) => r.id === 'pg-num')

  it('recommends the pg_num the autoscaler aims for instead of the default', () => {
    const rec = find(pgRecs({ autoscaleMode: 'warn' }))!
    expect(rec.title).toBe('Set pg_num to 1024')
    expect(rec.severity).toBe('info')
    expect(rec.changes).toEqual([
      {
        parameter: 'pg_num (step 4)',
        from: '32',
        fromNote: 'Ceph default; 2.4 PG replicas per OSD',
        to: '1024',
        toNote: '77 per OSD; target 100',
      },
    ])
    expect(rec.formula).toBe(
      [
        'pg_num ≈ OSDs × PG target ÷ copies',
        '       = 40 × 100 ÷ 3 = 1,333',
        '       → closest power of two: 1024',
      ].join('\n'),
    )
    expect(rec.details.join(' ')).toContain('mon_target_pg_per_osd, 100, step 5')
    // 32 is 32× below 1024: the autoscaler warns
    expect(rec.details.join(' ')).toContain('reports POOL_TOO_FEW_PGS')
    expect(rec.adopt).toEqual({ summary: 'pg_num 1024', setup: { pool: { pgNum: 1024 } } })
    expect(isApplicable(rec)).toBe(false)
  })

  it('follows the PG target and only reports autoscaler warnings in warn mode', () => {
    const off = find(pgRecs({ autoscaleMode: 'off', pgNum: 512 }, 200))!
    expect(off.changes[0]).toMatchObject({ from: '512', to: '2048', fromNote: '38 PG replicas per OSD', toNote: '154 per OSD; target 200' })
    expect(off.details.join(' ')).not.toContain('POOL_TOO')
    // 2× off is within the autoscaler's threshold
    expect(find(pgRecs({ autoscaleMode: 'warn', pgNum: 2048 }))!.details.join(' ')).not.toContain('POOL_TOO')
  })

  it('warns when Ceph would refuse the pool', () => {
    // 4096 × 3 ÷ 40 = 307 PG replicas per OSD > 250
    const rec = find(pgRecs({ autoscaleMode: 'off', pgNum: 4096 }))!
    expect(rec.details.join(' ')).toContain('Ceph refuses to create the pool: mon_max_pg_per_osd allows 250')
    expect(find(pgRecs({ autoscaleMode: 'off', pgNum: 2048 }))!.details.join(' ')).not.toContain('refuses')
  })

  it('speaks of shards for EC pools', () => {
    const rec = find(pgRecs({ autoscaleMode: 'off' }, undefined, { kind: 'ec', k: 4, m: 2 }))!
    // 40 × 100 ÷ 6 = 667 → 512
    expect(rec.formula?.split('\n')).toEqual([
      'pg_num ≈ OSDs × PG target ÷ shards',
      '       = 40 × 100 ÷ 6 = 667',
      '       → closest power of two: 512',
    ])
    expect(rec.details.join(' ')).toContain('every PG lives on 6 OSDs (its shards)')
  })

  it('is only for pools with their own pg_num that differs', () => {
    expect(find(pgRecs({ autoscaleMode: 'on' }))).toBeUndefined()
    expect(find(pgRecs({ autoscaleMode: 'off', pgNum: 1024 }))).toBeUndefined()
    expect(find(pgRecs({ autoscaleMode: 'off', pgNum: 2048 }, 200))).toBeUndefined()
  })
})

