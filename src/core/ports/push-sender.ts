import type { StoredPushSubscription } from './user-repository.ts'

/**
 * Payload v1. The service worker (Task 6) depends on exactly this shape; any change bumps `v`.
 * `body` is the message text; it is sent to the device and never stored or logged.
 */
export interface PushPayload {
  v: 1
  title: string
  body: string
  tag: string
}

export interface PushOptions {
  ttlSeconds: number
  urgency: 'very-low' | 'low' | 'normal' | 'high'
  /** At most 32 URL-safe characters. Same topic replaces a still-pending message at the push service. */
  topic?: string
}

export type PushResult =
  /** 2xx from the push service. */
  | { kind: 'accepted'; status: number }
  /** Subscription expired (404/410). */
  | { kind: 'gone'; status: 404 | 410 }
  /** `error` is a short code, never a response body, endpoint or key. */
  | { kind: 'failed'; status: number | null; retryable: boolean; error: string }

export interface PushSender {
  send(subscription: StoredPushSubscription, payload: PushPayload, options: PushOptions): Promise<PushResult>
}
