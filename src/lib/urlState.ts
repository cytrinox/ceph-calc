// Compact, shareable encoding of the calculator state in the URL hash.

import { DEFAULT_SCHEME } from './schemes'
import {
  APPLICATIONS,
  AUTOSCALE_MODES,
  COMPRESSION_ALGORITHMS,
  COMPRESSION_MODES,
  EC_PLUGINS,
  EC_TECHNIQUES,
  STRIPE_UNITS_KIB,
  DEFAULT_PG_TARGET_PER_OSD,
  MAX_PG_TARGET_PER_OSD,
  defaultPoolOptions,
  type PoolOptions,
} from './pool'
import { customEcMinSize, DEFAULT_RATIOS, defaultEcMinSize, type Scheme } from './ceph'
import { CURRENCY_MAX_LENGTH, DEFAULT_PRICE_PER_TB, localCurrency } from './pricing'
import {
  BASIC_IOPS,
  DEFAULT_IO_SIZE_KIB,
  DEFAULT_OBJECT_SIZE_KIB,
  IO_SIZES_KIB,
  MAX_OSD_IOPS,
  OBJECT_SIZES_KIB,
  type OsdIops,
} from './iops'
import {
  ALL_DOMAIN_TYPES,
  BUCKET_TYPES,
  DEFAULT_OSD_CLASS,
  TYPE_ID,
  int,
  isValidDeviceClass,
  num,
  uid,
  type BasicTopology,
  type Bucket,
  type DomainType,
  type Topology,
} from './topology'

export type TopologyTab = 'basic' | 'advanced'

export interface AppState {
  tab: TopologyTab
  basic: BasicTopology
  advanced: Topology | null
  failureDomain: DomainType
  scheme: Scheme
  fullRatio: number
  backfillfullRatio: number
  nearfullRatio: number
  recoveryReserve: number
  pool: PoolOptions
  /** Price per decimal TB of raw drive capacity. */
  pricePerTB: number
  /** Free-text currency (EUR, $, USD, …). */
  currency: string
  /** Random IOPS one OSD of each device class sustains at the client I/O size (missing = not set). */
  osdIops: Record<string, OsdIops>
  /** Client I/O size of the IOPS estimate, in KiB. */
  ioSizeKiB: number
  /** RADOS object size of the IOPS estimate, in KiB: larger requests take one operation per object. */
  objectSizeKiB: number
  /** Show the virtual CRUSH map (`ceph osd crush tree`) of the hardware. */
  crushMap: boolean
  /** mon_target_pg_per_osd: PG replicas per OSD the pg_num suggestion (and the autoscaler) aims for. */
  pgTargetPerOsd: number
}

export function defaultState(): AppState {
  return {
    tab: 'basic',
    basic: { hosts: 5, osdsPerHost: 8, osdSizeTB: 8 },
    advanced: null,
    failureDomain: 'host',
    scheme: { ...DEFAULT_SCHEME },
    fullRatio: DEFAULT_RATIOS.full,
    backfillfullRatio: DEFAULT_RATIOS.backfillfull,
    nearfullRatio: DEFAULT_RATIOS.nearfull,
    recoveryReserve: 0,
    pool: defaultPoolOptions(),
    pricePerTB: DEFAULT_PRICE_PER_TB,
    currency: localCurrency(),
    osdIops: {},
    ioSizeKiB: DEFAULT_IO_SIZE_KIB,
    objectSizeKiB: DEFAULT_OBJECT_SIZE_KIB,
    crushMap: false,
    pgTargetPerOsd: DEFAULT_PG_TARGET_PER_OSD,
  }
}

// Bucket as [typeId, name, count, children, osds[[count, sizeTB, deviceClass?]]]; the class only when not ssd.
type PackedOsdGroup = [number, number] | [number, number, string]
type PackedBucket = [number, string, number, PackedBucket[], PackedOsdGroup[]]

interface Packed {
  v: 1
  t: 'b' | 'a'
  b: [number, number, number]
  a?: PackedBucket[]
  d: number
  /** [0, size, min_size] or [1, k, m] plus min_size when it differs from Ceph's EC default. */
  s: [0, number, number] | [1, number, number] | [1, number, number, number]
  f: number
  bf?: number
  nf?: number
  r: number
  p?: Partial<PoolOptions>
  /** Price per TB. */
  pt?: number
  cu?: string
  /** I/O size in KiB, per device class the read and write IOPS per OSD, and the object size in KiB when not 4M;
   *  left out while nothing is set. */
  io?: [number, Record<string, [number, number]>] | [number, Record<string, [number, number]>, number]
  /** 1 = show the virtual CRUSH map; left out when off. */
  cm?: 1
  /** PG target per OSD; left out at Ceph's default. */
  pg?: number
}

const iops = (value: unknown) => Math.min(MAX_OSD_IOPS, int(value))
/** PG target per OSD within 1–MAX_PG_TARGET_PER_OSD; Ceph's default when unusable. */
const pgTarget = (value: unknown) =>
  int(value) > 0 ? Math.min(MAX_PG_TARGET_PER_OSD, int(value)) : DEFAULT_PG_TARGET_PER_OSD

/** IOPS keys: device class names, or the Basic tab's class-less values. */
const isIopsKey = (key: string) => key === BASIC_IOPS || isValidDeviceClass(key)

/** Only classes with a value; nothing at all while no IOPS are set and the I/O size is the default. */
function packIops(state: AppState): Pick<Packed, 'io'> {
  const classes = Object.entries(state.osdIops)
    .filter(([cls, o]) => isIopsKey(cls) && (iops(o.read) > 0 || iops(o.write) > 0))
    .map(([cls, o]): [string, [number, number]] => [cls, [iops(o.read), iops(o.write)]])
  const object = objectSize(state.objectSizeKiB)
  if (classes.length === 0 && state.ioSizeKiB === DEFAULT_IO_SIZE_KIB && object === DEFAULT_OBJECT_SIZE_KIB) return {}
  const io: [number, Record<string, [number, number]>] = [ioSize(state.ioSizeKiB), Object.fromEntries(classes)]
  return { io: object === DEFAULT_OBJECT_SIZE_KIB ? io : [...io, object] }
}

function unpackIops(raw: unknown): Record<string, OsdIops> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, OsdIops> = {}
  for (const [cls, value] of Object.entries(raw)) {
    if (!isIopsKey(cls) || !Array.isArray(value)) continue
    const osd = { read: iops(value[0]), write: iops(value[1]) }
    if (osd.read > 0 || osd.write > 0) result[cls] = osd
  }
  return result
}

function ecPacked(scheme: Extract<Scheme, { kind: 'ec' }>): Packed['s'] {
  const minSize = customEcMinSize(scheme)
  const base: [1, number, number] = [1, int(scheme.k), int(scheme.m)]
  return minSize === null ? base : [...base, int(minSize)]
}

/** EC scheme from a link; a min_size equal to the default is dropped. */
function ecScheme(k: number, m: number, minSize: unknown): Scheme {
  const scheme: Scheme = { kind: 'ec', k, m }
  if (typeof minSize === 'number' && Number.isFinite(minSize) && int(minSize) !== defaultEcMinSize(k, m)) {
    scheme.minSize = Math.max(1, int(minSize))
  }
  return scheme
}
const ioSize = (value: unknown) =>
  (IO_SIZES_KIB as readonly number[]).includes(value as number) ? (value as number) : DEFAULT_IO_SIZE_KIB
const objectSize = (value: unknown) =>
  (OBJECT_SIZES_KIB as readonly number[]).includes(value as number) ? (value as number) : DEFAULT_OBJECT_SIZE_KIB

/** A fill ratio from untrusted input, clamped to 0–1; the fallback when missing or not a number. */
function ratioOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clampRatio(value) : fallback
}

function clampRatio(value: unknown): number {
  return Math.min(1, Math.max(0, num(value)))
}

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Merge untrusted pool settings over the defaults, keeping only well-typed values. */
export function sanitizePool(raw: unknown): PoolOptions {
  const d = defaultPoolOptions()
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v.slice(0, 128) : fallback)
  const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
  return {
    name: str(r.name, d.name),
    application: pick(APPLICATIONS, r.application, d.application),
    crushRule: str(r.crushRule, d.crushRule),
    deviceClass:
      typeof r.deviceClass === 'string' && (r.deviceClass === '' || isValidDeviceClass(r.deviceClass))
        ? r.deviceClass
        : d.deviceClass,
    ecProfile: str(r.ecProfile, d.ecProfile),
    ecPlugin: pick(EC_PLUGINS, r.ecPlugin, d.ecPlugin),
    ecTechnique: pick(EC_TECHNIQUES, r.ecTechnique, d.ecTechnique),
    stripeUnitKiB: (STRIPE_UNITS_KIB as readonly number[]).includes(r.stripeUnitKiB as number)
      ? (r.stripeUnitKiB as number)
      : d.stripeUnitKiB,
    fastRead: bool(r.fastRead, d.fastRead),
    ecOverwrites: bool(r.ecOverwrites, d.ecOverwrites),
    ecOptimizations: bool(r.ecOptimizations, d.ecOptimizations),
    autoscaleMode: pick(AUTOSCALE_MODES, r.autoscaleMode, d.autoscaleMode),
    pgNum: Math.max(1, int(r.pgNum ?? d.pgNum)),
    bulk: bool(r.bulk, d.bulk),
    targetSizeRatio: num(r.targetSizeRatio),
    targetSizeTB: num(r.targetSizeTB),
    compressionMode: pick(COMPRESSION_MODES, r.compressionMode, d.compressionMode),
    compressionAlgorithm: pick(COMPRESSION_ALGORITHMS, r.compressionAlgorithm, d.compressionAlgorithm),
    compressionRatio:
      typeof r.compressionRatio === 'number' && r.compressionRatio > 0
        ? Math.min(1, r.compressionRatio)
        : d.compressionRatio,
    quotaMaxTB: num(r.quotaMaxTB),
    quotaMaxObjects: int(r.quotaMaxObjects),
    noDelete: bool(r.noDelete, d.noDelete),
    noSizeChange: bool(r.noSizeChange, d.noSizeChange),
  }
}

function packBucket(b: Bucket): PackedBucket {
  return [
    TYPE_ID[b.type],
    b.name,
    int(b.count),
    b.children.map(packBucket),
    b.osds.map((o): PackedOsdGroup =>
      o.deviceClass === DEFAULT_OSD_CLASS ? [int(o.count), num(o.sizeTB)] : [int(o.count), num(o.sizeTB), o.deviceClass],
    ),
  ]
}

const BUCKET_BY_ID = new Map(BUCKET_TYPES.map((t) => [TYPE_ID[t], t]))

function unpackBucket(p: PackedBucket, parentId: number): Bucket | null {
  if (!Array.isArray(p)) return null
  const type = BUCKET_BY_ID.get(p[0])
  if (!type || TYPE_ID[type] >= parentId) return null
  return {
    id: uid(),
    type,
    name: String(p[1] ?? type),
    count: Math.max(0, int(p[2])),
    children:
      type === 'host'
        ? []
        : (Array.isArray(p[3]) ? p[3] : [])
            .map((c) => unpackBucket(c, TYPE_ID[type]))
            .filter((c): c is Bucket => c !== null),
    osds:
      type === 'host' && Array.isArray(p[4])
        ? p[4].map((o) => ({
            id: uid(),
            count: int(o?.[0]),
            sizeTB: num(o?.[1]),
            deviceClass: typeof o?.[2] === 'string' && isValidDeviceClass(o[2]) ? o[2] : DEFAULT_OSD_CLASS,
          }))
        : [],
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

export function encodeState(state: AppState): string {
  const packed: Packed = {
    v: 1,
    t: state.tab === 'basic' ? 'b' : 'a',
    b: [int(state.basic.hosts), int(state.basic.osdsPerHost), num(state.basic.osdSizeTB)],
    d: TYPE_ID[state.failureDomain],
    s:
      state.scheme.kind === 'replicated'
        ? [0, int(state.scheme.size), int(state.scheme.minSize)]
        : ecPacked(state.scheme),
    f: clampRatio(state.fullRatio),
    bf: clampRatio(state.backfillfullRatio),
    nf: clampRatio(state.nearfullRatio),
    r: int(state.recoveryReserve),
    p: state.pool,
    pt: num(state.pricePerTB),
    cu: state.currency,
    ...packIops(state),
    ...(state.crushMap ? { cm: 1 as const } : {}),
    ...(pgTarget(state.pgTargetPerOsd) !== DEFAULT_PG_TARGET_PER_OSD ? { pg: pgTarget(state.pgTargetPerOsd) } : {}),
  }
  if (state.advanced) packed.a = state.advanced.map(packBucket)
  return toBase64Url(JSON.stringify(packed))
}

export function decodeState(data: string): AppState | null {
  try {
    const p = JSON.parse(fromBase64Url(data)) as Packed
    if (p?.v !== 1) return null
    const state = defaultState()
    state.tab = p.t === 'a' ? 'advanced' : 'basic'
    if (Array.isArray(p.b)) {
      state.basic = { hosts: int(p.b[0]), osdsPerHost: int(p.b[1]), osdSizeTB: num(p.b[2]) }
    }
    if (Array.isArray(p.a)) {
      state.advanced = p.a.map((b) => unpackBucket(b, Infinity)).filter((b): b is Bucket => b !== null)
    }
    state.failureDomain = ALL_DOMAIN_TYPES.find((t) => TYPE_ID[t] === p.d) ?? 'host'
    if (Array.isArray(p.s)) {
      state.scheme =
        p.s[0] === 0
          ? { kind: 'replicated', size: Math.max(1, int(p.s[1])), minSize: Math.max(1, int(p.s[2])) }
          : ecScheme(Math.max(2, int(p.s[1])), Math.max(1, int(p.s[2])), p.s[3])
    }
    state.fullRatio = ratioOr(p.f, state.fullRatio)
    state.backfillfullRatio = ratioOr(p.bf, state.backfillfullRatio)
    state.nearfullRatio = ratioOr(p.nf, state.nearfullRatio)
    state.recoveryReserve = int(p.r)
    state.pool = sanitizePool(p.p)
    if (typeof p.pt === 'number' && Number.isFinite(p.pt)) state.pricePerTB = Math.max(0, p.pt)
    if (typeof p.cu === 'string') state.currency = p.cu.slice(0, CURRENCY_MAX_LENGTH)
    if (Array.isArray(p.io)) {
      state.ioSizeKiB = ioSize(p.io[0])
      state.osdIops = unpackIops(p.io[1])
      state.objectSizeKiB = objectSize(p.io[2])
    }
    state.crushMap = p.cm === 1
    if (p.pg !== undefined) state.pgTargetPerOsd = pgTarget(p.pg)
    return state
  } catch {
    return null
  }
}

export function readStateFromUrl(): AppState | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash.startsWith('s=')) return null
  return decodeState(hash.slice(2))
}

export function writeStateToUrl(state: AppState): void {
  const url = `${window.location.pathname}${window.location.search}#s=${encodeState(state)}`
  window.history.replaceState(null, '', url)
}

/** Absolute link that restores exactly this configuration. */
export function shareUrl(state: AppState): string {
  return `${window.location.origin}${window.location.pathname}${window.location.search}#s=${encodeState(state)}`
}
