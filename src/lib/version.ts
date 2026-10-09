// Version label shown next to the beta badge, resolved at build time (see vite.config.ts).

/** Release tags: v1.2.3, optionally with a pre-release suffix (v2.0.0-rc.1). */
export const VERSION_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/

/** Glob for `git describe --match`; VERSION_TAG checks the result. */
export const VERSION_TAG_GLOB = 'v[0-9]*.[0-9]*.[0-9]*'

/**
 * Label for the page title; '' = no label. A non-empty override wins as-is; otherwise the output of
 * `git describe --tags --long` (v1.2.3-5-gabc1234) gives "v1.2.3" on the tag and "v1.2.3+5" after it.
 */
export function versionLabel(override: string | undefined, describe: string | null): string {
  const forced = override?.trim()
  if (forced) return forced
  const match = describe?.trim().match(/^(.*)-(\d+)-g[0-9a-f]+$/)
  if (!match || !VERSION_TAG.test(match[1])) return ''
  const [, tag, distance] = match
  return Number(distance) > 0 ? `${tag}+${Number(distance)}` : tag
}
