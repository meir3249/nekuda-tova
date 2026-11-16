import type { StoredPushSubscription } from '../../core/index.ts'
import type { PushPlatform, PushSubscriptionLike } from './push-platform.ts'
import { base64UrlToUint8Array, isValidVapidPublicKey } from './vapid.ts'

export type SubscribeResult =
  | { ok: true; subscription: PushSubscriptionLike; stored: StoredPushSubscription }
  | { ok: false; reason: 'NO_VAPID_KEY' | 'SUBSCRIBE_FAILED' | 'BAD_SUBSCRIPTION' }

/** `subscription.toJSON()` → the `{endpoint, keys:{p256dh, auth}}` shape the server stores; null if incomplete. */
export function serializeSubscription(sub: PushSubscriptionLike): StoredPushSubscription | null {
  let json: ReturnType<PushSubscriptionLike['toJSON']>
  try {
    json = sub.toJSON()
  } catch {
    return null
  }
  const endpoint = json.endpoint ?? sub.endpoint
  const p256dh = json.keys?.['p256dh']
  const auth = json.keys?.['auth']
  if (typeof endpoint !== 'string' || endpoint === '' || typeof p256dh !== 'string' || typeof auth !== 'string') return null
  return { endpoint, keys: { p256dh, auth } }
}

/**
 * Steps 2–4 of the subscribe flow (spec 07): wait for the service worker, subscribe with the VAPID public key,
 * serialize. Permission must already be granted. Never throws.
 */
export async function subscribePush(platform: PushPlatform, vapidPublicKey: string): Promise<SubscribeResult> {
  if (!isValidVapidPublicKey(vapidPublicKey)) return { ok: false, reason: 'NO_VAPID_KEY' }
  let subscription: PushSubscriptionLike
  try {
    subscription = await platform.subscribe(base64UrlToUint8Array(vapidPublicKey))
  } catch {
    return { ok: false, reason: 'SUBSCRIBE_FAILED' }
  }
  const stored = serializeSubscription(subscription)
  if (!stored) {
    await unsubscribeQuietly(subscription)
    return { ok: false, reason: 'BAD_SUBSCRIPTION' }
  }
  return { ok: true, subscription, stored }
}

/** Best effort: an orphaned subscription is harmless (the server never learns it), so errors are ignored. */
export async function unsubscribeQuietly(sub: PushSubscriptionLike | null): Promise<void> {
  if (!sub) return
  try {
    await sub.unsubscribe()
  } catch {
    /* ignore */
  }
}
