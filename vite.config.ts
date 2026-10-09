import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { VERSION_TAG_GLOB, channelLabel, versionLabel } from './src/lib/version'
import { iconsPlugin } from './build/icons'

/**
 * `git describe` for the version label. Builds without .git (the container) get it from
 * CEPH_CALC_GIT_DESCRIBE instead; no git, no repo or no matching tag gives null (no label).
 */
function gitDescribe(): string | null {
  if (process.env.CEPH_CALC_GIT_DESCRIBE) return process.env.CEPH_CALC_GIT_DESCRIBE
  try {
    return execSync(`git describe --tags --long --match '${VERSION_TAG_GLOB}'`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
  } catch {
    return null
  }
}

export default defineConfig({
  // favicon.ico, apple-touch-icon and the manifest icons are rendered from favicon.svg.
  plugins: [vue(), iconsPlugin(fileURLToPath(new URL('./public/favicon.svg', import.meta.url)))],
  define: {
    // Channel badge (alpha, beta, stable, …); "dev" without CEPH_CALC_CHANNEL.
    __APP_CHANNEL__: JSON.stringify(channelLabel(process.env.CEPH_CALC_CHANNEL)),
    // CEPH_CALC_VERSION overrides the label from the nearest version tag.
    __APP_VERSION__: JSON.stringify(versionLabel(process.env.CEPH_CALC_VERSION, gitDescribe())),
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
        additionalData: '@use "@/styles/tokens" as *;\n',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'build/**/*.test.ts'],
  },
})
