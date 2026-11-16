import type { StoredPushSubscription, Subscription } from '../../core/ports/user-repository.ts'

/** Shape of a `public.subscriptions` row as returned by PostgREST. */
export interface SubscriptionDbRow {
  id: string
  push_subscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null
  local_time: string
  timezone: string
  enabled: boolean
  start_index: number
  message_index: number
  next_send_at: string | null
  claimed_until: string | null
  updated_at: string
}

const toDate = (v: string | null): Date | null => (v === null ? null : new Date(v))

export function rowToSubscription(r: SubscriptionDbRow): Subscription {
  return {
    id: r.id,
    pushSubscription: r.push_subscription
      ? {
          endpoint: r.push_subscription.endpoint,
          keys: { p256dh: r.push_subscription.keys.p256dh, auth: r.push_subscription.keys.auth },
        }
      : null,
    localTime: r.local_time,
    timezone: r.timezone,
    enabled: r.enabled,
    startIndex: r.start_index,
    messageIndex: r.message_index,
    nextSendAt: toDate(r.next_send_at),
    claimedUntil: toDate(r.claimed_until),
    updatedAt: new Date(r.updated_at),
  }
}

export function pushSubscriptionToJson(s: StoredPushSubscription | null): SubscriptionDbRow['push_subscription'] {
  return s ? { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } } : null
}
