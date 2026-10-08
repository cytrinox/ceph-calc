/**
 * Next value when a stepper button snaps to whole multiples of `step`:
 * 0.5 → 1 (up), 1.3 → 2 (up) / 1 (down), 3 → 4 / 2. Never goes below one step.
 */
export function snapStep(current: number, direction: 1 | -1, step: number): number {
  const units = (Number(current) || 0) / step
  const eps = 1e-9
  const next = direction > 0 ? Math.floor(units + eps) + 1 : Math.ceil(units - eps) - 1
  return Math.max(1, next) * step
}

/** Parse a typed number, accepting a comma or a dot as decimal separator ("0,85" or "0.85"). NaN if invalid. */
export function parseDecimal(text: string): number {
  const normalized = text.trim().replace(',', '.')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(normalized)) return Number.NaN
  return Number(normalized)
}
