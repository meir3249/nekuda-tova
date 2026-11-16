import type { SupabaseClient } from '@supabase/supabase-js'
import type { Subscription, SubscriptionLookup, UserRepository } from '../../core/ports/user-repository.ts'
import { toRepositoryError } from './errors.ts'
import { rowToSubscription, type SubscriptionDbRow } from './rows.ts'

interface RpcResult {
  data: unknown
  error: { message: string; code?: string } | null
  status: number
}

/** `UserRepository` over the SQL functions in migration 0003. Uses the service-role client. */
export class SupabaseUserRepository implements UserRepository, SubscriptionLookup {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    let res: RpcResult
    try {
      res = (await this.client.rpc(fn, args)) as RpcResult
    } catch (e) {
      throw toRepositoryError({ message: e instanceof Error ? e.message : 'request failed' }, 0)
    }
    if (res.error) throw toRepositoryError(res.error, res.status)
    return res.data
  }

  private rows(data: unknown): Subscription[] {
    return ((data ?? []) as SubscriptionDbRow[]).map(rowToSubscription)
  }

  async peekDue(now: Date, limit: number): Promise<Subscription[]> {
    return this.rows(await this.rpc('peek_due_subscriptions', { p_now: now.toISOString(), p_limit: limit }))
  }

  async claimDue(now: Date, limit: number, leaseSeconds: number): Promise<Subscription[]> {
    return this.rows(
      await this.rpc('claim_due_subscriptions', {
        p_now: now.toISOString(),
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      }),
    )
  }

  async finalizeSent(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean> {
    const data = await this.rpc('finalize_sent', {
      p_id: id,
      p_expected: expectedNextSendAt.toISOString(),
      p_new: newNextSendAt.toISOString(),
    })
    return data === true
  }

  async finalizeSkipped(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean> {
    const data = await this.rpc('finalize_skipped', {
      p_id: id,
      p_expected: expectedNextSendAt.toISOString(),
      p_new: newNextSendAt.toISOString(),
    })
    return data === true
  }

  async releaseClaim(id: string): Promise<void> {
    await this.rpc('release_claim', { p_id: id })
  }

  async markExpired(id: string): Promise<void> {
    await this.rpc('mark_expired', { p_id: id })
  }

  async pruneInactive(olderThan: Date): Promise<number> {
    const data = await this.rpc('prune_inactive', { p_cutoff: olderThan.toISOString() })
    return typeof data === 'number' ? data : 0
  }

  /** Read-only single-row lookup for the --test-push diagnostic (service role only). */
  async getById(id: string): Promise<Subscription | null> {
    let res: RpcResult
    try {
      res = (await this.client.from('subscriptions').select('*').eq('id', id).maybeSingle()) as RpcResult
    } catch (e) {
      throw toRepositoryError({ message: e instanceof Error ? e.message : 'request failed' }, 0)
    }
    if (res.error) throw toRepositoryError(res.error, res.status)
    return res.data ? rowToSubscription(res.data as SubscriptionDbRow) : null
  }
}
