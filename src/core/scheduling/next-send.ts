import { isValidSlot, parseSlot } from './slots.ts'
import { addCalendarDays, isValidTimezone, localDateOf, localToInstant } from './timezone.ts'

const MIN_MS = Date.UTC(2000, 0, 1)
const MAX_MS = Date.UTC(2200, 0, 1)

/**
 * First instant strictly after `after` at which the local clock in `tz` shows `localTime`.
 * An instant exactly equal to `after` is not "upcoming".
 */
export function nextOccurrenceAfter(localTime: string, tz: string, after: Date): Date {
  if (!isValidSlot(localTime)) throw new RangeError(`Invalid slot: ${String(localTime)}`)
  if (!isValidTimezone(tz)) throw new RangeError(`Invalid timezone: ${String(tz)}`)
  const ms = after.getTime()
  if (!Number.isFinite(ms) || ms < MIN_MS || ms >= MAX_MS) {
    throw new RangeError('after must be a valid instant between years 2000 and 2200')
  }

  const { hh, mm } = parseSlot(localTime)
  const day = localDateOf(tz, after)
  const candidate = localToInstant(tz, day, hh, mm)
  if (candidate.getTime() > ms) return candidate
  return localToInstant(tz, addCalendarDays(day, 1), hh, mm)
}
