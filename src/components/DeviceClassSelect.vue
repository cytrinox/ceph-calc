<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { DEVICE_CLASS_MAX_LENGTH, isValidDeviceClass } from '@/lib/topology'

/**
 * A device class: one of `classes` from the dropdown, or any other name. "custom…" turns the dropdown into a text
 * field in place; Enter or leaving it turns it back (the name is then an option of its own), Escape cancels.
 * With `anyLabel`, '' (no restriction) comes first. `compact` is the inline variant for OSD rows; otherwise it is a
 * labelled field like SelectField.
 */
const props = defineProps<{
  label: string
  classes: readonly string[]
  anyLabel?: string
  compact?: boolean
}>()

const model = defineModel<string>({ required: true })

// Not a valid class name (leading "*"), so it can't collide with a listed class.
const CUSTOM = '*custom'
const id = `dc-${Math.random().toString(36).slice(2, 9)}`

const editing = ref(false)
let before = ''
const select = ref<HTMLSelectElement>()
const input = ref<HTMLInputElement>()

const listed = computed(() => (props.anyLabel !== undefined ? ['', ...props.classes] : props.classes))
// A custom name that isn't listed (e.g. typed for the rule only) still shows as the chosen option.
const unlisted = computed(() => (listed.value.includes(model.value) ? null : model.value))
const invalid = computed(() => (model.value === '' ? props.anyLabel === undefined : !isValidDeviceClass(model.value)))

function onSelect(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value !== CUSTOM) {
    model.value = value
    return
  }
  before = model.value
  editing.value = true
  // Start from the current class, ready to be overwritten.
  nextTick(() => input.value?.select())
}

function finish(refocus: boolean) {
  if (!editing.value) return
  // OSDs always have a class, so an emptied name keeps the previous one; for the rule, empty means any class.
  if (model.value === '' && props.anyLabel === undefined) model.value = before
  editing.value = false
  if (refocus) nextTick(() => select.value?.focus())
}

function cancel() {
  model.value = before
  finish(true)
}
</script>

<template>
  <div class="device-class" :class="{ compact }">
    <label v-if="!compact" :for="id" class="label">{{ label }}</label>
    <input
      v-if="editing"
      :id="id"
      ref="input"
      v-model.trim="model"
      type="text"
      :class="{ invalid }"
      :aria-label="compact ? `${label}: custom name` : undefined"
      :aria-invalid="invalid || undefined"
      :maxlength="DEVICE_CLASS_MAX_LENGTH"
      placeholder="class name"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      @blur="finish(false)"
      @keydown.enter.prevent="finish(true)"
      @keydown.escape.prevent="cancel"
    />
    <select
      v-else
      :id="id"
      ref="select"
      :value="model"
      :class="{ invalid }"
      :aria-label="compact ? label : undefined"
      :aria-invalid="invalid || undefined"
      :title="compact ? label : undefined"
      @change="onSelect"
    >
      <option v-if="anyLabel !== undefined" value="">{{ anyLabel }}</option>
      <option v-for="c in classes" :key="c" :value="c">{{ c }}</option>
      <option v-if="unlisted !== null" :value="unlisted">{{ unlisted }}</option>
      <option :value="CUSTOM">custom…</option>
    </select>
  </div>
</template>

<style lang="scss" scoped>
.device-class {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.label {
  font-weight: 500;
}

select,
input {
  width: 100%;
  min-width: 0;
  border-color: var(--border);

  &.invalid {
    border-color: var(--danger);
  }
}

input {
  font-family: $font-mono;
  font-size: 0.9rem;

  &::placeholder {
    color: var(--text-faint);
    font-style: italic;
  }
}

// Inline in an OSD row: compact like the bucket type select.
.compact {
  display: flex;

  select,
  input {
    width: auto;
    min-height: 34px;
    padding: 0.3rem 0.4rem;
    font-family: $font-mono;
    font-size: 0.8rem;

    @include touch {
      min-height: 44px;
    }
  }

  select {
    color: var(--accent-text);
    // As wide as the chosen class, not the longest option ("custom…"), so the OSD row stays on one line.
    field-sizing: content;
  }

  input {
    width: 6rem;

    // Grows with the name instead.
    @supports (field-sizing: content) {
      width: auto;
      min-width: 4rem;
      max-width: 9rem;
      field-sizing: content;
    }
  }
}
</style>
