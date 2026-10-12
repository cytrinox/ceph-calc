<script setup lang="ts">
import { computed, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import DeviceClassSelect from './DeviceClassSelect.vue'
import NumberField from './NumberField.vue'
import SelectField from './SelectField.vue'
import TextField from './TextField.vue'
import ToggleField from './ToggleField.vue'
import type { Scheme } from '@/lib/ceph'
import { formatTB } from '@/lib/format'
import {
  DEFAULT_COMPRESSION_RATIO,
  defaultProfileName,
  defaultRuleName,
  isValidName,
  M2_ONLY_TECHNIQUES,
  poolIssues,
  STRIPE_UNITS_KIB,
  TECHNIQUES_BY_PLUGIN,
  usesPgNum,
  DEFAULT_POOL_PG_NUM,
  type Application,
  type AutoscaleMode,
  type CompressionAlgorithm,
  type CompressionMode,
  type EcPlugin,
  type EcTechnique,
  type PoolOptions,
} from '@/lib/pool'
import { OSD_CLASSES, sortDeviceClasses, type DomainType } from '@/lib/topology'

const props = defineProps<{
  pool: PoolOptions
  scheme: Scheme
  domain: DomainType
  /** Device classes used in the Advanced tree (custom ones become selectable). */
  treeClasses: string[]
}>()

const applications: { value: Application; label: string }[] = [
  { value: 'rbd', label: 'RBD (block)' },
  { value: 'cephfs', label: 'CephFS (file)' },
  { value: 'rgw', label: 'RGW (object)' },
  { value: 'none', label: 'None / custom' },
]

const deviceClasses = computed(() => sortDeviceClasses([...OSD_CLASSES, ...props.treeClasses]))

const plugins: { value: EcPlugin; label: string }[] = [
  { value: 'jerasure', label: 'jerasure' },
  { value: 'isa', label: 'isa (ISA-L)' },
  { value: 'clay', label: 'clay' },
]

const techniques = computed<{ value: EcTechnique; label: string }[]>(() =>
  TECHNIQUES_BY_PLUGIN[props.pool.ecPlugin].map((t) => ({
    value: t,
    label: t === 'reed_sol_van' ? `${t} (default)` : M2_ONLY_TECHNIQUES.includes(t) ? `${t} (m=2)` : t,
  })),
)

// Switching plugin resets a technique the new plugin does not support.
watch(
  () => props.pool.ecPlugin,
  (plugin) => {
    if (!TECHNIQUES_BY_PLUGIN[plugin].includes(props.pool.ecTechnique)) props.pool.ecTechnique = 'reed_sol_van'
  },
)

const stripeUnits = STRIPE_UNITS_KIB.map((kib) => ({
  value: String(kib),
  label: kib >= 1024 ? `${kib / 1024} MiB` : `${kib} KiB`,
}))

const stripeUnit = computed({
  get: () => String(props.pool.stripeUnitKiB),
  set: (v: string) => {
    props.pool.stripeUnitKiB = Number(v)
  },
})

const autoscaleModes: { value: AutoscaleMode; label: string }[] = [
  { value: 'on', label: 'on: manage the number of PGs' },
  { value: 'warn', label: 'warn: only report' },
  { value: 'off', label: 'off: fixed number of PGs' },
]

const compressionModes: { value: CompressionMode; label: string }[] = [
  { value: 'none', label: 'none' },
  { value: 'passive', label: 'passive (if hinted)' },
  { value: 'aggressive', label: 'aggressive (unless hinted)' },
  { value: 'force', label: 'force (always)' },
]

const compressionAlgorithms: { value: CompressionAlgorithm; label: string }[] = [
  { value: 'snappy', label: 'snappy' },
  { value: 'lz4', label: 'lz4' },
  { value: 'zstd', label: 'zstd' },
  { value: 'zlib', label: 'zlib' },
]

const isEc = computed(() => props.scheme.kind === 'ec')
const ruleDefault = computed(() => defaultRuleName(props.scheme, props.domain, props.pool.deviceClass))
const profileDefault = computed(() => defaultProfileName(props.scheme, props.domain, props.pool.deviceClass))
const issues = computed(() => poolIssues(props.pool, props.scheme))

const pgSummary = computed(() => {
  const p = props.pool
  if (p.autoscaleMode === 'off') return `${p.pgNum} PGs`
  const target =
    p.targetSizeRatio > 0 ? ` · ratio ${p.targetSizeRatio.toFixed(2)}` : p.targetSizeTB > 0 ? ` · ${formatTB(p.targetSizeTB)}` : ''
  return `autoscale ${p.autoscaleMode}${p.autoscaleMode === 'warn' ? ` · ${p.pgNum} PGs` : ''}${target}`
})
const compressionSummary = computed(() =>
  props.pool.compressionMode === 'none'
    ? 'off'
    : `${props.pool.compressionMode} · ${props.pool.compressionAlgorithm} · ~${props.pool.compressionRatio.toFixed(2)}`,
)
const safetySummary = computed(() => {
  const parts: string[] = []
  if (props.pool.quotaMaxTB > 0 || props.pool.quotaMaxObjects > 0) parts.push('quota')
  if (props.pool.noDelete) parts.push('nodelete')
  if (props.pool.noSizeChange) parts.push('nosizechange')
  return parts.length ? parts.join(' · ') : 'none'
})
</script>

<template>
  <div class="pool">
    <div class="pair">
      <TextField
        v-model="pool.name"
        label="Pool name"
        placeholder="data"
        :invalid="!isValidName(pool.name)"
      />
      <SelectField v-model="pool.application" label="Application" :options="applications" />
    </div>

    <div class="pair">
      <TextField
        v-model="pool.crushRule"
        label="CRUSH rule"
        :placeholder="ruleDefault"
        :invalid="!!pool.crushRule && !isValidName(pool.crushRule)"
      />
      <DeviceClassSelect v-model="pool.deviceClass" label="Device class" any-label="Any device" :classes="deviceClasses" />
    </div>
    <p class="hint">
      The rule places one {{ isEc ? 'chunk' : 'copy' }} per {{ domain }} under root <code>default</code>. Leave
      the name empty to use <code>{{ ruleDefault }}</code>.
    </p>

    <template v-if="isEc">
      <div class="pair wide-first">
        <TextField
          v-model="pool.ecProfile"
          label="EC profile"
          :placeholder="profileDefault"
          :invalid="!!pool.ecProfile && !isValidName(pool.ecProfile)"
        />
        <SelectField v-model="pool.ecPlugin" label="Plugin" :options="plugins" />
      </div>
      <div class="pair wide-first">
        <SelectField v-model="pool.ecTechnique" label="Technique" :options="techniques" />
        <SelectField v-model="stripeUnit" label="stripe_unit" :options="stripeUnits" />
      </div>
      <ToggleField
        v-model="pool.ecOverwrites"
        label="Partial overwrites"
        code="allow_ec_overwrites"
        hint="Required for RBD and CephFS data on EC pools"
      />
      <ToggleField
        v-model="pool.fastRead"
        label="Fast read"
        code="fast_read"
        hint="Read all shards, decode from the first k replies: lower latency, more traffic"
      />
      <ToggleField
        v-model="pool.ecOptimizations"
        label="EC optimizations"
        code="allow_ec_optimizations"
        hint="Partial reads and writes for small I/O; Ceph Tentacle or later, cannot be disabled"
      />
    </template>

    <details class="group">
      <summary>
        <AppIcon name="chevron" :size="14" class="caret" />
        <span class="title">Placement groups</span>
        <span class="state">{{ pgSummary }}</span>
      </summary>
      <div class="group-body">
        <SelectField v-model="pool.autoscaleMode" label="PG autoscaler" :options="autoscaleModes" />
        <!-- Off: the pool keeps its pg_num; warn: the autoscaler only reports, so the pool needs one too. -->
        <NumberField
          v-if="usesPgNum(pool)"
          v-model="pool.pgNum"
          label="Number of PGs"
          :default-value="DEFAULT_POOL_PG_NUM"
          :min="1"
          :max="32768"
          pow2
        />
        <template v-if="pool.autoscaleMode !== 'off'">
          <ToggleField
            v-model="pool.bulk"
            label="Bulk pool"
            code="bulk"
            hint="Start with many PGs; for pools that will hold most data"
          />
          <NumberField
            v-model="pool.targetSizeRatio"
            label="Target size ratio"
            hint="Expected share of cluster capacity (0 = unset)"
            :min="0"
            :max="1"
            :step="0.05"
            :decimals="2"
            :integer="false"
          />
          <NumberField
            v-model="pool.targetSizeTB"
            label="Target size"
            hint="Expected pool size, sets target_size_bytes (0 = unset; ratio wins if both are set)"
            unit="TB"
            :min="0"
            :max="1000000"
            :step="1"
            :integer="false"
          />
        </template>
      </div>
    </details>

    <details class="group">
      <summary>
        <AppIcon name="chevron" :size="14" class="caret" />
        <span class="title">Compression</span>
        <span class="state">{{ compressionSummary }}</span>
      </summary>
      <div class="group-body">
        <SelectField v-model="pool.compressionMode" label="Mode" :options="compressionModes" />
        <template v-if="pool.compressionMode !== 'none'">
          <SelectField v-model="pool.compressionAlgorithm" label="Algorithm" :options="compressionAlgorithms" />
          <NumberField
            v-model="pool.compressionRatio"
            label="Compression ratio"
            hint="Expected compressed ÷ original size; 0.90 = 10% saved"
            :min="0.05"
            :max="1"
            :step="0.05"
            :decimals="2"
            :integer="false"
            :default-value="DEFAULT_COMPRESSION_RATIO"
          />
        </template>
      </div>
    </details>

    <details class="group">
      <summary>
        <AppIcon name="chevron" :size="14" class="caret" />
        <span class="title">Quotas &amp; safety flags</span>
        <span class="state">{{ safetySummary }}</span>
      </summary>
      <div class="group-body">
        <NumberField
          v-model="pool.quotaMaxTB"
          label="Max bytes"
          hint="0 = unlimited"
          unit="TB"
          :min="0"
          :max="1000000"
          :step="1"
          :integer="false"
        />
        <NumberField
          v-model="pool.quotaMaxObjects"
          label="Max objects"
          hint="0 = unlimited"
          :min="0"
          :max="1e12"
          :step="1000"
        />
        <ToggleField v-model="pool.noDelete" label="Protect from deletion" code="nodelete" />
        <ToggleField v-model="pool.noSizeChange" label="Lock size / min_size" code="nosizechange" />
      </div>
    </details>

    <ul v-if="issues.length" class="issues">
      <li v-for="i in issues" :key="i"><AppIcon name="alert" :size="13" /> {{ i }}</li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
.pool {
  display: grid;
  gap: 0.9rem;
}

.pair {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  // A field that grows (the device class with its custom name) doesn't stretch its neighbour.
  align-items: start;
}

.pair.wide-first {
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
}

.hint {
  margin: -0.4rem 0 0;
  color: var(--text-muted);
  font-size: 0.78rem;

  code {
    font-family: $font-mono;
    font-size: 0.74rem;
    color: var(--accent-text);
  }
}

.group {
  border: 1px solid var(--border);
  border-radius: $radius;
  background: var(--panel-alt);

  summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 0.85rem;
    cursor: pointer;
    list-style: none;
    min-height: 44px;

    &::-webkit-details-marker {
      display: none;
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: -2px;
      border-radius: $radius;
    }
  }

  .caret {
    color: var(--text-muted);
    transition: transform 0.15s;
  }

  &[open] .caret {
    transform: rotate(90deg);
  }

  .title {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .state {
    margin-left: auto;
    font-family: $font-mono;
    font-size: 0.74rem;
    color: var(--text-faint);
    text-align: right;
  }
}

.group-body {
  display: grid;
  gap: 0.85rem;
  padding: 0.2rem 0.85rem 0.9rem;
}

.issues {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
  font-size: 0.8rem;
  color: var(--warning);

  li {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;

    svg {
      flex: 0 0 auto;
      margin-top: 0.2rem;
    }
  }
}
</style>
