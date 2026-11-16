/**
 * Progression: which message a user receives.
 * Indexing is 0-based: `index = (startIndex + counter) mod n`, in `[0, n-1]`.
 * The counter is never reduced by modulo anywhere; `n` is read at send time.
 */

const MAX_START_INDEX = 2 ** 31 - 1

function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer, got ${String(value)}`)
  }
}

export function messageIndexFor(startIndex: number, counter: number, n: number): number {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`n must be an integer >= 1, got ${String(n)}`)
  }
  assertNonNegativeSafeInteger(startIndex, 'startIndex')
  assertNonNegativeSafeInteger(counter, 'counter')
  const sum = startIndex + counter
  if (sum > Number.MAX_SAFE_INTEGER) {
    throw new RangeError('startIndex + counter exceeds Number.MAX_SAFE_INTEGER')
  }
  return sum % n
}

/** Random integer in `[0, 2^31-1]` from a `Math.random`-compatible `rng` (`[0,1)`). */
export function randomStartIndex(rng: () => number): number {
  const r = rng()
  if (!Number.isFinite(r) || r < 0 || r >= 1) {
    throw new RangeError(`rng must return a value in [0, 1), got ${String(r)}`)
  }
  return Math.min(MAX_START_INDEX, Math.floor(r * (MAX_START_INDEX + 1)))
}
