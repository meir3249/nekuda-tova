import { validateContent } from '../content/index.ts'
import type { Clock } from '../ports/clock.ts'
import type { ContentSource } from '../ports/content-source.ts'
import type { DeliveryLog, DeliveryLogEntry, RunSummary } from '../ports/delivery-log.ts'
import type { PushOptions, PushPayload, PushSender } from '../ports/push-sender.ts'
import type { Subscription, UserRepository } from '../ports/user-repository.ts'
import { messageIndexFor } from '../progression/index.ts'
import { nextOccurrenceAfter } from '../scheduling/next-send.ts'
import { evaluateDelay } from '../scheduling/staleness.ts'
import { localDateOf, type LocalDate } from '../scheduling/timezone.ts'

/** Upper bound on claim batches per run, so one run can never loop forever. */
export const MAX_BATCHES_PER_RUN = 20

const DAY_MS = 24 * 60 * 60 * 1000

export interface SendCycleDeps {
  clock: Clock
  content: ContentSource
  users: UserRepository
  push: PushSender
  log: DeliveryLog
}

export interface SendCycleConfig {
  runId: string
  batchSize: number
  leaseSeconds: number
  maxLateSeconds: number
  ttlSeconds: number
  urgency: PushOptions['urgency']
  title: string
  dryRun: boolean
  concurrency: number
  inactiveRetentionDays: number
  logRetentionDays: number
}

/** What a dry run would do for one due user. Ids and numbers only, never message text. */
export interface PlannedAction {
  userId: string
  scheduledFor: Date
  delaySeconds: number
  action: 'send' | 'skip_stale'
  /** Index into the message list for `send`; null for `skip_stale`. */
  messageIndex: number | null
}

/** `RunSummary` plus the extra figures the sender prints. Contains no message text, endpoints or keys. */
export interface SendCycleReport extends RunSummary {
  dryRun: boolean
  /** Finalize returned false: the user changed settings mid-run. Not retried. */
  raced: number
  /** Failures writing to the delivery log or releasing claims (the run itself continued). */
  bookkeepingErrors: number
  maxDelaySeconds: number
  medianDelaySeconds: number
  staleUserIds: string[]
  failedUserIds: string[]
  /** Failures by push HTTP status, or by a short reason (timeout, endpoint_not_allowed, exception) without one. 401/403 means bad VAPID keys. */
  failedByStatus: Record<string, number>
  /** Dry run only. */
  plan: PlannedAction[]
  /** Short, content-free reason when the run did not complete normally. */
  note: string | null
}

/** Deterministic Web Push topic from the tag: 17 URL-safe characters (limit is 32). Pure FNV-1a, two seeds. */
export function topicForTag(tag: string): string {
  const fnv = (seed: number): string => {
    let h = seed >>> 0
    for (let i = 0; i < tag.length; i++) {
      h ^= tag.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return `t${fnv(0x811c9dc5)}${fnv(0x9747b28c)}`
}

export function tagForDate(date: LocalDate): string {
  const p = (n: number, w: number): string => String(n).padStart(w, '0')
  return `ntk-${p(date.y, 4)}-${p(date.m, 2)}-${p(date.d, 2)}`
}

function assertConfig(cfg: SendCycleConfig): void {
  const positive = (v: number, name: string): void => {
    if (!Number.isInteger(v) || v < 1) throw new RangeError(`${name} must be an integer >= 1`)
  }
  positive(cfg.batchSize, 'batchSize')
  positive(cfg.concurrency, 'concurrency')
  positive(cfg.leaseSeconds, 'leaseSeconds')
  positive(cfg.ttlSeconds, 'ttlSeconds')
  if (!Number.isInteger(cfg.maxLateSeconds) || cfg.maxLateSeconds < 0) {
    throw new RangeError('maxLateSeconds must be an integer >= 0')
  }
}

async function forEachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? (s[mid] as number) : Math.floor(((s[mid - 1] as number) + (s[mid] as number)) / 2)
}

/**
 * One sender run (spec 05). Pure orchestration over ports.
 *
 * Failed pushes are NOT released immediately: their claims are released at the end of the run, so the same
 * run can never reclaim and retry them in a tight loop. They are retried by the next run (until stale).
 * Never writes message text anywhere. A dry run performs no write of any kind.
 */
export async function runSendCycle(deps: SendCycleDeps, cfg: SendCycleConfig): Promise<SendCycleReport> {
  assertConfig(cfg)
  const { clock, content, users, push, log } = deps
  const startedAt = clock.now()

  const delays: number[] = []
  const staleUserIds: string[] = []
  const failedUserIds: string[] = []
  const plan: PlannedAction[] = []
  const failedByStatus: Record<string, number> = {}
  const deferredRelease = new Set<string>()
  const counts = { claimed: 0, sent: 0, skippedStale: 0, failed: 0, expired: 0, raced: 0, bookkeepingErrors: 0 }

  const finish = (outcome: RunSummary['outcome'], note: string | null): SendCycleReport => ({
    runId: cfg.runId,
    startedAt,
    finishedAt: clock.now(),
    outcome,
    claimed: counts.claimed,
    sent: counts.sent,
    skippedStale: counts.skippedStale,
    failed: counts.failed,
    expired: counts.expired,
    dryRun: cfg.dryRun,
    raced: counts.raced,
    bookkeepingErrors: counts.bookkeepingErrors,
    maxDelaySeconds: delays.length === 0 ? 0 : Math.max(...delays),
    medianDelaySeconds: median(delays),
    staleUserIds,
    failedUserIds,
    failedByStatus,
    plan,
    note,
  })

  /** Bookkeeping must never turn a delivered push into a "failure": swallow and count. */
  const safely = async (op: () => Promise<unknown>): Promise<void> => {
    try {
      await op()
    } catch {
      counts.bookkeepingErrors++
    }
  }
  const record = (entry: DeliveryLogEntry): Promise<void> => safely(() => log.record(entry))
  const recordRun = async (report: SendCycleReport): Promise<void> => {
    if (cfg.dryRun) return
    const { runId, startedAt: s, finishedAt, outcome, claimed, sent, skippedStale, failed, expired } = report
    await safely(() => log.recordRun({ runId, startedAt: s, finishedAt, outcome, claimed, sent, skippedStale, failed, expired }))
  }

  // 1. Content. Invalid content: send nothing, change nothing.
  let messages: readonly { id: string; content: string }[]
  try {
    const result = validateContent(await content.loadRaw())
    if (!result.ok) {
      const report = finish('aborted_invalid_content', `content invalid (${result.errors.length} error(s))`)
      await recordRun(report)
      return report
    }
    messages = result.content.messages
  } catch {
    const report = finish('aborted_invalid_content', 'content could not be read')
    await recordRun(report)
    return report
  }
  const n = messages.length

  const processRow = async (row: Subscription): Promise<void> => {
    const scheduled = row.nextSendAt
    const attempt = clock.now()
    const entry = (
      status: DeliveryLogEntry['status'],
      delaySeconds: number,
      pushStatus: number | null,
      messageId: string | null,
    ): DeliveryLogEntry => ({
      userId: row.id,
      scheduledFor: scheduled ?? attempt,
      attemptedAt: attempt,
      delaySeconds,
      status,
      pushStatus,
      counterValue: row.messageIndex,
      runId: cfg.runId,
      messageId,
    })
    const fail = async (delaySeconds: number, pushStatus: number | null, reason: string): Promise<void> => {
      counts.failed++
      failedUserIds.push(row.id)
      const key = pushStatus === null ? reason : String(pushStatus)
      failedByStatus[key] = (failedByStatus[key] ?? 0) + 1
      deferredRelease.add(row.id)
      await record(entry('failed', delaySeconds, pushStatus, null))
    }

    if (scheduled === null) {
      await fail(0, null, 'no_schedule')
      return
    }
    const { delaySeconds, stale } = evaluateDelay(scheduled, attempt, cfg.maxLateSeconds)

    try {
      delays.push(delaySeconds)

      if (stale) {
        const next = nextOccurrenceAfter(row.localTime, row.timezone, attempt)
        if (!(await users.finalizeSkipped(row.id, scheduled, next))) {
          counts.raced++
          deferredRelease.add(row.id)
          return
        }
        counts.skippedStale++
        staleUserIds.push(row.id)
        await record(entry('skipped_stale', delaySeconds, null, null))
        return
      }

      if (row.pushSubscription === null) {
        await users.markExpired(row.id)
        counts.expired++
        await record(entry('expired_subscription', delaySeconds, null, null))
        return
      }

      const idx = messageIndexFor(row.startIndex, row.messageIndex, n)
      const message = messages[idx] as { id: string; content: string }
      const tag = tagForDate(localDateOf(row.timezone, scheduled))
      const payload: PushPayload = { v: 1, title: cfg.title, body: message.content, tag }
      const options: PushOptions = { ttlSeconds: cfg.ttlSeconds, urgency: cfg.urgency, topic: topicForTag(tag) }

      const result = await push.send(row.pushSubscription, payload, options)

      if (result.kind === 'accepted') {
        const next = nextOccurrenceAfter(row.localTime, row.timezone, attempt)
        if (!(await users.finalizeSent(row.id, scheduled, next))) {
          counts.raced++
          deferredRelease.add(row.id)
          return
        }
        counts.sent++
        await record(entry('sent', delaySeconds, result.status, message.id))
      } else if (result.kind === 'gone') {
        await users.markExpired(row.id)
        counts.expired++
        await record(entry('expired_subscription', delaySeconds, result.status, null))
      } else {
        await fail(delaySeconds, result.status, result.error)
      }
    } catch {
      // One user's problem (bad row, adapter error) never aborts the run.
      await fail(delaySeconds, null, 'exception')
    }
  }

  const dryRunRow = (row: Subscription): void => {
    counts.claimed++
    const scheduled = row.nextSendAt
    if (scheduled === null) return
    const { delaySeconds, stale } = evaluateDelay(scheduled, clock.now(), cfg.maxLateSeconds)
    delays.push(delaySeconds)
    let messageIndex: number | null = null
    if (!stale) {
      try {
        messageIndex = messageIndexFor(row.startIndex, row.messageIndex, n)
      } catch {
        counts.failed++
        failedUserIds.push(row.id)
        return
      }
    } else {
      staleUserIds.push(row.id)
    }
    plan.push({
      userId: row.id,
      scheduledFor: scheduled,
      delaySeconds,
      action: stale ? 'skip_stale' : 'send',
      messageIndex,
    })
  }

  try {
    if (cfg.dryRun) {
      const due = await users.peekDue(clock.now(), cfg.batchSize * MAX_BATCHES_PER_RUN)
      due.forEach(dryRunRow)
      return finish('ok', null)
    }

    // 2. Retention. A failure here must not stop today's messages.
    const now0 = clock.now()
    await safely(() => users.pruneInactive(new Date(now0.getTime() - cfg.inactiveRetentionDays * DAY_MS)))
    await safely(() => log.pruneOlderThan(new Date(now0.getTime() - cfg.logRetentionDays * DAY_MS)))

    // 3 + 4. Claim in batches and process with bounded concurrency.
    const seen = new Set<string>()
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch++) {
        const rows = await users.claimDue(clock.now(), cfg.batchSize, cfg.leaseSeconds)
        const fresh = rows.filter((r) => !seen.has(r.id))
        for (const r of fresh) seen.add(r.id)
        counts.claimed += fresh.length
        await forEachLimited(fresh, cfg.concurrency, processRow)
        if (rows.length < cfg.batchSize || fresh.length === 0) break
      }
    } finally {
      await Promise.all([...deferredRelease].map((id) => safely(() => users.releaseClaim(id))))
    }

    // 5.
    const report = finish('ok', null)
    await recordRun(report)
    return report
  } catch (e) {
    // Fatal (e.g. Supabase unreachable). Claims already taken expire by lease.
    const report = finish('error', e instanceof Error ? e.name : 'unknown error')
    await recordRun(report)
    throw e
  }
}
