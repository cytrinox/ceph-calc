import { defaultMinSize, type Scheme } from './ceph'

export interface Preset {
  id: string
  label: string
  scheme: Scheme
}

const rep = (size: number): Preset => ({
  id: `rep${size}`,
  label: `Replication ${size}x`,
  scheme: { kind: 'replicated', size, minSize: defaultMinSize(size) },
})

const ec = (k: number, m: number): Preset => ({
  id: `ec${k}-${m}`,
  label: `EC ${k}+${m}`,
  scheme: { kind: 'ec', k, m },
})

/** Ordered by type, then by increasing size / k / m. */
export const PRESETS: Preset[] = [
  rep(2),
  rep(3),
  rep(4),
  ec(2, 1),
  ec(2, 2),
  ec(4, 2),
  ec(4, 3),
  ec(6, 2),
  ec(6, 3),
  ec(8, 2),
  ec(8, 3),
]

/** Ceph's default pool layout: replication 3x. */
export const DEFAULT_PRESET_ID = 'rep3'
export const DEFAULT_SCHEME: Scheme = { ...PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)!.scheme }

export const CUSTOM_REPLICATED = 'custom-replicated'
export const CUSTOM_EC = 'custom-ec'

export function sameScheme(a: Scheme, b: Scheme): boolean {
  if (a.kind === 'replicated' && b.kind === 'replicated') return a.size === b.size && a.minSize === b.minSize
  if (a.kind === 'ec' && b.kind === 'ec') return a.k === b.k && a.m === b.m
  return false
}

export function matchPreset(scheme: Scheme): Preset | undefined {
  return PRESETS.find((p) => sameScheme(p.scheme, scheme))
}

/** Dropdown value for a scheme: the matching preset id, or a custom option. */
export function schemeSelection(scheme: Scheme): string {
  return matchPreset(scheme)?.id ?? (scheme.kind === 'replicated' ? CUSTOM_REPLICATED : CUSTOM_EC)
}

export function schemeLabel(scheme: Scheme): string {
  const preset = matchPreset(scheme)
  if (preset) return preset.label
  if (scheme.kind === 'replicated') return `Replication ${scheme.size}x (min_size ${scheme.minSize})`
  return `EC ${scheme.k}+${scheme.m}`
}
