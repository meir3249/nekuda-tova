import type { StoredPushSubscription } from '../ports/user-repository.ts'
import { isAllowedPushHost, type PushEndpointAllowlist } from './push-endpoint-allowlist.ts'

export const MAX_PUSH_SUBSCRIPTION_BYTES = 4096

const BASE64URL = /^[A-Za-z0-9_-]{16,256}$/

export type PushSubscriptionValidation =
  | { ok: true; value: StoredPushSubscription }
  | { ok: false; message: string }

/**
 * Shape validation: https endpoint on an allowlisted host, base64url keys, total size <= 4 KiB.
 * Returns a normalized copy containing only the known fields.
 */
export function validatePushSubscription(
  input: unknown,
  allowlist: PushEndpointAllowlist,
): PushSubscriptionValidation {
  const fail = (message: string): PushSubscriptionValidation => ({ ok: false, message })

  if (typeof input !== 'object' || input === null) return fail('Subscription must be an object')
  const rec = input as Record<string, unknown>
  const endpoint = rec['endpoint']
  const keys = rec['keys']
  if (typeof endpoint !== 'string') return fail('endpoint must be a string')
  if (typeof keys !== 'object' || keys === null) return fail('keys must be an object')
  const p256dh = (keys as Record<string, unknown>)['p256dh']
  const auth = (keys as Record<string, unknown>)['auth']
  if (typeof p256dh !== 'string' || !BASE64URL.test(p256dh)) return fail('keys.p256dh must be base64url')
  if (typeof auth !== 'string' || !BASE64URL.test(auth)) return fail('keys.auth must be base64url')

  if (new TextEncoder().encode(JSON.stringify({ endpoint, keys: { p256dh, auth } })).length > MAX_PUSH_SUBSCRIPTION_BYTES) {
    return fail('Subscription exceeds 4 KiB')
  }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return fail('endpoint is not a valid URL')
  }
  if (url.protocol !== 'https:') return fail('endpoint must use https')
  if (url.username !== '' || url.password !== '') return fail('endpoint must not contain credentials')
  if (!isAllowedPushHost(url.hostname, allowlist)) return fail('endpoint host is not allowed')

  return { ok: true, value: { endpoint, keys: { p256dh, auth } } }
}
