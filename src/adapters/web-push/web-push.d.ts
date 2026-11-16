// Minimal typings for the parts of `web-push` 4.x we use (the package ships none).
declare module 'web-push' {
  export interface PushSubscriptionLike {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  export interface SendOptions {
    vapidDetails?: { subject: string; publicKey: string; privateKey: string }
    TTL?: number
    urgency?: 'very-low' | 'low' | 'normal' | 'high'
    topic?: string
    timeout?: number
  }

  export interface SendResult {
    statusCode: number
    body: string
    headers: Record<string, string>
  }

  export class WebPushError extends Error {
    statusCode: number
    headers: Record<string, string>
    body: string
    endpoint: string
  }

  export function sendNotification(
    subscription: PushSubscriptionLike,
    payload: string,
    options?: SendOptions,
  ): Promise<SendResult>

  export function generateVAPIDKeys(): { publicKey: string; privateKey: string }
}
