import { describe, expect, it } from 'vitest'
import { SystemClock } from '../../src/adapters/system/system-clock.ts'

describe('SystemClock', () => {
  it('returns a Date close to the real time', () => {
    const before = Date.now()
    const now = new SystemClock().now()
    const after = Date.now()
    expect(now).toBeInstanceOf(Date)
    expect(now.getTime()).toBeGreaterThanOrEqual(before)
    expect(now.getTime()).toBeLessThanOrEqual(after)
  })
})
