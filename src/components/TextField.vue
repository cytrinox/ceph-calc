<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    hint?: string
    placeholder?: string
    invalid?: boolean
    mono?: boolean
  }>(),
  { mono: true },
)

const model = defineModel<string>({ required: true })
const id = `tf-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <div class="text-field">
    <label :for="id" class="label">{{ label }}</label>
    <input
      :id="id"
      v-model.trim="model"
      type="text"
      :class="{ mono, invalid }"
      :placeholder="placeholder"
      :aria-invalid="invalid || undefined"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<style lang="scss" scoped>
.text-field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.label {
  font-weight: 500;
}

input {
  width: 100%;
  min-width: 0;
  border-color: var(--border);

  &.mono {
    font-family: $font-mono;
    font-size: 0.9rem;
  }

  &::placeholder {
    color: var(--text-faint);
    font-style: italic;
  }

  &.invalid {
    border-color: var(--danger);
  }
}

.hint {
  color: var(--text-muted);
  font-size: 0.78rem;
}
</style>
