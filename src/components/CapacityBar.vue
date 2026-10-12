<script setup lang="ts">
import { computed } from 'vue'
import DistributionBar from './DistributionBar.vue'
import RatioMarker from './RatioMarker.vue'
import { formatPct } from '@/lib/format'
import { formatCapacity } from '@/lib/units'
import { dataUntilRatio, rawUntilRatio, type CapacityResult } from '@/lib/ceph'
import { plural, type DomainType } from '@/lib/topology'
import { distributionSegments } from '@/lib/distribution'

const props = defineProps<{ result: CapacityResult; domain: DomainType; recoveryReserve: number }>()

const share = (tb: number) => (props.result.rawTB > 0 ? tb / props.result.rawTB : 0)

const segments = computed(() => distributionSegments(props.result))

// The unusable block only appears when there is unusable space (balanced clusters have none).
const legend = computed(() => segments.value.filter((s) => s.key !== 'unusable' || s.tb > 1e-9))

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

const breakdowns = computed(() => {
  const { reserved, unusable, fillRatios } = props.result
  const n = props.recoveryReserve
  const visible = (items: { label: string; tb: number }[]) => items.filter((b) => b.tb > 1e-9)
  return {
    reserved: visible([
      { label: `Recovery reserve (${n} ${plural(props.domain, n)})`, tb: reserved.recoveryReserveTB },
      { label: `Nearfull headroom (${formatPct(1 - fillRatios.nearfull)})`, tb: reserved.nearfullHeadroomTB },
    ]),
    unusable: visible([
      { label: 'Stranded by imbalance', tb: unusable.strandedTB },
      { label: 'Outside failure domains', tb: unusable.unplacedTB },
    ]),
  } as Record<string, { label: string; tb: number }[]>
})
</script>

<template>
  <div class="capacity-bar">
    <DistributionBar :result="result" />

    <ul class="legend" :class="`cols-${legend.length}`">
      <li v-for="s in legend" :key="s.key" :class="s.key">
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
        <ul v-if="breakdowns[s.key]?.length" class="breakdown">
          <li v-for="b in breakdowns[s.key]" :key="b.label">
            <span>{{ b.label }}</span>
            <span class="mono">{{ formatCapacity(b.tb) }}</span>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
// Legend columns follow the card width (not the viewport): four blocks go 4 → 2 × 2 → 1.
.capacity-bar {
  container-type: inline-size;
}

.legend {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;

  &.cols-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 1rem;

    @container (min-width: 40rem) {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @container (max-width: 30rem) {
    &.cols-3,
    &.cols-4 {
      grid-template-columns: minmax(0, 1fr);
    }
  }

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

  .unusable .swatch {
    background: var(--unusable-stripe);
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
    align-items: baseline;
    gap: 0.5rem;
  }

  .mono {
    flex: 0 0 auto;
    font-family: $font-mono;
    color: var(--text);
  }
}
</style>
