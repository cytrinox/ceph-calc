<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  num: number
  title: string
  subtitle: string
  /** One-line summary of the step's settings, shown instead of the subtitle while collapsed. */
  summary?: string
  /** Collapsed on a first visit (before the user has toggled this step). */
  collapsedByDefault?: boolean
}>()

const storageKey = `ceph-calculator-step-${props.num}`
const bodyId = `step-body-${props.num}`

function load(): boolean {
  const fallback = !props.collapsedByDefault
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === null ? fallback : stored === 'open'
  } catch {
    return fallback
  }
}

const open = ref(load())

function toggle() {
  open.value = !open.value
  try {
    localStorage.setItem(storageKey, open.value ? 'open' : 'closed')
  } catch {
    // storage unavailable: the state just isn't remembered
  }
}
</script>

<template>
  <div class="step" :class="{ collapsed: !open }">
    <h3 class="heading">
      <button type="button" class="step-head" :aria-expanded="open" :aria-controls="bodyId" @click="toggle">
        <span class="num">{{ num }}</span>
        <span class="titles">
          <span class="title">{{ title }}</span>
          <span class="sub" :class="{ summary: !open && summary }">{{ !open && summary ? summary : subtitle }}</span>
        </span>
        <AppIcon name="chevron" :size="16" class="caret" />
      </button>
    </h3>
    <div v-show="open" :id="bodyId" class="body">
      <slot />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.step {
  padding: 1rem 1.4rem 1.3rem;

  & + & {
    border-top: 1px solid var(--border);
  }

  &.collapsed {
    padding-bottom: 1rem;
  }
}

.heading {
  margin: 0;
  font: inherit;
}

.step-head {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: $radius-sm;

  &:hover .caret {
    color: var(--accent-text);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
}

.titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}

.title {
  font-family: $font-display;
  font-size: 0.98rem;
  font-weight: 700;
}

.sub {
  margin-top: 0.05rem;
  color: var(--text-muted);
  font-size: 0.8rem;

  &.summary {
    font-family: $font-mono;
    font-size: 0.76rem;
    overflow-wrap: anywhere;
  }
}

.caret {
  flex: 0 0 auto;
  margin-top: 0.2rem;
  color: var(--text-muted);
  transform: rotate(90deg);
  transition: transform 0.15s, color 0.15s;

  .collapsed & {
    transform: rotate(0deg);
  }
}

.num {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border-radius: 50%;
  border: 1.5px solid var(--accent);
  color: var(--accent-text);
  font-family: $font-display;
  font-size: 0.78rem;
  font-weight: 700;
  flex: 0 0 auto;
}

.body {
  margin-top: 1rem;
}

@include below($bp-sm) {
  .step {
    padding: 0.9rem 1rem 1.1rem;

    &.collapsed {
      padding-bottom: 0.9rem;
    }
  }
}
</style>
