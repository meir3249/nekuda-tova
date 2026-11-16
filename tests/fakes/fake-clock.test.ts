import { describe, expect, it } from 'vitest'
import { FakeClock } from './fake-clock.ts'

describe('FakeClock', () => {
  it('starts at the given date and returns copies', () => {
    const start = new Date('2026-03-01T10:00:00.000Z')
    const clock = new FakeClock(start)
    const a = clock.now()
    a.setUTCFullYear(1999)
    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z')
  })

  it('set() replaces the time', () => {
    const clock = new FakeClock()
    clock.set(new Date('2027-01-02T03:04:05.000Z'))
    expect(clock.now().toISOString()).toBe('2027-01-02T03:04:05.000Z')
  })

  it('advance() moves time forward and backward', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'))
    clock.advance(90_000)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z')
    clock.advance(-90_000)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
})
