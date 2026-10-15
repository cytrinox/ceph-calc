// FAQ entries that other parts of the page can link to.

export const FAQ_IDS = {
  realNet: 'faq-real-net-capacity',
  calculation: 'faq-calculation',
  recoveryReserve: 'faq-recovery-reserve',
  iops: 'faq-iops',
} as const

export type FaqId = (typeof FAQ_IDS)[keyof typeof FAQ_IDS]

/**
 * Open an FAQ entry, scroll to it and highlight it briefly. Uses script instead of a #fragment
 * link because the URL hash holds the shareable configuration.
 */
export function openFaq(id: FaqId): void {
  const item = document.getElementById(id)
  if (!item) return
  if (item instanceof HTMLDetailsElement) item.open = true
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  item.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  item.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  item.classList.remove('flash')
  void item.offsetWidth // restart the highlight animation
  item.classList.add('flash')
  window.setTimeout(() => item.classList.remove('flash'), 1600)
}
