import { describe, expect, it } from 'vitest'
import { evaluateDelay } from '../../../src/core/scheduling/staleness.ts'
import { isValidSlot, SLOTS } from '../../../src/core/scheduling/slots.ts'
import { isValidTimezone } from '../../../src/core/scheduling/timezone.ts'

describe('slots', () => {
  it('has exactly 48 valid slots', () => {
    expect(SLOTS).toHaveLength(48)
    expect(SLOTS[0]).toBe('00:00')
    expect(SLOTS[1]).toBe('00:30')
    expect(SLOTS[47]).toBe('23:30')
    for (const s of SLOTS) expect(isValidSlot(s)).toBe(true)
  })

  it.each(['9:00', '09:15', '24:00', '09:0', '09:00 ', ' 09:00', '09:60', '', '0900', '12:45'])(
    'rejects %j',
    (s) => {
      expect(isValidSlot(s)).toBe(false)
    },
  )
})

describe('isValidTimezone', () => {
  it.each(['Asia/Jerusalem', 'America/New_York', 'UTC', 'Asia/Kathmandu', 'Australia/Lord_Howe'])(
    'accepts %s',
    (tz) => {
      expect(isValidTimezone(tz)).toBe(true)
    },
  )
  it.each(['Asia/Nowhere', '+02:00', 'IST', '', 'EST', 'utc-5'])('rejects %j', (tz) => {
    expect(isValidTimezone(tz)).toBe(false)
  })
})

describe('evaluateDelay', () => {
  const sched = new Date('2027-01-01T10:00:00.000Z')
  const at = (s: number) => new Date(sched.getTime() + s * 1000)

  it('on time and early are not stale; early clamps to 0', () => {
    expect(evaluateDelay(sched, sched)).toEqual({ delaySeconds: 0, stale: false })
    expect(evaluateDelay(sched, at(-30))).toEqual({ delaySeconds: 0, stale: false })
  })

  it('7199 s and 7200 s are sent; 7201 s is stale', () => {
    expect(evaluateDelay(sched, at(7199))).toEqual({ delaySeconds: 7199, stale: false })
    expect(evaluateDelay(sched, at(7200))).toEqual({ delaySeconds: 7200, stale: false })
    expect(evaluateDelay(sched, at(7201))).toEqual({ delaySeconds: 7201, stale: true })
  })

  it('floors sub-second delays', () => {
    expect(evaluateDelay(sched, new Date(sched.getTime() + 7200_999)).stale).toBe(false)
    expect(evaluateDelay(sched, new Date(sched.getTime() + 7201_000)).stale).toBe(true)
  })

  it('honors a custom limit', () => {
    expect(evaluateDelay(sched, at(61), 60).stale).toBe(true)
  })
})
