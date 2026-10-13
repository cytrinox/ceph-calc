<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import CapacityBar from './CapacityBar.vue'
import FaqLink from './FaqLink.vue'
import { FAQ_IDS } from '@/lib/faq'
import { formatIops, formatPct, formatInt } from '@/lib/format'
import { BASIC_IOPS, describeCost, explainIops, ioSizeLabel, type IopsEstimate } from '@/lib/iops'
import { formatCapacity } from '@/lib/units'
import { placementMessage, type CapacityResult } from '@/lib/ceph'
import { plural, type DomainType } from '@/lib/topology'

const props = defineProps<{
  result: CapacityResult
  schemeName: string
  facts: string[]
  domain: DomainType
  recoveryReserve: number
  warnings: string[]
  /** Cluster price label; null when no price per TB is set. */
  /** `perUsable` is per usable `unit` (the TB/TiB toggle). */
  price: { total: string; perUsable: string | null; unit: string; detail: string } | null
  /** Effective capacity with compression; null when compression is off. */
  compression: { effective: string; detail: string } | null
  /** 4k random IOPS estimate; null when no per-OSD IOPS are set. */
  iops: IopsEstimate | null
}>()

const iopsSize = computed(() => (props.iops ? ioSizeLabel(props.iops.basis.ioSizeKiB) : ''))
const iopsValue = (n: number | null) => (props.result.valid && n !== null ? formatIops(n) : '—')
// What one client operation costs, or which device classes still lack the per-OSD IOPS it needs.
const iopsNote = (estimate: IopsEstimate, op: 'read' | 'write') => {
  const cost = estimate.costs[op]
  const { missing } = estimate.ops[op]
  // A request larger than an object takes one operation per object (step 5).
  const objects = estimate.costs.objects > 1 ? ` (${estimate.costs.objects} objects)` : ''
  if (missing.length === 0) return `${describeCost(cost)} per client ${op}${objects}`
  const kinds = [cost.reads > 0 && 'read', cost.writes > 0 && 'write'].filter(Boolean).join(' and ')
  // The Basic tab's values have no class.
  const classes = missing.filter((cls) => cls !== BASIC_IOPS)
  return `needs ${kinds} IOPS ${classes.length ? `for ${classes.join(', ')}` : 'per OSD'}`
}
// Tooltip: the arithmetic first, then what the number means.
const iopsTitle = (op: 'read' | 'write') => {
  const sum = props.iops && props.result.valid ? explainIops(props.iops, op) : null
  const meaning = `${iopsSize.value} random IOPS until the largest OSDs are saturated: a ceiling for a healthy cluster with many parallel requests`
  return sum ? `${sum}\n${meaning}` : meaning
}

const usableParts = computed(() => {
  const [value, unit] = formatCapacity(props.result.usableTB).split(' ')
  return { value, unit }
})
</script>

<template>
  <section class="card summary">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="database" :size="17" /></span>
      <h2>Real net capacity<FaqLink :target="FAQ_IDS.realNet" topic="the real net capacity" /></h2>
      <div class="aside head-labels">
        <span
          v-if="price"
          class="price-pill"
          :title="`Drive cost: ${price.detail}`"
        >
          <span class="total">{{ price.total }}</span>
          <span v-if="price.perUsable" class="per">{{ price.perUsable }} / usable {{ price.unit }}</span>
        </span>
        <span class="scheme-pill">{{ schemeName }}</span>
      </div>
    </div>

    <div class="hero">
      <div class="figure">
        <template v-if="result.valid">
          <div class="big">
            <span class="value">{{ usableParts.value }}</span>
            <span class="unit">{{ usableParts.unit }}</span>
          </div>
          <p class="lead">left for your data after redundancy and safety headroom</p>
        </template>
        <template v-else>
          <div class="big invalid"><span class="value">n/a</span></div>
          <p class="lead error">{{ placementMessage(result, domain) }}</p>
        </template>
        <ul class="facts">
          <li v-if="compression" class="compress" :title="compression.detail">
            ≈ <strong>{{ compression.effective }}</strong> with compression
          </li>
          <li v-for="f in facts" :key="f">{{ f }}</li>
        </ul>
      </div>

      <div class="kpis">
        <dl class="kpi">
          <div class="half tone-safe">
            <dt><AppIcon name="columns" :size="14" /> Raw capacity</dt>
            <dd>
              <strong>{{ formatCapacity(result.rawTB) }}</strong>
              <span>across {{ formatInt(result.domainCount) }} {{ plural(domain, result.domainCount) }}</span>
            </dd>
          </div>
          <div class="half tone-safe">
            <dt><AppIcon name="gauge" :size="14" /> Storage efficiency</dt>
            <dd>
              <strong>{{ result.valid ? formatPct(result.efficiency) : '—' }}</strong>
              <span>of raw is writable</span>
            </dd>
          </div>
        </dl>
        <dl class="kpi">
          <div class="half tone-critical">
            <dt><AppIcon name="shield" :size="14" /> Survives losing</dt>
            <dd>
              <strong>{{ result.failuresTolerated }} {{ plural(domain, result.failuresTolerated) }}</strong>
              <span>no data loss<template v-if="recoveryReserve > 0">, then recovers</template></span>
            </dd>
          </div>
          <div class="half tone-important">
            <dt><AppIcon name="pulse" :size="14" /> Operational losing</dt>
            <dd>
              <strong>{{ result.ioFailuresTolerated }} {{ plural(domain, result.ioFailuresTolerated) }}</strong>
              <span>I/O continues (min_size {{ result.minSize }})</span>
            </dd>
          </div>
        </dl>
        <dl v-if="iops" class="kpi">
          <div class="half" :title="iopsTitle('read')">
            <dt><AppIcon name="disk-read" :size="14" /> Read IOPS · {{ iopsSize }}</dt>
            <dd>
              <strong>{{ iopsValue(iops.read) }}</strong>
              <span>{{ iopsNote(iops, 'read') }}</span>
            </dd>
          </div>
          <div class="half" :title="iopsTitle('write')">
            <dt><AppIcon name="disk-write" :size="14" /> Write IOPS · {{ iopsSize }}</dt>
            <dd>
              <strong>{{ iopsValue(iops.write) }}</strong>
              <span>{{ iopsNote(iops, 'write') }}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <div class="bar-wrap">
      <CapacityBar :result="result" :domain="domain" :recovery-reserve="recoveryReserve" />
    </div>

    <div v-if="warnings.length" class="callout" role="note">
      <AppIcon name="alert" :size="16" />
      <ul>
        <li v-for="w in warnings" :key="w">{{ w }}</li>
      </ul>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.head-labels {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.4rem;
}

.price-pill {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: var(--panel-alt);
  white-space: nowrap;
  cursor: help;

  .total {
    font-family: $font-display;
    font-weight: 700;
    font-size: 0.9rem;
  }

  .per {
    font-size: 0.74rem;
    color: var(--text-muted);
  }
}

.scheme-pill {
  font-family: $font-mono;
  font-size: 0.78rem;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  white-space: nowrap;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  gap: 1.5rem;
  padding: 0.8rem 1.4rem 1.4rem;
}

.figure {
  align-self: center;
}

.big {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-family: $font-display;
  line-height: 1;
  margin-top: 0.4rem;

  .value {
    font-size: clamp(3rem, 9vw, 4.6rem);
    font-weight: 700;
    letter-spacing: -0.04em;
    background: linear-gradient(120deg, var(--accent-text), var(--protection));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .unit {
    font-size: clamp(1.3rem, 3.5vw, 1.8rem);
    font-weight: 500;
    color: var(--text-muted);
  }

  &.invalid .value {
    background: none;
    color: var(--text-faint);
  }
}

.lead {
  margin: 0.6rem 0 0;
  color: var(--text-muted);
  font-size: 0.92rem;

  &.error {
    color: var(--danger);
  }
}

.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;

  li {
    font-size: 0.76rem;
    color: var(--text-muted);
    background: var(--panel-alt);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.2rem 0.65rem;

    // Effective capacity with compression: highlighted like a result, not a plain fact.
    &.compress {
      color: var(--accent-text);
      background: var(--accent-soft);
      border-color: var(--accent);
      cursor: help;

      strong {
        font-family: $font-display;
        font-weight: 700;
      }
    }
  }
}

.kpis {
  display: grid;
  gap: 0.7rem;
  align-content: center;
}

.kpi {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  border-radius: $radius;
  background: var(--panel-alt);
  border: 1px solid var(--border);
}

.half {
  padding: 0.8rem 0.95rem;
  min-width: 0;

  & + & {
    border-left: 1px solid var(--border-strong);
  }

  dt {
    @include caption;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.74rem;

    svg {
      flex: 0 0 auto;
      color: var(--accent-text);
    }
  }

  // Status colour on the icon only (same hues as the ratio markers):
  // safe results green, data-loss tolerance red, I/O tolerance yellow.
  &.tone-safe dt svg {
    color: var(--marker-nearfull);
  }

  &.tone-critical dt svg {
    color: var(--marker-full);
  }

  &.tone-important dt svg {
    color: var(--marker-backfillfull);
  }

  dd {
    margin: 0.25rem 0 0;
    display: flex;
    flex-direction: column;

    strong {
      font-family: $font-display;
      font-size: 1.25rem;
      font-weight: 700;
      line-height: 1.25;
      overflow-wrap: anywhere;
    }

    span {
      font-size: 0.74rem;
      color: var(--text-faint);
    }
  }
}

.bar-wrap {
  padding: 1.2rem 1.4rem 1.4rem;
  border-top: 1px solid var(--border);
}

.callout {
  display: flex;
  gap: 0.6rem;
  margin: 0 1.4rem 1.4rem;
  padding: 0.75rem 0.9rem;
  border-radius: $radius;
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  color: var(--warning);

  svg {
    flex: 0 0 auto;
    margin-top: 0.15rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.3rem;
    font-size: 0.84rem;
  }
}

@include below($bp-md) {
  .hero {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@include below($bp-sm) {
  .hero {
    padding: 0.6rem 1rem 1rem;
  }

  .kpis {
    grid-template-columns: 1fr;
  }

  .bar-wrap {
    padding: 1rem;
  }

  .callout {
    margin: 0 1rem 1rem;
  }

  // Badges get their own line under the title instead of overflowing the card.
  .card-head {
    flex-wrap: wrap;
  }

  .head-labels {
    flex-basis: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }

  .scheme-pill {
    display: none;
  }
}
</style>
