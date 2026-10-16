<script setup lang="ts">
import { computed } from 'vue'
import RatioMarker, { type RatioKind } from './RatioMarker.vue'
import { formatCapacity } from '@/lib/units'
import { distributionSegments } from '@/lib/distribution'
import type { CapacityResult } from '@/lib/ceph'

/**
 * The raw data distribution bar with its ratio markers (no legend). Used by the result card and, with
 * `recommendedNearfull`, by the recommendations, so both renderings stay identical.
 */
const props = defineProps<{
  result: CapacityResult
  /** Adds a larger marker where healthy OSDs reach this nearfull ratio. */
  recommendedNearfull?: number
}>()

const share = (tb: number) => (props.result.rawTB > 0 ? tb / props.result.rawTB : 0)

const segments = computed(() => distributionSegments(props.result))

/**
 * About 30 % larger than the regular markers (12 px). The triangle is drawn with borders, which the browser
 * rounds to whole pixels per side, so the size must be even: 16 px.
 */
const RECOMMENDED_SIZE = 16

/** Where healthy OSDs reach each fill ratio, as a share of raw capacity. */
const markers = computed(() => {
  const r = props.result
  if (!r.valid || r.rawTB <= 0) return []
  const defs: { key: RatioKind; label: string; effect: string; ratio: number }[] = [
    { key: 'nearfull', label: 'nearfull', effect: 'health warning', ratio: r.fillRatios.nearfull },
    { key: 'backfillfull', label: 'backfillfull', effect: 'recovery stops', ratio: r.fillRatios.backfillfull },
    { key: 'full', label: 'full', effect: 'writes stop', ratio: r.fillRatios.full },
  ]
  if (props.recommendedNearfull !== undefined) {
    defs.push({
      key: 'recommended',
      label: 'recommended nearfull_ratio',
      effect: 'warns when the data exceeds the plan',
      ratio: props.recommendedNearfull,
    })
  }
  return defs.map((d) => {
    const storedTB = r.healthyPlaceableTB * d.ratio
    return {
      ...d,
      position: Math.min(1, storedTB / r.rawTB),
      size: d.key === 'recommended' ? RECOMMENDED_SIZE : undefined,
      title: `${d.label} ${d.ratio.toFixed(2)} (${d.effect}): reached at ${formatCapacity(storedTB)} raw stored, ${formatCapacity(storedTB * r.dataFraction)} of data`,
    }
  })
})
</script>

<template>
  <div class="distribution" :class="{ 'with-recommended': recommendedNearfull !== undefined }">
    <div class="bar-head">
      <span class="title">Raw data distribution:</span>
      <span class="total">{{ formatCapacity(result.rawTB) }} = 100%</span>
    </div>
    <div class="track">
      <div v-if="markers.length" class="markers">
        <span
          v-for="m in markers"
          :key="m.key"
          :class="['marker', m.key]"
          :style="{ left: `${m.position * 100}%` }"
          :title="m.title"
          role="img"
          :aria-label="m.title"
        >
          <RatioMarker :kind="m.key" :size="m.size" />
        </span>
      </div>
      <span
        v-for="m in markers"
        :key="`tick-${m.key}`"
        :class="['tick', m.key]"
        :style="{ left: `${m.position * 100}%` }"
        aria-hidden="true"
      />
      <div class="bar" role="img" :aria-label="segments.map((s) => `${s.label} ${formatCapacity(s.tb)}`).join(', ')">
        <div
          v-for="s in segments"
          v-show="s.tb > 0"
          :key="s.key"
          :class="['seg', s.key]"
          :style="{ width: `${share(s.tb) * 100}%` }"
          :title="`${s.label}: ${formatCapacity(s.tb)} (${s.pct})`"
        >
          <span v-if="share(s.tb) >= 0.1" class="pct">{{ s.pct }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.bar-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 0.6rem;

  .title {
    font-family: $font-display;
    font-weight: 700;
    font-size: 0.95rem;
  }

  .total {
    font-family: $font-mono;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
}

// Height of the marker row; taller with the larger recommended marker.
.distribution {
  --marker-h: 11px;

  &.with-recommended {
    --marker-h: 16px;
  }
}

.tick.nearfull {
  color: var(--marker-nearfull);
}

.tick.backfillfull {
  color: var(--marker-backfillfull);
}

.tick.full {
  color: var(--marker-full);
}

.tick.recommended {
  color: var(--accent-text);
}

.track {
  position: relative;
}

.markers {
  position: relative;
  height: calc(var(--marker-h) + 2px);
}

.marker {
  position: absolute;
  bottom: 2px;
  transform: translateX(-50%);
  line-height: 0;
  cursor: help;
}

.tick {
  position: absolute;
  top: calc(var(--marker-h) + 2px);
  bottom: 0;
  width: 0;
  border-left: 1.5px dashed currentColor;
  transform: translateX(-50%);
  opacity: 0.85;
  pointer-events: none;
  z-index: 1;
}

.bar {
  display: flex;
  height: 40px;
  border-radius: $radius-sm;
  overflow: hidden;
  border: 1px solid var(--border);
  background: var(--reserved);
}

.seg {
  display: flex;
  align-items: center;
  padding: 0 0.6rem;
  flex: 0 0 auto;
  min-width: 0;
  transition: width 0.35s ease;
  overflow: hidden;

  & + .seg {
    border-left: 1px solid var(--panel);
  }

  .pct {
    font-family: $font-mono;
    font-size: 0.78rem;
    font-weight: 500;
  }
}

.seg.usable {
  background: var(--accent);
  color: var(--on-accent);
}

.seg.protection {
  background: var(--protection);
  color: #fff;
}

.seg.reserved {
  color: var(--text-muted);
  background: repeating-linear-gradient(
    135deg,
    var(--reserved) 0 7px,
    var(--reserved-stripe) 7px 9px
  );
}

.seg.unusable {
  color: var(--text-muted);
  background: repeating-linear-gradient(
    135deg,
    var(--unusable) 0 7px,
    var(--unusable-stripe) 7px 9px
  );
}

@include below($bp-sm) {
  .bar {
    height: 38px;
  }
}
</style>
