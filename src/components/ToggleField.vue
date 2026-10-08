<script setup lang="ts">
defineProps<{ label: string; hint?: string; code?: string }>()
const model = defineModel<boolean>({ required: true })
const id = `tg-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <label class="toggle-field" :for="id">
    <span class="text">
      <span class="label">
        {{ label }}
        <code v-if="code">{{ code }}</code>
      </span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </span>
    <input :id="id" v-model="model" type="checkbox" role="switch" class="visually-hidden" />
    <span class="switch" aria-hidden="true" />
  </label>
</template>

<style lang="scss" scoped>
.toggle-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  cursor: pointer;
  min-height: 36px;

  @include touch {
    min-height: 44px;
  }
}

.text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.label {
  font-weight: 500;
}

code {
  font-family: $font-mono;
  font-size: 0.72rem;
  color: var(--text-faint);
  margin-left: 0.25rem;
}

.hint {
  color: var(--text-muted);
  font-size: 0.78rem;
}

.switch {
  position: relative;
  flex: 0 0 auto;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--input-bg);
  border: 1px solid var(--border-strong);
  transition: background 0.2s, border-color 0.2s;

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-faint);
    transition: transform 0.2s, background 0.2s;
  }
}

input:checked + .switch {
  background: var(--accent);
  border-color: var(--accent);

  &::after {
    transform: translateX(18px);
    background: var(--on-accent);
  }
}

input:focus-visible + .switch {
  box-shadow: 0 0 0 3px var(--focus);
}
</style>
