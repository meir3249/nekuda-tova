import { validateContent } from '../content/index.ts'
import type { ContentSource } from '../ports/content-source.ts'
import type { PushOptions, PushResult, PushSender } from '../ports/push-sender.ts'
import type { SubscriptionLookup } from '../ports/user-repository.ts'
import { messageIndexFor } from '../progression/index.ts'

export interface TestPushDeps {
  content: ContentSource
  lookup: SubscriptionLookup
  push: PushSender
}

export interface TestPushConfig {
  userId: string
  title: string
  ttlSeconds: number
  urgency: PushOptions['urgency']
}

export type TestPushOutcome =
  | { ok: true; result: PushResult }
  | { ok: false; reason: 'invalid_content' | 'user_not_found' | 'no_subscription' }

/** The tag used for diagnostic pushes. Distinct from the daily `ntk-<date>` tags so it never replaces one. */
export const TEST_PUSH_TAG = 'ntk-test'

/**
 * Diagnostic: sends the user's NEXT message to the stored subscription. Read-only by construction:
 * it receives no write port, so the counter and schedule cannot change and nothing is logged.
 */
export async function runTestPush(deps: TestPushDeps, cfg: TestPushConfig): Promise<TestPushOutcome> {
  let validated: ReturnType<typeof validateContent>
  try {
    validated = validateContent(await deps.content.loadRaw())
  } catch {
    return { ok: false, reason: 'invalid_content' }
  }
  if (!validated.ok) return { ok: false, reason: 'invalid_content' }

  const row = await deps.lookup.getById(cfg.userId)
  if (row === null) return { ok: false, reason: 'user_not_found' }
  if (row.pushSubscription === null) return { ok: false, reason: 'no_subscription' }

  const messages = validated.content.messages
  const message = messages[messageIndexFor(row.startIndex, row.messageIndex, messages.length)]
  if (message === undefined) return { ok: false, reason: 'invalid_content' }

  const result = await deps.push.send(
    row.pushSubscription,
    { v: 1, title: cfg.title, body: message.content, tag: TEST_PUSH_TAG },
    { ttlSeconds: cfg.ttlSeconds, urgency: cfg.urgency },
  )
  return { ok: true, result }
}
