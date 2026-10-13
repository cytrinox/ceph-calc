// Recommendations derived from the capacity result and the pool layout, shown in their own panel. Two kinds:
// - applied: Ceph settings (`ratios`, `config`) that the commands panel can add to the generated commands;
// - adopted: changes to the calculator's own setup (`adopt`), taken over with a button.
// Add new kinds to `recommendations()`.

import { computeCapacity, schemeWidth, type CapacityInput, type CapacityResult, type Scheme, type Tunables } from './ceph'
import { CRUSH_WEIGHT_MAX, initialWeightFor, type CrushWeightOverflow } from './crushTree'
import { formatInt, formatIops, formatPct } from './format'
import { describeCost, estimateIops, ioSizeLabel, opCosts, type IopsBasis } from './iops'
import {
  AUTOSCALE_PG_NUM_MIN,
  DEFAULT_PG_TARGET_PER_OSD,
  DEFAULT_POOL_PG_NUM,
  EC_OPTIMIZATION_PLUGINS,
  MAX_PG_PER_OSD,
  MAX_POOL_PG_NUM,
  nearestPowerOfTwo,
  PG_AUTOSCALE_THRESHOLD,
  pgReplicasPerOsd,
  suggestPgNum,
  usesPgNum,
  type PoolOptions,
} from './pool'
import { PRESETS } from './schemes'
import { plural, type DomainType } from './topology'
import { formatCapacity } from './units'

export type RatioKey = 'nearfull' | 'backfillfull' | 'full'

/** A `ceph config set global <option> <value>` setting. */
export interface ConfigSetting {
  option: string
  value: string
}

export interface RecommendationInput {
  /** The failure domains, for what-if calculations of a changed setup. */
  input: CapacityInput
  result: CapacityResult
  tunables: Tunables
  scheme: Scheme
  domain: DomainType
  /** The same topology with hosts as failure domains; only needed while spreading across OSDs. */
  hostInput?: CapacityInput
  /** Set when CRUSH can't hold the hardware with its default weights (see `crushWeightOverflow`). */
  crushOverflow?: CrushWeightOverflow | null
  /** Pool options (step 4), for recommendations about them. */
  pool?: PoolOptions
  /** Client I/O size of the IOPS estimate (step 5), in KiB. */
  ioSizeKiB?: number
  /** RADOS object size (step 5), in KiB. */
  objectSizeKiB?: number
  /** IOPS basis when per-OSD IOPS are set, to show what a change does to the estimate. */
  iops?: IopsBasis | null
  /** OSDs the CRUSH rule uses (its device class only). */
  osdCount?: number
  /** mon_target_pg_per_osd (step 5). */
  pgTargetPerOsd?: number
}

export type MarkerKind = 'nearfull' | 'backfillfull' | 'full' | 'recommended'

/** Calculator inputs an adopted recommendation changes. */
export interface SetupChange {
  recoveryReserve?: number
  scheme?: Scheme
  failureDomain?: DomainType
  pool?: Partial<PoolOptions>
}

/** "Switch parameter X from A to B", with short notes and optional ratio markers. */
export interface SettingChange {
  parameter: string
  from: string
  to: string
  fromNote?: string
  toNote?: string
  fromMarker?: MarkerKind
  toMarker?: MarkerKind
}

export interface Recommendation {
  id: string
  /** `critical` when the current setup risks data loss (red warning sign), else `info` (light bulb). */
  severity: 'info' | 'critical'
  /** Headline, e.g. "Set the cluster's nearfull ratio to 0.68". */
  title: string
  /** The settings it changes. */
  changes: SettingChange[]
  /** Explanation paragraphs. */
  details: string[]
  /** Short label for its toggle in the commands panel (applied recommendations). */
  toggleLabel?: string
  /** Cluster-wide ratios it sets when applied. */
  ratios?: Partial<Record<RatioKey, number>>
  /** Config options it sets when applied. */
  config?: ConfigSetting[]
  /** Show the raw data distribution with a marker at this nearfull ratio. */
  distribution?: { nearfull: number }
  /** The calculation behind the recommended value, shown as a formula block below the changes. */
  formula?: string
  /** Setup change taken over with "Adopt recommendation"; `summary` names it afterwards ("recovery reserve of 1 host"). */
  adopt?: { summary: string; setup: SetupChange }
}

/** Whether the recommendation changes the generated commands (and so gets a toggle in the commands panel). */
export function isApplicable(rec: Recommendation): boolean {
  return Object.keys(rec.ratios ?? {}).length > 0 || (rec.config?.length ?? 0) > 0
}

const ratio = (r: number) => r.toFixed(2)

/**
 * The Ceph nearfull_ratio that warns as soon as the stored data exceeds the plan. With a recovery reserve the plan
 * keeps healthy OSDs at `healthyFill`, so that after losing the reserved domains and recovering their data they
 * reach the planning nearfull ratio. Rounded down, so the warning comes at or just before that point.
 */
export function nearfullRecommendation({ result, tunables, domain }: RecommendationInput): Recommendation | null {
  const reserve = Math.floor(tunables.recoveryReserve || 0)
  const planning = result.fillRatios.nearfull
  const recommended = Math.floor(result.healthyFill * 100 + 1e-9) / 100
  // Without a tolerated failure (size 1) there is nothing to recover, so the reserve has no meaning here.
  if (!result.valid || reserve <= 0 || result.failuresTolerated <= 0) return null
  if (!(recommended > 0) || recommended >= Number(ratio(planning))) return null
  const failed = `${reserve} failed ${plural(domain, reserve)}`
  const p = ratio(planning)
  const r = ratio(recommended)
  return {
    id: 'nearfull-ratio',
    severity: 'info',
    title: `Set the cluster's nearfull ratio to ${r}`,
    changes: [
      {
        parameter: 'nearfull_ratio',
        from: p,
        fromNote: `planning value (step 3): highest OSD fill after recovering ${failed}`,
        fromMarker: 'nearfull',
        to: r,
        toNote: 'healthy OSDs reach it when the data exceeds the plan',
        toMarker: 'recommended',
      },
    ],
    details: [
      `With a recovery reserve of ${reserve} ${plural(domain, reserve)}, the planned data fills healthy OSDs to only ` +
        `${formatPct(result.healthyFill)}: the rest is kept free to recover ${failed} and still stay below ${p}.`,
      `Ceph's nearfull warning at ${p} would only fire once that reserve is used up, when a failure could no longer ` +
        `be recovered below ${p}. At ${r} (the larger marker, where the planned data ends), Ceph warns as soon as ` +
        `more data is stored than planned.`,
      `After a failure and recovery the OSDs are near ${p}, so the warning stays on until the failed ` +
        `${plural(domain, 1)} is replaced: the reserve is in use.`,
      `Only change it if this pool is alone on the cluster: nearfull_ratio is cluster-wide, not per pool. With ` +
        `other pools, or OSDs of other device classes that fill at their own pace, the lower ratio would also warn ` +
        `for data that follows other plans. Then keep ${p} and watch this pool's usage (ceph df) instead.`,
    ],
    toggleLabel: `nearfull_ratio ${r} instead of ${p}`,
    ratios: { nearfull: recommended },
    distribution: { nearfull: recommended },
  }
}

/**
 * Settings for a replicated pool with size 1. Ceph refuses it without mon_allow_pool_size_one (the generated
 * commands always set that), and afterwards keeps HEALTH_WARN for as long as the pool exists unless
 * mon_warn_on_pool_no_redundancy is switched off.
 */
export function singleCopyRecommendation({ scheme, tunables, domain }: RecommendationInput): Recommendation | null {
  if (scheme.kind !== 'replicated' || scheme.size !== 1) return null
  const reserve = Math.floor(tunables.recoveryReserve || 0)
  const details = [
    'Ceph refuses pools with size 1 unless mon_allow_pool_size_one is true, and the size change needs ' +
      '--yes-i-really-mean-it. Both are already part of the generated commands.',
    'Once the pool exists, Ceph reports HEALTH_WARN "pool(s) have no replicas configured" for as long as it keeps a ' +
      'single copy. A permanent warning hides new problems; mon_warn_on_pool_no_redundancy = false silences it, ' +
      'for every pool in the cluster.',
  ]
  if (reserve > 0) {
    details.push(
      `A recovery reserve of ${reserve} ${plural(domain, reserve)} doesn't help a single-copy pool: a failed ` +
        `${plural(domain, 1)} loses its data, nothing can be recovered. A reserve of 0 gives the space back.`,
    )
  }
  details.push('Use size 1 only for data you can recreate: any failed OSD loses data.')
  return {
    id: 'single-copy',
    severity: 'info',
    title: 'Prepare Ceph for a single-copy pool',
    changes: [
      {
        parameter: 'mon_allow_pool_size_one',
        from: 'false',
        fromNote: 'Ceph default',
        to: 'true',
        toNote: 'required for size 1; already in the commands',
      },
      {
        parameter: 'mon_warn_on_pool_no_redundancy',
        from: 'true',
        fromNote: 'Ceph default',
        to: 'false',
        toNote: 'silences the permanent HEALTH_WARN',
      },
    ],
    details,
    toggleLabel: 'mon_warn_on_pool_no_redundancy false',
    config: [{ option: 'mon_warn_on_pool_no_redundancy', value: 'false' }],
  }
}

/**
 * A recovery reserve of 1 when none is planned: without it a failed domain can't be recovered. Only when a spare
 * domain exists (otherwise the layout could not be placed) and the layout survives a failure at all.
 */
export function recoveryReserveRecommendation({
  input,
  result,
  tunables,
  scheme,
  domain,
}: RecommendationInput): Recommendation | null {
  if (Math.floor(tunables.recoveryReserve || 0) > 0 || !result.valid || result.failuresTolerated <= 0) return null
  const withReserve = computeCapacity(input, scheme, { ...tunables, recoveryReserve: 1 })
  if (!withReserve.valid) return null
  const one = plural(domain, 1)
  return {
    id: 'recovery-reserve',
    severity: 'info',
    title: `Plan a recovery reserve of 1 ${one}`,
    changes: [
      {
        parameter: 'recovery reserve (step 3)',
        from: '0',
        fromNote: `${formatCapacity(result.usableTB)} real net capacity`,
        to: '1',
        toNote: `${formatCapacity(withReserve.usableTB)} real net capacity`,
      },
    ],
    details: [
      `Without a recovery reserve the cluster may be filled right up to nearfull. When a ${one} fails, its data ` +
        `can't be re-created on the others: backfill stops at backfillfull, placement groups stay degraded until ` +
        `the hardware is replaced, and a further failure can lose data.`,
      `A reserve of 1 ${one} keeps enough space free to recover a failed ${one} automatically. It costs ` +
        `${formatCapacity(result.usableTB - withReserve.usableTB)} of real net capacity.`,
    ],
    adopt: { summary: `recovery reserve of 1 ${one}`, setup: { recoveryReserve: 1 } },
  }
}

/** More than one copy for replication size 1: 3x (Ceph's default), or 2x when only 2 domains are available. */
export function replicationRecommendation({
  input,
  result,
  tunables,
  scheme,
  domain,
}: RecommendationInput): Recommendation | null {
  if (scheme.kind !== 'replicated' || scheme.size !== 1) return null
  const target = ['rep3', 'rep2']
    .map((id) => PRESETS.find((p) => p.id === id)!.scheme)
    .find((s) => computeCapacity(input, s, tunables).valid)
  if (!target || target.kind !== 'replicated') return null
  const better = computeCapacity(input, target, tunables)
  const size = target.size
  const domains = plural(domain)
  return {
    id: 'replication',
    // A single copy loses data with any failed OSD.
    severity: 'critical',
    title: `Keep ${size} copies instead of 1`,
    changes: [
      {
        parameter: 'pool layout (step 2)',
        from: 'size 1',
        fromNote: `${formatCapacity(result.usableTB)} real net capacity, survives no failure`,
        to: `size ${size}`,
        toNote:
          `${formatCapacity(better.usableTB)} real net capacity, survives ${better.failuresTolerated} failed ` +
          plural(domain, better.failuresTolerated),
      },
    ],
    details: [
      'With a single copy every failed OSD loses data: there is nothing to recover from.',
      size === 3
        ? `Replication 3x, Ceph's default, keeps the data when up to 2 ${domains} fail and keeps serving I/O with one failed.`
        : `Replication 2x keeps the data when a ${plural(domain, 1)} fails. With 3 ${domains} or more, 3 copies are safer.`,
      `It costs ${formatCapacity(result.usableTB - better.usableTB)} of real net capacity. Keep size 1 only for data ` +
        `you can recreate.`,
    ],
    adopt: { summary: `replication ${size}x`, setup: { scheme: { ...target } } },
  }
}

/**
 * Hosts instead of OSDs as failure domain when there are several hosts: with OSDs, several copies (chunks) of an
 * object can share a host, so one failed host can take more than the pool tolerates. Keeps the recovery reserve, or
 * lowers it as far as needed when there are too few hosts for it.
 */
export function failureDomainRecommendation({
  result,
  tunables,
  scheme,
  domain,
  hostInput,
}: RecommendationInput): Recommendation | null {
  if (domain !== 'osd' || !hostInput || !result.valid || result.failuresTolerated <= 0) return null
  const hosts = hostInput.groups.reduce((n, g) => n + g.mult, 0)
  if (hosts < 2) return null
  const reserve = Math.floor(tunables.recoveryReserve || 0)
  let kept = reserve
  let better = computeCapacity(hostInput, scheme, tunables)
  while (!better.valid && kept > 0) {
    kept--
    better = computeCapacity(hostInput, scheme, { ...tunables, recoveryReserve: kept })
  }
  if (!better.valid) return null

  const replicated = scheme.kind === 'replicated'
  const copies = replicated ? 'copies' : 'chunks'
  const tolerated = better.failuresTolerated
  const changes: SettingChange[] = [
    {
      parameter: 'spread across (step 2)',
      from: plural('osd'),
      fromNote: `${formatCapacity(result.usableTB)} real net capacity; a failed host can take several ${copies}`,
      to: plural('host'),
      toNote:
        `${formatCapacity(better.usableTB)} real net capacity, survives ${tolerated} failed ` +
        plural('host', tolerated),
    },
  ]
  if (kept < reserve) {
    changes.push({
      parameter: 'recovery reserve (step 3)',
      from: String(reserve),
      fromNote: 'counts OSDs',
      to: String(kept),
      toNote: kept > 0 ? 'counts hosts' : 'no spare host for a reserve',
    })
  }

  const delta = result.usableTB - better.usableTB
  const capacity =
    Math.abs(delta) <= result.usableTB * 0.005
      ? 'The real net capacity stays the same.'
      : delta > 0
        ? `It costs ${formatCapacity(delta)} of real net capacity.`
        : `It gives ${formatCapacity(-delta)} more real net capacity, as the recovery reserve drops.`
  const details = [
    `With OSDs as failure domain, CRUSH only keeps the ${copies} of an object on different OSDs, not on different ` +
      `hosts. A single failed host can take more of them than the pool tolerates: the data is unavailable until the ` +
      `host is back, and lost if its drives are.`,
    `With hosts as failure domain every ${replicated ? 'copy' : 'chunk'} is on a different host, so the pool ` +
      `survives ${tolerated} failed ${plural('host', tolerated)}. ${capacity}`,
  ]
  if (kept < reserve) {
    details.push(
      `With ${hosts} hosts there is no spare host for a recovery reserve of ${reserve}, so it drops to ${kept}.`,
    )
  } else if (reserve > 0) {
    details.push(
      `The recovery reserve of ${reserve} then counts hosts: it keeps room for ${reserve} failed ` +
        `${plural('host', reserve)} instead of ${reserve} ${plural('osd', reserve)}.`,
    )
  }
  return {
    id: 'failure-domain',
    // A failed host can take more copies than the pool tolerates.
    severity: 'critical',
    title: `Spread the ${copies} across hosts instead of OSDs`,
    changes,
    details,
    adopt: {
      summary: kept < reserve ? `spread across hosts, recovery reserve ${kept}` : 'spread across hosts',
      setup: kept < reserve ? { failureDomain: 'host', recoveryReserve: kept } : { failureDomain: 'host' },
    },
  }
}

/** Fixed-point CRUSH weight as TiB, e.g. for "582,076 TiB". */
const tib = (fixed: number) => `${formatInt(Math.round(fixed / 0x10000))} TiB`

/**
 * osd_crush_initial_weight = 1 when the default weights (TiB) overflow a CRUSH bucket: CRUSH only compares weights,
 * so the same weight for every OSD keeps the placement while the root weighs the OSD count. Smaller than 1 only
 * beyond 65,535 OSDs.
 */
export function crushWeightRecommendation({ crushOverflow }: RecommendationInput): Recommendation | null {
  if (!crushOverflow) return null
  const { rootWeight, osds, smallestTB, largestTB } = crushOverflow
  const value = initialWeightFor(osds)
  const limit = tib(CRUSH_WEIGHT_MAX + 1)
  const details = [
    `CRUSH stores a bucket's weight as a 32-bit fixed-point number, so no bucket can weigh more than ${limit}. ` +
      `With Ceph's default weights, each OSD's size in TiB, root default would weigh ${tib(rootWeight)}. Ceph ` +
      `refuses OSDs once a bucket overflows ("insert_item unable to rebuild roots with classes: (34) Numerical ` +
      `result out of range"), and those OSDs never get data.`,
    `CRUSH only compares weights, so giving every OSD the same weight keeps the placement. With ` +
      `osd_crush_initial_weight = ${value}, each new OSD weighs ${value} instead of its size, and the root ` +
      `${formatInt(Number(value) * osds)}.`,
    'Set it before the OSDs are created. An existing cluster can be reweighted with ' +
      `ceph osd crush reweight-subtree default ${value}.`,
  ]
  if (largestTB > smallestTB) {
    details.push(
      `Your OSDs differ in size (${smallestTB} to ${largestTB} TB). With the same weight each gets the same share ` +
        'of data, so the smaller ones fill up first. Give each OSD a weight in proportion to its size instead, e.g. ' +
        'its TiB ÷ 10, with ceph osd crush reweight osd.N <weight>.',
    )
  }
  return {
    id: 'crush-initial-weight',
    severity: 'info',
    title: `Set osd_crush_initial_weight to ${value}`,
    changes: [
      {
        parameter: 'osd_crush_initial_weight',
        from: '-1',
        fromNote: `Ceph default: the size in TiB; root ${tib(rootWeight)}, above the ${limit} limit`,
        to: value,
        toNote: `every OSD weighs ${value}; root ${formatInt(Number(value) * osds)}`,
      },
    ],
    details,
    toggleLabel: `osd_crush_initial_weight ${value}`,
    config: [{ option: 'osd_crush_initial_weight', value }],
  }
}

/**
 * OSD operations per client read and write of `size` ("16K: read 1 OSD read, write 3 reads + 3 writes"), plus the
 * IOPS they allow when per-OSD IOPS are set for that size (the client I/O size of step 5).
 */
function ecEffect(
  scheme: Scheme,
  options: PoolOptions,
  size: number,
  iops: IopsBasis | null | undefined,
  objectSizeKiB: number | undefined,
): string {
  const costs = opCosts(scheme, options, size, objectSizeKiB)
  const ops = `${ioSizeLabel(size)}: read ${describeCost(costs.read)}, write ${describeCost(costs.write)}`
  const estimate = iops && iops.ioSizeKiB === size ? estimateIops(iops, scheme, options) : null
  return estimate && estimate.read !== null && estimate.write !== null
    ? `${ops}; ${formatIops(estimate.read)} / ${formatIops(estimate.write)} IOPS`
    : ops
}

/** Ceph's recommended minimum stripe_unit with EC optimizations, in KiB. */
const EC_OPTIMIZED_STRIPE_UNIT_KIB = 16

/**
 * allow_ec_optimizations for an EC pool without it (Ceph Tentacle or later): partial reads and writes for small
 * I/O. Only for the plugins and technique that support it; raises stripe_unit to Ceph's recommended 16K.
 */
export function ecOptimizationsRecommendation({
  scheme,
  pool,
  ioSizeKiB,
  objectSizeKiB,
  iops,
}: RecommendationInput): Recommendation | null {
  if (scheme.kind !== 'ec' || !pool || pool.ecOptimizations) return null
  if (!EC_OPTIMIZATION_PLUGINS.includes(pool.ecPlugin) || pool.ecTechnique !== 'reed_sol_van') return null
  const { k, m } = scheme
  const size = ioSizeKiB ?? iops?.ioSizeKiB ?? 4
  const stripeUnitKiB = Math.max(pool.stripeUnitKiB, EC_OPTIMIZED_STRIPE_UNIT_KIB)
  const raiseStripeUnit = stripeUnitKiB !== pool.stripeUnitKiB
  const optimized = { ...pool, ecOptimizations: true, stripeUnitKiB }
  const changes: SettingChange[] = [
    {
      parameter: 'allow_ec_optimizations (step 4)',
      from: 'false',
      fromNote: ecEffect(scheme, pool, size, iops, objectSizeKiB),
      to: 'true',
      toNote: ecEffect(scheme, optimized, size, iops, objectSizeKiB),
    },
  ]
  if (raiseStripeUnit) {
    changes.push({
      parameter: 'stripe_unit (step 4)',
      from: ioSizeLabel(pool.stripeUnitKiB),
      fromNote: 'Ceph default',
      to: ioSizeLabel(stripeUnitKiB),
      toNote: "Ceph's recommendation with EC optimizations",
    })
  }
  const details = [
    `Classic EC works on whole stripes: a small read fetches all ${k} data shards, and a small write reads them ` +
      `and rewrites all ${k + m} shards (read-modify-write). That is why EC pools are slow for small random I/O.`,
    'With allow_ec_optimizations Ceph reads only the shards that hold the requested data, and a small write ' +
      'updates just the changed data shards and the parity (parity-delta or partial writes, whichever reads ' +
      'less). Small reads and writes need far fewer OSD operations: higher IOPS, lower latency and less load on ' +
      'the OSDs and the network, which makes EC pools better suited for RBD and CephFS.',
    'Only available from Ceph Tentacle (v20) on, for the jerasure and isa plugins with reed_sol_van; the whole ' +
      'cluster must run Tentacle. Once enabled on a pool it cannot be switched off.',
  ]
  if (raiseStripeUnit) {
    details.push(
      `Ceph recommends a stripe_unit of at least ${ioSizeLabel(EC_OPTIMIZED_STRIPE_UNIT_KIB)} with EC ` +
        'optimizations: medium-sized requests then touch fewer shards. stripe_unit is part of the EC profile, so it ' +
        'is set when the pool is created.',
    )
  }
  return {
    id: 'ec-optimizations',
    severity: 'info',
    title: 'Enable EC optimizations',
    changes,
    details,
    adopt: raiseStripeUnit
      ? {
          summary: `EC optimizations, stripe_unit ${ioSizeLabel(stripeUnitKiB)}`,
          setup: { pool: { ecOptimizations: true, stripeUnitKiB } },
        }
      : { summary: 'EC optimizations', setup: { pool: { ecOptimizations: true } } },
  }
}

/**
 * pg_num as Ceph's autoscaler would pick it, when the pool sets its own (autoscaler off or warn) and it differs:
 * the PG target per OSD (step 5) × OSDs ÷ pool width, as the nearest power of two.
 */
/**
 * stripe_unit of at least 16K for an EC pool with EC optimizations (Ceph's recommendation): requests then touch fewer
 * data shards. The counterpart of `ecOptimizationsRecommendation`, which raises it when enabling them.
 */
export function stripeUnitRecommendation({
  scheme,
  pool,
  ioSizeKiB,
  objectSizeKiB,
  iops,
}: RecommendationInput): Recommendation | null {
  if (scheme.kind !== 'ec' || !pool?.ecOptimizations || pool.stripeUnitKiB >= EC_OPTIMIZED_STRIPE_UNIT_KIB) return null
  // Without a supported plugin and technique the optimizations don't work at all (a pool issue says so).
  if (!EC_OPTIMIZATION_PLUGINS.includes(pool.ecPlugin) || pool.ecTechnique !== 'reed_sol_van') return null
  const to = EC_OPTIMIZED_STRIPE_UNIT_KIB
  const raised = { ...pool, stripeUnitKiB: to }
  // A request no larger than one strip touches one shard either way: compare at least 16K.
  const size = Math.max(ioSizeKiB ?? iops?.ioSizeKiB ?? 4, to)
  const shards = (unit: number) => Math.min(scheme.k, Math.ceil(size / unit))
  const shardWord = (n: number) => `${n} ${n === 1 ? 'shard' : 'shards'}`
  return {
    id: 'stripe-unit',
    severity: 'info',
    title: `Raise stripe_unit to ${ioSizeLabel(to)}`,
    changes: [
      {
        parameter: 'stripe_unit (step 4)',
        from: ioSizeLabel(pool.stripeUnitKiB),
        fromNote: ecEffect(scheme, pool, size, iops, objectSizeKiB),
        to: ioSizeLabel(to),
        toNote: ecEffect(scheme, raised, size, iops, objectSizeKiB),
      },
    ],
    details: [
      'With EC optimizations a request reads and writes only the data shards it touches. stripe_unit is how much ' +
        `data goes to one shard before the next: with ${ioSizeLabel(pool.stripeUnitKiB)} a ${ioSizeLabel(size)} ` +
        `request spreads over ${shardWord(shards(pool.stripeUnitKiB))}, with ${ioSizeLabel(to)} over ` +
        `${shardWord(shards(to))}. Reads of medium-sized requests then need fewer OSD operations; writes compare ` +
        'in the row above (a write covering a whole stripe needs no reads, so small strips can help writes).',
      `Ceph recommends a stripe_unit of at least ${ioSizeLabel(to)} with EC optimizations. stripe_unit is part of ` +
        'the EC profile, so it is set when the pool is created.',
    ],
    adopt: { summary: `stripe_unit ${ioSizeLabel(to)}`, setup: { pool: { stripeUnitKiB: to } } },
  }
}

export function pgNumRecommendation({
  scheme,
  pool,
  osdCount,
  pgTargetPerOsd,
}: RecommendationInput): Recommendation | null {
  if (!pool || !usesPgNum(pool) || !osdCount || osdCount <= 0) return null
  const target = pgTargetPerOsd ?? DEFAULT_PG_TARGET_PER_OSD
  const suggested = suggestPgNum(osdCount, scheme, target)
  const current = pool.pgNum
  if (current === suggested) return null
  const width = schemeWidth(scheme)
  const copies = scheme.kind === 'replicated' ? 'copies' : 'shards'
  const ideal = (osdCount * target) / width
  const raw = ideal < 10 ? ideal.toFixed(1) : formatInt(Math.round(ideal))
  const rounded = nearestPowerOfTwo(ideal)
  // Short lines: the block fits a phone without scrolling. A fourth line names the limit when it changes the result.
  const formula = [
    `pg_num ≈ OSDs × PG target ÷ ${copies}`,
    `       = ${formatInt(osdCount)} × ${formatInt(target)} ÷ ${width} = ${raw}`,
    `       → closest power of two: ${rounded}`,
    ...(suggested > rounded ? [`       → at least ${AUTOSCALE_PG_NUM_MIN} (the autoscaler's minimum)`] : []),
    ...(suggested < rounded ? [`       → at most ${MAX_POOL_PG_NUM} (mon_max_pool_pg_num)`] : []),
  ].join('\n')
  const perOsd = (pg: number) => {
    const n = pgReplicasPerOsd(pg, scheme, osdCount)
    return n < 10 ? n.toFixed(1) : formatInt(Math.round(n))
  }
  const details = [
    'Every PG is placed on its own set of OSDs. Too few PGs spread the data unevenly over the OSDs, so some fill ' +
      'up first, give less parallelism and make each PG bigger to recover. Too many cost memory and CPU on every ' +
      'OSD and more peering.',
    `This is how Ceph's autoscaler sizes a pool: the PG target is the number of PG replicas each OSD should hold ` +
      `(mon_target_pg_per_osd, ${formatInt(target)}, step 5), and every PG lives on ${width} OSDs (its ${copies}). ` +
      "It assumes this pool holds the cluster's data; with more pools, share the PGs by their expected data.",
  ]
  const factor = Math.max(current / suggested, suggested / current)
  if (pool.autoscaleMode === 'warn' && factor > PG_AUTOSCALE_THRESHOLD) {
    details.push(
      `${current} is more than ${PG_AUTOSCALE_THRESHOLD}× off, so the autoscaler in warn mode reports ` +
        `${current < suggested ? 'POOL_TOO_FEW_PGS' : 'POOL_TOO_MANY_PGS'}.`,
    )
  }
  if (pgReplicasPerOsd(current, scheme, osdCount) > MAX_PG_PER_OSD) {
    details.push(
      `With ${perOsd(current)} PG replicas per OSD, Ceph refuses to create the pool: mon_max_pg_per_osd allows ` +
        `${MAX_PG_PER_OSD}.`,
    )
  }
  return {
    id: 'pg-num',
    severity: 'info',
    // pg_num values as Ceph takes them (2048, not 2,048).
    title: `Set pg_num to ${suggested}`,
    changes: [
      {
        parameter: 'pg_num (step 4)',
        from: String(current),
        fromNote: `${current === DEFAULT_POOL_PG_NUM ? 'Ceph default; ' : ''}${perOsd(current)} PG replicas per OSD`,
        to: String(suggested),
        toNote: `${perOsd(suggested)} per OSD; target ${formatInt(target)}`,
      },
    ],
    formula,
    details,
    adopt: { summary: `pg_num ${suggested}`, setup: { pool: { pgNum: suggested } } },
  }
}

export function recommendations(input: RecommendationInput): Recommendation[] {
  return [
    replicationRecommendation(input),
    failureDomainRecommendation(input),
    singleCopyRecommendation(input),
    crushWeightRecommendation(input),
    recoveryReserveRecommendation(input),
    nearfullRecommendation(input),
    ecOptimizationsRecommendation(input),
    stripeUnitRecommendation(input),
    pgNumRecommendation(input),
  ].filter((r): r is Recommendation => r !== null)
}
