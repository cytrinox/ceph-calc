// Generates the Ceph CLI commands that create a pool for the current configuration.

import { customEcMinSize, type Scheme, type Tunables } from './ceph'
import {
  DEFAULT_PG_TARGET_PER_OSD,
  effectiveProfileName,
  effectiveRuleName,
  PG_AUTOSCALE_THRESHOLD,
  usesPgNum,
  type PoolOptions,
} from './pool'
import type { ConfigSetting, RatioKey } from './recommendations'
import type { DomainType } from './topology'

export interface CommandLine {
  /** Command split into parts; parts after the first are rendered as continuation lines. */
  parts: string[]
  note?: string
}

export interface CommandSection {
  id: string
  title: string
  note?: string
  lines: CommandLine[]
}

export interface CommandInput {
  pool: PoolOptions
  scheme: Scheme
  domain: DomainType
  tunables: Tunables
  /** Include cluster-wide settings: the fill ratios and the PG target (they affect every pool). */
  includeClusterSettings: boolean
  /** mon_target_pg_per_osd; set on the cluster when it differs from Ceph's default. */
  pgTargetPerOsd?: number
  /** Ratios from applied recommendations; emitted even without the other cluster-wide ratios. */
  ratioOverrides?: Partial<Record<RatioKey, number>>
  /** `ceph config set global` options from applied recommendations. */
  configSettings?: ConfigSetting[]
}

/** Starting pg_num when the autoscaler manages the pool (Ceph's osd_pool_default_pg_num). */
export const AUTOSCALE_START_PG = 32

const ratio = (r: number) => r.toFixed(2)

/** `ceph config set global <option> <value>` */
export function configCommand(option: string, value: string): string {
  return `ceph config set global ${option} ${value}`
}

/** `ceph osd set-nearfull-ratio 0.85` and the like. */
export function ratioCommand(key: RatioKey, value: number): string {
  return `ceph osd set-${key}-ratio ${ratio(value)}`
}

/** Decimal TB to an exact byte count string (1 TB = 10^12 bytes). */
export function tbToBytes(tb: number): string {
  const micro = BigInt(Math.round(tb * 1e6))
  return (micro * 1_000_000n).toString()
}

/** stripe_unit as accepted by Ceph (4K, 64K, 1M). */
export function stripeUnitArg(kib: number): string {
  return kib >= 1024 && kib % 1024 === 0 ? `${kib / 1024}M` : `${kib}K`
}

const cmd = (...parts: string[]): CommandLine => ({ parts })

export function buildCommands(input: CommandInput): CommandSection[] {
  const { pool, scheme, domain, tunables } = input
  const name = pool.name || 'data'
  const rule = effectiveRuleName(pool, scheme, domain)
  const isEc = scheme.kind === 'ec'
  const sections: CommandSection[] = []
  const set = (key: string, value: string | number | boolean) => cmd(`ceph osd pool set ${name} ${key} ${value}`)

  const planned: Record<RatioKey, number> = {
    nearfull: tunables.nearfullRatio,
    backfillfull: tunables.backfillfullRatio,
    full: tunables.fullRatio,
  }
  const overrides = input.ratioOverrides ?? {}
  const ratioLines = (['nearfull', 'backfillfull', 'full'] as const)
    .filter((key) => input.includeClusterSettings || overrides[key] !== undefined)
    .map((key) => {
      const value = overrides[key]
      return value === undefined
        ? cmd(ratioCommand(key, planned[key]))
        : { ...cmd(ratioCommand(key, value)), note: `recommended (planning value ${ratio(planned[key])})` }
    })
  // The PG target drives the autoscaler (and the pg_num suggestion); set it only when it differs from Ceph's default.
  const pgTarget = input.pgTargetPerOsd ?? DEFAULT_PG_TARGET_PER_OSD
  const clusterLines =
    input.includeClusterSettings && pgTarget !== DEFAULT_PG_TARGET_PER_OSD
      ? [
          ...ratioLines,
          {
            ...cmd(configCommand('mon_target_pg_per_osd', String(pgTarget))),
            note: `PG replicas per OSD (Ceph default ${DEFAULT_PG_TARGET_PER_OSD})`,
          },
        ]
      : ratioLines
  if (clusterLines.length) {
    sections.push({
      id: 'ratios',
      title: 'Cluster-wide settings',
      note: 'These apply to every pool in the cluster.',
      lines: clusterLines,
    })
  }

  if (input.configSettings?.length) {
    sections.push({
      id: 'recommended',
      title: 'Recommended settings',
      note: 'From the Recommendations panel; they apply to the whole cluster.',
      lines: input.configSettings.map((s) => cmd(configCommand(s.option, s.value))),
    })
  }

  let profile = ''
  if (scheme.kind === 'ec') {
    profile = effectiveProfileName(pool, scheme, domain)
    const parts = [
      `ceph osd erasure-code-profile set ${profile}`,
      `k=${scheme.k} m=${scheme.m}`,
      `plugin=${pool.ecPlugin} technique=${pool.ecTechnique}`,
      `stripe_unit=${stripeUnitArg(pool.stripeUnitKiB)}`,
      `crush-root=default crush-failure-domain=${domain}` +
        (pool.deviceClass ? ` crush-device-class=${pool.deviceClass}` : ''),
    ]
    sections.push({ id: 'profile', title: 'Erasure-code profile', lines: [{ parts }] })
  }

  sections.push({
    id: 'rule',
    title: 'CRUSH rule',
    note: `One ${isEc ? 'chunk' : 'copy'} per ${domain} under root default.`,
    lines: [
      isEc
        ? cmd(`ceph osd crush rule create-erasure ${rule} ${profile}`)
        : cmd(`ceph osd crush rule create-replicated ${rule} default ${domain}${pool.deviceClass ? ` ${pool.deviceClass}` : ''}`),
    ],
  })

  const pg = usesPgNum(pool) ? pool.pgNum : AUTOSCALE_START_PG
  const createNote = {
    on: `Starts with ${pg} PGs; the autoscaler adjusts pg_num.`,
    warn: `The autoscaler only warns when pg_num is more than ${PG_AUTOSCALE_THRESHOLD}× off its target; it doesn't change it.`,
    off: undefined,
  }[pool.autoscaleMode]
  sections.push({
    id: 'create',
    title: 'Create the pool',
    note: createNote,
    lines: [
      {
        parts: [
          `ceph osd pool create ${name} ${pg} ${pg}`,
          isEc ? `erasure ${profile} ${rule}` : `replicated ${rule}`,
          `--autoscale-mode=${pool.autoscaleMode}`,
        ],
      },
    ],
  })

  if (scheme.kind === 'replicated' && scheme.size === 1) {
    // Ceph refuses single-copy pools unless explicitly allowed and confirmed.
    sections.push({
      id: 'redundancy',
      title: 'Redundancy',
      lines: [
        { parts: [configCommand('mon_allow_pool_size_one', 'true')], note: 'single-copy pools are blocked by default' },
        cmd(`ceph osd pool set ${name} size 1 --yes-i-really-mean-it`),
        set('min_size', scheme.minSize),
      ],
    })
  } else if (scheme.kind === 'replicated') {
    sections.push({ id: 'redundancy', title: 'Redundancy', lines: [set('size', scheme.size), set('min_size', scheme.minSize)] })
  } else {
    // Ceph creates EC pools with min_size = k + min(1, m - 1); only a changed value needs setting.
    const minSize = customEcMinSize(scheme)
    if (minSize !== null) sections.push({ id: 'redundancy', title: 'Redundancy', lines: [set('min_size', minSize)] })
    const ecLines: CommandLine[] = []
    if (pool.ecOptimizations) {
      ecLines.push({ ...set('allow_ec_optimizations', true), note: 'Ceph Tentacle or later; cannot be disabled' })
    }
    if (pool.ecOverwrites) ecLines.push(set('allow_ec_overwrites', true))
    if (pool.fastRead) ecLines.push(set('fast_read', 1))
    if (ecLines.length) sections.push({ id: 'ec-options', title: 'EC options', lines: ecLines })
  }

  if (pool.autoscaleMode !== 'off') {
    const pgLines: CommandLine[] = []
    if (pool.bulk) pgLines.push(set('bulk', true))
    if (pool.targetSizeRatio > 0) pgLines.push(set('target_size_ratio', ratio(pool.targetSizeRatio)))
    if (pool.targetSizeTB > 0) {
      pgLines.push({ ...set('target_size_bytes', tbToBytes(pool.targetSizeTB)), note: `${pool.targetSizeTB} TB` })
    }
    if (pgLines.length) sections.push({ id: 'pg', title: 'Autoscaler hints', lines: pgLines })
  }

  if (pool.compressionMode !== 'none') {
    sections.push({
      id: 'compression',
      title: 'Compression',
      lines: [set('compression_mode', pool.compressionMode), set('compression_algorithm', pool.compressionAlgorithm)],
    })
  }

  const quota: CommandLine[] = []
  if (pool.quotaMaxTB > 0) {
    quota.push({ parts: [`ceph osd pool set-quota ${name} max_bytes ${tbToBytes(pool.quotaMaxTB)}`], note: `${pool.quotaMaxTB} TB` })
  }
  if (pool.quotaMaxObjects > 0) quota.push(cmd(`ceph osd pool set-quota ${name} max_objects ${pool.quotaMaxObjects}`))
  if (quota.length) sections.push({ id: 'quota', title: 'Quotas', lines: quota })

  if (pool.application !== 'none') {
    const app: CommandLine[] = [cmd(`ceph osd pool application enable ${name} ${pool.application}`)]
    // EC pools cannot hold omap data, so only replicated pools are initialised for RBD.
    if (pool.application === 'rbd' && !isEc) app.push(cmd(`rbd pool init ${name}`))
    const notes: Record<string, string | undefined> = {
      rbd: isEc
        ? `EC pools hold RBD data only: initialise a replicated pool with rbd pool init for image metadata and create images with --data-pool ${name}.`
        : undefined,
      cephfs: `CephFS also needs a replicated metadata pool; add this one with ceph fs add_data_pool${isEc ? ' (EC data pools need allow_ec_overwrites)' : ''}.`,
      rgw: 'RGW creates its other pools on first use; this pool is typically the bucket data pool.',
    }
    sections.push({ id: 'application', title: 'Application', note: notes[pool.application], lines: app })
  }

  const flags: CommandLine[] = []
  if (pool.noSizeChange) flags.push(set('nosizechange', true))
  if (pool.noDelete) flags.push(set('nodelete', true))
  if (flags.length) sections.push({ id: 'flags', title: 'Protection flags', lines: flags })

  return sections
}

/** Plain-text script: section titles and notes as comments, continuation lines with backslashes. */
export function commandsToScript(sections: CommandSection[], shebang = false): string {
  const out: string[] = shebang ? ['#!/bin/sh', 'set -e', ''] : []
  sections.forEach((s, i) => {
    if (i > 0) out.push('')
    out.push(`# ${s.title}`)
    if (s.note) out.push(`# ${s.note}`)
    for (const line of s.lines) {
      const text = line.parts.join(' \\\n    ')
      out.push(line.note ? `${text}  # ${line.note}` : text)
    }
  })
  return out.join('\n') + '\n'
}
