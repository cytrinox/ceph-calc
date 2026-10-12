import type { InjectionKey, Ref } from 'vue'

/** Returns the set of all bucket names in the tree, used to generate unique names. */
export const USED_NAMES_KEY: InjectionKey<() => Set<string>> = Symbol('usedNames')

/** Device classes OSD groups can pick from: the built-in ones plus custom ones already used in the tree. */
export const DEVICE_CLASSES_KEY: InjectionKey<Readonly<Ref<string[]>>> = Symbol('deviceClasses')
