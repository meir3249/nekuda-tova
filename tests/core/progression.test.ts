import { describe, expect, it } from 'vitest'
import { messageIndexFor, randomStartIndex } from '../../src/core/progression/index.ts'

describe('messageIndexFor', () => {
  it('matches the spec examples', () => {
    // Spec originally said 7; 562 = 13*41 + 29, so the correct value is 29.
    expect(messageIndexFor(0, 562, 41)).toBe(29)
    expect(messageIndexFor(40, 562, 41)).toBe(28)
  })

  it('stays correct for counters up to 2^40', () => {
    const c = 2 ** 40
    expect(messageIndexFor(0, c, 41)).toBe(c % 41)
    expect(messageIndexFor(2 ** 31 - 1, c, 38)).toBe((2 ** 31 - 1 + c) % 38)
  })

  it('n=1 is always 0', () => {
    expect(messageIndexFor(0, 0, 1)).toBe(0)
    expect(messageIndexFor(123456, 987654, 1)).toBe(0)
  })

  it('always lands in [0, n-1]', () => {
    for (let c = 0; c < 500; c++) {
      const i = messageIndexFor(17, c, 41)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(41)
    }
  })

  it('throws RangeError on precondition violations', () => {
    expect(() => messageIndexFor(0, 0, 0)).toThrow(RangeError)
    expect(() => messageIndexFor(0, 0, -3)).toThrow(RangeError)
    expect(() => messageIndexFor(0, 0, 1.5)).toThrow(RangeError)
    expect(() => messageIndexFor(-1, 0, 5)).toThrow(RangeError)
    expect(() => messageIndexFor(0, -1, 5)).toThrow(RangeError)
    expect(() => messageIndexFor(0.5, 1, 5)).toThrow(RangeError)
    expect(() => messageIndexFor(1, Number.MAX_SAFE_INTEGER, 5)).toThrow(RangeError)
    expect(() => messageIndexFor(0, Number.MAX_SAFE_INTEGER + 1, 5)).toThrow(RangeError)
    expect(() => messageIndexFor(0, Number.NaN, 5)).toThrow(RangeError)
  })

  it('accepts the exact safe-integer boundary', () => {
    expect(messageIndexFor(0, Number.MAX_SAFE_INTEGER, 7)).toBe(Number.MAX_SAFE_INTEGER % 7)
  })
})

describe('randomStartIndex', () => {
  it('bounds with rng 0 and 0.999999', () => {
    expect(randomStartIndex(() => 0)).toBe(0)
    const top = randomStartIndex(() => 0.999999)
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThanOrEqual(2 ** 31 - 1)
    expect(Number.isInteger(top)).toBe(true)
  })

  it('is deterministic for an injected rng', () => {
    expect(randomStartIndex(() => 0.5)).toBe(2 ** 30)
  })

  it('rejects an out-of-contract rng', () => {
    expect(() => randomStartIndex(() => 1)).toThrow(RangeError)
    expect(() => randomStartIndex(() => -0.1)).toThrow(RangeError)
    expect(() => randomStartIndex(() => Number.NaN)).toThrow(RangeError)
  })
})
