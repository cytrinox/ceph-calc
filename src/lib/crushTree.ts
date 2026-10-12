// A virtual `ceph osd crush tree` for the topology: what Ceph would print once the hardware is deployed.
// Every bucket copy (×N) and OSD becomes its own item, with Ceph-style IDs, names and weights.

import { collectNames, int, num, sortDeviceClasses, type Bucket, type BucketType, type Topology } from './topology'

/** Rows shown per tree (the default root and each shadow root); the rest is counted. */
export const CRUSH_TREE_ROWS_PER_ROOT = 500

/** CRUSH weights are 16.16 fixed point. */
const WEIGHT_ONE = 0x10000

/**
 * printf("%.Nf") as glibc does it: the exact binary value of `x`, rounded to `digits` decimals with ties to even.
 * (`toFixed` rounds ties up.)
 */
export function printfFixed(x: number, digits: number): string {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, Math.abs(x))
  const hi = view.getUint32(0)
  const expBits = (hi >>> 20) & 0x7ff
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(view.getUint32(4))
  if (expBits > 0) mantissa |= 1n << 52n
  const exp = (expBits > 0 ? expBits : 1) - 1075
  // |x| = mantissa × 2^exp, scaled by 10^digits as an exact fraction
  let num = mantissa * 10n ** BigInt(digits)
  let den = 1n
  if (exp >= 0) num <<= BigInt(exp)
  else den <<= BigInt(-exp)
  let q = num / den
  const twice = 2n * (num % den)
  if (twice > den || (twice === den && q % 2n === 1n)) q += 1n
  const s = q.toString().padStart(digits + 1, '0')
  const sign = x < 0 && q > 0n ? '-' : ''
  return digits > 0 ? `${sign}${s.slice(0, -digits)}.${s.slice(-digits)}` : `${sign}${s}`
}

/**
 * Initial CRUSH weight of an OSD, in 16.16 fixed point, as Ceph computes it:
 * 1. the OSD registers its size in TiB with 4 decimals: `"%.4lf"` of max(0.00001, bytes ÷ 2^40);
 * 2. the monitor stores it as `(int)(weight * (float)0x10000)`, in single precision, truncated.
 */
export function osdCrushWeight(sizeTB: number): number {
  const tib = Math.max(0.00001, (num(sizeTB) * 1e12) / 2 ** 40)
  return Math.trunc(Math.fround(Number(printfFixed(tib, 4))) * WEIGHT_ONE)
}

/** How `ceph osd crush tree` prints a weight (weightf_t): single precision, 5 decimals, and 0 as "0". */
export function formatCrushWeight(fixed: number): string {
  const weight = Math.fround(fixed) / WEIGHT_ONE
  return weight < 0.000001 ? '0' : printfFixed(weight, 5)
}

export interface CrushLine {
  id: string
  /** Device class: of the OSD, or of the shadow tree; empty for regular buckets. */
  cls: string
  weight: string
  depth: number
  /** Bucket type; empty for OSDs. */
  type: string
  name: string
  /** "~ssd" on shadow buckets. */
  shadow: string
  /** Rows of this tree left out after the row limit ("… N more"). */
  more?: number
}

/** Bucket names for copies: like `nextFreeName()`, but with a cursor per prefix, so 10 000 copies stay fast. */
class NameAllocator {
  private cursor = new Map<string, number>()
  private used: Set<string>

  constructor(used: Set<string>) {
    this.used = new Set(used)
  }

  next(name: string): string {
    const match = /^(.*?)(\d+)$/.exec(name)
    const prefix = match ? match[1] : name
    const width = match ? match[2].length : 0
    let n = Math.max(this.cursor.get(prefix) ?? 0, match ? Number(match[2]) + 1 : 2)
    let candidate: string
    do {
      candidate = `${prefix}${String(n).padStart(width, '0')}`
      n++
    } while (this.used.has(candidate))
    this.used.add(candidate)
    this.cursor.set(prefix, n)
    return candidate
  }
}

/**
 * Memoized per bucket and class ('' = all classes), so weights and row counts don't need the expanded tree.
 * Create it per call: buckets are edited in place.
 */
function memo<T>(fn: (b: Bucket, cls: string) => T) {
  const cache = new Map<Bucket, Map<string, T>>()
  return (b: Bucket, cls: string): T => {
    let byClass = cache.get(b)
    if (!byClass) cache.set(b, (byClass = new Map()))
    if (!byClass.has(cls)) byClass.set(cls, fn(b, cls))
    return byClass.get(cls)!
  }
}

const matches = (osdClass: string, cls: string) => cls === '' || osdClass === cls

/** CRUSH weights of buckets per class ('' = all OSDs), fixed point; create per call (see `memo`). */
function crushWeigher() {
  const weightOf = memo((b, cls): number =>
    b.type === 'host'
      ? b.osds.reduce((sum, o) => sum + (matches(o.deviceClass, cls) ? int(o.count) * osdCrushWeight(o.sizeTB) : 0), 0)
      : b.children.reduce((sum, c) => sum + int(c.count) * weightOf(c, cls), 0),
  )
  return weightOf
}

/** Rows a bucket prints per class ('' = all OSDs), itself included; create per call (see `memo`). */
function crushRowCounter() {
  const rowsOf = memo(
    (b, cls): number =>
      1 +
      (b.type === 'host'
        ? b.osds.reduce((n, o) => n + (matches(o.deviceClass, cls) ? int(o.count) : 0), 0)
        : b.children.reduce((n, c) => n + int(c.count) * rowsOf(c, cls), 0)),
  )
  return rowsOf
}

/** Rows of the complete output (all trees, without the row limit), computed without expanding the tree. */
export function crushTreeRowCount(topology: Topology, showShadow: boolean): number {
  const rowsOf = crushRowCounter()
  const trees = showShadow ? [...treeClasses(topology), ''] : ['']
  return trees.reduce((n, cls) => n + 1 + topology.reduce((m, b) => m + int(b.count) * rowsOf(b, cls), 0), 0)
}

/** A bucket's weight is an unsigned 32-bit 16.16 fixed-point number in CRUSH (`__u32 weight`): at most 65,536 TiB. */
export const CRUSH_WEIGHT_MAX = 0xffffffff

export interface CrushWeightOverflow {
  /** Weight of root default, the heaviest bucket (fixed point). */
  rootWeight: number
  /** Other buckets above the limit, per type with their copies counted, in tree order. */
  buckets: { type: BucketType; count: number }[]
  osds: number
  /** Smallest and largest OSD size in TB. */
  smallestTB: number
  largestTB: number
}

/**
 * Whether CRUSH can hold the tree with Ceph's default weights (TiB): once adding an OSD would push a bucket above
 * `CRUSH_WEIGHT_MAX`, Ceph refuses it ("insert_item unable to rebuild roots with classes: (34) Numerical result out
 * of range"). The root sums everything, so it overflows first. Null when everything fits.
 */
export function crushWeightOverflow(topology: Topology): CrushWeightOverflow | null {
  const weightOf = crushWeigher()
  const rootWeight = topology.reduce((sum, b) => sum + int(b.count) * weightOf(b, ''), 0)
  if (rootWeight <= CRUSH_WEIGHT_MAX) return null
  const over = new Map<BucketType, number>()
  let osds = 0
  let smallestTB = Infinity
  let largestTB = 0
  const visit = (b: Bucket, mult: number) => {
    const n = mult * int(b.count)
    if (n === 0) return
    if (weightOf(b, '') > CRUSH_WEIGHT_MAX) over.set(b.type, (over.get(b.type) ?? 0) + n)
    for (const o of b.type === 'host' ? b.osds : []) {
      if (int(o.count) === 0) continue
      osds += n * int(o.count)
      smallestTB = Math.min(smallestTB, num(o.sizeTB))
      largestTB = Math.max(largestTB, num(o.sizeTB))
    }
    for (const c of b.children) visit(c, n)
  }
  for (const b of topology) visit(b, 1)
  const buckets = [...over].map(([type, count]) => ({ type, count }))
  return { rootWeight, buckets, osds, smallestTB, largestTB }
}

/**
 * The largest `osd_crush_initial_weight` (4 decimals, as the OSD formats it) that keeps `osds` equal OSDs in one
 * bucket within `CRUSH_WEIGHT_MAX`: 1 up to 65,535 OSDs.
 */
export function initialWeightFor(osds: number): string {
  const fixed = (w: number) => Math.trunc(Math.fround(w) * WEIGHT_ONE)
  let tenThousandths = Math.min(10_000, Math.floor((CRUSH_WEIGHT_MAX / Math.max(1, osds) / WEIGHT_ONE) * 10_000))
  while (tenThousandths > 1 && osds * fixed(tenThousandths / 10_000) > CRUSH_WEIGHT_MAX) tenThousandths--
  return printfFixed(tenThousandths / 10_000, 4).replace(/\.?0+$/, '')
}

/** Device classes of the OSDs in the tree; Ceph builds one shadow tree per class. */
export function treeClasses(topology: Topology): string[] {
  const found: string[] = []
  const visit = (b: Bucket) => {
    if (int(b.count) === 0) return
    if (b.type === 'host') for (const o of b.osds) if (int(o.count) > 0) found.push(o.deviceClass)
    b.children.forEach(visit)
  }
  topology.forEach(visit)
  return sortDeviceClasses(found)
}

/**
 * The rows of `ceph osd crush tree` (with `showShadow`: `--show-shadow`).
 * - Bucket IDs follow tree order, each bucket's shadow buckets right after it (root default -1, default~hdd -2,
 *   first host -3, …), as when Ceph creates them one after the other. OSD IDs count from 0 in tree order.
 * - Shadow trees contain every bucket, with only the OSDs of their class (others weigh 0). Like Ceph, roots are
 *   printed in ascending ID order, so the shadow trees come first.
 * - Each tree shows at most `rowsPerRoot` rows and counts the rest (Infinity: the complete output).
 */
export function crushTreeLines(
  topology: Topology,
  showShadow: boolean,
  rowsPerRoot = CRUSH_TREE_ROWS_PER_ROOT,
): CrushLine[] {
  const classes = treeClasses(topology)
  const idsPerBucket = 1 + classes.length
  const used = collectNames(topology)
  used.add('default')

  const weightOf = crushWeigher()
  const rowsOf = crushRowCounter()

  const tree = (cls: string): CrushLine[] => {
    const shadowIndex = cls === '' ? -1 : classes.indexOf(cls)
    // Real bucket k gets -(k × idsPerBucket + 1), its shadow of class j the IDs right after.
    const bucketId = (k: number) => String(-(k * idsPerBucket + 2 + shadowIndex))
    const shadow = cls === '' ? '' : `~${cls}`
    const names = new NameAllocator(used)
    const lines: CrushLine[] = []
    let bucketIndex = 0
    let osdId = 0
    const full = () => lines.length >= rowsPerRoot

    const bucket = (weight: number, depth: number, type: string, name: string) =>
      lines.push({ id: bucketId(bucketIndex++), cls, weight: formatCrushWeight(weight), depth, type, name, shadow })

    bucket(topology.reduce((sum, b) => sum + int(b.count) * weightOf(b, cls), 0), 0, 'root', 'default')

    const visit = (b: Bucket, depth: number, keepNames: boolean) => {
      for (let copy = 0; copy < int(b.count) && !full(); copy++) {
        const keep = keepNames && copy === 0
        const name = keep ? b.name : names.next(b.name)
        bucket(weightOf(b, cls), depth, b.type, name)
        if (b.type === 'host') {
          for (const o of b.osds) {
            for (let i = 0; i < int(o.count); i++) {
              const id = osdId++
              if (!matches(o.deviceClass, cls) || full()) continue
              const weight = formatCrushWeight(osdCrushWeight(o.sizeTB))
              const name = `osd.${id}`
              lines.push({ id: String(id), cls: o.deviceClass, weight, depth: depth + 1, type: '', name, shadow: '' })
            }
          }
        } else {
          for (const c of b.children) visit(c, depth + 1, keep)
        }
      }
    }
    for (const b of topology) visit(b, 1, true)

    const total = 1 + topology.reduce((n, b) => n + int(b.count) * rowsOf(b, cls), 0)
    if (total > lines.length) {
      lines.push({ id: '', cls: '', weight: '', depth: 1, type: '', name: '', shadow: '', more: total - lines.length })
    }
    return lines
  }

  // Roots in ascending ID order: the shadow roots (-2 - j) before root default (-1).
  const shadows = showShadow ? [...classes].reverse().flatMap((c) => tree(c)) : []
  return [...shadows, ...tree('')]
}

/** Column widths of the table, as Ceph's TextTable computes them (headings left-aligned, values right). */
export function crushTreeColumns(lines: CrushLine[]) {
  // A loop, not Math.max(...values): the complete output can have more lines than a call takes arguments.
  const width = (heading: string, values: string[]) => values.reduce((w, v) => Math.max(w, v.length), heading.length)
  return {
    id: width('ID', lines.map((l) => l.id)),
    cls: width('CLASS', lines.map((l) => l.cls)),
    weight: width('WEIGHT', lines.map((l) => l.weight)),
  }
}

/** The fixed-width columns before TYPE NAME, including the indentation (4 spaces per level). */
export function crushLinePrefix(line: CrushLine, cols: ReturnType<typeof crushTreeColumns>): string {
  return (
    `${line.id.padStart(cols.id)}  ${line.cls.padStart(cols.cls)}  ${line.weight.padStart(cols.weight)}  ` +
    ' '.repeat(4 * line.depth)
  )
}

export function crushTreeHeader(cols: ReturnType<typeof crushTreeColumns>): string {
  return `${'ID'.padEnd(cols.id)}  ${'CLASS'.padEnd(cols.cls)}  ${'WEIGHT'.padEnd(cols.weight)}  TYPE NAME`
}

export const moreLabel = (n: number) => `… ${n.toLocaleString('en-US')} more`

/** Plain text, as the command prints it (for copying). */
export function crushTreeText(lines: CrushLine[]): string {
  const cols = crushTreeColumns(lines)
  const body = lines.map((l) => {
    const typeName = l.more !== undefined ? moreLabel(l.more) : l.type ? `${l.type} ${l.name}${l.shadow}` : l.name
    return (crushLinePrefix(l, cols) + typeName).trimEnd()
  })
  return [crushTreeHeader(cols), ...body].join('\n')
}
