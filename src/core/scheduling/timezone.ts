/**
 * Timezone helpers built only on `Intl.DateTimeFormat` (no dependencies).
 *
 * Gap/overlap rule (D-014):
 *  - ambiguous local time (clocks go back): the FIRST occurrence (earlier instant);
 *  - nonexistent local time (clocks go forward): the transition instant, i.e. the
 *    first instant whose local wall time is >= the requested time.
 */

export interface LocalDate {
  y: number
  m: number
  d: number
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
    formatters.set(tz, f)
  }
  return f
}

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0) return false
  // IANA-style only: rejects offsets ("+02:00") and abbreviations ("IST").
  if (tz !== 'UTC' && !tz.includes('/')) return false
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz })
    return true
  } catch {
    return false
  }
}

interface WallParts {
  y: number
  m: number
  d: number
  hh: number
  mm: number
  ss: number
}

function wallParts(tz: string, instantMs: number): WallParts {
  const out: WallParts = { y: 0, m: 0, d: 0, hh: 0, mm: 0, ss: 0 }
  for (const p of formatterFor(tz).formatToParts(new Date(instantMs))) {
    const v = Number(p.value)
    switch (p.type) {
      case 'year':
        out.y = v
        break
      case 'month':
        out.m = v
        break
      case 'day':
        out.d = v
        break
      case 'hour':
        out.hh = v % 24
        break
      case 'minute':
        out.mm = v
        break
      case 'second':
        out.ss = v
        break
      default:
        break
    }
  }
  return out
}

/** Local wall-clock time of an instant, expressed as if it were UTC (ms). */
function wallMs(tz: string, instantMs: number): number {
  const p = wallParts(tz, instantMs)
  return Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss)
}

/** UTC offset (minutes, east positive) of `tz` at `instant`. */
export function offsetMinutesAt(tz: string, instant: Date): number {
  const ms = instant.getTime()
  if (!Number.isFinite(ms)) throw new RangeError('Invalid instant')
  const truncated = Math.floor(ms / 1000) * 1000
  return Math.round((wallMs(tz, ms) - truncated) / MINUTE)
}

export function localDateOf(tz: string, instant: Date): LocalDate {
  const ms = instant.getTime()
  if (!Number.isFinite(ms)) throw new RangeError('Invalid instant')
  const p = wallParts(tz, ms)
  return { y: p.y, m: p.m, d: p.d }
}

/** Calendar-day arithmetic on a date tuple (never adds 24 h). */
export function addCalendarDays(date: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

export function localToInstant(tz: string, date: LocalDate, hh: number, mm: number): Date {
  const target = Date.UTC(date.y, date.m - 1, date.d, hh, mm)

  const offsets = new Set<number>([
    offsetMinutesAt(tz, new Date(target - DAY)),
    offsetMinutesAt(tz, new Date(target + DAY)),
  ])
  const valid: number[] = []
  for (const o of offsets) {
    const c = target - o * MINUTE
    if (wallMs(tz, c) === target) valid.push(c)
  }

  if (valid.length > 0) return new Date(Math.min(...valid)) // ambiguous → first occurrence

  // Nonexistent (spring forward): first instant whose local wall time >= requested.
  let lo = (target - DAY) / MINUTE // local < target
  let hi = (target + DAY) / MINUTE // local >= target
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (wallMs(tz, mid * MINUTE) >= target) hi = mid
    else lo = mid
  }
  return new Date(hi * MINUTE)
}
