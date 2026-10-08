<script setup lang="ts">
import { capacityUnit, setCapacityUnit, type CapacityUnit } from '@/lib/units'

const units: { value: CapacityUnit; title: string }[] = [
  { value: 'TB', title: 'Decimal units (1 TB = 10¹² bytes)' },
  { value: 'TiB', title: 'Binary units (1 TiB = 2⁴⁰ bytes), as shown by ceph df' },
]
</script>

<template>
  <div class="unit-toggle" role="group" aria-label="Capacity units in results">
    <button
      v-for="u in units"
      :key="u.value"
      type="button"
      :class="{ active: capacityUnit === u.value }"
      :aria-pressed="capacityUnit === u.value"
      :title="u.title"
      @click="setCapacityUnit(u.value)"
    >
      {{ u.value }}
    </button>
  </div>
</template>

<style lang="scss" scoped>
.unit-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 42px;
  padding: 3px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow: var(--shadow);

  @include touch {
    height: 44px;
  }
}

button {
  height: 100%;
  min-width: 2.9rem;
  padding: 0 0.7rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font-family: $font-mono;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    color: var(--text);
  }

  &.active {
    background: var(--accent-soft);
    color: var(--accent-text);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  @include below($bp-sm) {
    min-width: 2.5rem;
    padding: 0 0.5rem;
  }
}
</style>
