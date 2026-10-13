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
import {
  BASIC_IOPS,
  DEFAULT_OBJECT_SIZE_KIB,
  IO_SIZES_KIB,
  MAX_OSD_IOPS,
  OBJECT_SIZES_KIB,
  ioSizeLabel,
  type OsdIops,
} from '@/lib/iops'
import { CURRENCY_MAX_LENGTH, formatPrice } from '@/lib/pricing'
import { DEFAULT_PG_TARGET_PER_OSD, MAX_PG_TARGET_PER_OSD } from '@/lib/pool'
import { DEFAULT_OSD_CLASS, TYPE_ID, plural, type DomainType, type TopologyExample } from '@/lib/topology'
import { defaultState, encodeState, type AppState, type TopologyTab } from '@/lib/urlState'

const props = defineProps<{
  state: AppState
  domainOptions: DomainType[]
  osdCount: number
  /** Device classes used in the Advanced tree. */
  treeClasses: string[]
  /** Device classes of the hardware (Basic: the rule's class or ssd): one IOPS tab each. */
  iopsClasses: string[]
  /** Failure domains in the topology. */
  domainCount: number
  /** Copies / shards per object. */
  width: number
}>()
const emit = defineEmits<{ resetFromBasic: []; reset: [] }>()

// Everything back to the first-visit defaults. The configuration lives only in the URL (replaced, not pushed), so
// there is no undo: ask first. Viewer preferences (theme, unit, open steps) stay.
const isDefault = computed(() => encodeState(props.state) === encodeState(defaultState()))
function reset() {
  const question =
    'Reset the cluster setup to the defaults? This replaces the hardware (including the Advanced tree), ' +
    'redundancy, headroom and pool settings, the price, the IOPS and the CRUSH map switch.'
  if (confirm(question)) emit('reset')
}

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
  // stripe_unit belongs to the EC profile, so it only shows for EC pools.
  const stripeUnit = props.state.scheme.kind === 'ec' ? [`stripe_unit ${ioSizeLabel(pool.stripeUnitKiB)}`] : []
  return [pool.name || 'data', pool.application, ...stripeUnit, `autoscale ${pool.autoscaleMode}`].join(' · ')
})
const miscSummary = computed(() => {
  const st = props.state
  const value = (n: number) => (n > 0 ? formatIops(n) : '—')
  const price = st.pricePerTB > 0 ? `${formatPrice(st.pricePerTB, st.currency)}/TB` : 'no price'
  // Basic: one class-less set ("read 200 · write 150"); Advanced: per class ("ssd 50K / 20K · hdd 200 / 150").
  const basic = st.tab === 'basic'
  const set = basic ? [BASIC_IOPS].filter((key) => st.osdIops[key]) : props.iopsClasses.filter((cls) => st.osdIops[cls])
  const values = (key: string) =>
    basic
      ? `read ${value(st.osdIops[key].read)} · write ${value(st.osdIops[key].write)}`
      : `${key} ${value(st.osdIops[key].read)} / ${value(st.osdIops[key].write)}`
  const objects = st.objectSizeKiB !== DEFAULT_OBJECT_SIZE_KIB ? ` · ${ioSizeLabel(st.objectSizeKiB)} objects` : ''
  const iops = set.length
    ? `${ioSizeLabel(st.ioSizeKiB)} · ${set.map(values).join(' · ')} IOPS per OSD${objects}`
    : 'no IOPS'
  const pgTarget = st.pgTargetPerOsd !== DEFAULT_PG_TARGET_PER_OSD ? [`PG target ${formatInt(st.pgTargetPerOsd)}`] : []
  return [price, iops, ...pgTarget, ...(st.crushMap ? ['CRUSH map'] : [])].join(' · ')
})

// Per-OSD IOPS, one tab per device class of the Advanced tree; the Basic tab has one set without a class (no tabs).
// A class without values has no entry, so links stay short.
const iopsTab = ref('')
const iopsClass = computed({
  get: () => {
    if (props.state.tab === 'basic') return BASIC_IOPS
    return props.iopsClasses.includes(iopsTab.value) ? iopsTab.value : (props.iopsClasses[0] ?? DEFAULT_OSD_CLASS)
  },
  set: (cls: string) => (iopsTab.value = cls),
})
// "one OSD" on the Basic tab, "one hdd OSD" on the Advanced tab.
const iopsOsd = computed(() => (iopsClass.value === BASIC_IOPS ? 'one OSD' : `one ${iopsClass.value} OSD`))
const iopsTabs = computed(() =>
  props.iopsClasses.map((cls) => {
    const osd = props.state.osdIops[cls]
    const value = (n: number) => (n > 0 ? formatIops(n) : '—')
    return { value: cls, label: cls, hint: osd ? `${value(osd.read)} / ${value(osd.write)}` : 'not set' }
  }),
)
// The rule only uses its class (Advanced tab); the other tabs don't count for this pool.
const iopsClassUnused = computed(() => {
  const rule = props.state.tab === 'advanced' ? props.state.pool.deviceClass : ''
  return rule !== '' && iopsClass.value !== rule ? rule : null
})

function iopsField(op: keyof OsdIops) {
  return computed({
    get: () => props.state.osdIops[iopsClass.value]?.[op] ?? 0,
    set: (value: number) => {
      const cls = iopsClass.value
      const current = props.state.osdIops[cls] ?? { read: 0, write: 0 }
      const next = { ...current, [op]: value }
      if (next.read > 0 || next.write > 0) props.state.osdIops[cls] = next
      else delete props.state.osdIops[cls]
    },
  })
}
const readIops = iopsField('read')
const writeIops = iopsField('write')

/** Failure domains beyond what one object needs: the most the recovery reserve can cover. */
const spareDomains = computed(() => props.domainCount - props.width)
const pieces = computed(() => (props.state.scheme.kind === 'ec' ? 'shards' : 'copies'))
</script>

<template>
  <section class="card config">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="server" :size="17" /></span>
      <h2>Cluster setup</h2>
      <div class="aside">
        <button
          type="button"
          class="btn"
          :disabled="isDefault"
          :title="isDefault ? 'All settings are at their defaults' : 'Reset all settings to the defaults'"
          aria-label="Reset all settings to the defaults"
          @click="reset"
        >
          <AppIcon name="reset" :size="15" />
        </button>
      </div>
    </div>

    <StepSection :num="1" title="Hardware" subtitle="Hosts and drives that make up the cluster" :summary="hardwareSummary">
      <TabGroup v-model="state.tab" class="topology-tabs" :tabs="tabs" label="Topology mode" />
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
            Ceph expects nearfull ≤ backfillfull ≤ full; other orders give HEALTH_ERR (OSD_OUT_OF_ORDER_FULL).
          </p>
        </div>
      </div>
    </StepSection>

    <StepSection :num="4" collapsed-by-default title="Pool configuration" subtitle="Names and pool options used to create the pool" :summary="poolSummary">
      <PoolConfig
        :pool="state.pool"
        :scheme="state.scheme"
        :domain="state.failureDomain"
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
        <TabGroup v-if="state.tab === 'advanced'" v-model="iopsClass" :tabs="iopsTabs" label="Device class" />
        <p v-if="iopsClassUnused" class="unused">
          The CRUSH rule only uses {{ iopsClassUnused }} OSDs (step 4): these values don't count for this pool.
        </p>
        <NumberField
          :key="`${iopsClass}-read`"
          v-model="readIops"
          label="Read IOPS"
          :hint="`${ioSizeLabel(state.ioSizeKiB)} random reads ${iopsOsd} sustains`"
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
          :key="`${iopsClass}-write`"
          v-model="writeIops"
          label="Write IOPS"
          :hint="`${ioSizeLabel(state.ioSizeKiB)} random writes ${iopsOsd} sustains`"
          :min="0"
          :max="MAX_OSD_IOPS"
          :step="100"
          blank-zero
        />
        <p class="measure">
          Measure on the OSD itself with this block size (e.g. fio with
          <code>bs={{ ioSizeLabel(state.ioSizeKiB).toLowerCase() }}</code> against an OSD, or
          <code>ceph tell osd.N bench</code> for writes), so BlueStore overhead is included. Each device class has its
          own values (Advanced tab). Leave them all empty to hide the estimate.
        </p>
        <!-- A div, not a label: the hint holds the default link (like NumberField's). -->
        <div class="select-field">
          <label for="object-size" class="label">Object size</label>
          <select id="object-size" v-model.number="state.objectSizeKiB">
            <option v-for="kib in OBJECT_SIZES_KIB" :key="kib" :value="kib">
              {{ ioSizeLabel(kib) }}{{ kib === DEFAULT_OBJECT_SIZE_KIB ? ' · RBD and CephFS default' : '' }}
            </option>
          </select>
          <span class="hint">
            RADOS objects the data is cut into; a larger request takes one operation per object (<button
              v-if="state.objectSizeKiB !== DEFAULT_OBJECT_SIZE_KIB"
              type="button"
              class="reset"
              :title="`Reset Object size to the default ${ioSizeLabel(DEFAULT_OBJECT_SIZE_KIB)}`"
              @click="state.objectSizeKiB = DEFAULT_OBJECT_SIZE_KIB"
            >default {{ ioSizeLabel(DEFAULT_OBJECT_SIZE_KIB) }}</button><template v-else
              >default {{ ioSizeLabel(DEFAULT_OBJECT_SIZE_KIB) }}</template
            >)
          </span>
        </div>
      </div>

      <div class="misc-group">
        <h4>Placement groups</h4>
        <NumberField
          v-model="state.pgTargetPerOsd"
          label="PG target per OSD"
          hint="mon_target_pg_per_osd: PG replicas per OSD the autoscaler aims for."
          :default-value="DEFAULT_PG_TARGET_PER_OSD"
          :min="1"
          :max="MAX_PG_TARGET_PER_OSD"
          :step="10"
        />
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

// Round icon button, like the buttons in the other card heads (Copy all, Copy).
.btn {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  background: var(--panel-alt);
  color: var(--text);
  padding: 0;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }

  @include touch {
    width: 44px;
    height: 44px;
  }
}

// Basic / Advanced (step 1); the IOPS class tabs sit in a grid with its own gaps.
.topology-tabs {
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

  // "default 4M" link, like NumberField's.
  .reset {
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: var(--accent-text);
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
    cursor: pointer;

    &:hover {
      text-decoration-style: solid;
    }
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

// A tab whose class the pool's CRUSH rule doesn't use.
.unused {
  margin: 0;
  font-size: 0.78rem;
  color: var(--warning);
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
