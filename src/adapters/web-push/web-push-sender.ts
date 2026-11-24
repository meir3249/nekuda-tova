import * as webPush from 'web-push'
import type { PushOptions, PushPayload, PushResult, PushSender } from '../../core/ports/push-sender.ts'
import type { StoredPushSubscription } from '../../core/ports/user-repository.ts'
import {
  DEFAULT_PUSH_ENDPOINT_ALLOWLIST,
  isAllowedPushHost,
  type PushEndpointAllowlist,
} from '../../core/settings/push-endpoint-allowlist.ts'

export const PUSH_REQUEST_TIMEOUT_MS = 10_000

export interface VapidDetails {
  /** `mailto:` or `https:` contact URL. */
  subject: string
  publicKey: string
  privateKey: string
}

/** The one function of `web-push` we call. Injectable so tests need no network. */
export type SendNotification = (
  subscription: StoredPushSubscription,
  payload: string,
  options: webPush.SendOptions,
) => Promise<{ statusCode: number }>

export interface WebPushSenderOptions {
  sendNotification?: SendNotification
  allowlist?: PushEndpointAllowlist
  timeoutMs?: number
  /** Called with raw HTTP details after every send attempt. Used only for local verbose logging. */
  onRawResponse?: (info: { endpoint: string; statusCode: number; body: string; headers: Record<string, string> }) => void
}

/** Returns true when the endpoint belongs to Apple's push infrastructure. */
export function isAppleEndpoint(endpoint: string): boolean {
  try {
    const h = new URL(endpoint).hostname.toLowerCase()
    return h === 'web.push.apple.com' || h.endsWith('.push.apple.com')
  } catch {
    return false
  }
}
export function isAllowedEndpoint(endpoint: string, allowlist: PushEndpointAllowlist): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && isAllowedPushHost(url.hostname, allowlist)
}

/**
 * `PushSender` over `web-push`. Never throws for a delivery problem and never puts an endpoint, key,
 * response body or message text into a result: `error` is a short fixed code.
 */
export class WebPushSender implements PushSender {
  private readonly vapid: VapidDetails
  private readonly sendNotification: SendNotification
  private readonly allowlist: PushEndpointAllowlist
  private readonly timeoutMs: number
  private readonly onRawResponse: WebPushSenderOptions['onRawResponse']

  constructor(vapid: VapidDetails, options: WebPushSenderOptions = {}) {
    this.vapid = vapid
    this.sendNotification = options.sendNotification ?? ((sub, payload, opts) => webPush.sendNotification(sub, payload, opts))
    this.allowlist = options.allowlist ?? DEFAULT_PUSH_ENDPOINT_ALLOWLIST
    this.timeoutMs = options.timeoutMs ?? PUSH_REQUEST_TIMEOUT_MS
    this.onRawResponse = options.onRawResponse
  }

  async send(subscription: StoredPushSubscription, payload: PushPayload, options: PushOptions): Promise<PushResult> {
    if (!isAllowedEndpoint(subscription.endpoint, this.allowlist)) {
      return { kind: 'failed', status: null, retryable: false, error: 'endpoint_not_allowed' }
    }

    const sendOptions: webPush.SendOptions = {
      vapidDetails: this.vapid,
      TTL: options.ttlSeconds,
      urgency: options.urgency,
      timeout: this.timeoutMs,
      // Apple rejects arbitrary topic strings with BadWebPushTopic; omit for Apple endpoints.
      ...(options.topic && !isAppleEndpoint(subscription.endpoint) ? { topic: options.topic } : {}),
    }

    try {
      const res = await this.sendNotification(subscription, JSON.stringify(payload), sendOptions)
      this.onRawResponse?.({ endpoint: subscription.endpoint, statusCode: res.statusCode, body: (res as { body?: string }).body ?? '', headers: (res as { headers?: Record<string, string> }).headers ?? {} })
      return mapStatus(res.statusCode)
    } catch (e) {
      const status = (e as { statusCode?: unknown }).statusCode
      if (typeof status === 'number') {
        this.onRawResponse?.({
          endpoint: subscription.endpoint,
          statusCode: status,
          body: (e as { body?: string }).body ?? '',
          headers: (e as { headers?: Record<string, string> }).headers ?? {},
        })
        return mapStatus(status)
      }
      return { kind: 'failed', status: null, retryable: true, error: networkErrorCode(e) }
    }
  }
}

function mapStatus(status: number): PushResult {
  if (status >= 200 && status < 300) return { kind: 'accepted', status }
  if (status === 404 || status === 410) return { kind: 'gone', status }
  // 429 and 5xx are transient. We do not retry within the run (that also honors Retry-After); the next run does.
  if (status === 429 || status >= 500) return { kind: 'failed', status, retryable: true, error: `http_${status}` }
  // 400, 401, 403, 413, ...: our request is wrong (e.g. bad VAPID keys). Still retried next run, bounded by staleness.
  return { kind: 'failed', status, retryable: false, error: `http_${status}` }
}

/** Only a fixed vocabulary leaves this function: Node error text can contain hostnames. */
function networkErrorCode(e: unknown): string {
  const message = e instanceof Error ? e.message : ''
  if (/timeout|timed out/i.test(message)) return 'timeout'
  const code = (e as { code?: unknown }).code
  if (typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)) return code.toLowerCase()
  return 'network_error'
}
