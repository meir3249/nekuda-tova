import type { PermissionState } from '../../src/core/index.ts'
import type { PushPlatform, PushSubscriptionLike } from '../../src/pwa/push/push-platform.ts'

/** A valid-looking VAPID public key: 65 bytes, uncompressed P-256 point prefix 0x04. */
export const TEST_VAPID_KEY = Buffer.from([4, ...Array.from({ length: 64 }, (_, i) => i + 1)]).toString('base64url')

export class FakeSubscription implements PushSubscriptionLike {
  unsubscribed = false
  constructor(
    readonly endpoint: string,
    private readonly owner: FakePushPlatform,
  ) {}
  toJSON() {
    return { endpoint: this.endpoint, keys: { p256dh: 'BPk' + 'a'.repeat(84), auth: 'auth' + 'b'.repeat(18) } }
  }
  unsubscribe(): Promise<boolean> {
    this.unsubscribed = true
    if (this.owner.current === this) this.owner.current = null
    return Promise.resolve(true)
  }
}

/** Fake browser push: permission prompt, push manager and subscriptions, with call logs. */
export class FakePushPlatform implements PushPlatform {
  perm: PermissionState = 'default'
  /** What the permission prompt resolves to. */
  promptResult: PermissionState = 'granted'
  /** When set, the prompt stays open until `answerPrompt` is called. */
  holdPrompt = false
  private pendingPrompt: ((p: PermissionState) => void) | null = null
  current: FakeSubscription | null = null
  subscribeFails = false
  getSubscriptionFails = false
  requestCalls = 0
  subscribeCalls = 0
  keysUsed: Uint8Array[] = []
  private n = 0

  permission(): PermissionState {
    return this.perm
  }

  requestPermission(): Promise<PermissionState> {
    this.requestCalls++
    return new Promise((resolve) => {
      const answer = (p: PermissionState) => {
        this.perm = p === 'default' ? this.perm : p
        resolve(p)
      }
      if (this.holdPrompt) this.pendingPrompt = answer
      else answer(this.promptResult)
    })
  }

  answerPrompt(p: PermissionState): void {
    this.pendingPrompt?.(p)
    this.pendingPrompt = null
  }

  getSubscription(): Promise<PushSubscriptionLike | null> {
    if (this.getSubscriptionFails) return Promise.reject(new Error('sw not ready'))
    return Promise.resolve(this.current)
  }

  subscribe(key: Uint8Array<ArrayBuffer>): Promise<PushSubscriptionLike> {
    this.subscribeCalls++
    this.keysUsed.push(key)
    if (this.subscribeFails) return Promise.reject(new Error('push service unreachable'))
    if (!this.current) this.current = new FakeSubscription(`https://fcm.googleapis.com/fcm/send/device-${++this.n}`, this)
    return Promise.resolve(this.current)
  }

  /** Simulates the browser rotating the subscription (pushsubscriptionchange). */
  rotate(): FakeSubscription {
    this.current = new FakeSubscription(`https://fcm.googleapis.com/fcm/send/rotated-${++this.n}`, this)
    return this.current
  }
}
