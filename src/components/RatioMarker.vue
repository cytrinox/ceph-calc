<script setup lang="ts">
export type RatioKind = 'nearfull' | 'backfillfull' | 'full' | 'recommended'

withDefaults(defineProps<{ kind: RatioKind; size?: number }>(), { size: 12 })
</script>

<template>
  <span
    class="ratio-marker"
    :class="kind"
    :style="{ borderLeftWidth: `${size / 2}px`, borderRightWidth: `${size / 2}px`, borderTopWidth: `${size - 2}px` }"
    aria-hidden="true"
  />
</template>

<style lang="scss" scoped>
// Downward triangle in the ratio's colour (shared by the capacity bar and the headroom step).
.ratio-marker {
  display: inline-block;
  width: 0;
  height: 0;
  border-style: solid;
  border-color: currentColor transparent transparent;
  flex: 0 0 auto;
}

.nearfull {
  color: var(--marker-nearfull);
}

.backfillfull {
  color: var(--marker-backfillfull);
}

.full {
  color: var(--marker-full);
}

// A recommended ratio (see the Recommendations panel).
.recommended {
  color: var(--accent-text);
}
</style>
