import type { SupabaseClient } from '@supabase/supabase-js'
import type { DeliveryLog, DeliveryLogEntry, RunSummary } from '../../core/ports/delivery-log.ts'
import { toRepositoryError } from './errors.ts'

interface Result {
  data?: unknown
  error: { message: string; code?: string } | null
  status: number
}

/** `DeliveryLog` over `delivery_log` / `sender_runs`. Stores ids and counts only, never message text. */
export class SupabaseDeliveryLog implements DeliveryLog {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  private async run(op: () => PromiseLike<unknown>): Promise<Result> {
    let res: Result
    try {
      res = (await op()) as Result
    } catch (e) {
      throw toRepositoryError({ message: e instanceof Error ? e.message : 'request failed' }, 0)
    }
    if (res.error) throw toRepositoryError(res.error, res.status)
    return res
  }

  async record(entry: DeliveryLogEntry): Promise<void> {
    await this.run(() =>
      this.client.from('delivery_log').insert({
        user_id: entry.userId,
        scheduled_for: entry.scheduledFor.toISOString(),
        attempted_at: entry.attemptedAt.toISOString(),
        delay_seconds: entry.delaySeconds,
        status: entry.status,
        push_status: entry.pushStatus,
        counter_value: entry.counterValue,
        run_id: entry.runId,
        message_id: entry.messageId,
      }),
    )
  }

  async recordRun(summary: RunSummary): Promise<void> {
    await this.run(() =>
      this.client.from('sender_runs').upsert(
        {
          run_id: summary.runId,
          started_at: summary.startedAt.toISOString(),
          finished_at: summary.finishedAt.toISOString(),
          outcome: summary.outcome,
          claimed: summary.claimed,
          sent: summary.sent,
          skipped_stale: summary.skippedStale,
          failed: summary.failed,
          expired: summary.expired,
        },
        { onConflict: 'run_id' },
      ),
    )
  }

  async pruneOlderThan(cutoff: Date): Promise<number> {
    const res = await this.run(() => this.client.rpc('prune_delivery_log', { p_cutoff: cutoff.toISOString() }))
    return typeof res.data === 'number' ? res.data : 0
  }
}
