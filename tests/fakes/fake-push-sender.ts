import type { PushOptions, PushPayload, PushResult, PushSender } from '../../src/core/ports/push-sender.ts'
import type { StoredPushSubscription } from '../../src/core/ports/user-repository.ts'

export interface SentPush {
  subscription: StoredPushSubscription
  payload: PushPayload
  options: PushOptions
}

export type PushBehavior = (sent: SentPush) => PushResult | Error | Promise<PushResult | Error>

/** Records every send; replies from a function (default: accepted 201). Tracks peak concurrency. */
export class FakePushSender implements PushSender {
  readonly sent: SentPush[] = []
  maxInFlight = 0
  private inFlight = 0

  constructor(
    private behavior: PushBehavior = () => ({ kind: 'accepted', status: 201 }),
    private readonly delayMs = 0,
  ) {}

  setBehavior(behavior: PushBehavior): void {
    this.behavior = behavior
  }

  async send(subscription: StoredPushSubscription, payload: PushPayload, options: PushOptions): Promise<PushResult> {
    const record: SentPush = { subscription, payload, options }
    this.sent.push(record)
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    try {
      if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs))
      const result = await this.behavior(record)
      if (result instanceof Error) throw result
      return result
    } finally {
      this.inFlight--
    }
  }
}
