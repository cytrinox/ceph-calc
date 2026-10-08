<script setup lang="ts" generic="T extends string">
defineProps<{ tabs: { value: T; label: string; hint?: string }[]; label: string }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <div class="tabs" role="tablist" :aria-label="label">
    <button
      v-for="tab in tabs"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="model === tab.value"
      :class="{ active: model === tab.value }"
      @click="model = tab.value"
    >
      <span class="name">{{ tab.label }}</span>
      <span v-if="tab.hint" class="hint">{{ tab.hint }}</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.tabs {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
  gap: 4px;
  padding: 4px;
  background: var(--input-bg);
  border-radius: 999px;
}

button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  padding: 0.35rem 0.9rem;
  min-height: 40px;
  cursor: pointer;
  line-height: 1.2;
  transition: background 0.2s, color 0.2s;

  &:hover {
    color: var(--text);
  }

  &.active {
    background: var(--panel);
    color: var(--text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 0 0 1px var(--border);

    .hint {
      color: var(--accent-text);
    }
  }

  @include touch {
    min-height: 44px;
  }
}

.name {
  font-weight: 600;
  font-size: 0.88rem;
}

.hint {
  font-size: 0.7rem;
  color: var(--text-faint);
}
</style>
