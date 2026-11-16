import { describe, expect, it } from 'vitest'
import { nextOccurrenceAfter } from '../../../src/core/scheduling/next-send.ts'
import {
  localDateOf,
  localToInstant,
  offsetMinutesAt,
} from '../../../src/core/scheduling/timezone.ts'

const iso = (d: Date) => d.toISOString()
const next = (slot: string, tz: string, after: string) => iso(nextOccurrenceAfter(slot, tz, new Date(after)))

/**
 * Expected values below were derived by hand from tzdata rules and are verified by these
 * tests against the runtime's ICU data. 2026-2027 transitions:
 *  - Asia/Jerusalem: DST ends Sun 2026-10-25 02:00→01:00 (+3→+2); starts Fri 2027-03-26 02:00→03:00 (+2→+3)
 *  - America/New_York: starts Sun 2027-03-14 02:00→03:00; ends Sun 2027-11-07 02:00→01:00
 *  - Australia/Lord_Howe (30-min shift): starts Sun 2026-10-04 02:00→02:30 (+10:30→+11);
 *    ends Sun 2027-04-04 02:00→01:30 (+11→+10:30)
 */
describe('offsets', () => {
  it('handles 30 and 45 minute offsets', () => {
    expect(offsetMinutesAt('Asia/Kolkata', new Date('2027-01-01T00:00:00Z'))).toBe(330)
    expect(offsetMinutesAt('Asia/Kathmandu', new Date('2027-01-01T00:00:00Z'))).toBe(345)
    expect(offsetMinutesAt('Australia/Lord_Howe', new Date('2027-01-01T00:00:00Z'))).toBe(660)
    expect(offsetMinutesAt('Australia/Lord_Howe', new Date('2027-06-01T00:00:00Z'))).toBe(630)
    expect(offsetMinutesAt('Pacific/Kiritimati', new Date('2027-01-01T00:00:00Z'))).toBe(840)
    expect(offsetMinutesAt('Pacific/Pago_Pago', new Date('2027-01-01T00:00:00Z'))).toBe(-660)
    expect(offsetMinutesAt('UTC', new Date('2027-01-01T00:00:00Z'))).toBe(0)
  })

  it('reflects DST', () => {
    expect(offsetMinutesAt('Asia/Jerusalem', new Date('2027-01-15T00:00:00Z'))).toBe(120)
    expect(offsetMinutesAt('Asia/Jerusalem', new Date('2027-07-15T00:00:00Z'))).toBe(180)
  })
})

describe('Asia/Jerusalem', () => {
  it('09:00 stays local 09:00 across spring forward; UTC shifts by 1 h', () => {
    expect(next('09:00', 'Asia/Jerusalem', '2027-03-24T12:00:00Z')).toBe('2027-03-25T07:00:00.000Z')
    expect(next('09:00', 'Asia/Jerusalem', '2027-03-25T12:00:00Z')).toBe('2027-03-26T06:00:00.000Z')
    expect(next('09:00', 'Asia/Jerusalem', '2027-03-26T12:00:00Z')).toBe('2027-03-27T06:00:00.000Z')
  })

  it('02:30 on 2027-03-26 (nonexistent) → transition instant (local 03:00)', () => {
    const r = nextOccurrenceAfter('02:30', 'Asia/Jerusalem', new Date('2027-03-25T12:00:00Z'))
    expect(iso(r)).toBe('2027-03-26T00:00:00.000Z')
    expect(offsetMinutesAt('Asia/Jerusalem', r)).toBe(180)
  })

  it('01:30 on 2026-10-25 (ambiguous) → first occurrence (+3)', () => {
    expect(next('01:30', 'Asia/Jerusalem', '2026-10-24T12:00:00Z')).toBe('2026-10-24T22:30:00.000Z')
  })

  it('after the first occurrence, the next 01:30 is the following day (+2)', () => {
    expect(next('01:30', 'Asia/Jerusalem', '2026-10-24T22:30:00Z')).toBe('2026-10-25T23:30:00.000Z')
    // Between first and second occurrence is still "after" the first.
    expect(next('01:30', 'Asia/Jerusalem', '2026-10-24T23:00:00Z')).toBe('2026-10-25T23:30:00.000Z')
  })
})

describe('America/New_York', () => {
  it('02:30 on 2027-03-14 (nonexistent) → transition instant', () => {
    expect(next('02:30', 'America/New_York', '2027-03-13T12:00:00Z')).toBe('2027-03-14T07:00:00.000Z')
  })

  it('01:30 on 2027-11-07 (ambiguous) → first occurrence (EDT)', () => {
    expect(next('01:30', 'America/New_York', '2027-11-06T12:00:00Z')).toBe('2027-11-07T05:30:00.000Z')
  })
})

describe('half-hour and 45-minute offsets', () => {
  it('Asia/Kolkata 09:30 (+05:30)', () => {
    expect(next('09:30', 'Asia/Kolkata', '2027-01-01T00:00:00Z')).toBe('2027-01-01T04:00:00.000Z')
  })
  it('Asia/Kathmandu 09:00 (+05:45)', () => {
    expect(next('09:00', 'Asia/Kathmandu', '2027-01-01T00:00:00Z')).toBe('2027-01-01T03:15:00.000Z')
  })
})

describe('Australia/Lord_Howe (30-minute DST shift)', () => {
  it('start 2026-10-04: slot 02:00 does not exist → transition instant (15:30Z on Oct 3)', () => {
    expect(next('02:00', 'Australia/Lord_Howe', '2026-10-03T12:00:00Z')).toBe('2026-10-03T15:30:00.000Z')
  })
  it('start 2026-10-04: slot 02:30 exists at +11 and equals the transition instant', () => {
    expect(next('02:30', 'Australia/Lord_Howe', '2026-10-03T12:00:00Z')).toBe('2026-10-03T15:30:00.000Z')
  })
  it('start 2026-10-04: slot 01:30 is still at +10:30', () => {
    expect(next('01:30', 'Australia/Lord_Howe', '2026-10-03T12:00:00Z')).toBe('2026-10-03T15:00:00.000Z')
  })
  it('end 2027-04-04: ambiguous slot 01:30 → first occurrence at +11 (14:30Z on Apr 3)', () => {
    expect(next('01:30', 'Australia/Lord_Howe', '2027-04-03T12:00:00Z')).toBe('2027-04-03T14:30:00.000Z')
  })
  it('end 2027-04-04: slot 02:00 occurs once, at +10:30 (15:30Z on Apr 3)', () => {
    expect(next('02:00', 'Australia/Lord_Howe', '2027-04-03T12:00:00Z')).toBe('2027-04-03T15:30:00.000Z')
  })
})

describe('UTC and boundaries', () => {
  it('UTC is the identity', () => {
    expect(next('09:00', 'UTC', '2027-01-01T00:00:00Z')).toBe('2027-01-01T09:00:00.000Z')
    expect(next('23:30', 'UTC', '2027-01-01T00:00:00Z')).toBe('2027-01-01T23:30:00.000Z')
  })

  it.each(['UTC', 'Asia/Jerusalem', 'America/New_York', 'Asia/Kolkata'])(
    '%s: after exactly on a slot instant returns the next day; 1 ms before returns the same day',
    (tz) => {
      const slotInstant = nextOccurrenceAfter('09:00', tz, new Date('2027-05-10T00:00:00Z'))
      const nextDay = nextOccurrenceAfter('09:00', tz, slotInstant)
      expect(nextDay.getTime()).toBeGreaterThan(slotInstant.getTime())
      expect(localDateOf(tz, nextDay).d).not.toBe(localDateOf(tz, slotInstant).d)
      const justBefore = new Date(slotInstant.getTime() - 1)
      expect(iso(nextOccurrenceAfter('09:00', tz, justBefore))).toBe(iso(slotInstant))
    },
  )

  it('23 h and 25 h days still produce local HH:MM the next day', () => {
    const cases: [string, string, string][] = [
      ['Asia/Jerusalem', '2027-03-25T00:00:00Z', '2027-03-28T00:00:00Z'], // 23 h day on 03-26
      ['America/New_York', '2027-11-06T00:00:00Z', '2027-11-09T00:00:00Z'], // 25 h day on 11-07
      ['America/New_York', '2027-03-13T00:00:00Z', '2027-03-16T00:00:00Z'], // 23 h day on 03-14
      ['Asia/Jerusalem', '2026-10-24T00:00:00Z', '2026-10-27T00:00:00Z'], // 25 h day on 10-25
    ]
    for (const [tz, start, end] of cases) {
      let t = new Date(start)
      while (t.getTime() < new Date(end).getTime()) {
        t = nextOccurrenceAfter('09:00', tz, t)
        const off = offsetMinutesAt(tz, t)
        const local = new Date(t.getTime() + off * 60_000)
        expect([local.getUTCHours(), local.getUTCMinutes()]).toEqual([9, 0])
      }
    }
  })

  it('consecutive days are exactly one calendar day apart over a full year', () => {
    for (const tz of ['Asia/Jerusalem', 'America/New_York', 'Australia/Lord_Howe']) {
      let t = nextOccurrenceAfter('12:00', tz, new Date('2026-12-31T00:00:00Z'))
      let prev = localDateOf(tz, t)
      for (let i = 0; i < 400; i++) {
        t = nextOccurrenceAfter('12:00', tz, t)
        const cur = localDateOf(tz, t)
        const diff = (Date.UTC(cur.y, cur.m - 1, cur.d) - Date.UTC(prev.y, prev.m - 1, prev.d)) / 86_400_000
        expect(diff).toBe(1)
        prev = cur
      }
    }
  })

  it('Pacific/Kiritimati (+14) and Pacific/Pago_Pago (-11) local date boundaries', () => {
    // 09:59Z = 23:59 local on Jan 1 in Kiritimati → next 00:00 is Jan 2 local = 10:00Z.
    expect(next('00:00', 'Pacific/Kiritimati', '2027-01-01T09:59:00Z')).toBe('2027-01-01T10:00:00.000Z')
    // 10:59Z = Dec 31 23:59 local in Pago_Pago → next 00:00 is Jan 1 local = 11:00Z.
    expect(next('00:00', 'Pacific/Pago_Pago', '2027-01-01T10:59:00Z')).toBe('2027-01-01T11:00:00.000Z')
    // Same UTC instant lands on different local dates.
    expect(localDateOf('Pacific/Kiritimati', new Date('2027-01-01T12:00:00Z'))).toEqual({ y: 2027, m: 1, d: 2 })
    expect(localDateOf('Pacific/Pago_Pago', new Date('2027-01-01T05:00:00Z'))).toEqual({ y: 2026, m: 12, d: 31 })
  })
})

describe('localToInstant', () => {
  it('returns the unique instant for an ordinary time', () => {
    expect(iso(localToInstant('Asia/Jerusalem', { y: 2027, m: 1, d: 15 }, 9, 0))).toBe('2027-01-15T07:00:00.000Z')
  })
})

describe('input validation', () => {
  const after = new Date('2027-01-01T00:00:00Z')
  it('rejects invalid slot and timezone with RangeError', () => {
    for (const s of ['9:00', '09:15', '24:00']) expect(() => nextOccurrenceAfter(s, 'UTC', after)).toThrow(RangeError)
    for (const tz of ['Asia/Nowhere', '+02:00', 'IST']) {
      expect(() => nextOccurrenceAfter('09:00', tz, after)).toThrow(RangeError)
    }
  })
  it('rejects `after` outside 2000–2200 or invalid', () => {
    expect(() => nextOccurrenceAfter('09:00', 'UTC', new Date('1969-12-31T00:00:00Z'))).toThrow(RangeError)
    expect(() => nextOccurrenceAfter('09:00', 'UTC', new Date('2200-01-01T00:00:00Z'))).toThrow(RangeError)
    expect(() => nextOccurrenceAfter('09:00', 'UTC', new Date(Number.NaN))).toThrow(RangeError)
  })
})
