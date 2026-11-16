import type { Clock } from '../../src/core/ports/clock.ts'

/** Controllable clock for tests. */
export class FakeClock implements Clock {
  private current: Date

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = new Date(start.getTime())
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  set(date: Date): void {
    this.current = new Date(date.getTime())
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}
