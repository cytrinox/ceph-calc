<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import DistributionBar from './DistributionBar.vue'
import SettingChange from './SettingChange.vue'
import { configCommand, ratioCommand } from '@/lib/commands'
import type { CapacityResult } from '@/lib/ceph'
import { isApplicable, type RatioKey, type Recommendation, type SetupChange } from '@/lib/recommendations'

const props = defineProps<{ recommendations: Recommendation[]; result: CapacityResult }>()
const emit = defineEmits<{ adopt: [setup: SetupChange] }>()

/** How long the "Adopted" note stays until it has faded out (matches the CSS animation). */
const ADOPTED_MS = 1900

// An adopted recommendation vanishes (its condition no longer holds); a note takes its place and fades out.
const adopted = ref<{ id: string; index: number; summary: string }[]>([])

type Item = { kind: 'rec'; key: string; rec: Recommendation } | { kind: 'adopted'; key: string; summary: string }

const items = computed<Item[]>(() => {
  const list: Item[] = props.recommendations.map((rec) => ({ kind: 'rec', key: rec.id, rec }))
  for (const note of adopted.value) {
    list.splice(Math.min(note.index, list.length), 0, { kind: 'adopted', key: note.id, summary: note.summary })
  }
  return list
})

// Recommendations start collapsed (pictogram, headline, adopt button); the headline expands the description.
const expanded = ref<string[]>([])
const isOpen = (id: string) => expanded.value.includes(id)

function toggle(id: string) {
  expanded.value = isOpen(id) ? expanded.value.filter((e) => e !== id) : [...expanded.value, id]
}

let noteId = 0

function adopt(rec: Recommendation) {
  if (!rec.adopt) return
  const id = `adopted-${++noteId}`
  adopted.value = [...adopted.value, { id, index: props.recommendations.indexOf(rec), summary: rec.adopt.summary }]
  emit('adopt', rec.adopt.setup)
  setTimeout(() => (adopted.value = adopted.value.filter((n) => n.id !== id)), ADOPTED_MS)
}

/** The commands a recommendation stands for, as a preview. */
const commands = (rec: Recommendation) => [
  ...(Object.entries(rec.ratios ?? {}) as [RatioKey, number][]).map(([key, value]) => ratioCommand(key, value)),
  ...(rec.config ?? []).map((c) => configCommand(c.option, c.value)),
]
</script>

<template>
  <section v-if="items.length" class="card recommendations">
    <div class="card-head">
      <span class="icon-badge"><AppIcon name="bulb" :size="17" /></span>
      <h2>Recommendations</h2>
    </div>

    <ol class="list">
      <template v-for="item in items" :key="item.key">
        <li v-if="item.kind === 'adopted'" class="item adopted" role="status">
          <AppIcon name="check" :size="15" />
          <span>Adopted: {{ item.summary }}.</span>
        </li>
        <li v-else class="item" :class="{ open: isOpen(item.rec.id) }">
          <div class="title-row" :class="{ 'with-adopt': item.rec.adopt }">
            <h3 class="title">
              <button
                type="button"
                class="toggle"
                :aria-expanded="isOpen(item.rec.id)"
                :aria-controls="`rec-${item.rec.id}`"
                @click="toggle(item.rec.id)"
              >
                <span
                  class="severity"
                  :class="item.rec.severity"
                  role="img"
                  :aria-label="item.rec.severity === 'critical' ? 'Risk of data loss' : 'Recommendation'"
                  :title="item.rec.severity === 'critical' ? 'Risk of data loss' : 'Recommendation'"
                >
                  <AppIcon :name="item.rec.severity === 'critical' ? 'alert' : 'bulb'" :size="17" />
                </span>
                <span class="text">{{ item.rec.title }}</span>
              </button>
            </h3>
            <button v-if="item.rec.adopt" type="button" class="adopt" @click="adopt(item.rec)">
              <AppIcon name="check" :size="13" /> Adopt recommendation
            </button>
            <!-- Same as clicking the headline (the button carries aria-expanded for keyboards and screen readers). -->
            <span class="caret" aria-hidden="true" @click="toggle(item.rec.id)">
              <AppIcon name="chevron" :size="16" />
            </span>
          </div>
          <div v-show="isOpen(item.rec.id)" :id="`rec-${item.rec.id}`" class="body">
            <div class="changes">
              <SettingChange v-for="c in item.rec.changes" :key="c.parameter" v-bind="c" />
            </div>
            <DistributionBar
              v-if="item.rec.distribution"
              :result="result"
              :recommended-nearfull="item.rec.distribution.nearfull"
            />
            <p v-for="d in item.rec.details" :key="d" class="detail">{{ d }}</p>
            <template v-if="isApplicable(item.rec)">
              <pre class="command"><code>{{ commands(item.rec).join('\n') }}</code></pre>
              <p class="apply">
                <AppIcon name="terminal" :size="13" />
                <span>Apply it in the Ceph commands below with “Apply recommendations”.</span>
              </p>
            </template>
          </div>
        </li>
      </template>
    </ol>
  </section>
</template>

<style lang="scss" scoped>
.list {
  display: grid;
  // Space above and below the separator between recommendations.
  gap: 1.75rem;
  margin: 0;
  padding: 0.6rem 1.4rem 1.4rem;
  list-style: none;
}

.item {
  display: grid;
  gap: 0.7rem;

  & + & {
    padding-top: 1.75rem;
    border-top: 1px solid var(--border);
  }
}

// Headline | adopt button | chevron. The chevron always ends the row, so it lines up across recommendations.
.title-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'title caret';
  align-items: center;
  gap: 0.5rem 0.75rem;

  &.with-adopt {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas: 'title adopt caret';
  }
}

.title {
  grid-area: title;
  min-width: 0;
  margin: 0;
  font-family: $font-display;
  font-size: 1rem;
  font-weight: 700;
}

// The whole headline expands and collapses the description (like the step headers).
.toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: $radius-sm;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;

  .text {
    flex: 1 1 auto;
    min-width: 0;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
}

.caret {
  grid-area: caret;
  display: inline-flex;
  padding: 0.25rem;
  margin: -0.25rem;
  color: var(--text-muted);
  cursor: pointer;
  transition: transform 0.15s, color 0.15s;

  .open & {
    transform: rotate(90deg);
  }

  &:hover,
  .title-row:has(.toggle:hover) & {
    color: var(--accent-text);
  }
}

.body {
  display: grid;
  gap: 0.7rem;
}

// Light bulb for advice (the panel's colour), red warning sign when the setup risks data loss.
.severity {
  display: inline-flex;
  flex: 0 0 auto;

  &.info {
    color: var(--accent-text);
  }

  &.critical {
    color: var(--danger);
  }
}

// Adopting changes the calculator's own inputs (unlike applying, which changes the generated commands).
.adopt {
  grid-area: adopt;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid var(--accent);
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-text);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: var(--accent);
    color: var(--on-accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

// Takes the place of an adopted recommendation and fades out (ADOPTED_MS in the script).
.item.adopted {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.85rem;
  border: 1px solid var(--accent);
  border-radius: $radius;
  background: var(--accent-soft);
  color: var(--accent-text);
  font-size: 0.9rem;
  font-weight: 600;
  animation: adopted 1.9s ease forwards;

  svg {
    flex: 0 0 auto;
  }
}

// Fade-in 0.3 s, visible for 1 s, fade-out 0.6 s; its size stays until it is removed.
@keyframes adopted {
  0% {
    opacity: 0;
    transform: scale(0.98);
  }
  15.8%,
  68.4% {
    opacity: 1;
    transform: none;
  }
  100% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .item.adopted {
    animation: none;
  }
}

.changes {
  display: grid;
  gap: 0.5rem;
}

.detail {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.55;
}

.command {
  margin: 0;
  padding: 0.6rem 0.8rem;
  border-radius: $radius-sm;
  background: var(--code-bg);
  color: var(--code-text);
  font-family: $font-mono;
  font-size: 0.8rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.apply {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-faint);

  svg {
    flex: 0 0 auto;
  }
}

@include below($bp-sm) {
  .list {
    padding: 0.5rem 1rem 1rem;
  }

  // The adopt button moves below the headline.
  .title-row.with-adopt {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      'title caret'
      'adopt adopt';
  }

  .adopt {
    justify-self: start;
  }
}
</style>
