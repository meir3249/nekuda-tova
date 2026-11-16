export const DEFAULT_MAX_LATE_SECONDS = 7200

/** D-011: a send up to and including 7200 s late is still sent; beyond that it is stale. */
export function evaluateDelay(
  scheduledFor: Date,
  attemptedAt: Date,
  maxLateSeconds: number = DEFAULT_MAX_LATE_SECONDS,
): { delaySeconds: number; stale: boolean } {
  const delaySeconds = Math.max(0, Math.floor((attemptedAt.getTime() - scheduledFor.getTime()) / 1000))
  return { delaySeconds, stale: delaySeconds > maxLateSeconds }
}
