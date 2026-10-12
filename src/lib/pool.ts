// Pool-level settings (step 4): options, defaults, derived rule/profile names, PG suggestion and
// validation. commands.ts turns them into Ceph commands.

import { schemeWidth, type Scheme } from './ceph'
import { isValidDeviceClass, type DomainType } from './topology'

export const APPLICATIONS = ['rbd', 'cephfs', 'rgw', 'none'] as const
export const AUTOSCALE_MODES = ['on', 'warn', 'off'] as const
export const COMPRESSION_MODES = ['none', 'passive', 'aggressive', 'force'] as const
export const COMPRESSION_ALGORITHMS = ['snappy', 'zlib', 'zstd', 'lz4'] as const
export const EC_PLUGINS = ['jerasure', 'isa', 'clay'] as const
export const EC_TECHNIQUES = [
  'reed_sol_van',
  'reed_sol_r6_op',
  'cauchy_orig',
  'cauchy_good',
  'liberation',
  'blaum_roth',
  'liber8tion',
  'cauchy',
] as const
/** Allowed stripe_unit values in KiB (Ceph default 4K). */
export const STRIPE_UNITS_KIB = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096] as const

export type Application = (typeof APPLICATIONS)[number]
export type AutoscaleMode = (typeof AUTOSCALE_MODES)[number]
export type CompressionMode = (typeof COMPRESSION_MODES)[number]
export type CompressionAlgorithm = (typeof COMPRESSION_ALGORITHMS)[number]
export type EcPlugin = (typeof EC_PLUGINS)[number]
export type EcTechnique = (typeof EC_TECHNIQUES)[number]

/**
 * Techniques per plugin. clay delegates to a scalar MDS code (jerasure by default); per the
 * Ceph clay docs it then accepts reed_sol_van, reed_sol_r6_op, cauchy_orig, cauchy_good and
 * liber8tion, but not liberation or blaum_roth.
 */
export const TECHNIQUES_BY_PLUGIN: Record<EcPlugin, readonly EcTechnique[]> = {
  jerasure: ['reed_sol_van', 'reed_sol_r6_op', 'cauchy_orig', 'cauchy_good', 'liberation', 'blaum_roth', 'liber8tion'],
  isa: ['reed_sol_van', 'cauchy'],
  clay: ['reed_sol_van', 'reed_sol_r6_op', 'cauchy_orig', 'cauchy_good', 'liber8tion'],
}

/**
 * allow_ec_optimizations (Ceph Tentacle and later) works only with these plugins and the
 * reed_sol_van technique.
 */
export const EC_OPTIMIZATION_PLUGINS: readonly EcPlugin[] = ['jerasure', 'isa']

/** Techniques that only work with exactly two coding chunks. */
export const M2_ONLY_TECHNIQUES: readonly EcTechnique[] = ['reed_sol_r6_op', 'liberation', 'blaum_roth', 'liber8tion']

export interface PoolOptions {
  name: string
  application: Application
  /** CRUSH rule name; empty = derived from scheme and failure domain. */
  crushRule: string
  /** Restrict placement to one device class (built-in or custom); empty = any. */
  deviceClass: string
  /** Erasure-code profile name; empty = derived. EC pools only. */
  ecProfile: string
  ecPlugin: EcPlugin
  ecTechnique: EcTechnique
  /** EC profile stripe_unit in KiB. */
  stripeUnitKiB: number
  /** fast_read: EC reads use the first k shards that answer. */
  fastRead: boolean
  /** allow_ec_overwrites, required for RBD and CephFS data on EC pools. */
  ecOverwrites: boolean
  /** allow_ec_optimizations (Tentacle+): partial reads and writes for small I/O; cannot be disabled. */
  ecOptimizations: boolean
  autoscaleMode: AutoscaleMode
  /** pg_num when the autoscaler is off. */
  pgNum: number
  /** Autoscaler hint: pool is expected to hold most of the data. */
  bulk: boolean
  /** Autoscaler hint: expected share of cluster capacity (0 = unset). */
  targetSizeRatio: number
  /** Autoscaler hint: expected pool size in TB (0 = unset). */
  targetSizeTB: number
  compressionMode: CompressionMode
  compressionAlgorithm: CompressionAlgorithm
  /** Expected compressed size ÷ original size (0.9 = 10% saved); estimate for the effective capacity only. */
  compressionRatio: number
  /** Quota in TB (0 = unlimited). */
  quotaMaxTB: number
  /** Quota in objects (0 = unlimited). */
  quotaMaxObjects: number
  noDelete: boolean
  noSizeChange: boolean
}

export const DEFAULT_COMPRESSION_RATIO = 0.9

/**
 * Logical data that fits into `usableTB` when it compresses to `ratio` of its size.
 * Null when compression is off or would not gain anything.
 */
export function compressedCapacityTB(usableTB: number, pool: PoolOptions): number | null {
  const ratio = pool.compressionRatio
  if (pool.compressionMode === 'none' || !(ratio > 0) || ratio >= 1 || usableTB <= 0) return null
  return usableTB / ratio
}

export function defaultPoolOptions(): PoolOptions {
  return {
    name: 'data',
    application: 'rbd',
    crushRule: '',
    deviceClass: '',
    ecProfile: '',
    ecPlugin: 'jerasure',
    ecTechnique: 'reed_sol_van',
    stripeUnitKiB: 4,
    fastRead: false,
    ecOverwrites: true,
    ecOptimizations: false,
    autoscaleMode: 'on',
    pgNum: DEFAULT_POOL_PG_NUM,
    bulk: false,
    targetSizeRatio: 0,
    targetSizeTB: 0,
    compressionMode: 'none',
    compressionAlgorithm: 'snappy',
    compressionRatio: DEFAULT_COMPRESSION_RATIO,
    quotaMaxTB: 0,
    quotaMaxObjects: 0,
    noDelete: false,
    noSizeChange: false,
  }
}

/** Ceph pool / rule / profile names: keep to a safe, shell-friendly charset. */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name) && name.length <= 128
}

// The dash keeps k and m apart: without it EC 2+11 and EC 21+1 would both be "ec211".
function schemeSlug(scheme: Scheme): string {
  return scheme.kind === 'replicated' ? `rep${scheme.size}` : `ec${scheme.k}-${scheme.m}`
}

export function defaultRuleName(scheme: Scheme, domain: DomainType, deviceClass: string): string {
  return [schemeSlug(scheme), domain, deviceClass].filter(Boolean).join('_')
}

export function defaultProfileName(scheme: Scheme, domain: DomainType, deviceClass: string): string {
  if (scheme.kind !== 'ec') return ''
  return ['ec', `${scheme.k}-${scheme.m}`, domain, deviceClass].filter(Boolean).join('-')
}

export function effectiveRuleName(pool: PoolOptions, scheme: Scheme, domain: DomainType): string {
  return pool.crushRule.trim() || defaultRuleName(scheme, domain, pool.deviceClass)
}

export function effectiveProfileName(pool: PoolOptions, scheme: Scheme, domain: DomainType): string {
  return pool.ecProfile.trim() || defaultProfileName(scheme, domain, pool.deviceClass)
}

/** Ceph's osd_pool_default_pg_num: pg_num of a new pool when none is given. */
export const DEFAULT_POOL_PG_NUM = 32
/**
 * Ceph's mon_target_pg_per_osd: PG replicas per OSD the autoscaler aims for. 100 in every release up to Tentacle;
 * the development branch raises it to 200 (commit d34fa3316f, after Tentacle).
 */
export const DEFAULT_PG_TARGET_PER_OSD = 100
/** Upper bound of the PG target input (and of links). */
export const MAX_PG_TARGET_PER_OSD = 1000
/**
 * Ceph's mon_max_pg_per_osd: with more PG replicas per OSD, pool creation fails. 250 up to Tentacle; the
 * development branch raises it to 500 together with the PG target.
 */
export const MAX_PG_PER_OSD = 250
/** The autoscaler's threshold: it changes pg_num, or warns in warn mode, only when off by more than this factor. */
export const PG_AUTOSCALE_THRESHOLD = 3
const MAX_PG_NUM = 32768

/** The PG autoscaler sets pg_num (warn: only reports); otherwise pg_num is the pool's own. */
export const usesPgNum = (pool: Pick<PoolOptions, 'autoscaleMode'>) => pool.autoscaleMode !== 'on'

/** Ceph's nearest_power_of_two() (pg_autoscaler): the closer of the powers of two around n; ties go up. */
export function nearestPowerOfTwo(n: number): number {
  if (!(n > 1)) return 1
  const upper = 2 ** Math.ceil(Math.log2(Math.floor(n)))
  const lower = upper / 2
  if (upper === Math.floor(n)) return upper
  return upper - n > n - lower ? lower : upper
}

/**
 * The pg_num Ceph's autoscaler would pick for a pool holding the cluster's data: `targetPerOsd` PG replicas per OSD,
 * so OSDs × target ÷ pool width, as the nearest power of two.
 */
export function suggestPgNum(osdCount: number, scheme: Scheme, targetPerOsd = DEFAULT_PG_TARGET_PER_OSD): number {
  const width = Math.max(1, schemeWidth(scheme))
  const ideal = (Math.max(1, osdCount) * Math.max(1, targetPerOsd)) / width
  return Math.max(1, Math.min(nearestPowerOfTwo(ideal), MAX_PG_NUM))
}

/** PG replicas (shards) each OSD holds: every PG is placed on `width` OSDs. */
export function pgReplicasPerOsd(pgNum: number, scheme: Scheme, osdCount: number): number {
  return osdCount > 0 ? (pgNum * schemeWidth(scheme)) / osdCount : 0
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

/** Human-readable problems with the pool settings (shown inline, not blocking). */
export function poolIssues(pool: PoolOptions, scheme: Scheme): string[] {
  const issues: string[] = []
  if (!isValidName(pool.name)) issues.push('Pool name: use letters, digits, ".", "_" or "-".')
  if (pool.crushRule && !isValidName(pool.crushRule)) issues.push('CRUSH rule name contains invalid characters.')
  if (pool.deviceClass && !isValidDeviceClass(pool.deviceClass)) {
    issues.push('Device class: use letters, digits, ".", "_" or "-".')
  }
  if (scheme.kind === 'ec' && pool.ecProfile && !isValidName(pool.ecProfile)) {
    issues.push('EC profile name contains invalid characters.')
  }
  if (
    scheme.kind === 'ec' &&
    !pool.ecOverwrites &&
    (pool.application === 'rbd' || pool.application === 'cephfs')
  ) {
    issues.push(`${pool.application.toUpperCase()} on an EC pool needs allow_ec_overwrites.`)
  }
  if (scheme.kind === 'ec') {
    if (!TECHNIQUES_BY_PLUGIN[pool.ecPlugin].includes(pool.ecTechnique)) {
      issues.push(`Technique ${pool.ecTechnique} is not available for the ${pool.ecPlugin} plugin.`)
    } else if (M2_ONLY_TECHNIQUES.includes(pool.ecTechnique) && scheme.m !== 2) {
      issues.push(`Technique ${pool.ecTechnique} requires m = 2.`)
    }
    if (pool.ecOptimizations) {
      if (!EC_OPTIMIZATION_PLUGINS.includes(pool.ecPlugin) || pool.ecTechnique !== 'reed_sol_van') {
        issues.push('EC optimizations need the jerasure or isa plugin with reed_sol_van.')
      } else if (pool.stripeUnitKiB < 16) {
        issues.push('With EC optimizations Ceph recommends a stripe_unit of at least 16K.')
      }
    }
  }
  if (pool.autoscaleMode !== 'off' && pool.targetSizeRatio > 0 && pool.targetSizeTB > 0) {
    issues.push('Both target size ratio and bytes are set; Ceph uses the ratio.')
  }
  if (usesPgNum(pool) && !isPowerOfTwo(pool.pgNum)) {
    issues.push('pg_num should be a power of two.')
  }
  return issues
}
