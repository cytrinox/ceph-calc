<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { parseDecimal, snapStep } from '@/lib/stepping'

const props = withDefaults(
  defineProps<{
    label: string
    hint?: string
    unit?: string
    min?: number
    max?: number
    step?: number
    integer?: boolean
    /** Buttons double / halve the value (e.g. pg_num). */
    pow2?: boolean
    /** Fixed number of decimals shown when not editing (e.g. 2 renders 0.9 as 0.90). */
    decimals?: number
    /** Default value; shown after the hint as a link that resets the field when it differs. */
    defaultValue?: number
    /** Decimals kept for typed values (defaults to the step's decimals, at least 2). */
    precision?: number
    /**
     * Buttons snap to whole multiples of `step` (0.5 → 1, 1.3 → 2 / 1) and never go below
     * one step, while typed values may be anything down to `min`.
     */
    snap?: boolean
    /** 0 means "not set": show an empty field with a dash placeholder; clearing the field sets 0. */
    blankZero?: boolean
  }>(),
  { step: 1, integer: true },
)

const model = defineModel<number>({ required: true })

// The last word and the suffix wrap together, so a marker never ends up alone on a line.
const labelHead = computed(() => props.label.slice(0, props.label.lastIndexOf(' ') + 1))
const labelTail = computed(() => props.label.slice(props.label.lastIndexOf(' ') + 1))

const id = `nf-${Math.random().toString(36).slice(2, 9)}`
const decimals = computed(() => (String(props.step).split('.')[1] ?? '').length)

function clamp(value: number): number {
  let v = props.integer ? Math.round(value) : Number(value.toFixed(props.precision ?? Math.max(decimals.value, 2)))
  if (props.min !== undefined) v = Math.max(props.min, v)
  if (props.max !== undefined) v = Math.min(props.max, v)
  return v
}

function format(value: number): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (props.blankZero && n === 0) return ''
  if (props.decimals === undefined) return String(n)
  const fixed = n.toFixed(props.decimals)
  // Show at least `decimals`, but keep extra typed digits (up to `precision`) instead of rounding them away.
  if (props.precision !== undefined && props.precision > props.decimals && Number(fixed) !== n) {
    return String(Number(n.toFixed(props.precision)))
  }
  return fixed
}

// While the input has focus, show exactly what the user types; otherwise the formatted model.
const editing = ref(false)
const draft = ref('')
const display = computed(() => (editing.value ? draft.value : format(model.value)))

function onFocus() {
  draft.value = format(model.value)
  editing.value = true
}

function onInput(event: Event) {
  const input = event.target as HTMLInputElement
  draft.value = input.value
  if (props.blankZero && input.value.trim() === '') {
    model.value = 0
    return
  }
  const value = parseDecimal(input.value)
  if (Number.isFinite(value)) model.value = clamp(value)
}

function onBlur(event: Event) {
  editing.value = false
  // Force the DOM back in sync even when the formatted text did not change.
  ;(event.target as HTMLInputElement).value = format(model.value)
}

/** Arrow keys step like the − / + buttons (a text input has no native stepping). */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
  event.preventDefault()
  stepBy(event.key === 'ArrowUp' ? 1 : -1)
  draft.value = format(model.value)
}

function stepBy(direction: 1 | -1) {
  if (props.pow2) {
    const current = Math.max(1, Number(model.value) || 1)
    const exp = direction > 0 ? Math.floor(Math.log2(current)) + 1 : Math.ceil(Math.log2(current)) - 1
    model.value = clamp(2 ** Math.max(0, exp))
    return
  }
  const current = Number(model.value) || 0
  if (props.snap) {
    model.value = clamp(snapStep(current, direction, props.step))
    return
  }
  const next = Number((current + direction * props.step).toFixed(decimals.value))
  model.value = clamp(next)
}

const isDefault = computed(() => props.defaultValue !== undefined && Math.abs(model.value - props.defaultValue) < 1e-9)

const atMin = computed(() =>
  props.snap ? model.value <= props.step : props.min !== undefined && model.value <= props.min,
)
const atMax = computed(() => props.max !== undefined && model.value >= props.max)
</script>

<template>
  <div class="field">
    <div class="text">
      <label v-if="$slots['label-suffix']" :for="id" class="label">
        {{ labelHead }}<span class="tail">{{ labelTail }}<span class="suffix"><slot name="label-suffix" /></span></span>
      </label>
      <!-- Two labels for one input: lets the last word and the button wrap together. -->
      <span v-else-if="$slots['label-after']" class="label">
        <label :for="id">{{ labelHead }}</label><span class="tail"><label :for="id">{{ labelTail }}</label><slot
            name="label-after"
        /></span>
      </span>
      <label v-else :for="id" class="label">{{ label }}</label>
      <span v-if="hint || defaultValue !== undefined" class="hint">
        {{ hint }}<template v-if="defaultValue !== undefined">
          {{ hint ? ' ' : '' }}(<button
            v-if="!isDefault"
            type="button"
            class="reset"
            :title="`Reset ${label} to the default ${format(defaultValue)}`"
            @click="model = defaultValue"
          >default {{ format(defaultValue) }}</button><template v-else>default {{ format(defaultValue) }}</template>)
        </template>
      </span>
    </div>
    <div class="stepper">
      <button type="button" tabindex="-1" :disabled="atMin" :aria-label="`Decrease ${label}`" @click="stepBy(-1)">
        <AppIcon name="minus" :size="14" />
      </button>
      <span class="input-wrap">
        <!--
          A text input (not type="number"): browsers render number inputs in the system locale
          on first paint ("0,85") but show the raw value after updates ("0.85"). Here the display
          is always our own formatting with a dot; typing a comma or a dot both work.
        -->
        <input
          :id="id"
          type="text"
          :inputmode="integer ? 'numeric' : 'decimal'"
          :pattern="integer ? '[0-9]*' : '[0-9]*[.,]?[0-9]*'"
          enterkeyhint="done"
          role="spinbutton"
          :aria-valuenow="model"
          :aria-valuemin="min"
          :aria-valuemax="max"
          autocomplete="off"
          spellcheck="false"
          :placeholder="blankZero ? '—' : undefined"
          :value="display"
          @focus="onFocus"
          @input="onInput"
          @keydown="onKeydown"
          @blur="onBlur"
        />
        <span v-if="$slots.unit" class="unit custom"><slot name="unit" /></span>
        <span v-else-if="unit" class="unit">{{ unit }}</span>
      </span>
      <button type="button" tabindex="-1" :disabled="atMax" :aria-label="`Increase ${label}`" @click="stepBy(1)">
        <AppIcon name="plus" :size="14" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.label {
  font-weight: 500;
}

.tail {
  white-space: nowrap;
}

// Inline so a suffix (e.g. a ratio marker) stays next to the last word when the label wraps.
.suffix {
  display: inline-block;
  margin-left: 0.4rem;
  vertical-align: 0.1em;
}

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
  line-height: 1.35;
}

.stepper {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  background: var(--input-bg);
  border-radius: $radius;
  padding: 3px;
  border: 1px solid var(--border);

  &:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--focus);
  }

  button {
    display: grid;
    place-items: center;
    width: 30px;
    border: 0;
    border-radius: $radius-sm;
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
      width: 40px;
    }
  }
}

.input-wrap {
  position: relative;
  display: flex;

  input {
    // Same width for every stepper so the boxes line up; fits about eight digits plus a unit.
    width: 7.4rem;
    font-family: $font-mono;
    font-variant-numeric: tabular-nums;
    min-height: 34px;
    border: 0;
    background: transparent;
    text-align: center;
    padding: 0.3rem 0.3rem;
    box-shadow: none;
    -moz-appearance: textfield;
    appearance: textfield;

    &::-webkit-inner-spin-button,
    &::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    &:focus {
      box-shadow: none;
    }

    @include touch {
      min-height: 40px;
    }
  }

  // With a unit, right-align the number so it reads "14.508 TB".
  &:has(.unit) input {
    text-align: right;
    padding-left: 0.5rem;
    padding-right: 2.1rem;
  }

  // Editable suffix (e.g. a currency input) needs more room than a short static unit.
  &:has(.unit.custom) > input {
    padding-right: 2.9rem;
  }
}

.unit.custom {
  right: 0.25rem;
  pointer-events: auto;
}

.unit {
  position: absolute;
  right: 0.55rem;
  top: 50%;
  transform: translateY(-50%);
  font-family: $font-mono;
  font-size: 0.7rem;
  color: var(--text-faint);
  pointer-events: none;
}
</style>
