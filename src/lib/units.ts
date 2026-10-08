// Display unit for output capacities (inputs such as OSD sizes are always decimal TB).

import { ref } from 'vue'
import { formatTB, formatTiB, TIB_PER_TB } from './format'

export type CapacityUnit = 'TB' | 'TiB'

const STORAGE_KEY = 'ceph-calculator-unit'

function load(): CapacityUnit {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'TB' || stored === 'TiB') return stored
  } catch {
    // storage unavailable (private mode, tests)
  }
  return 'TB'
}

export const capacityUnit = ref<CapacityUnit>(load())

export function setCapacityUnit(unit: CapacityUnit): void {
  capacityUnit.value = unit
  try {
    localStorage.setItem(STORAGE_KEY, unit)
  } catch {
    // ignore
  }
}

/** Format a decimal-TB capacity in the selected output unit (reactive in templates and computeds). */
export function formatCapacity(tb: number): string {
  return capacityUnit.value === 'TiB' ? formatTiB(tb) : formatTB(tb)
}

/** Selected base unit per decimal TB (1 for TB, ≈0.909 for TiB), for axis tick maths. */
export function unitPerTB(): number {
  return capacityUnit.value === 'TiB' ? TIB_PER_TB : 1
}
