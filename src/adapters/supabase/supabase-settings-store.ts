import type { SupabaseClient } from '@supabase/supabase-js'
import type { SettingsPatch, SettingsStore } from '../../core/ports/settings-store.ts'
import type { SettingsRow } from '../../core/settings/apply-settings-change.ts'
import { toRepositoryError } from './errors.ts'
import { pushSubscriptionToJson, rowToSubscription, type SubscriptionDbRow } from './rows.ts'

interface Result {
  data?: unknown
  error: { message: string; code?: string } | null
  status: number
  count?: number | null
}

/** `SettingsStore` for the Edge Function (service-role client). */
export class SupabaseSettingsStore implements SettingsStore {
  private readonly client: SupabaseClient

  constructor(client: SupabaseClient) {
    this.client = client
  }

  private async run(op: () => PromiseLike<unknown>): Promise<Result> {
    try {
      return (await op()) as Result
    } catch (e) {
      throw toRepositoryError({ message: e instanceof Error ? e.message : 'request failed' }, 0)
    }
  }

  async get(id: string): Promise<SettingsRow | null> {
    const res = await this.run(() => this.client.from('subscriptions').select('*').eq('id', id).maybeSingle())
    if (res.error) throw toRepositoryError(res.error, res.status)
    if (!res.data) return null
    const s = rowToSubscription(res.data as SubscriptionDbRow)
    return {
      pushSubscription: s.pushSubscription,
      localTime: s.localTime,
      timezone: s.timezone,
      enabled: s.enabled,
      startIndex: s.startIndex,
      messageIndex: s.messageIndex,
      nextSendAt: s.nextSendAt,
    }
  }

  async count(): Promise<number> {
    const res = await this.run(() => this.client.rpc('count_subscriptions'))
    if (res.error) throw toRepositoryError(res.error, res.status)
    return Number(res.data ?? 0)
  }

  async create(id: string, row: SettingsRow): Promise<'created' | 'exists'> {
    const res = await this.run(() =>
      this.client.from('subscriptions').insert({
        id,
        push_subscription: pushSubscriptionToJson(row.pushSubscription),
        local_time: row.localTime,
        timezone: row.timezone,
        enabled: row.enabled,
        start_index: row.startIndex,
        message_index: row.messageIndex,
        next_send_at: row.nextSendAt ? row.nextSendAt.toISOString() : null,
      }),
    )
    if (res.error) {
      if (res.error.code === '23505') return 'exists' // unique_violation: concurrent first request
      throw toRepositoryError(res.error, res.status)
    }
    return 'created'
  }

  async update(id: string, patch: SettingsPatch): Promise<void> {
    const values: Record<string, unknown> = {}
    if (patch.pushSubscription !== undefined) values['push_subscription'] = pushSubscriptionToJson(patch.pushSubscription)
    if (patch.localTime !== undefined) values['local_time'] = patch.localTime
    if (patch.timezone !== undefined) values['timezone'] = patch.timezone
    if (patch.enabled !== undefined) values['enabled'] = patch.enabled
    if (patch.nextSendAt !== undefined) {
      values['next_send_at'] = patch.nextSendAt ? patch.nextSendAt.toISOString() : null
    }
    if (Object.keys(values).length === 0) return
    const res = await this.run(() => this.client.from('subscriptions').update(values).eq('id', id))
    if (res.error) throw toRepositoryError(res.error, res.status)
  }
}
