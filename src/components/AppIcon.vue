<script setup lang="ts">
export type IconName =
  | 'plus'
  | 'minus'
  | 'copy'
  | 'split'
  | 'trash'
  | 'chevron'
  | 'sun'
  | 'moon'
  | 'reset'
  | 'sparkle'
  | 'alert'
  | 'server'
  | 'shield'
  | 'gauge'
  | 'database'
  | 'pulse'
  | 'columns'
  | 'check'
  | 'terminal'
  | 'download'
  | 'disk-read'
  | 'disk-write'
  | 'share'
  | 'help'
  | 'scale'

defineProps<{ name: IconName; size?: number }>()

const PATHS: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  split: 'M4 6h16M4 12h7m2 0h7M4 18h4m3 0h2m3 0h4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chevron: 'M9 6l6 6-6 6',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  reset: 'M4 4v6h6M4.5 15a8 8 0 1 0 1.9-8.3L4 10',
  sparkle: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  gauge: 'M12 14l4-4M3.5 18a9 9 0 1 1 17 0',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  pulse: 'M3 12h4l2-5 4 10 2-5h6',
  columns: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  check: 'M5 12l5 5L20 7',
  terminal: 'M4 17l6-5-6-5M12 19h8',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 21h16',
  // The line is the disk: reads point away from it, writes towards it.
  'disk-read': 'M12 17V3m0 0-4 4m4-4 4 4M4 21h16',
  'disk-write': 'M12 3v14m0 0-4-4m4 4 4-4M4 21h16',
  help: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  share: 'M10 14a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5M14 10a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  scale: 'M12 4v16M8 20h8M5 7h14M5 7l-2.5 7M5 7l2.5 7M2.5 14a2.5 2.5 0 0 0 5 0zM19 7l-2.5 7M19 7l2.5 7M16.5 14a2.5 2.5 0 0 0 5 0z',
}
</script>

<template>
  <svg
    :width="size ?? 16"
    :height="size ?? 16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>
