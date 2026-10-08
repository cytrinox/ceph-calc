// Pool-level settings used to describe (and later generate commands for) the Ceph pool.

import { schemeWidth, type Scheme } from './ceph'
import type { DomainType } from './topology'

export const APPLICATIONS = ['rbd', 'cephfs', 'rgw', 'none'] as const
export const DEVICE_CLASSES = ['', 'hdd', 'ssd', 'nvme'] as const
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
export type DeviceClass = (typeof DEVICE_CLASSES)[number]
export type AutoscaleMode = (typeof AUTOSCALE_MODES)[number]
export type CompressionMode = (typeof COMPRESSION_MODES)[number]
export type CompressionAlgorithm = (typeof COMPRESSION_ALGORITHMS)[number]
export type EcPlugin = (typeof EC_PLUGINS)[number]
export type EcTechnique = (typeof EC_TECHNIQUES)[number]

/**
 * Techniques per plugin. clay delegates to a scalar MDS code (jerasure by
 * default), so it accepts the jerasure techniques.
 */
export const TECHNIQUES_BY_PLUGIN: Record<EcPlugin, readonly EcTechnique[]> = {
  jerasure: ['reed_sol_van', 'reed_sol_r6_op', 'cauchy_orig', 'cauchy_good', 'liberation', 'blaum_roth', 'liber8tion'],
  isa: ['reed_sol_van', 'cauchy'],
  clay: ['reed_sol_van', 'reed_sol_r6_op', 'cauchy_orig', 'cauchy_good', 'liberation', 'blaum_roth', 'liber8tion'],
}

/** Techniques that only work with exactly two coding chunks. */
export const M2_ONLY_TECHNIQUES: readonly EcTechnique[] = ['reed_sol_r6_op', 'liberation', 'blaum_roth', 'liber8tion']

export interface PoolOptions {
  name: string
  application: Application
  /** CRUSH rule name; empty = derived from scheme and failure domain. */
  crushRule: string
  /** Restrict placement to one device class; empty = any. */
  deviceClass: DeviceClass
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
    autoscaleMode: 'on',
    pgNum: 128,
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

export function defaultRuleName(scheme: Scheme, domain: DomainType, deviceClass: DeviceClass): string {
  return [schemeSlug(scheme), domain, deviceClass].filter(Boolean).join('_')
}

export function defaultProfileName(scheme: Scheme, domain: DomainType, deviceClass: DeviceClass): string {
  if (scheme.kind !== 'ec') return ''
  return ['ec', `${scheme.k}-${scheme.m}`, domain, deviceClass].filter(Boolean).join('-')
}

export function effectiveRuleName(pool: PoolOptions, scheme: Scheme, domain: DomainType): string {
  return pool.crushRule.trim() || defaultRuleName(scheme, domain, pool.deviceClass)
}

export function effectiveProfileName(pool: PoolOptions, scheme: Scheme, domain: DomainType): string {
  return pool.ecProfile.trim() || defaultProfileName(scheme, domain, pool.deviceClass)
}

/** Classic sizing: ~100 PGs per OSD divided by the pool width, rounded to a power of two. */
export function suggestPgNum(osdCount: number, scheme: Scheme, targetPerOsd = 100): number {
  const width = Math.max(1, schemeWidth(scheme))
  const raw = (Math.max(1, osdCount) * targetPerOsd) / width
  const lower = 2 ** Math.floor(Math.log2(raw))
  const pg = raw - lower > lower * 0.25 ? lower * 2 : lower
  return Math.max(1, Math.min(pg, 32768))
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0
}

/** Human-readable problems with the pool settings (shown inline, not blocking). */
export function poolIssues(pool: PoolOptions, scheme: Scheme): string[] {
  const issues: string[] = []
  if (!isValidName(pool.name)) issues.push('Pool name: use letters, digits, ".", "_" or "-".')
  if (pool.crushRule && !isValidName(pool.crushRule)) issues.push('CRUSH rule name contains invalid characters.')
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
  }
  if (pool.autoscaleMode !== 'off' && pool.targetSizeRatio > 0 && pool.targetSizeTB > 0) {
    issues.push('Both target size ratio and bytes are set; Ceph uses the ratio.')
  }
  if (pool.autoscaleMode === 'off' && !isPowerOfTwo(pool.pgNum)) {
    issues.push('pg_num should be a power of two.')
  }
  return issues
}
