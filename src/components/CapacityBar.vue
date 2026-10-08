<script setup lang="ts">
import { computed } from 'vue'
import RatioMarker from './RatioMarker.vue'
import { formatPct } from '@/lib/format'
import { formatCapacity } from '@/lib/units'
import { dataUntilRatio, rawUntilRatio, type CapacityResult } from '@/lib/ceph'
import { plural, type DomainType } from '@/lib/topology'

const props = defineProps<{ result: CapacityResult; domain: DomainType; recoveryReserve: number }>()

const share = (tb: number) => (props.result.rawTB > 0 ? tb / props.result.rawTB : 0)

const segments = computed(() => [
  { key: 'usable', label: 'Usable data', note: 'what you can store', tb: props.result.usableTB },
  { key: 'protection', label: 'Protection overhead', note: 'replicas / parity', tb: props.result.protectionTB },
  { key: 'reserved', label: 'Reserved headroom', note: 'kept free on purpose', tb: props.result.reservedTB },
])

/** Where healthy OSDs reach each fill ratio, as a share of raw capacity. */
const markers = computed(() => {
  const r = props.result
  if (!r.valid || r.rawTB <= 0) return []
  const defs = [
    { key: 'nearfull', label: 'nearfull', effect: 'health warning' },
    { key: 'backfillfull', label: 'backfillfull', effect: 'recovery stops' },
    { key: 'full', label: 'full', effect: 'writes stop' },
  ] as const
  return defs.map((d) => {
    const ratio = r.fillRatios[d.key]
    const storedTB = r.healthyPlaceableTB * ratio
    const position = Math.min(1, storedTB / r.rawTB)
    return {
      ...d,
      ratio,
      position,
      title: `${d.label} ${ratio.toFixed(2)} (${d.effect}): reached at ${formatCapacity(storedTB)} raw stored, ${formatCapacity(storedTB * r.dataFraction)} of data`,
    }
  })
})

/**
 * Additional data (net) that fits between the planned fill and the backfillfull / full markers
 * on a healthy cluster; shown under "Usable data".
 */
const untilLimits = computed(() => {
  const r = props.result
  if (!r.valid) return []
  return (['backfillfull', 'full'] as const).map((key) => {
    const tb = dataUntilRatio(r, key)
    return {
      key,
      tb,
      title: `${formatCapacity(tb)} more data (${formatCapacity(rawUntilRatio(r, key))} raw) until healthy OSDs reach the ${key} ratio (${r.fillRatios[key].toFixed(2)})`,
    }
  })
})

const breakdown = computed(() => {
  const r = props.result.reserved
  const n = props.recoveryReserve
  return [
    { label: `Recovery reserve (${n} ${plural(props.domain, n)})`, tb: r.recoveryReserveTB },
    { label: `Nearfull headroom (${formatPct(1 - props.result.fillRatios.nearfull)})`, tb: r.nearfullHeadroomTB },
    { label: 'Stranded by imbalance', tb: r.strandedTB },
    { label: 'Outside failure domains', tb: r.unplacedTB },
  ].filter((b) => b.tb > 1e-9)
})
</script>

<template>
  <div class="capacity-bar">
    <div class="bar-head">
      <span class="title">Raw data distribution:</span>
      <span class="total">{{ formatCapacity(result.rawTB) }} = 100%</span>
    </div>
    <div class="track">
      <div v-if="markers.length" class="markers">
        <span
          v-for="m in markers"
          :key="m.key"
          :class="['marker', m.key]"
          :style="{ left: `${m.position * 100}%` }"
          :title="m.title"
          role="img"
          :aria-label="m.title"
        >
          <RatioMarker :kind="m.key" />
        </span>
      </div>
      <span
        v-for="m in markers"
        :key="`tick-${m.key}`"
        :class="['tick', m.key]"
        :style="{ left: `${m.position * 100}%` }"
        aria-hidden="true"
      />
    <div class="bar" role="img" :aria-label="segments.map((s) => `${s.label} ${formatCapacity(s.tb)}`).join(', ')">
      <div
        v-for="s in segments"
        v-show="s.tb > 0"
        :key="s.key"
        :class="['seg', s.key]"
        :style="{ width: `${share(s.tb) * 100}%` }"
        :title="`${s.label}: ${formatCapacity(s.tb)} (${formatPct(share(s.tb))})`"
      >
        <span v-if="share(s.tb) >= 0.1" class="pct">{{ formatPct(share(s.tb)) }}</span>
      </div>
    </div>
    </div>

    <ul class="legend">
      <li v-for="s in segments" :key="s.key" :class="s.key">
        <span class="swatch" />
        <span class="label">{{ s.label }}</span>
        <span class="value">{{ formatCapacity(s.tb) }}</span>
        <span class="note">{{ formatPct(share(s.tb)) }} · {{ s.note }}</span>
        <ul v-if="s.key === 'usable' && untilLimits.length" class="until">
          <li v-for="u in untilLimits" :key="u.key" :title="u.title">
            <RatioMarker :kind="u.key" :size="9" />
            <span class="mono">+{{ formatCapacity(u.tb) }}</span> until {{ u.key }}
          </li>
        </ul>
        <ul v-if="s.key === 'reserved' && breakdown.length" class="breakdown">
          <li v-for="b in breakdown" :key="b.label">
            <span>{{ b.label }}</span>
            <span class="mono">{{ formatCapacity(b.tb) }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.6rem;

  .title {
    font-family: $font-display;
    font-weight: 700;
    font-size: 0.95rem;
  }

  .total {
    font-family: $font-mono;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
}

$marker-h: 11px;

.tick.nearfull {
  color: var(--marker-nearfull);
}

.tick.backfillfull {
  color: var(--marker-backfillfull);
}

.tick.full {
  color: var(--marker-full);
}

.track {
  position: relative;
}

.markers {
  position: relative;
  height: $marker-h + 2px;
}

.marker {
  position: absolute;
  bottom: 2px;
  transform: translateX(-50%);
  line-height: 0;
  cursor: help;
}

.tick {
  position: absolute;
  top: $marker-h + 2px;
  bottom: 0;
  width: 0;
  border-left: 1.5px dashed currentColor;
  transform: translateX(-50%);
  opacity: 0.85;
  pointer-events: none;
  z-index: 1;
}

.bar {
  display: flex;
  height: 40px;
  border-radius: $radius-sm;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--reserved);
}

.seg {
  display: flex;
  align-items: center;
  padding: 0 0.6rem;
  flex: 0 0 auto;
  min-width: 0;
  transition: width 0.35s ease;
  overflow: hidden;

  & + .seg {
    border-left: 1px solid var(--panel);
  }

  .pct {
    font-family: $font-mono;
    font-size: 0.78rem;
    font-weight: 500;
  }
}

.seg.usable {
  background: var(--accent);
  color: var(--on-accent);
}

.seg.protection {
  background: var(--protection);
  color: #fff;
}

.seg.reserved {
  color: var(--text-muted);
  background: repeating-linear-gradient(
    135deg,
    var(--reserved) 0 7px,
    var(--reserved-stripe) 7px 9px
  );
}

.legend {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;

  > li {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    align-content: start;
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    margin-top: 0.4rem;
    grid-row: span 3;
  }

  .usable .swatch {
    background: var(--accent);
  }

  .protection .swatch {
    background: var(--protection);
  }

  .reserved .swatch {
    background: var(--reserved-stripe);
    box-shadow: inset 0 0 0 1px var(--border-strong);
  }

  .label {
    @include caption;
  }

  .value {
    font-family: $font-display;
    font-weight: 700;
    font-size: 1.1rem;
  }

  .note {
    font-size: 0.74rem;
    color: var(--text-faint);
  }
}

.until {
  grid-column: 2;
  list-style: none;
  margin: 0.2rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.1rem;
  font-size: 0.74rem;
  color: var(--text-faint);

  li {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    cursor: help;
  }

  .mono {
    font-family: $font-mono;
    color: var(--text-muted);
  }
}

.breakdown {
  grid-column: 2;
  list-style: none;
  margin: 0.5rem 0 0;
  padding: 0.45rem 0 0;
  border-top: 1px dashed var(--border-strong);
  display: grid;
  gap: 0.15rem;
  font-size: 0.74rem;
  color: var(--text-muted);

  li {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .mono {
    font-family: $font-mono;
    color: var(--text);
  }
}

@include below($bp-sm) {
  .bar {
    height: 38px;
  }

  .legend {
    grid-template-columns: 1fr;
  }
}
</style>
