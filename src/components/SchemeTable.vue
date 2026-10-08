<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import SchemeChart from './SchemeChart.vue'
import { computeCapacity, placementHint, type CapacityInput, type Scheme, type Tunables } from '@/lib/ceph'
import { formatInt, formatPct } from '@/lib/format'
import { formatCapacity } from '@/lib/units'
import { PRESETS, matchPreset, sameScheme, schemeLabel } from '@/lib/schemes'
import { plural, type DomainType } from '@/lib/topology'

const props = defineProps<{
  input: CapacityInput
  tunables: Tunables
  current: Scheme
  domain: DomainType
}>()

const emit = defineEmits<{ select: [scheme: Scheme] }>()

const rows = computed(() => {
  const schemes = PRESETS.map((p) => ({ id: p.id, label: p.label, scheme: p.scheme, custom: false }))
  if (!matchPreset(props.current)) {
    schemes.unshift({ id: 'custom', label: schemeLabel(props.current), scheme: props.current, custom: true })
  }
  return schemes.map((s) => {
    const result = computeCapacity(props.input, s.scheme, props.tunables)
    const raw = result.rawTB || 1
    return {
      ...s,
      kind: s.scheme.kind === 'replicated' ? 'REP' : 'EC',
      active: sameScheme(s.scheme, props.current),
      result,
      usableShare: result.valid ? result.usableTB / raw : 0,
      protectionShare: result.valid ? result.protectionTB / raw : 0,
      hint: placementHint(result, props.domain),
    }
  })
})

const bestId = computed(() => {
  // Only layouts that survive at least one failure compete; 1x replication always "wins" otherwise.
  const valid = rows.value.filter((r) => r.result.valid && r.result.failuresTolerated > 0)
  return valid.length ? valid.reduce((a, b) => (b.result.usableTB > a.result.usableTB ? b : a)).id : null
})

function ariaLabel(row: (typeof rows.value)[number]): string {
  const r = row.result
  const d = props.domain
  return r.valid
    ? `${row.label}: ${formatCapacity(r.usableTB)} usable, ${formatPct(r.efficiency)} efficiency, survives ${r.failuresTolerated} ${plural(d, r.failuresTolerated)}, needs ${r.minDomains} ${plural(d, r.minDomains)}`
    : `${row.label}: ${row.hint?.needs ?? 'not placeable'}${row.hint?.reserve ? ` (${row.hint.reserve})` : ''}`
}
</script>

<template>
  <section class="card schemes">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="columns" :size="17" /></span>
      <h2>Compare layouts</h2>
      <span class="aside hint">Click a row to apply the preset.</span>
    </div>

    <div class="cols" aria-hidden="true">
      <span>Layout</span>
      <span>Raw split</span>
      <span class="num">Usable</span>
      <span class="num">Eff.</span>
      <span class="num">Survives</span>
      <span class="num">Needs</span>
    </div>

    <ol class="list">
      <li v-for="row in rows" :key="row.id">
        <button
          type="button"
          class="row"
          :class="{ active: row.active, invalid: !row.result.valid }"
          :aria-pressed="row.active"
          :aria-label="ariaLabel(row)"
          @click="emit('select', { ...row.scheme })"
        >
          <span class="name">
            <span class="tag" :class="row.kind.toLowerCase()">{{ row.kind }}</span>
            <span class="label">{{ row.label }}</span>
            <span v-if="row.custom" class="badge">custom</span>
            <span v-if="row.id === bestId" class="badge best">most space</span>
          </span>
          <span class="mini" aria-hidden="true">
            <template v-if="row.result.valid">
              <span class="u" :style="{ width: `${row.usableShare * 100}%` }" />
              <span class="p" :style="{ width: `${row.protectionShare * 100}%` }" />
            </template>
            <span v-else-if="row.hint" class="needs">
              {{ row.hint.needs }}<span v-if="row.hint.reserve" class="reserve"> ({{ row.hint.reserve }})</span>
            </span>
          </span>
          <span class="num usable">{{ row.result.valid ? formatCapacity(row.result.usableTB) : '—' }}</span>
          <span class="num eff">{{ row.result.valid ? formatPct(row.result.efficiency) : '—' }}</span>
          <span class="num survives">{{ row.result.failuresTolerated }}</span>
          <span class="num min">{{ formatInt(row.result.minDomains) }}</span>
          <span class="sub">
            survives {{ row.result.failuresTolerated }} · needs {{ formatInt(row.result.minDomains) }}
            {{ plural(domain, row.result.minDomains) }}
          </span>
        </button>
      </li>
    </ol>
    <p class="foot">
      “Survives” and “Needs” count {{ plural(domain) }}. Needs = shards per object + recovery reserve.
    </p>

    <div class="chart">
      <SchemeChart :rows="rows" :domain="domain" @select="(scheme) => emit('select', scheme)" />
    </div>
  </section>
</template>

<style lang="scss" scoped>
$cols: minmax(9.5rem, 1.3fr) minmax(5rem, 1.4fr) 5.2rem 3.4rem 4.4rem 3.8rem;

.hint {
  font-size: 0.78rem;
  color: var(--text-faint);
}

.cols,
.row {
  display: grid;
  grid-template-columns: $cols;
  gap: 0.9rem;
  align-items: center;
}

.cols {
  padding: 0.8rem 1.4rem 0.4rem;
  @include caption;
  font-size: 0.72rem;
  color: var(--text-faint);
}

.num {
  text-align: right;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0 0.6rem 0.4rem;
}

.row {
  position: relative;
  width: 100%;
  border: 0;
  border-radius: $radius;
  background: transparent;
  padding: 0.6rem 0.8rem;
  text-align: left;
  cursor: pointer;
  font-size: 0.88rem;
  transition: background 0.15s;

  &:hover {
    background: var(--panel-alt);
  }

  &.active {
    background: var(--accent-soft);
    box-shadow: inset 3px 0 0 var(--accent);

    .label {
      color: var(--accent-text);
      font-weight: 600;
    }
  }

  &.invalid {
    .label,
    .num {
      color: var(--text-faint);
    }
  }
}

.name {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  flex-wrap: wrap;
}

.label {
  white-space: nowrap;
}

.tag {
  font-family: $font-mono;
  font-size: 0.62rem;
  font-weight: 500;
  padding: 0.05rem 0.35rem;
  border-radius: 4px;
  letter-spacing: 0.03em;

  &.rep {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  &.ec {
    background: var(--protection-soft);
    color: var(--protection);
  }
}

.badge {
  font-size: 0.66rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  color: var(--text-muted);

  &.best {
    border-color: var(--accent);
    color: var(--accent-text);
  }
}

.mini {
  display: flex;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: repeating-linear-gradient(135deg, var(--reserved) 0 4px, var(--reserved-stripe) 4px 5px);

  .u {
    background: var(--accent);
    transition: width 0.3s;
  }

  .p {
    background: var(--protection);
    opacity: 0.75;
    transition: width 0.3s;
  }

  &:has(.needs) {
    height: auto;
    background: none;
    overflow: visible;
  }
}

.needs {
  font-size: 0.76rem;
  color: var(--danger);
  white-space: normal;
  line-height: 1.3;

  // The parenthetical wraps as one piece onto a second line in narrow columns.
  .reserve {
    white-space: nowrap;
  }
}

.usable {
  font-family: $font-display;
  font-weight: 700;
}

.eff,
.survives,
.min {
  font-family: $font-mono;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.sub {
  display: none;
}

.chart {
  padding: 1.1rem 1.4rem 1.3rem;
  border-top: 1px solid var(--border);
}

.foot {
  margin: 0;
  padding: 0.4rem 1.4rem 1.1rem;
  font-size: 0.74rem;
  color: var(--text-faint);
}

@include below($bp-md) {
  .aside.hint {
    display: none;
  }
}

@include below($bp-sm) {
  .cols {
    display: none;
  }

  .list {
    padding: 0.3rem 0.4rem 0.4rem;
  }

  .row {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas:
      'name usable eff'
      'mini mini mini'
      'sub sub sub';
    gap: 0.35rem 0.75rem;
    padding: 0.7rem 0.75rem;
  }

  .name {
    grid-area: name;
  }

  .mini {
    grid-area: mini;
    height: 7px;
  }

  .usable {
    grid-area: usable;
  }

  .eff {
    grid-area: eff;
  }

  .survives,
  .min {
    display: none;
  }

  .sub {
    grid-area: sub;
    display: block;
    font-size: 0.72rem;
    color: var(--text-faint);
  }

  .foot {
    padding: 0.3rem 1rem 1rem;
  }

  .chart {
    padding: 0.9rem 1rem 1rem;
  }
}
</style>
