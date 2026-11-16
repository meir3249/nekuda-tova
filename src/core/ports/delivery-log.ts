export type DeliveryStatus = 'sent' | 'skipped_stale' | 'failed' | 'expired_subscription'

export interface DeliveryLogEntry {
  userId: string
  scheduledFor: Date
  attemptedAt: Date
  delaySeconds: number
  status: DeliveryStatus
  pushStatus: number | null
  /** Counter used for the attempt (value before any increment). */
  counterValue: number
  runId: string | null
  /** Message id only; never message text. */
  messageId: string | null
}

export interface RunSummary {
  runId: string
  startedAt: Date
  finishedAt: Date
  outcome: 'ok' | 'aborted_invalid_content' | 'error'
  claimed: number
  sent: number
  skippedStale: number
  failed: number
  expired: number
}

export interface DeliveryLog {
  record(entry: DeliveryLogEntry): Promise<void>
  recordRun(summary: RunSummary): Promise<void>
  pruneOlderThan(cutoff: Date): Promise<number>
}
