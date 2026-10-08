<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { parseDecimal, snapStep } from '@/lib/stepping'

/**
 * Compact − / + stepper for tight spots (the CRUSH tree editor). Same behaviour as NumberField:
 * text input with our own formatting, comma or dot accepted, arrow keys step.
 */
const props = withDefaults(
  defineProps<{
    label: string
    min?: number
    max?: number
    /** Whole numbers only (counts). */
    integer?: boolean
    /** Buttons jump to whole units (0.5 → 1, 1.3 → 2) while any decimal can be typed. */
    snap?: boolean
    unit?: string
    /** Width of the value box. */
    width?: string
  }>(),
  { min: 0, integer: true, width: '2.6rem' },
)

const model = defineModel<number>({ required: true })

function clamp(value: number): number {
  let v = props.integer ? Math.round(value) : Number(value.toFixed(3))
  v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  return v
}

const editing = ref(false)
const draft = ref('')
const display = computed(() => (editing.value ? draft.value : String(Number(model.value) || 0)))

function onFocus() {
  draft.value = String(Number(model.value) || 0)
  editing.value = true
}

function onInput(event: Event) {
  draft.value = (event.target as HTMLInputElement).value
  const value = parseDecimal(draft.value)
  if (Number.isFinite(value)) model.value = clamp(value)
}

function onBlur(event: Event) {
  editing.value = false
  ;(event.target as HTMLInputElement).value = String(Number(model.value) || 0)
}

function stepBy(direction: 1 | -1) {
  const current = Number(model.value) || 0
  if (props.snap) {
    model.value = clamp(snapStep(current, direction, 1))
  } else {
    model.value = clamp(current + direction)
  }
  draft.value = String(model.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  stepBy(event.key === 'ArrowUp' ? 1 : -1)
}

// In snap mode the buttons stop at 1 unit (smaller values can still be typed), like OSD size on the Basic tab.
const atMin = computed(() => (Number(model.value) || 0) <= (props.snap ? 1 : props.min))
const atMax = computed(() => props.max !== undefined && model.value >= props.max)
</script>

<template>
  <span class="mini-stepper">
    <button type="button" tabindex="-1" :disabled="atMin" :aria-label="`Decrease ${label}`" @click="stepBy(-1)">
      <AppIcon name="minus" :size="11" />
    </button>
    <span class="value">
      <input
        type="text"
        :inputmode="integer ? 'numeric' : 'decimal'"
        :pattern="integer ? '[0-9]*' : '[0-9]*[.,]?[0-9]*'"
        enterkeyhint="done"
        role="spinbutton"
        :aria-label="label"
        :aria-valuenow="model"
        :aria-valuemin="min"
        :aria-valuemax="max"
        autocomplete="off"
        spellcheck="false"
        :style="{ width }"
        :value="display"
        @focus="onFocus"
        @input="onInput"
        @keydown="onKeydown"
        @blur="onBlur"
      />
      <span v-if="unit" class="unit">{{ unit }}</span>
    </span>
    <button type="button" tabindex="-1" :disabled="atMax" :aria-label="`Increase ${label}`" @click="stepBy(1)">
      <AppIcon name="plus" :size="11" />
    </button>
  </span>
</template>

<style lang="scss" scoped>
.mini-stepper {
  display: inline-flex;
  align-items: stretch;
  flex: 0 0 auto;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: $radius-sm;
  background: var(--input-bg);

  &:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--focus);
  }

  button {
    display: grid;
    place-items: center;
    width: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--accent-soft);
      color: var(--accent-text);
    }

    &:disabled {
      opacity: 0.35;
      cursor: default;
    }

    @include touch {
      width: 30px;
    }
  }
}

.value {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  padding-right: 0.1rem;
}

input {
  min-height: 28px;
  padding: 0.15rem 0.2rem;
  border: 0;
  background: transparent;
  box-shadow: none;
  text-align: center;
  font-family: $font-mono;
  font-size: 0.84rem;
  color: var(--text);

  &:focus {
    box-shadow: none;
  }

  @include touch {
    min-height: 40px;
  }
}

.unit {
  font-family: $font-mono;
  font-size: 0.66rem;
  color: var(--text-faint);
}
</style>
