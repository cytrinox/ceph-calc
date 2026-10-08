<script setup lang="ts">
import { computed, provide } from 'vue'
import AppIcon from './AppIcon.vue'
import BucketNode from './BucketNode.vue'
import { formatInt, formatTB } from '@/lib/format'
import {
  ALL_DOMAIN_TYPES,
  BUCKET_TYPES,
  TOPOLOGY_EXAMPLES,
  collectNames,
  newBucket,
  nextFreeName,
  plural,
  topologyStats,
  type BucketType,
  type DomainType,
  type Topology,
} from '@/lib/topology'
import { USED_NAMES_KEY } from './treeContext'

const model = defineModel<Topology>({ required: true })
const emit = defineEmits<{ resetFromBasic: []; exampleLoaded: [domain: DomainType] }>()

provide(USED_NAMES_KEY, () => collectNames(model.value))

const stats = computed(() => topologyStats(model.value))

const totals = computed(() => {
  const s = stats.value
  const parts = [...ALL_DOMAIN_TYPES]
    .reverse()
    .filter((t) => s.counts[t] > 0)
    .map((t) => `${formatInt(s.counts[t])} ${plural(t, s.counts[t])}`)
  return parts.length ? `${parts.join(' · ')} · ${formatTB(s.rawTB)} raw` : 'Empty topology'
})

function addRootBucket(event: Event) {
  const select = event.target as HTMLSelectElement
  const type = select.value as BucketType
  select.value = ''
  if (!type) return
  const last = [...model.value].reverse().find((b) => b.type === type)
  model.value.push(newBucket(type, nextFreeName(last?.name ?? `${type}0`, collectNames(model.value))))
}

function loadExample(event: Event) {
  const select = event.target as HTMLSelectElement
  const example = TOPOLOGY_EXAMPLES.find((e) => e.id === select.value)
  select.value = ''
  if (!example) return
  if (model.value.length && !confirm(`Replace the current topology with “${example.label}”?`)) return
  model.value = example.build()
  emit('exampleLoaded', example.domain)
}

function resetFromBasic() {
  if (model.value.length && !confirm('Replace the current topology with the Basic settings?')) return
  emit('resetFromBasic')
}
</script>

<template>
  <div class="advanced">
    <div class="toolbar">
      <label class="add">
        <AppIcon name="plus" :size="14" />
        <select aria-label="Add top-level bucket" value="" @change="addRootBucket">
          <option value="" disabled>Add bucket…</option>
          <option v-for="t in BUCKET_TYPES" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <button type="button" title="Rebuild from the Basic tab" @click="resetFromBasic">
        <AppIcon name="reset" :size="14" /> From Basic
      </button>
      <label class="add examples" title="Load an example topology">
        <AppIcon name="sparkle" :size="14" />
        <select aria-label="Load an example topology" value="" @change="loadExample">
          <option value="" disabled>Examples…</option>
          <option v-for="ex in TOPOLOGY_EXAMPLES" :key="ex.id" :value="ex.id">{{ ex.label }}</option>
        </select>
      </label>
    </div>

    <p class="help">
      Build the CRUSH tree with any default bucket type. Use <strong>×N</strong> for identical copies and
      <AppIcon name="copy" :size="12" /> to duplicate a bucket for individual edits.
    </p>

    <div v-if="model.length" class="tree">
      <BucketNode
        v-for="(bucket, i) in model"
        :key="bucket.id"
        :bucket="bucket"
        :siblings="model"
        :index="i"
        :depth="0"
        :parent-type="null"
      />
    </div>
    <p v-else class="empty">No buckets yet. Add a host, rack or datacenter to start.</p>

    <footer class="totals">{{ totals }}</footer>
  </div>
</template>

<style lang="scss" scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;

  button,
  .add {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--border-strong);
    border-radius: $radius-sm;
    background: var(--input-bg);
    color: var(--text);
    font-family: $font-mono;
    font-size: 0.78rem;
    padding: 0 0.65rem;
    min-height: 34px;
    cursor: pointer;

    &:hover {
      border-color: var(--accent);
      color: var(--accent-text);
    }

    @include touch {
      min-height: 44px;
    }
  }

  // The closed select is as wide as its longest option; keep the examples button compact.
  .examples select {
    width: 6.6rem;
    text-overflow: ellipsis;
  }

  .add {
    position: relative;
    color: var(--accent-text);
    padding-right: 0;

    select {
      border: 0;
      background: transparent;
      padding: 0 0.6rem 0 0;
      min-height: 32px;
      font-size: 0.78rem;
      color: inherit;
      box-shadow: none;
    }
  }
}

.help {
  margin: 0.7rem 0;
  color: var(--text-muted);
  font-size: 0.8rem;

  svg {
    vertical-align: -1px;
  }
}

.empty {
  color: var(--text-muted);
  font-size: 0.85rem;
  text-align: center;
  padding: 1.5rem 0.5rem;
  border: 1px dashed var(--border-strong);
  border-radius: $radius-sm;
}

.totals {
  margin-top: 0.75rem;
  padding-top: 0.7rem;
  border-top: 1px solid var(--border);
  font-family: $font-mono;
  font-size: 0.75rem;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
</style>
