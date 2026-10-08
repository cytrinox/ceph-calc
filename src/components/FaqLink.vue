<script setup lang="ts">
import { openFaq, type FaqId } from '@/lib/faq'

defineProps<{ target: FaqId; topic: string }>()
</script>

<template>
  <button
    type="button"
    class="faq-link"
    :aria-label="`Explain ${topic} (FAQ)`"
    :title="`Explain ${topic} (FAQ)`"
    @click="openFaq(target)"
  >
    ?
  </button>
</template>

<style lang="scss" scoped>
.faq-link {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 17px;
  height: 17px;
  margin-left: 0.35rem;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-family: $font-display;
  font-size: 0.66rem;
  font-weight: 700;
  line-height: 1;
  vertical-align: 0.15em;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background 0.15s;

  &:hover,
  &:focus-visible {
    color: var(--accent-text);
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  // Bigger hit area on touch screens without enlarging the circle.
  @include touch {
    &::before {
      content: '';
      position: absolute;
      inset: -12px;
    }
  }
}
</style>
