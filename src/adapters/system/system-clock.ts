import type { Clock } from '../../core/ports/clock.ts'

/** Real clock backed by the system time. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date()
  }
}
