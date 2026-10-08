<script setup lang="ts" generic="T extends string">
defineProps<{
  label: string
  hint?: string
  options: readonly { value: T; label: string }[]
}>()

const model = defineModel<T>({ required: true })
const id = `sf-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <div class="select-field">
    <label :for="id" class="label">{{ label }}</label>
    <select :id="id" v-model="model">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </div>
</template>

<style lang="scss" scoped>
.select-field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.label {
  font-weight: 500;
}

select {
  width: 100%;
  min-width: 0;
  border-color: var(--border);
}

.hint {
  color: var(--text-muted);
  font-size: 0.78rem;
}
</style>
