import { SLOTS, isValidSlot } from '../../core/index.ts'

export interface SlotOption {
  /** Always "HH:MM" (what is saved). */
  value: string
  /** Shown to the user: always 24-hour "HH:MM" (Israeli/European convention), whatever the browser locale. */
  label: string
}

/**
 * Display label for a slot. Always 24-hour, zero-padded ("09:00", "15:30"), never "3:00 PM": the label is the
 * wall-clock slot itself, so it does not depend on the device locale, timezone or DST.
 */
export function formatSlot(slot: string): string {
  return isValidSlot(slot) ? slot : '09:00'
}

export function slotOptions(): SlotOption[] {
  return SLOTS.map((value) => ({ value, label: formatSlot(value) }))
}

/**
 * Makes `select` hold exactly the 48 slots with 24-hour labels, selecting `value`.
 * Reuses existing option elements (the build pre-renders them) so focus and scroll are not disturbed.
 */
export function renderTimeSelect(select: HTMLSelectElement, value: string): void {
  const opts = slotOptions()
  const doc = select.ownerDocument
  const existing = Array.from(select.options)
  const reusable = existing.length === opts.length && existing.every((o, i) => o.value === opts[i]!.value)
  if (!reusable) {
    select.replaceChildren(
      ...opts.map((o) => {
        const el = doc.createElement('option')
        el.value = o.value
        return el
      }),
    )
  }
  Array.from(select.options).forEach((el, i) => {
    const label = opts[i]!.label
    if (el.textContent !== label) el.textContent = label
  })
  select.value = isValidSlot(value) ? value : '09:00'
}
