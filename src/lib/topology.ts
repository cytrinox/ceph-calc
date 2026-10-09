import type { Scheme } from './ceph'

// CRUSH topology model: a tree of buckets (Ceph default types) with OSD groups as leaves.

export const BUCKET_TYPES = [
  'host',
  'chassis',
  'rack',
  'row',
  'pdu',
  'pod',
  'room',
  'datacenter',
  'zone',
  'region',
] as const

export type BucketType = (typeof BUCKET_TYPES)[number]
export type DomainType = 'osd' | BucketType

/** CRUSH type ids from Ceph's default map (root = 11 is implicit). */
export const TYPE_ID: Record<DomainType, number> = {
  osd: 0,
  host: 1,
  chassis: 2,
  rack: 3,
  row: 4,
  pdu: 5,
  pod: 6,
  room: 7,
  datacenter: 8,
  zone: 9,
  region: 10,
}

export const ALL_DOMAIN_TYPES: DomainType[] = ['osd', ...BUCKET_TYPES]

export interface OsdGroup {
  id: string
  count: number
  sizeTB: number
}

export interface Bucket {
  id: string
  type: BucketType
  name: string
  /** Number of identical copies of this subtree. */
  count: number
  /** Child buckets (types strictly lower than this bucket's type). Unused for hosts. */
  children: Bucket[]
  /** OSD groups; only used for hosts. */
  osds: OsdGroup[]
}

export type Topology = Bucket[]

export interface BasicTopology {
  hosts: number
  osdsPerHost: number
  osdSizeTB: number
}

let seq = 0
export function uid(): string {
  seq = (seq + 1) % 1_000_000
  return `${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** Coerce user input (possibly '' or NaN from number inputs) to a non-negative number. */
export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function int(value: unknown): number {
  return Math.floor(num(value))
}

export function plural(type: DomainType, n = 2): string {
  if (type === 'osd') return n === 1 ? 'OSD' : 'OSDs'
  if (n === 1) return type
  return type === 'chassis' ? 'chassis' : `${type}s`
}

export function newOsdGroup(count = 8, sizeTB = 8): OsdGroup {
  return { id: uid(), count, sizeTB }
}

export function newBucket(type: BucketType, name: string, init: Partial<Bucket> = {}): Bucket {
  return {
    id: uid(),
    type,
    name,
    count: 1,
    children: [],
    osds: type === 'host' ? [newOsdGroup()] : [],
    ...init,
  }
}

/** Types a bucket of the given type may contain (strictly lower CRUSH type id). */
export function childTypesFor(type: BucketType | null): BucketType[] {
  if (type === 'host') return []
  const max = type === null ? Infinity : TYPE_ID[type]
  return BUCKET_TYPES.filter((t) => TYPE_ID[t] < max)
}

const DEFAULT_CHILD: Record<BucketType, BucketType | null> = {
  host: null,
  chassis: 'host',
  rack: 'host',
  row: 'rack',
  pdu: 'rack',
  pod: 'rack',
  room: 'row',
  datacenter: 'row',
  zone: 'datacenter',
  region: 'datacenter',
}

export function defaultChildType(type: BucketType): BucketType | null {
  return DEFAULT_CHILD[type]
}

// ---------------------------------------------------------------------------
// Naming

function walk(topology: Topology, fn: (b: Bucket) => void): void {
  for (const b of topology) {
    fn(b)
    walk(b.children, fn)
  }
}

export function collectNames(topology: Topology): Set<string> {
  const names = new Set<string>()
  walk(topology, (b) => names.add(b.name))
  return names
}

/** Next unused name derived from `name`: host03 -> host04, dc -> dc2. Registers it in `used`. */
export function nextFreeName(name: string, used: Set<string>): string {
  const match = /^(.*?)(\d+)$/.exec(name)
  const prefix = match ? match[1] : name
  const width = match ? match[2].length : 0
  let n = match ? Number(match[2]) + 1 : 2
  let candidate: string
  do {
    candidate = `${prefix}${String(n).padStart(width, '0')}`
    n++
  } while (used.has(candidate))
  used.add(candidate)
  return candidate
}

/** Deep copy with fresh ids; the copy and every descendant get unique names. */
export function cloneBucket(bucket: Bucket, used: Set<string>): Bucket {
  return {
    id: uid(),
    type: bucket.type,
    name: nextFreeName(bucket.name, used),
    count: bucket.count,
    children: bucket.children.map((c) => cloneBucket(c, used)),
    osds: bucket.osds.map((o) => ({ ...o, id: uid() })),
  }
}

export const SPLIT_LIMIT = 500

/**
 * Replace siblings[index] (×N) by individual buckets. At most SPLIT_LIMIT entries are created:
 * above that, the last entry keeps the remaining copies (×rest), so the total is never reduced.
 * Returns the number of entries.
 */
export function splitBucket(siblings: Bucket[], index: number, used: Set<string>): number {
  const original = siblings[index]
  const total = int(original.count)
  const n = Math.min(total, SPLIT_LIMIT)
  if (n <= 1) return 0
  original.count = 1
  const copies: Bucket[] = []
  for (let i = 1; i < n; i++) copies.push(cloneBucket(original, used))
  // Copies beyond the limit stay together in the last entry.
  copies[copies.length - 1].count = total - (n - 1)
  siblings.splice(index + 1, 0, ...copies)
  return n
}

export function duplicateBucket(siblings: Bucket[], index: number, used: Set<string>): Bucket {
  const copy = cloneBucket(siblings[index], used)
  siblings.splice(index + 1, 0, copy)
  return copy
}

// ---------------------------------------------------------------------------
// Capacity and statistics

export function osdGroupsCapacity(osds: OsdGroup[]): number {
  return osds.reduce((sum, o) => sum + int(o.count) * num(o.sizeTB), 0)
}

/** Raw capacity of a single copy of the bucket (its own count is not applied). */
export function bucketCapacity(bucket: Bucket): number {
  if (bucket.type === 'host') return osdGroupsCapacity(bucket.osds)
  return bucket.children.reduce((sum, c) => sum + int(c.count) * bucketCapacity(c), 0)
}

export type TypeCounts = Record<DomainType, number>

export interface TreeStats {
  counts: TypeCounts
  rawTB: number
  emptyBuckets: number
  /** Capacity of the largest single OSD (0 without OSDs). */
  largestOsdTB: number
}

function emptyCounts(): TypeCounts {
  return Object.fromEntries(ALL_DOMAIN_TYPES.map((t) => [t, 0])) as TypeCounts
}

function addStats(into: TreeStats, from: TreeStats, factor: number): void {
  for (const t of ALL_DOMAIN_TYPES) into.counts[t] += from.counts[t] * factor
  into.rawTB += from.rawTB * factor
  into.emptyBuckets += from.emptyBuckets * factor
  if (factor > 0) into.largestOsdTB = Math.max(into.largestOsdTB, from.largestOsdTB)
}

/** Statistics of a single copy of `bucket` (including itself, excluding its own count). */
export function bucketStats(bucket: Bucket): TreeStats {
  const stats: TreeStats = { counts: emptyCounts(), rawTB: 0, emptyBuckets: 0, largestOsdTB: 0 }
  stats.counts[bucket.type] = 1
  if (bucket.type === 'host') {
    for (const o of bucket.osds) {
      stats.counts.osd += int(o.count)
      if (int(o.count) > 0) stats.largestOsdTB = Math.max(stats.largestOsdTB, num(o.sizeTB))
    }
    stats.rawTB = osdGroupsCapacity(bucket.osds)
  } else {
    for (const c of bucket.children) addStats(stats, bucketStats(c), int(c.count))
  }
  if (stats.rawTB === 0) stats.emptyBuckets += 1
  return stats
}

export function topologyStats(topology: Topology): TreeStats {
  const stats: TreeStats = { counts: emptyCounts(), rawTB: 0, emptyBuckets: 0, largestOsdTB: 0 }
  for (const b of topology) addStats(stats, bucketStats(b), int(b.count))
  return stats
}

/** Bucket types present in the tree, ordered by CRUSH type id. */
export function presentTypes(topology: Topology): BucketType[] {
  const found = new Set<BucketType>()
  walk(topology, (b) => found.add(b.type))
  return BUCKET_TYPES.filter((t) => found.has(t))
}

export interface DomainGroup {
  /** Capacity of one failure domain. */
  capTB: number
  /** How many failure domains have this capacity. */
  mult: number
}

export interface FailureDomains {
  groups: DomainGroup[]
  /** Raw capacity that is not below any bucket of the failure-domain type. */
  unplacedTB: number
  /** Number of hosts not below any bucket of the failure-domain type. */
  unplacedHosts: number
  /** Failure domains without OSD capacity: CRUSH never places data there, so they are not in `groups`. */
  emptyDomains: number
}

/**
 * Collect the failure domains of `type` with their capacities. Identical
 * capacities are merged so huge clusters stay cheap to evaluate.
 */
export function failureDomains(topology: Topology, type: DomainType): FailureDomains {
  const byCap = new Map<number, number>()
  let unplacedTB = 0
  let unplacedHosts = 0
  let emptyDomains = 0
  const add = (cap: number, mult: number) => {
    if (mult <= 0) return
    if (cap > 0) byCap.set(cap, (byCap.get(cap) ?? 0) + mult)
    else emptyDomains += mult
  }

  const visit = (bucket: Bucket, parentMult: number) => {
    const mult = parentMult * int(bucket.count)
    if (mult === 0) return
    if (type === 'osd') {
      if (bucket.type === 'host') {
        for (const o of bucket.osds) add(num(o.sizeTB), mult * int(o.count))
      } else {
        for (const c of bucket.children) visit(c, mult)
      }
      return
    }
    if (bucket.type === type) {
      add(bucketCapacity(bucket), mult)
    } else if (TYPE_ID[bucket.type] < TYPE_ID[type]) {
      unplacedTB += mult * bucketCapacity(bucket)
      unplacedHosts += mult * bucketStats(bucket).counts.host
    } else {
      for (const c of bucket.children) visit(c, mult)
    }
  }

  for (const b of topology) visit(b, 1)
  const groups = [...byCap.entries()]
    .map(([capTB, mult]) => ({ capTB, mult }))
    .sort((a, b) => b.capTB - a.capTB)
  return { groups, unplacedTB, unplacedHosts, emptyDomains }
}

export interface DomainBalance {
  smallestTB: number
  largestTB: number
  averageTB: number
  /** Largest relative deviation from the average (0.25 = ±25%). */
  spread: number
}

/** Size spread of the failure domains; null when there are fewer than two. */
export function domainBalance(groups: DomainGroup[]): DomainBalance | null {
  const count = groups.reduce((n, g) => n + g.mult, 0)
  if (count < 2 || groups.length === 0) return null
  const total = groups.reduce((sum, g) => sum + g.capTB * g.mult, 0)
  const averageTB = total / count
  const largestTB = Math.max(...groups.map((g) => g.capTB))
  const smallestTB = Math.min(...groups.map((g) => g.capTB))
  const spread = averageTB > 0 ? Math.max(largestTB / averageTB - 1, 1 - smallestTB / averageTB) : 0
  return { smallestTB, largestTB, averageTB, spread }
}

/** Spread above which failure domains count as unbalanced. */
export const UNBALANCED_SPREAD = 0.25

// ---------------------------------------------------------------------------
// Builders

/** The Basic hosts as one host ×N; split it in the tree to edit hosts individually. */
export function buildBasicTopology(basic: BasicTopology): Topology {
  const hosts = int(basic.hosts)
  if (hosts === 0) return []
  // Pad like the names split copies get, e.g. host001 for 100+ hosts.
  const name = `host${'1'.padStart(Math.max(2, String(hosts).length), '0')}`
  return [newBucket('host', name, { count: hosts, osds: [newOsdGroup(int(basic.osdsPerHost), num(basic.osdSizeTB))] })]
}

/** 2 datacenters: dc1 with 3 rows, dc2 with 7 rows; 20 racks/row, 20 hosts/rack, 10 × 16 TB/host. */
export function buildExampleTopology(): Topology {
  const host = newBucket('host', 'dc1-host01', { count: 20, osds: [newOsdGroup(10, 16)] })
  const rack = newBucket('rack', 'dc1-rack01', { count: 20, children: [host] })
  const row = newBucket('row', 'dc1-row01', { count: 3, children: [rack] })
  const dc1 = newBucket('datacenter', 'dc1', { children: [row] })
  const dc2: Bucket = {
    id: uid(),
    type: 'datacenter',
    name: 'dc2',
    count: 1,
    children: [
      newBucket('row', 'dc2-row01', {
        count: 7,
        children: [
          newBucket('rack', 'dc2-rack01', {
            count: 20,
            children: [newBucket('host', 'dc2-host01', { count: 20, osds: [newOsdGroup(10, 16)] })],
          }),
        ],
      }),
    ],
    osds: [],
  }
  return [dc1, dc2]
}

// ---------------------------------------------------------------------------
// Example topologies for the Advanced tab

export interface TopologyExample {
  id: string
  label: string
  /** Failure domain that suits the example; set when it is loaded. */
  domain: DomainType
  /** Pool layout and recovery reserve that suit the example; set when it is loaded (with Ceph's default ratios). */
  scheme: Scheme
  recoveryReserve: number
  build(): Topology
}

const REP3: Scheme = { kind: 'replicated', size: 3, minSize: 2 }

const host = (name: string, count: number, osds: [number, number][]) =>
  newBucket('host', name, { count, osds: osds.map(([n, size]) => newOsdGroup(n, size)) })

export const TOPOLOGY_EXAMPLES: TopologyExample[] = [
  {
    id: 'small',
    label: 'Small cluster · 4 hosts × 6 × 8 TB',
    domain: 'host',
    scheme: REP3,
    recoveryReserve: 1,
    build: () => [host('host01', 4, [[6, 8]])],
  },
  {
    id: 'single-host',
    label: 'Single host · 5 × 4 TB + 1 × 1 TB OSDs',
    domain: 'osd',
    scheme: REP3,
    recoveryReserve: 1,
    build: () => [
      host('host01', 1, [
        [5, 4],
        [1, 1],
      ]),
    ],
  },
  {
    id: 'mixed',
    label: 'Mixed generations · 3 × 96 TB + 2 × 192 TB hosts',
    domain: 'host',
    scheme: REP3,
    recoveryReserve: 1,
    build: () => [host('gen1-host01', 3, [[12, 8]]), host('gen2-host01', 2, [[12, 16]])],
  },
  {
    // The big host can hold at most a third of all copies: 5 TB of it can never be filled.
    id: 'unbalanced-hosts',
    label: 'Unbalanced hosts · 3 × 10 TB + 1 × 20 TB',
    domain: 'host',
    scheme: REP3,
    recoveryReserve: 1,
    build: () => [host('host01', 3, [[1, 10]]), host('big-host01', 1, [[1, 20]])],
  },
  {
    id: 'racks',
    label: 'Rack-aware · 5 racks × 4 hosts × 12 × 16 TB',
    domain: 'rack',
    scheme: { kind: 'ec', k: 2, m: 2 },
    recoveryReserve: 1,
    build: () => [newBucket('rack', 'rack01', { count: 5, children: [host('host01', 4, [[12, 16]])] })],
  },
  {
    id: 'unbalanced',
    label: 'Unbalanced racks · 6 / 6 / 4 / 2 hosts',
    domain: 'rack',
    scheme: REP3,
    recoveryReserve: 1,
    build: () =>
      [6, 6, 4, 2].map((hosts, i) =>
        newBucket('rack', `rack0${i + 1}`, { children: [host(`r${i + 1}-host01`, hosts, [[12, 16]])] }),
      ),
  },
  {
    id: 'chassis',
    label: 'Blade chassis · 2 racks × 3 chassis × 4 blades',
    domain: 'chassis',
    scheme: REP3,
    recoveryReserve: 1,
    build: () => [
      newBucket('rack', 'rack01', {
        count: 2,
        children: [newBucket('chassis', 'chassis01', { count: 3, children: [host('blade01', 4, [[4, 7.68]])] })],
      }),
    ],
  },
  {
    id: 'all-types',
    label: 'Every bucket type · region → zone → … → chassis → host',
    domain: 'rack',
    scheme: { kind: 'ec', k: 6, m: 3 },
    recoveryReserve: 2,
    // Nested strictly by CRUSH type id; pdu (5) sits above row (4) as in Ceph's default map.
    build: () => {
      const levels: [BucketType, string, number][] = [
        ['region', 'eu', 1],
        ['zone', 'eu-west', 2],
        ['datacenter', 'dc1', 1],
        ['room', 'room1', 2],
        ['pod', 'pod1', 1],
        ['pdu', 'pdu-a', 2],
        ['row', 'row1', 1],
        ['rack', 'rack01', 2],
        ['chassis', 'chassis01', 2],
      ]
      let child = host('host01', 2, [[12, 16]])
      for (const [type, name, count] of [...levels].reverse()) {
        child = newBucket(type, name, { count, children: [child] })
      }
      return [child]
    },
  },
  {
    id: 'datacenters',
    label: 'Two datacenters · 3 + 7 rows × 20 racks × 20 hosts',
    domain: 'rack',
    scheme: { kind: 'ec', k: 8, m: 3 },
    recoveryReserve: 2,
    build: buildExampleTopology,
  },
]
