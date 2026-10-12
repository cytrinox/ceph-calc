<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import DeviceClassSelect from './DeviceClassSelect.vue'
import MiniStepper from './MiniStepper.vue'
import { formatInt, formatTB } from '@/lib/format'
import {
  ALL_DOMAIN_TYPES,
  BUCKET_TYPES,
  OSD_CLASSES,
  SPLIT_LIMIT,
  TYPE_ID,
  bucketStats,
  childTypesFor,
  defaultChildType,
  duplicateBucket,
  int,
  newBucket,
  newOsdGroup,
  nextFreeName,
  plural,
  renameForType,
  splitBucket,
  uid,
  type Bucket,
  type BucketType,
} from '@/lib/topology'
import { DEVICE_CLASSES_KEY, USED_NAMES_KEY } from './treeContext'

const props = defineProps<{
  bucket: Bucket
  siblings: Bucket[]
  index: number
  depth: number
  parentType: BucketType | null
}>()

const usedNames = inject(USED_NAMES_KEY, () => new Set<string>())
const deviceClasses = inject(DEVICE_CLASSES_KEY, computed(() => [...OSD_CLASSES]))

const isHost = computed(() => props.bucket.type === 'host')
const open = ref(props.depth < 2 && props.bucket.children.length <= 10)

const stats = computed(() => bucketStats(props.bucket))

/** Allowed types: below the parent, above every child (hosts only without children). */
const allowedTypes = computed(() => {
  const maxChild = props.bucket.children.reduce((m, c) => Math.max(m, TYPE_ID[c.type]), 0)
  return childTypesFor(props.parentType).filter((t) => {
    if (t === 'host') return props.bucket.children.length === 0
    return TYPE_ID[t] > maxChild
  })
})

const summary = computed(() => {
  const s = stats.value
  const parts = ALL_DOMAIN_TYPES.filter((t) => TYPE_ID[t] < TYPE_ID[props.bucket.type] && s.counts[t] > 0)
    .reverse()
    .map((t) => `${formatInt(s.counts[t])} ${plural(t, s.counts[t])}`)
  return [...parts, formatTB(s.rawTB)].join(' · ')
})

const total = computed(() => {
  const n = int(props.bucket.count)
  return n > 1 ? `×${formatInt(n)} = ${formatTB(stats.value.rawTB * n)}` : ''
})

function changeType(event: Event) {
  const type = (event.target as HTMLSelectElement).value as BucketType
  // A generated name like room1-row1 follows the new type (room1-host1); a name of your own stays.
  props.bucket.name = renameForType(props.bucket.name, props.bucket.type, type, usedNames())
  props.bucket.type = type
  if (type === 'host' && props.bucket.osds.length === 0) props.bucket.osds.push(newOsdGroup())
}

function addChild() {
  const b = props.bucket
  const last = b.children[b.children.length - 1]
  const type = last?.type ?? defaultChildType(b.type) ?? 'host'
  const name = nextFreeName(last?.name ?? `${b.name}-${type}0`, usedNames())
  b.children.push(newBucket(type, name))
  open.value = true
}

function duplicate() {
  duplicateBucket(props.siblings, props.index, usedNames())
}

function split() {
  const n = int(props.bucket.count)
  const type = props.bucket.type
  if (n > SPLIT_LIMIT) {
    const rest = n - (SPLIT_LIMIT - 1)
    const question =
      `Split into ${formatInt(SPLIT_LIMIT - 1)} individual ${plural(type)} plus one ${type} ×${formatInt(rest)}? ` +
      `(splitting creates at most ${formatInt(SPLIT_LIMIT)} entries)`
    if (!confirm(question)) return
  } else if (n > 50 && !confirm(`Create ${formatInt(n)} individual ${plural(type, n)}?`)) {
    return
  }
  splitBucket(props.siblings, props.index, usedNames())
}

function remove() {
  const hasContent = props.bucket.children.length > 0
  if (hasContent && !confirm(`Remove ${props.bucket.name} and everything inside it?`)) return
  props.siblings.splice(props.index, 1)
}

function addOsdGroup() {
  const last = props.bucket.osds[props.bucket.osds.length - 1]
  props.bucket.osds.push(last ? { ...last, id: uid() } : newOsdGroup())
  open.value = true
}

function duplicateOsdGroup(i: number) {
  props.bucket.osds.splice(i + 1, 0, { ...props.bucket.osds[i], id: uid() })
}

function removeOsdGroup(i: number) {
  props.bucket.osds.splice(i, 1)
}

const hasBody = computed(() => (isHost.value ? true : props.bucket.children.length > 0))
</script>

<template>
  <div class="node" :class="{ host: isHost }">
    <div class="head">
      <button
        type="button"
        class="chevron"
        :class="{ open, hidden: !hasBody }"
        :aria-expanded="open"
        :aria-label="open ? 'Collapse' : 'Expand'"
        @click="open = !open"
      >
        <AppIcon name="chevron" :size="14" />
      </button>
      <select class="type" :value="bucket.type" aria-label="Bucket type" @change="changeType">
        <option v-for="t in BUCKET_TYPES" :key="t" :value="t" :disabled="!allowedTypes.includes(t)">
          {{ t }}
        </option>
      </select>
      <input v-model="bucket.name" class="name" aria-label="Bucket name" spellcheck="false" />
      <span class="count" title="Number of identical copies">
        <span>×</span>
        <MiniStepper v-model="bucket.count" label="Copies" />
      </span>
    </div>

    <div class="meta">
      <span class="summary">
        {{ summary }}<span v-if="total" class="total"> · {{ total }}</span>
      </span>
      <div class="actions">
        <button v-if="!isHost" type="button" title="Add child bucket" aria-label="Add child bucket" @click="addChild">
          <AppIcon name="plus" />
        </button>
        <button type="button" title="Duplicate" aria-label="Duplicate" @click="duplicate">
          <AppIcon name="copy" />
        </button>
        <button
          v-if="int(bucket.count) > 1"
          type="button"
          title="Split into individual copies"
          aria-label="Split into individual copies"
          @click="split"
        >
          <AppIcon name="split" />
        </button>
        <button type="button" class="danger" title="Remove" aria-label="Remove" @click="remove">
          <AppIcon name="trash" />
        </button>
      </div>
    </div>

    <div v-if="open && hasBody" class="body">
      <template v-if="isHost">
        <div v-for="(osd, i) in bucket.osds" :key="osd.id" class="osd">
          <span class="osd-label">OSD</span>
          <MiniStepper v-model="osd.count" label="OSD count" />
          <span class="times">×</span>
          <MiniStepper v-model="osd.sizeTB" label="OSD size in TB" unit="TB" :integer="false" snap width="3.4rem" />
          <DeviceClassSelect v-model="osd.deviceClass" label="Device class" :classes="deviceClasses" compact />
          <div class="actions">
            <button type="button" title="Duplicate OSD group" aria-label="Duplicate OSD group" @click="duplicateOsdGroup(i)">
              <AppIcon name="copy" />
            </button>
            <button type="button" class="danger" title="Remove OSD group" aria-label="Remove OSD group" @click="removeOsdGroup(i)">
              <AppIcon name="trash" />
            </button>
          </div>
        </div>
        <button type="button" class="link" @click="addOsdGroup"><AppIcon name="plus" :size="14" /> OSD group</button>
      </template>
      <template v-else>
        <BucketNode
          v-for="(child, i) in bucket.children"
          :key="child.id"
          :bucket="child"
          :siblings="bucket.children"
          :index="i"
          :depth="depth + 1"
          :parent-type="bucket.type"
        />
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.node {
  container: bucket / inline-size;
  border: 1px solid var(--border);
  border-radius: $radius-sm + 2px;
  background: var(--panel-alt);
  padding: 0.5rem 0.55rem 0.45rem;
  min-width: 0;

  & + & {
    margin-top: 0.45rem;
  }

  // Nested cards are tighter so deep trees (up to 10 bucket levels) keep usable inputs.
  & & {
    padding: 0.4rem 0.35rem 0.35rem;
  }
}

.head {
  display: grid;
  grid-template-columns: auto minmax(5.4rem, 7.2rem) minmax(3.5rem, 1fr) auto;
  gap: 0.4rem;
  align-items: center;

  input,
  select {
    min-height: 34px;
    padding: 0.3rem 0.5rem;
    font-size: 0.86rem;

    @include touch {
      min-height: 44px;
    }
  }
}

.chevron {
  display: grid;
  place-items: center;
  width: 26px;
  height: 34px;
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: $radius-sm;

  svg {
    transition: transform 0.15s;
  }

  &.open svg {
    transform: rotate(90deg);
  }

  &.hidden {
    visibility: hidden;
  }

  @include touch {
    width: 32px;
    height: 44px;
  }
}

.type {
  color: var(--accent-text);
  width: 100%;
  min-width: 0;
}

.name {
  min-width: 0;
  width: 100%;
  font-family: $font-mono;
}

.count {
  display: flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--text-muted);
  font-family: $font-mono;

}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0.3rem 0 0 calc(26px + 0.4rem);
  min-width: 0;
}

.summary {
  color: var(--text-muted);
  font-family: $font-mono;
  font-size: 0.75rem;
  min-width: 0;
  overflow-wrap: anywhere;
}

.total {
  color: var(--text);
}

.actions {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;

  button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: $radius-sm;
    background: none;
    color: var(--text-muted);
    cursor: pointer;

    &:hover {
      background: var(--accent-soft);
      color: var(--accent-text);
    }

    &.danger:hover {
      background: color-mix(in srgb, var(--danger) 14%, transparent);
      color: var(--danger);
    }

    @include touch {
      width: 44px;
      height: 44px;
    }
  }
}

.body {
  margin: 0.45rem 0 0.1rem 4px;
  padding-left: 0.3rem;
  border-left: 1px dashed var(--border-strong);
}

.osd {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.35rem;
  flex-wrap: wrap;

  .actions {
    margin-left: auto;
  }
}

.osd-label,
.times {
  font-family: $font-mono;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  border: 0;
  background: none;
  color: var(--accent-text);
  font-family: $font-mono;
  font-size: 0.78rem;
  padding: 0.3rem 0.2rem;
  cursor: pointer;
  min-height: 32px;

  @include touch {
    min-height: 44px;
  }
}

// Narrow cards (deep nesting, phones): type and count on the first line, the name on its own
// full-width line below. Each card is its own container, so this adapts per nesting level.
@container bucket (max-width: 320px) {
  .head {
    grid-template-columns: auto minmax(0, 1fr) auto;

    .name {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }

  .meta {
    margin-left: 0;
    flex-wrap: wrap;
  }
}

// Very narrow cards (deepest levels on phones): type, name and count each get their own line.
@container bucket (max-width: 240px) {
  .head {
    grid-template-columns: auto minmax(0, 1fr);

    .count {
      grid-column: 1 / -1;
      grid-row: 3;
    }
  }
}

@include below($bp-sm) {
  .node .node {
    padding: 0.35rem 0.25rem 0.3rem;
  }

  .meta {
    margin-left: 0;
    flex-wrap: wrap;
  }

  .body {
    margin-left: 2px;
    padding-left: 0.25rem;
  }
}
</style>
