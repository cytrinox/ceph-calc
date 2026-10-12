<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AdvancedTopology from './AdvancedTopology.vue'
import AppIcon from './AppIcon.vue'
import BasicTopology from './BasicTopology.vue'
import NumberField from './NumberField.vue'
import PoolConfig from './PoolConfig.vue'
import RatioMarker from './RatioMarker.vue'
import StepSection from './StepSection.vue'
import FaqLink from './FaqLink.vue'
import { FAQ_IDS } from '@/lib/faq'
import TabGroup from './TabGroup.vue'
import ToggleField from './ToggleField.vue'
import { DEFAULT_RATIOS, defaultEcMinSize, linkRatios, ratiosOrdered, schemeMinSize, type FillRatios } from '@/lib/ceph'
import { CUSTOM_EC, CUSTOM_REPLICATED, DEFAULT_PRESET_ID, PRESETS, schemeLabel, schemeSelection } from '@/lib/schemes'
import { formatInt, formatIops } from '@/lib/format'
import { IO_SIZES_KIB, MAX_OSD_IOPS, ioSizeLabel } from '@/lib/iops'
import { CURRENCY_MAX_LENGTH, formatPrice } from '@/lib/pricing'
import { TYPE_ID, plural, type DomainType, type TopologyExample } from '@/lib/topology'
import type { AppState, TopologyTab } from '@/lib/urlState'

const props = defineProps<{
  state: AppState
  domainOptions: DomainType[]
  osdCount: number
  /** OSDs the CRUSH rule uses (its device class only), for the pg_num suggestion. */
  poolOsdCount: number
  /** Device classes used in the Advanced tree. */
  treeClasses: string[]
  /** Failure domains in the topology. */
  domainCount: number
  /** Copies / shards per object. */
  width: number
}>()
const emit = defineEmits<{ resetFromBasic: [] }>()

const tabs: { value: TopologyTab; label: string; hint: string }[] = [
  { value: 'basic', label: 'Basic', hint: 'identical hosts' },
  { value: 'advanced', label: 'Advanced', hint: 'custom CRUSH tree' },
]

/** Set when the user explicitly picks a "Custom …" entry, so the dropdown keeps showing it. */
const customPicked = ref(false)

const selection = computed(() => {
  const s = props.state.scheme
  if (customPicked.value) return s.kind === 'replicated' ? CUSTOM_REPLICATED : CUSTOM_EC
  return schemeSelection(s)
})

function onSchemeSelect(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  const preset = PRESETS.find((p) => p.id === value)
  customPicked.value = !preset
  if (preset) {
    props.state.scheme = { ...preset.scheme }
  } else if (value === CUSTOM_REPLICATED && props.state.scheme.kind !== 'replicated') {
    props.state.scheme = { kind: 'replicated', size: 3, minSize: 2 }
  } else if (value === CUSTOM_EC && props.state.scheme.kind !== 'ec') {
    props.state.scheme = { kind: 'ec', k: 4, m: 2 }
  }
}

// A scheme picked elsewhere (e.g. the comparison table) clears the explicit "Custom" choice.
watch(
  () => props.state.scheme,
  (s) => {
    if (schemeSelection(s) !== CUSTOM_REPLICATED && schemeSelection(s) !== CUSTOM_EC) customPicked.value = false
  },
)

// Keep min_size within size.
watch(
  () => (props.state.scheme.kind === 'replicated' ? props.state.scheme.size : null),
  (size) => {
    const s = props.state.scheme
    if (size !== null && s.kind === 'replicated' && s.minSize > size) s.minSize = size
  },
)

// EC min_size: Ceph's default k + min(1, m - 1) unless changed; only a different value is stored.
const ecMinSize = computed({
  get: () => schemeMinSize(props.state.scheme),
  set: (value: number) => {
    const s = props.state.scheme
    if (s.kind !== 'ec') return
    if (value === defaultEcMinSize(s.k, s.m)) delete s.minSize
    else s.minSize = value
  },
})

// Keep a changed EC min_size within k..k+m; drop it once it matches the default again.
watch(
  () => (props.state.scheme.kind === 'ec' ? [props.state.scheme.k, props.state.scheme.m] : null),
  () => {
    const s = props.state.scheme
    if (s.kind !== 'ec' || s.minSize === undefined) return
    const clamped = Math.min(s.k + s.m, Math.max(s.k, s.minSize))
    if (clamped === defaultEcMinSize(s.k, s.m)) delete s.minSize
    else s.minSize = clamped
  },
)

// An example sets up the whole cluster: besides the topology, its failure domain, pool layout and
// recovery reserve, with Ceph's default fill ratios.
function applyExample(example: TopologyExample) {
  const st = props.state
  st.failureDomain = example.domain
  st.scheme = { ...example.scheme }
  st.recoveryReserve = example.recoveryReserve
  st.nearfullRatio = DEFAULT_RATIOS.nearfull
  st.backfillfullRatio = DEFAULT_RATIOS.backfillfull
  st.fullRatio = DEFAULT_RATIOS.full
}

// The ratios depend on each other: a finished change pushes the others along to keep nearfull ≤ backfillfull ≤ full.
// (Not on every key: typing 0.97 passes through 0, which must not drag the others down.)
function linkRatio(changed: keyof FillRatios) {
  Object.assign(props.state, linkRatios(props.state, changed))
}

const domain = computed(() => props.state.failureDomain)

// One-line summaries shown in a step's header while it is collapsed.
const hardwareSummary = computed(() => {
  const st = props.state
  const topo =
    st.tab === 'basic'
      ? `${formatInt(st.basic.hosts)} hosts × ${st.basic.osdsPerHost} × ${st.basic.osdSizeTB} TB`
      : `custom tree · ${formatInt(props.osdCount)} OSDs`
  return topo
})
const redundancySummary = computed(() => `${schemeLabel(props.state.scheme)} · across ${plural(domain.value)}`)
const headroomSummary = computed(() => {
  const st = props.state
  const r = (x: number) => Number(x).toFixed(2)
  return `recovery reserve ${st.recoveryReserve} · nearfull ${r(st.nearfullRatio)} · backfillfull ${r(st.backfillfullRatio)} · full ${r(st.fullRatio)}`
})
const poolSummary = computed(() => {
  const pool = props.state.pool
  return `${pool.name || 'data'} · ${pool.application} · autoscale ${pool.autoscaleMode}`
})
const miscSummary = computed(() => {
  const st = props.state
  const { osdReadIops: r, osdWriteIops: w } = st
  const value = (n: number) => (n > 0 ? formatIops(n) : '—')
  const price = st.pricePerTB > 0 ? `${formatPrice(st.pricePerTB, st.currency)}/TB` : 'no price'
  const iops =
    r > 0 || w > 0 ? `${ioSizeLabel(st.ioSizeKiB)} · read ${value(r)} · write ${value(w)} IOPS per OSD` : 'no IOPS'
  return [price, iops, ...(st.crushMap ? ['CRUSH map'] : [])].join(' · ')
})

/** Failure domains beyond what one object needs: the most the recovery reserve can cover. */
const spareDomains = computed(() => props.domainCount - props.width)
const pieces = computed(() => (props.state.scheme.kind === 'ec' ? 'shards' : 'copies'))
</script>

<template>
  <section class="card config">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="server" :size="17" /></span>
      <h2>Cluster setup</h2>
    </div>

    <StepSection :num="1" title="Hardware" subtitle="Hosts and drives that make up the cluster" :summary="hardwareSummary">
      <TabGroup v-model="state.tab" :tabs="tabs" label="Topology mode" />
      <BasicTopology v-if="state.tab === 'basic'" :topology="state.basic" />
      <AdvancedTopology
        v-else-if="state.advanced"
        v-model="state.advanced"
        @reset-from-basic="emit('resetFromBasic')"
        @example-loaded="applyExample"
      />
    </StepSection>

    <StepSection :num="2" collapsed-by-default title="Redundancy" subtitle="How copies or chunks are stored and spread" :summary="redundancySummary">
      <div class="stack">
        <label class="select-field">
          <span class="label">Spread across</span>
          <select v-model="state.failureDomain">
            <option v-for="t in domainOptions" :key="t" :value="t">{{ plural(t) }} — CRUSH type {{ TYPE_ID[t] }}</option>
          </select>
          <span class="hint">No two copies of an object share the same {{ plural(domain, 1) }}</span>
        </label>

        <label class="select-field">
          <span class="label">Pool layout</span>
          <select :value="selection" @change="onSchemeSelect">
            <optgroup label="Replicated">
              <option v-for="p in PRESETS.filter((p) => p.scheme.kind === 'replicated')" :key="p.id" :value="p.id">
                {{ p.label }}{{ p.id === DEFAULT_PRESET_ID ? ' · Ceph default' : '' }}
              </option>
              <option :value="CUSTOM_REPLICATED">Custom replication…</option>
            </optgroup>
            <optgroup label="Erasure coded">
              <option v-for="p in PRESETS.filter((p) => p.scheme.kind === 'ec')" :key="p.id" :value="p.id">
                {{ p.label }}
              </option>
              <option :value="CUSTOM_EC">Custom EC profile…</option>
            </optgroup>
          </select>
        </label>

        <div class="params">
          <template v-if="state.scheme.kind === 'replicated'">
            <NumberField v-model="state.scheme.size" label="size" hint="Copies kept of every object" :min="1" :max="10" />
            <NumberField
              v-model="state.scheme.minSize"
              label="min_size"
              hint="Copies needed to keep serving I/O"
              :min="1"
              :max="state.scheme.size"
            />
          </template>
          <template v-else>
            <NumberField v-model="state.scheme.k" label="k" hint="Data chunks per object" :min="2" :max="32" />
            <NumberField v-model="state.scheme.m" label="m" hint="Parity chunks per object" :min="1" :max="16" />
            <NumberField
              v-model="ecMinSize"
              label="min_size"
              hint="Shards needed to keep serving I/O"
              :default-value="defaultEcMinSize(state.scheme.k, state.scheme.m)"
              :min="state.scheme.k"
              :max="state.scheme.k + state.scheme.m"
            />
            <p class="note">
              Ceph default: min_size = k + min(1, m − 1) = {{ defaultEcMinSize(state.scheme.k, state.scheme.m) }}
            </p>
          </template>
        </div>
      </div>
    </StepSection>

    <StepSection :num="3" collapsed-by-default title="Headroom" subtitle="Space kept free so the cluster stays healthy" :summary="headroomSummary">
      <div class="stack">
        <div class="reserve-field">
          <NumberField
            v-model="state.recoveryReserve"
            label="Recovery reserve"
            :hint="`Free space to recover the data of this many failed ${plural(domain)}.`"
            :min="0"
            :max="Math.max(0, spareDomains)"
          >
            <template #label-after>
              <FaqLink :target="FAQ_IDS.recoveryReserve" topic="the recovery reserve" />
            </template>
          </NumberField>
          <p class="spare" :class="{ bad: spareDomains < 0 || state.recoveryReserve > spareDomains }">
            <template v-if="spareDomains >= 0">
              {{ domainCount }} {{ plural(domain, domainCount) }} − {{ width }} {{ pieces }} per object =
              <strong>{{ spareDomains }} spare</strong> for placement, so the reserve can be at most
              {{ spareDomains }}.
            </template>
            <template v-else>
              {{ domainCount }} {{ plural(domain, domainCount) }}, but {{ width }} {{ pieces }} per object need
              {{ width }} {{ plural(domain, width) }}: this layout cannot be placed.
            </template>
          </p>
        </div>
        <div class="ratios">
          <NumberField
            v-model="state.nearfullRatio"
            @commit="linkRatio('nearfullRatio')"
            label="Nearfull ratio"
            hint="Planning limit: get a warning when reaching nearfull"
            :default-value="DEFAULT_RATIOS.nearfull"
            :min="0"
            :max="1"
            :step="0.01"
            :decimals="2"
            :integer="false"
          >
            <template #label-suffix><RatioMarker kind="nearfull" :size="11" /></template>
          </NumberField>
          <NumberField
            v-model="state.backfillfullRatio"
            @commit="linkRatio('backfillfullRatio')"
            label="Backfillfull ratio"
            hint="Recovery and backfill stop above this"
            :default-value="DEFAULT_RATIOS.backfillfull"
            :min="0"
            :max="1"
            :step="0.01"
            :decimals="2"
            :integer="false"
          >
            <template #label-suffix><RatioMarker kind="backfillfull" :size="11" /></template>
          </NumberField>
          <NumberField
            v-model="state.fullRatio"
            @commit="linkRatio('fullRatio')"
            label="Full ratio"
            hint="Hard limit: OSDs refuse writes above this"
            :default-value="DEFAULT_RATIOS.full"
            :min="0"
            :max="1"
            :step="0.01"
            :decimals="2"
            :integer="false"
          >
            <template #label-suffix><RatioMarker kind="full" :size="11" /></template>
          </NumberField>
          <p v-if="!ratiosOrdered(state)" class="ratio-error">
            Ceph requires nearfull ≤ backfillfull ≤ full.
          </p>
        </div>
      </div>
    </StepSection>

    <StepSection :num="4" collapsed-by-default title="Pool configuration" subtitle="Names and pool options used to create the pool" :summary="poolSummary">
      <PoolConfig
        :pool="state.pool"
        :scheme="state.scheme"
        :domain="state.failureDomain"
        :osd-count="poolOsdCount"
        :tree-classes="treeClasses"
      />
    </StepSection>

    <StepSection :num="5" collapsed-by-default title="Miscellaneous" subtitle="Optional: drive price, IOPS and a virtual CRUSH map" :summary="miscSummary">
      <div class="misc-group">
        <h4>Price</h4>
        <NumberField
          v-model="state.pricePerTB"
          label="Price per TB"
          hint="Raw drive capacity, decimal TB. Click the currency to change it."
          :min="0"
          :max="1000000"
          :step="10"
          :precision="2"
          :integer="false"
          blank-zero
        >
          <template #unit>
            <input
              v-model.trim="state.currency"
              class="currency"
              type="text"
              :maxlength="CURRENCY_MAX_LENGTH"
              aria-label="Currency"
              title="Currency: any text, e.g. €, $, EUR, USD"
              autocomplete="off"
              spellcheck="false"
            />
          </template>
        </NumberField>
      </div>

      <div class="misc-group">
        <h4>IOPS</h4>
        <label class="select-field">
          <span class="label">Client I/O size</span>
          <select v-model.number="state.ioSizeKiB">
            <option v-for="kib in IO_SIZES_KIB" :key="kib" :value="kib">{{ ioSizeLabel(kib) }} random I/O</option>
          </select>
          <span class="hint">Size of each client request; enter the per-OSD IOPS for this size</span>
        </label>
        <NumberField
          v-model="state.osdReadIops"
          label="Read IOPS"
          :hint="`${ioSizeLabel(state.ioSizeKiB)} random reads one OSD sustains`"
          :min="0"
          :max="MAX_OSD_IOPS"
          :step="100"
          blank-zero
        >
          <template #label-after>
            <FaqLink :target="FAQ_IDS.iops" topic="the IOPS estimate" />
          </template>
        </NumberField>
        <NumberField
          v-model="state.osdWriteIops"
          label="Write IOPS"
          :hint="`${ioSizeLabel(state.ioSizeKiB)} random writes one OSD sustains`"
          :min="0"
          :max="MAX_OSD_IOPS"
          :step="100"
          blank-zero
        />
        <p class="measure">
          Measure on the OSD itself with this block size (e.g. fio with
          <code>bs={{ ioSizeLabel(state.ioSizeKiB).toLowerCase() }}</code> against an OSD, or
          <code>ceph tell osd.N bench</code> for writes), so BlueStore overhead is included. Leave both empty to hide the
          estimate.
        </p>
      </div>

      <div class="misc-group">
        <h4>CRUSH map</h4>
        <ToggleField
          v-model="state.crushMap"
          label="Create virtual CRUSH map"
          hint="Shows how ceph osd crush tree would list this configuration."
        />
      </div>
    </StepSection>
  </section>
</template>

<style lang="scss" scoped>
.config {
  padding-bottom: 0.4rem;
}

.tabs {
  margin-bottom: 1rem;
}

.stack {
  display: grid;
  gap: 0.9rem;
}

.params {
  display: grid;
  gap: 0.8rem;
  padding: 0.85rem;
  border-radius: $radius;
  background: var(--panel-alt);
  border: 1px dashed var(--border-strong);
}

.select-field {
  display: grid;
  gap: 0.35rem;

  .label {
    font-weight: 500;
  }

  .hint {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  select {
    width: 100%;
    border-color: var(--border);
  }
}

.misc-group {
  display: grid;
  gap: 0.8rem;

  & + & {
    margin-top: 1.1rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--border-strong);
  }

  h4 {
    margin: 0;
    font-family: $font-display;
    font-size: 0.86rem;
    font-weight: 700;
    color: var(--text-muted);
  }
}

.currency {
  width: 2.5rem;
  min-height: 0;
  height: 1.6rem;
  padding: 0 0.25rem;
  border: 0;
  border-bottom: 1px dashed var(--border-strong);
  border-radius: 0;
  background: transparent;
  font-family: $font-mono;
  font-size: 0.72rem;
  color: var(--text-muted);
  text-align: left;

  &:hover {
    border-bottom-color: var(--accent);
  }

  &:focus {
    box-shadow: none;
    border-bottom: 1px solid var(--accent);
    color: var(--text);
  }

  @include touch {
    min-height: 0;
  }
}

.reserve-field {
  display: grid;
  gap: 0.45rem;
}

.spare {
  margin: 0;
  padding: 0.5rem 0.7rem;
  border-radius: $radius-sm;
  background: var(--panel-alt);
  border: 1px solid var(--border);
  font-size: 0.78rem;
  color: var(--text-muted);

  strong {
    color: var(--accent-text);
    font-weight: 600;
  }

  &.bad {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, transparent);

    strong {
      color: inherit;
    }
  }
}

.ratios {
  display: grid;
  gap: 0.8rem;
  padding-top: 0.9rem;
  border-top: 1px dashed var(--border-strong);
}

.measure {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-muted);

  code {
    font-family: $font-mono;
    font-size: 0.95em;
  }
}

.ratio-error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8rem;
}

.note {
  margin: 0;
  color: var(--text-muted);
  font-family: $font-mono;
  font-size: 0.76rem;
}

</style>
