import type { DeliveryLog, DeliveryLogEntry, RunSummary } from '../../src/core/ports/delivery-log.ts'

export class InMemoryDeliveryLog implements DeliveryLog {
  readonly entries: DeliveryLogEntry[] = []
  readonly runs: RunSummary[] = []
  pruneCutoffs: Date[] = []
  failRecord = false

  record(entry: DeliveryLogEntry): Promise<void> {
    if (this.failRecord) return Promise.reject(new Error('log unavailable'))
    this.entries.push(entry)
    return Promise.resolve()
  }

  recordRun(summary: RunSummary): Promise<void> {
    this.runs.push(summary)
    return Promise.resolve()
  }

  pruneOlderThan(cutoff: Date): Promise<number> {
    this.pruneCutoffs.push(cutoff)
    return Promise.resolve(0)
  }
}
