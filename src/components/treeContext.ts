import type { InjectionKey } from 'vue'

/** Returns the set of all bucket names in the tree, used to generate unique names. */
export const USED_NAMES_KEY: InjectionKey<() => Set<string>> = Symbol('usedNames')
