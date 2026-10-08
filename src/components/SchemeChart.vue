<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { placementHint, type CapacityResult, type Scheme } from '@/lib/ceph'
import { formatInt, formatPct } from '@/lib/format'
import { capacityUnit, formatCapacity, unitPerTB } from '@/lib/units'
import { plural, type DomainType } from '@/lib/topology'

export interface ChartRow {
  id: string
  label: string
  custom: boolean
  active: boolean
  scheme: Scheme
  result: CapacityResult
}

const props = defineProps<{ rows: ChartRow[]; domain: DomainType }>()
const emit = defineEmits<{ select: [scheme: Scheme] }>()

// --- size -------------------------------------------------------------------
const root = ref<HTMLElement>()
const width = ref(640)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!root.value) return
  width.value = root.value.clientWidth
  observer = new ResizeObserver(([entry]) => (width.value = Math.max(280, entry.contentRect.width)))
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

const compact = computed(() => width.value < 520)
const height = computed(() => (compact.value ? 230 : 280))
const m = computed(() => ({ top: 18, right: compact.value ? 40 : 48, bottom: compact.value ? 44 : 34, left: compact.value ? 50 : 60 }))
const plotW = computed(() => width.value - m.value.left - m.value.right)
const plotH = computed(() => height.value - m.value.top - m.value.bottom)

// --- data -------------------------------------------------------------------
const rawTB = computed(() => props.rows[0]?.result.rawTB ?? 0)
const available = computed(() => props.rows[0]?.result.domainCount ?? 0)

function shortLabel(row: ChartRow): string {
  const s = row.scheme
  const base = s.kind === 'replicated' ? `${s.size}x` : `${s.k}+${s.m}`
  return row.custom ? `${base}*` : base
}

/** Round a maximum up to a clean axis value and return evenly spaced ticks. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0]
  const rough = max / count
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= rough) ?? 10 * mag
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

const usableTicks = computed(() => {
  const max = Math.max(0, ...props.rows.filter((r) => r.result.valid).map((r) => r.result.usableTB))
  // Round ticks in the display unit (TB or TiB), then convert back to TB for positioning.
  const factor = unitPerTB()
  return niceTicks((max || 1) * factor).map((t) => t / factor)
})
const usableMax = computed(() => usableTicks.value[usableTicks.value.length - 1])
const yUsable = (tb: number) => m.value.top + plotH.value * (1 - tb / usableMax.value)

/** Round percentage ticks for the right axis, placed on the same scale (pct × raw). */
const pctTicks = computed(() => {
  if (rawTB.value <= 0) return []
  const maxPct = usableMax.value / rawTB.value
  return niceTicks(maxPct, 4).filter((p) => p <= maxPct + 1e-9)
})

/** Bars are scaled to their own maximum: the tallest "needs" bar fills 90% of the plot height. */
const BAR_FILL = 0.9
const barMax = computed(() => Math.max(1, ...props.rows.map((r) => r.result.minDomains)) / BAR_FILL)
/** The available-domains line is only drawn when it falls inside the bar scale. */
const availableOnScale = computed(() => available.value <= barMax.value)
const yBar = (n: number) => m.value.top + plotH.value * (1 - n / barMax.value)

const band = computed(() => plotW.value / Math.max(1, props.rows.length))
const xCenter = (i: number) => m.value.left + band.value * (i + 0.5)
const barW = computed(() => Math.min(24, band.value * 0.55))

const points = computed(() =>
  props.rows.map((r, i) => ({
    row: r,
    x: xCenter(i),
    y: r.result.valid ? yUsable(r.result.usableTB) : null,
  })),
)

/** Line path that breaks at layouts the topology cannot hold. */
const linePath = computed(() => {
  let d = ''
  let pen = false
  for (const p of points.value) {
    if (p.y === null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
    pen = true
  }
  return d
})

/** Column with a 4px rounded top, square at the base. */
function roundedTop(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

const GAP = 2
const bars = computed(() =>
  props.rows.map((r, i) => {
    const x = xCenter(i) - barW.value / 2
    const base = yBar(0)
    const survivesTop = yBar(r.result.failuresTolerated)
    const needsTop = yBar(r.result.minDomains)
    return {
      id: r.id,
      // bottom segment: domains that may fail; square top, separated by a surface gap
      survives: { x, y: survivesTop, w: barW.value, h: Math.max(0, base - survivesTop) },
      // top segment: the rest of the domains this layout needs
      needs: roundedTop(x, needsTop, barW.value, Math.max(0, survivesTop - GAP - needsTop)),
      over: r.result.minDomains > available.value,
    }
  }),
)

// --- hover --------------------------------------------------------------------
const hover = ref<number | null>(null)
const tip = computed(() => {
  if (hover.value === null) return null
  const row = props.rows[hover.value]
  const left = xCenter(hover.value)
  return { row, left, flip: left > width.value * 0.6 }
})

const tipHint = computed(() => (tip.value ? placementHint(tip.value.row.result, props.domain) : null))

const activeIndex = computed(() => props.rows.findIndex((r) => r.active))
const activeLabel = computed(() => {
  // On small screens the tooltip and the table carry the value; a label would collide.
  if (compact.value) return null
  const i = activeIndex.value
  const p = points.value[i]
  if (!p || p.y === null) return null
  const r = p.row.result
  const text = `${formatCapacity(r.usableTB)} · ${formatPct(r.efficiency)}`
  // Put the label on the side of the point the neighbouring segments do not use.
  const neighbours = [points.value[i - 1]?.y, points.value[i + 1]?.y].filter((y): y is number => y != null)
  const linesAbove = neighbours.length > 0 && neighbours.every((y) => y < p.y!)
  const below = linesAbove || p.y < m.value.top + 24
  const anchor = i === 0 ? 'start' : i === points.value.length - 1 ? 'end' : 'middle'
  const x = anchor === 'start' ? p.x - 8 : anchor === 'end' ? p.x + 8 : p.x
  return { x, y: below ? p.y + 22 : p.y - 13, text, anchor }
})

const summary = computed(() =>
  props.rows
    .map((r) => (r.result.valid ? `${r.label}: ${formatCapacity(r.result.usableTB)}, ${formatPct(r.result.efficiency)}` : `${r.label}: not placeable`))
    .join('; '),
)
</script>

<template>
  <div ref="root" class="scheme-chart">
    <ul class="legend">
      <li><span class="key line" />Usable · {{ capacityUnit }} left, efficiency right</li>
      <li><span class="key survives" />Survives</li>
      <li><span class="key needs" />Needs</li>
      <li v-if="availableOnScale">
        <span class="key available" />{{ formatInt(available) }} {{ plural(domain, available) }} available
      </li>
      <li v-else>{{ formatInt(available) }} {{ plural(domain, available) }} available · all layouts fit</li>
    </ul>

    <div class="plot" @mouseleave="hover = null">
      <svg :width="width" :height="height" role="img" :aria-label="`Usable capacity per layout. ${summary}`">
        <!-- gridlines + left (TB) and right (% of raw) axes share the same positions -->
        <g class="grid">
          <line
            v-for="t in usableTicks"
            :key="t"
            :x1="m.left"
            :x2="m.left + plotW"
            :y1="yUsable(t)"
            :y2="yUsable(t)"
          />
        </g>
        <g class="axis left">
          <text v-for="t in usableTicks" :key="t" :x="m.left - 8" :y="yUsable(t)" dy="0.32em" text-anchor="end">
            {{ t === 0 ? '0' : formatCapacity(t) }}
          </text>
        </g>
        <g class="axis right">
          <template v-for="p in pctTicks" :key="p">
            <line :x1="m.left + plotW" :x2="m.left + plotW + 4" :y1="yUsable(p * rawTB)" :y2="yUsable(p * rawTB)" />
            <text :x="m.left + plotW + 8" :y="yUsable(p * rawTB)" dy="0.32em" text-anchor="start">
              {{ formatPct(p) }}
            </text>
          </template>
        </g>

        <!-- hover / selection band -->
        <rect
          v-if="activeIndex >= 0"
          class="band active"
          :x="m.left + band * activeIndex"
          :y="m.top"
          :width="band"
          :height="plotH"
        />
        <rect
          v-if="hover !== null"
          class="band hover"
          :x="m.left + band * hover"
          :y="m.top"
          :width="band"
          :height="plotH"
        />

        <!-- stacked bars (behind): survives + rest of needs, in failure-domain units -->
        <g class="bars">
          <g v-for="b in bars" :key="b.id" :class="{ over: b.over }">
            <rect class="survives" :x="b.survives.x" :y="b.survives.y" :width="b.survives.w" :height="b.survives.h" />
            <path class="needs" :d="b.needs" />
          </g>
        </g>

        <!-- available failure domains -->
        <g v-if="availableOnScale" class="available">
          <line :x1="m.left" :x2="m.left + plotW" :y1="yBar(available)" :y2="yBar(available)" />
        </g>

        <!-- usable line (front) -->
        <path class="line" :d="linePath" />
        <g class="points">
          <circle
            v-for="(p, i) in points.filter((p) => p.y !== null)"
            :key="i"
            :cx="p.x"
            :cy="p.y!"
            :r="p.row.active ? 6 : 4.5"
            :class="{ active: p.row.active }"
          />
        </g>
        <text
          v-if="activeLabel"
          class="direct"
          :x="activeLabel.x"
          :y="activeLabel.y"
          :text-anchor="activeLabel.anchor"
        >
          {{ activeLabel.text }}
        </text>

        <!-- x axis -->
        <g class="axis x">
          <text
            v-for="(r, i) in rows"
            :key="r.id"
            :x="xCenter(i)"
            :y="m.top + plotH + (compact ? 14 : 18)"
            :text-anchor="compact ? 'end' : 'middle'"
            :transform="compact ? `rotate(-45 ${xCenter(i)} ${m.top + plotH + 14})` : undefined"
            :class="{ active: r.active, invalid: !r.result.valid }"
          >
            {{ shortLabel(r) }}
          </text>
        </g>

        <!-- hit targets: whole column per layout -->
        <rect
          v-for="(r, i) in rows"
          :key="`hit-${r.id}`"
          class="hit"
          :x="m.left + band * i"
          :y="m.top"
          :width="band"
          :height="plotH + m.bottom"
          @mouseenter="hover = i"
          @click="emit('select', { ...r.scheme })"
        />
      </svg>

      <div
        v-if="tip"
        class="tooltip"
        :class="{ flip: tip.flip }"
        :style="{ left: `${tip.left}px`, top: `${m.top}px` }"
        role="status"
      >
        <strong>{{ tip.row.label }}</strong>
        <dl>
          <template v-if="tip.row.result.valid">
            <dt><span class="key line" />Usable</dt>
            <dd>{{ formatCapacity(tip.row.result.usableTB) }}</dd>
            <dt><span class="key blank" />Efficiency</dt>
            <dd>{{ formatPct(tip.row.result.efficiency) }}</dd>
          </template>
          <template v-else>
            <dt class="warn wide">
              {{ tipHint?.needs ?? 'Not placeable' }}<template v-if="tipHint?.reserve"> ({{ tipHint.reserve }})</template>
            </dt>
          </template>
          <dt><span class="key survives" />Survives</dt>
          <dd>{{ tip.row.result.failuresTolerated }}</dd>
          <dt><span class="key needs" />Needs</dt>
          <dd>{{ formatInt(tip.row.result.minDomains) }} / {{ formatInt(available) }}</dd>
        </dl>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.scheme-chart {
  min-width: 0;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem 1.1rem;
  list-style: none;
  margin: 0 0 0.6rem;
  padding: 0;
  font-size: 0.76rem;
  color: var(--text-muted);

  li {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
}

.key {
  display: inline-block;
  flex: 0 0 auto;

  &.line {
    width: 16px;
    height: 2px;
    border-radius: 1px;
    background: var(--chart-line);
    position: relative;

    &::after {
      content: '';
      position: absolute;
      left: 5px;
      top: -3px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--chart-line);
    }
  }

  &.survives,
  &.needs {
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }

  &.survives {
    background: var(--chart-bar);
  }

  &.needs {
    background: var(--chart-bar-soft);
  }

  &.available {
    width: 16px;
    border-top: 1.5px dashed var(--text-muted);
  }

  &.blank {
    width: 16px;
  }
}

.plot {
  position: relative;
}

svg {
  display: block;
  overflow: visible;
  font-family: $font-mono;
}

.grid line {
  stroke: var(--chart-grid);
  stroke-width: 1;
  shape-rendering: crispEdges;
}

.axis.right line {
  stroke: var(--text-faint);
  stroke-width: 1;
}

.axis text {
  font-size: 10.5px;
  fill: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.axis.x text {
  font-size: 11px;
  fill: var(--text-muted);

  &.active {
    fill: var(--text);
    font-weight: 600;
  }

  &.invalid {
    fill: var(--text-faint);
  }
}

.band {
  &.active {
    fill: var(--accent-soft);
  }

  &.hover {
    fill: var(--chart-grid);
  }
}

.bars {
  .survives {
    fill: var(--chart-bar);
    opacity: 0.55;
  }

  .needs {
    fill: var(--chart-bar-soft);
  }

  .over .survives {
    opacity: 0.3;
  }
}

.available line {
  stroke: var(--text-muted);
  stroke-width: 1.5;
  stroke-dasharray: 5 4;
  opacity: 0.8;
}

.line {
  fill: none;
  stroke: var(--chart-line);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.points circle {
  fill: var(--chart-line);
  stroke: var(--panel);
  stroke-width: 2;
}

.direct {
  font-size: 11px;
  font-weight: 500;
  fill: var(--text);
  paint-order: stroke;
  stroke: var(--panel);
  stroke-width: 3px;
}

.hit {
  fill: transparent;
  cursor: pointer;
}

.tooltip {
  position: absolute;
  transform: translateX(14px);
  min-width: 170px;
  padding: 0.55rem 0.7rem;
  border-radius: $radius-sm;
  background: var(--panel);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow);
  font-size: 0.78rem;
  pointer-events: none;
  z-index: 2;

  &.flip {
    transform: translateX(calc(-100% - 14px));
  }

  strong {
    display: block;
    margin-bottom: 0.3rem;
    font-weight: 600;
  }

  dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 0.15rem 1rem;
    margin: 0;
  }

  dt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--text-muted);

    &.warn {
      color: var(--danger);
    }

    &.wide {
      grid-column: 1 / -1;
      white-space: normal;
    }
  }

  dd {
    margin: 0;
    text-align: right;
    font-family: $font-mono;
    font-variant-numeric: tabular-nums;
  }
}
</style>
