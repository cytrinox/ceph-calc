<script setup lang="ts">
import { onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { applyTheme, loadTheme, saveTheme, type Theme } from '@/lib/theme'

const theme = ref<Theme>('dark')

onMounted(() => {
  theme.value = loadTheme()
  applyTheme(theme.value)
})

function toggle() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  applyTheme(theme.value)
  saveTheme(theme.value)
}
</script>

<template>
  <button
    type="button"
    class="toggle"
    :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
    :title="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`"
    @click="toggle"
  >
    <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="18" />
  </button>
</template>

<style lang="scss" scoped>
.toggle {
  display: inline-grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel);
  box-shadow: var(--shadow);
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--accent-text);
    border-color: var(--border-strong);
  }

  @include touch {
    width: 44px;
    height: 44px;
  }
}
</style>
