<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import RatioMarker, { type RatioKind } from './RatioMarker.vue'

/** "Switch parameter X from A to B": parameter | current value → new value, each value with a short note. */
defineProps<{
  parameter: string
  from: string
  to: string
  fromNote?: string
  toNote?: string
  /** Ratio markers next to the values, matching the distribution bar. */
  fromMarker?: RatioKind
  toMarker?: RatioKind
}>()

// Same sizes as in the distribution bar (even sizes render exactly).
const markerSize = (kind: RatioKind) => (kind === 'recommended' ? 16 : 12)
</script>

<template>
  <div class="setting-change">
    <div class="row">
      <code class="parameter">{{ parameter }}</code>
      <div class="side from">
        <span class="value">
          <RatioMarker v-if="fromMarker" :kind="fromMarker" :size="markerSize(fromMarker)" />{{ from }}
        </span>
        <span v-if="fromNote" class="note">{{ fromNote }}</span>
      </div>
      <AppIcon name="arrow-right" :size="20" class="arrow" />
      <div class="side to">
        <span class="value">
          <RatioMarker v-if="toMarker" :kind="toMarker" :size="markerSize(toMarker)" />{{ to }}
        </span>
        <span v-if="toNote" class="note">{{ toNote }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.setting-change {
  container-type: inline-size;
  padding: 0.75rem 0.9rem 0.8rem;
  border-radius: $radius;
  background: var(--panel-alt);
}

// Parameter | old value → new value. The same fractions in every row keep stacked changes aligned.
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: start;
  column-gap: 0.75rem;
  row-gap: 0.45rem;

  // Narrow cards (phones): the parameter goes on its own line above the values.
  @container (max-width: 30rem) {
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);

    .parameter {
      grid-column: 1 / -1;
      align-self: start;
    }
  }
}

.parameter {
  // Centred against the values with their notes.
  align-self: center;
  font-family: $font-mono;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--text);
  overflow-wrap: anywhere;
}

.side {
  display: grid;
  justify-items: center;
  gap: 0.15rem;
  min-width: 0;
  text-align: center;
}

.value {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: $font-display;
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.2;
}

.from .value {
  color: var(--text-muted);
}

.to .value {
  color: var(--accent-text);
}

.arrow {
  margin-top: 0.2rem;
  color: var(--text-faint);
}

.note {
  font-size: 0.74rem;
  color: var(--text-faint);
}
</style>
