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

export const REPO_URL = 'https://github.com/cytrinox/ceph-calc'

/**
 * Where the version label links to: the GitHub release of its tag (v1.2.3+5 → v1.2.3), or the release
 * list for labels that are no version tag (e.g. an override like "nightly").
 */
export function versionLink(label: string): { url: string; title: string } {
  const match = label.match(/^(.*?)(?:\+(\d+))?$/)!
  const [, tag, distance] = match
  if (!VERSION_TAG.test(tag)) return { url: `${REPO_URL}/releases`, title: `Version ${label}: releases on GitHub` }
  const after = distance ? `, ${distance} ${Number(distance) === 1 ? 'commit' : 'commits'} later` : ''
  return { url: `${REPO_URL}/releases/tag/${tag}`, title: `Release ${tag} on GitHub${after}` }
}
