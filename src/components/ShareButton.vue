<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { copyText } from '@/lib/clipboard'
import { shareUrl, writeStateToUrl, type AppState } from '@/lib/urlState'

const props = defineProps<{ state: AppState }>()

type Status = 'idle' | 'copied' | 'failed'
const status = ref<Status>('idle')
let timer: ReturnType<typeof setTimeout> | undefined

function flash(next: Status) {
  status.value = next
  clearTimeout(timer)
  timer = setTimeout(() => (status.value = 'idle'), 2200)
}

async function share() {
  // Make the address bar match the link right away (the regular sync is debounced).
  writeStateToUrl(props.state)
  const url = shareUrl(props.state)

  // Phones and tablets: use the native share sheet; desktops: copy the link.
  const touch = window.matchMedia?.('(pointer: coarse)').matches
  if (touch && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Ceph capacity plan', url })
      return
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return
    }
  }
  if (await copyText(url)) {
    flash('copied')
  } else {
    // Clipboard blocked: let the user copy the link by hand.
    flash('failed')
    window.prompt('Copy this link to share the configuration:', url)
  }
}
</script>

<template>
  <button
    type="button"
    class="share"
    :class="status"
    title="Copy a link that restores this configuration"
    aria-label="Share this configuration"
    @click="share"
  >
    <AppIcon :name="status === 'copied' ? 'check' : 'share'" :size="16" />
    <span class="text">{{ status === 'copied' ? 'Link copied' : status === 'failed' ? 'Copy failed' : 'Share' }}</span>
    <span class="visually-hidden" aria-live="polite">
      {{ status === 'copied' ? 'Link to this configuration copied to the clipboard' : status === 'failed' ? 'Could not copy the link' : '' }}
    </span>
  </button>
</template>

<style lang="scss" scoped>
.share {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  height: 42px;
  padding: 0 1rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text);
  font-weight: 500;
  font-size: 0.88rem;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;

  svg {
    color: var(--accent-text);
  }

  &:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  &.copied {
    border-color: var(--accent);
    color: var(--accent-text);
  }

  &.failed {
    border-color: var(--danger);
    color: var(--danger);

    svg {
      color: inherit;
    }
  }

  @include touch {
    height: 44px;
  }

  @include below($bp-sm) {
    width: 44px;
    padding: 0;
    justify-content: center;

    .text {
      display: none;
    }
  }
}
</style>
