const SLOT_RE = /^([01][0-9]|2[0-3]):(00|30)$/

export function isValidSlot(t: string): boolean {
  return typeof t === 'string' && SLOT_RE.test(t)
}

/** The 48 half-hour slots `00:00 … 23:30`. */
export const SLOTS: readonly string[] = Array.from({ length: 48 }, (_, i) => {
  const hh = String(Math.floor(i / 2)).padStart(2, '0')
  return `${hh}:${i % 2 === 0 ? '00' : '30'}`
})

/** Parses a valid slot into hour/minute. Throws `RangeError` on an invalid slot. */
export function parseSlot(t: string): { hh: number; mm: number } {
  if (!isValidSlot(t)) throw new RangeError(`Invalid slot: ${String(t)}`)
  return { hh: Number(t.slice(0, 2)), mm: Number(t.slice(3, 5)) }
}
