import { describe, expect, it } from 'vitest'
import type { Subscription, UserRepository } from '../../../src/core/ports/user-repository.ts'
import {
  MAX_BATCHES_PER_RUN,
  runSendCycle,
  tagForDate,
  topicForTag,
  type SendCycleConfig,
} from '../../../src/core/usecases/run-send-cycle.ts'
import { runTestPush } from '../../../src/core/usecases/run-test-push.ts'
import { FakeClock } from '../../fakes/fake-clock.ts'
import { FakeContentSource } from '../../fakes/fake-content-source.ts'
import { FakePushSender } from '../../fakes/fake-push-sender.ts'
import { InMemoryDeliveryLog } from '../../fakes/in-memory-delivery-log.ts'
import { InMemoryUserRepository } from '../../fakes/in-memory-user-repository.ts'

// Winter time in Jerusalem is UTC+2, so 09:00 local is 07:00Z.
const SLOT = new Date('2027-01-11T07:00:00.000Z')
const NEXT_DAY_SLOT = new Date('2027-01-12T07:00:00.000Z')
const minutes = (m: number): number => m * 60_000

function contentOf(n: number): string {
  return JSON.stringify({
    version: 1,
    messages: Array.from({ length: n }, (_, i) => ({
      id: `msg_${String(i + 1).padStart(4, '0')}`,
      content: `UNIQUE-BODY-${i}`,
    })),
  })
}
const bodyOf = (i: number): string => `UNIQUE-BODY-${i}`

const cfg = (over: Partial<SendCycleConfig> = {}): SendCycleConfig => ({
  runId: 'run-1',
  batchSize: 50,
  leaseSeconds: 900,
  maxLateSeconds: 7200,
  ttlSeconds: 3600,
  urgency: 'normal',
  title: 'TITLE',
  dryRun: false,
  concurrency: 5,
  inactiveRetentionDays: 365,
  logRetentionDays: 90,
  ...over,
})

function user(id: string, over: Partial<Subscription> = {}): Subscription {
  return {
    id,
    pushSubscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: 'P256', auth: 'AUTH' } },
    localTime: '09:00',
    timezone: 'Asia/Jerusalem',
    enabled: true,
    startIndex: 0,
    messageIndex: 0,
    nextSendAt: SLOT,
    claimedUntil: null,
    updatedAt: new Date('2027-01-01T00:00:00.000Z'),
    ...over,
  }
}

function setup(opts: { n?: number; at?: Date } = {}) {
  const clock = new FakeClock(opts.at ?? new Date(SLOT.getTime() + minutes(3)))
  const content = new FakeContentSource(contentOf(opts.n ?? 12))
  const repo = new InMemoryUserRepository(clock)
  const push = new FakePushSender()
  const log = new InMemoryDeliveryLog()
  const run = (over: Partial<SendCycleConfig> = {}, users: UserRepository = repo) =>
    runSendCycle({ clock, content, users, push, log }, cfg(over))
  return { clock, content, repo, push, log, run }
}

describe('runSendCycle: sending', () => {
  it('sends an on-time message, advances the counter and schedule, and logs it', async () => {
    const { repo, push, log, run } = setup()
    repo.put(user('u1', { startIndex: 5, messageIndex: 3 }))

    const report = await run()

    expect(report).toMatchObject({ outcome: 'ok', claimed: 1, sent: 1, failed: 0, skippedStale: 0, expired: 0 })
    expect(push.sent).toHaveLength(1)
    const { payload, options } = push.sent[0]!
    expect(payload).toEqual({ v: 1, title: 'TITLE', body: bodyOf(8), tag: 'ntk-2027-01-11' })
    expect(options).toMatchObject({ ttlSeconds: 3600, urgency: 'normal' })
    expect(options.topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(repo.get('u1')).toMatchObject({ messageIndex: 4, nextSendAt: NEXT_DAY_SLOT, claimedUntil: null })
    expect(log.entries).toEqual([
      {
        userId: 'u1',
        scheduledFor: SLOT,
        attemptedAt: new Date(SLOT.getTime() + minutes(3)),
        delaySeconds: 180,
        status: 'sent',
        pushStatus: 201,
        counterValue: 3,
        runId: 'run-1',
        messageId: 'msg_0009',
      },
    ])
    expect(log.runs).toHaveLength(1)
    expect(log.runs[0]).toMatchObject({ runId: 'run-1', outcome: 'ok', claimed: 1, sent: 1 })
  })

  it('does not touch users who are not due or are disabled; re-enabling resumes at the same counter', async () => {
    const { repo, push, run } = setup()
    repo.put(user('future', { nextSendAt: new Date(SLOT.getTime() + minutes(60)) }))
    repo.put(user('off', { enabled: false, nextSendAt: null, messageIndex: 7 }))
    const before = { future: repo.get('future'), off: repo.get('off') }

    const report = await run()

    expect(report.claimed).toBe(0)
    expect(push.sent).toHaveLength(0)
    expect(repo.get('future')).toEqual(before.future)
    expect(repo.get('off')).toEqual(before.off)

    // Re-enable: same counter, so the same message as before the pause.
    repo.put({ ...repo.get('off')!, enabled: true, nextSendAt: SLOT })
    await run({ runId: 'run-2' })
    expect(push.sent[0]!.payload.body).toBe(bodyOf(7))
    expect(repo.get('off')!.messageIndex).toBe(8)
  })

  it('uses the current number of messages at send time (content shrinks from 41 to 38)', async () => {
    const { repo, push, content, run } = setup({ n: 41 })
    repo.put(user('u1', { startIndex: 0, messageIndex: 40 }))
    await run()
    expect(push.sent[0]!.payload.body).toBe(bodyOf(40))

    content.set(contentOf(38))
    repo.put(user('u2', { startIndex: 0, messageIndex: 40 }))
    await run({ runId: 'run-2' })
    expect(push.sent[1]!.payload.body).toBe(bodyOf(40 % 38))
  })

  it('records a heartbeat even when nobody is due', async () => {
    const { log, run } = setup()
    const report = await run()
    expect(report).toMatchObject({ outcome: 'ok', claimed: 0 })
    expect(log.runs).toHaveLength(1)
    expect(log.entries).toHaveLength(0)
  })

  it('runs the retention prunes with the configured windows', async () => {
    const { clock, log, run } = setup()
    await run()
    expect(log.pruneCutoffs).toEqual([new Date(clock.now().getTime() - 90 * 86_400_000)])
  })
})

describe('runSendCycle: staleness (D-011)', () => {
  const at = (delaySeconds: number) => new Date(SLOT.getTime() + delaySeconds * 1000)

  it('1 h 59 m late is still sent with its delay logged', async () => {
    const { repo, log, run } = setup({ at: at(7140) })
    repo.put(user('u1'))
    await run()
    expect(log.entries[0]).toMatchObject({ status: 'sent', delaySeconds: 7140 })
  })

  it('exactly 7200 s late is sent', async () => {
    const { repo, log, run } = setup({ at: at(7200) })
    repo.put(user('u1'))
    await run()
    expect(log.entries[0]).toMatchObject({ status: 'sent', delaySeconds: 7200 })
  })

  it('7201 s late is skipped: counter unchanged, schedule moves to the next occurrence after now', async () => {
    const { repo, push, log, run } = setup({ at: at(7201) })
    repo.put(user('u1', { messageIndex: 9 }))
    const report = await run()

    expect(push.sent).toHaveLength(0)
    expect(report).toMatchObject({ sent: 0, skippedStale: 1, staleUserIds: ['u1'] })
    expect(repo.get('u1')).toMatchObject({ messageIndex: 9, nextSendAt: NEXT_DAY_SLOT, claimedUntil: null })
    expect(log.entries).toEqual([
      expect.objectContaining({ status: 'skipped_stale', delaySeconds: 7201, counterValue: 9, pushStatus: null, messageId: null }),
    ])
  })

  it('a user days behind gets one skip and no burst of catch-up messages', async () => {
    const { repo, push, run } = setup()
    repo.put(user('u1', { nextSendAt: new Date('2027-01-06T07:00:00.000Z'), messageIndex: 2 }))
    await run()
    expect(push.sent).toHaveLength(0)
    expect(repo.get('u1')).toMatchObject({ messageIndex: 2, nextSendAt: NEXT_DAY_SLOT })
    await run({ runId: 'run-2' })
    expect(push.sent).toHaveLength(0)
  })
})

describe('runSendCycle: push outcomes', () => {
  it.each([
    ['429 (retryable)', { kind: 'failed', status: 429, retryable: true, error: 'http_429' }, 429],
    ['403 (not retryable)', { kind: 'failed', status: 403, retryable: false, error: 'http_403' }, 403],
    ['network error', { kind: 'failed', status: null, retryable: true, error: 'timeout' }, null],
  ] as const)('failed %s: counter and schedule unchanged, claim released, not retried within the run', async (_n, result, status) => {
    const { repo, push, log, run } = setup()
    repo.put(user('u1', { messageIndex: 4 }))
    push.setBehavior(() => result)

    const report = await run()

    expect(report).toMatchObject({ outcome: 'ok', sent: 0, failed: 1, failedUserIds: ['u1'] })
    expect(report.failedByStatus).toEqual({ [status === null ? 'timeout' : String(status)]: 1 })
    expect(push.sent).toHaveLength(1)
    expect(repo.get('u1')).toMatchObject({ messageIndex: 4, nextSendAt: SLOT, claimedUntil: null })
    expect(log.entries).toEqual([expect.objectContaining({ status: 'failed', pushStatus: status, counterValue: 4, messageId: null })])
  })

  it('a failed user is retried by the next run and then succeeds', async () => {
    const { repo, push, clock, run } = setup()
    repo.put(user('u1'))
    push.setBehavior(() => ({ kind: 'failed', status: 503, retryable: true, error: 'http_503' }))
    await run()
    push.setBehavior(() => ({ kind: 'accepted', status: 201 }))
    clock.advance(minutes(30))
    await run({ runId: 'run-2' })
    expect(repo.get('u1')).toMatchObject({ messageIndex: 1, nextSendAt: NEXT_DAY_SLOT })
  })

  it('failures are retried until the window closes, then skipped as stale', async () => {
    const { repo, push, clock, log, run } = setup()
    repo.put(user('u1'))
    push.setBehavior(() => ({ kind: 'failed', status: 500, retryable: true, error: 'http_500' }))
    for (let i = 0; i < 4; i++) {
      await run({ runId: `r${i}` })
      clock.advance(minutes(30))
    }
    // Clock is now 07:00 + 3 min + 120 min = 9:03Z (delay 7380 s): stale.
    await run({ runId: 'r-last' })
    expect(repo.get('u1')).toMatchObject({ messageIndex: 0, nextSendAt: NEXT_DAY_SLOT })
    expect(log.entries.at(-1)).toMatchObject({ status: 'skipped_stale' })
    expect(log.entries.filter((e) => e.status === 'failed')).toHaveLength(4)
  })

  it.each([404, 410] as const)('gone (%i): subscription nulled, user disabled, expired_subscription logged', async (status) => {
    const { repo, push, log, run } = setup()
    repo.put(user('u1', { messageIndex: 6 }))
    push.setBehavior(() => ({ kind: 'gone', status }))

    const report = await run()

    expect(report).toMatchObject({ sent: 0, expired: 1, failed: 0 })
    expect(repo.get('u1')).toMatchObject({ pushSubscription: null, enabled: false, nextSendAt: null, messageIndex: 6 })
    expect(log.entries).toEqual([expect.objectContaining({ status: 'expired_subscription', pushStatus: status, counterValue: 6 })])
  })
})

describe('runSendCycle: robustness', () => {
  it('a per-user exception does not abort the run', async () => {
    const { repo, push, log, run } = setup()
    repo.put(user('bad', { timezone: 'Not/AZone', nextSendAt: new Date(SLOT.getTime() - 1000) }))
    repo.put(user('good'))
    push.setBehavior((s) => {
      if (s.subscription.endpoint.endsWith('/bad')) return new Error('adapter exploded')
      return { kind: 'accepted', status: 201 }
    })

    const report = await run()

    expect(report).toMatchObject({ outcome: 'ok', claimed: 2, sent: 1, failed: 1, failedUserIds: ['bad'] })
    expect(report.failedByStatus).toEqual({ exception: 1 })
    expect(repo.get('good')!.messageIndex).toBe(1)
    expect(repo.get('bad')).toMatchObject({ messageIndex: 0, claimedUntil: null })
    expect(log.entries.map((e) => e.status).sort()).toEqual(['failed', 'sent'])
  })

  it('a claimed row without a subscription is treated as expired', async () => {
    const { repo, push, log, run } = setup()
    repo.put(user('u1', { pushSubscription: null }))
    const report = await run()
    expect(push.sent).toHaveLength(0)
    expect(report.expired).toBe(1)
    expect(log.entries[0]).toMatchObject({ status: 'expired_subscription' })
  })

  it('when the user changes settings mid-run (CAS false) nothing more is logged and it is not retried', async () => {
    const { repo, push, log, run } = setup()
    repo.put(user('u1'))
    push.setBehavior(() => {
      // The user moves their slot while the push is in flight.
      repo.put({ ...repo.get('u1')!, localTime: '10:00', nextSendAt: new Date('2027-01-12T08:00:00.000Z') })
      return { kind: 'accepted', status: 201 }
    })

    const report = await run()

    expect(report).toMatchObject({ sent: 0, raced: 1, failed: 0 })
    expect(log.entries).toHaveLength(0)
    expect(repo.get('u1')).toMatchObject({ messageIndex: 0, nextSendAt: new Date('2027-01-12T08:00:00.000Z') })
    expect(push.sent).toHaveLength(1)
  })

  it('a delivery-log failure does not turn a delivered push into a failure', async () => {
    const { repo, log, run } = setup()
    log.failRecord = true
    repo.put(user('u1'))
    const report = await run()
    expect(report).toMatchObject({ sent: 1, failed: 0 })
    expect(report.bookkeepingErrors).toBe(1)
    expect(repo.get('u1')!.messageIndex).toBe(1)
  })

  it('a fatal repository error is recorded as an error run and rethrown', async () => {
    const { repo, log, run } = setup()
    const broken: UserRepository = {
      peekDue: repo.peekDue.bind(repo),
      claimDue: () => Promise.reject(new Error('db down')),
      finalizeSent: repo.finalizeSent.bind(repo),
      finalizeSkipped: repo.finalizeSkipped.bind(repo),
      releaseClaim: repo.releaseClaim.bind(repo),
      markExpired: repo.markExpired.bind(repo),
      pruneInactive: repo.pruneInactive.bind(repo),
    }
    await expect(run({}, broken)).rejects.toThrow('db down')
    expect(log.runs).toEqual([expect.objectContaining({ outcome: 'error' })])
  })

  it('rejects an invalid configuration', async () => {
    const { run } = setup()
    await expect(run({ batchSize: 0 })).rejects.toThrow(RangeError)
    await expect(run({ concurrency: 0 })).rejects.toThrow(RangeError)
  })
})

describe('runSendCycle: invalid content', () => {
  it.each([
    ['truncated JSON', '{"version":1,"messages":['],
    ['empty message list', JSON.stringify({ version: 1, messages: [] })],
    ['unsupported version', JSON.stringify({ version: 2, messages: [{ id: 'msg_0001', content: 'x' }] })],
    ['empty file', ''],
  ])('%s: no pushes, no state change, run recorded as aborted', async (_name, raw) => {
    const { repo, push, log, content, run } = setup()
    content.set(raw)
    repo.put(user('u1', { messageIndex: 3 }))
    const before = repo.get('u1')

    const report = await run()

    expect(report.outcome).toBe('aborted_invalid_content')
    expect(push.sent).toHaveLength(0)
    expect(repo.get('u1')).toEqual(before)
    expect(log.entries).toHaveLength(0)
    expect(log.pruneCutoffs).toHaveLength(0)
    expect(log.runs).toEqual([expect.objectContaining({ outcome: 'aborted_invalid_content', sent: 0 })])
  })

  it('an unreadable content file is also an aborted run', async () => {
    const { repo, push, content, log, run } = setup()
    content.failWith(new Error('ENOENT'))
    repo.put(user('u1'))
    const report = await run()
    expect(report.outcome).toBe('aborted_invalid_content')
    expect(push.sent).toHaveLength(0)
    expect(log.runs).toHaveLength(1)
  })
})

describe('runSendCycle: batches and concurrency', () => {
  it('loops over batches until fewer than batchSize come back', async () => {
    const { repo, push, run } = setup()
    for (let i = 0; i < 5; i++) repo.put(user(`u${i}`))
    const report = await run({ batchSize: 2 })
    expect(report).toMatchObject({ claimed: 5, sent: 5 })
    expect(push.sent).toHaveLength(5)
  })

  it(`caps a run at ${MAX_BATCHES_PER_RUN} batches; the rest wait for the next run`, async () => {
    const { repo, push, run } = setup()
    for (let i = 0; i < MAX_BATCHES_PER_RUN + 5; i++) repo.put(user(`u${String(i).padStart(3, '0')}`))
    const report = await run({ batchSize: 1 })
    expect(report.claimed).toBe(MAX_BATCHES_PER_RUN)
    expect(push.sent).toHaveLength(MAX_BATCHES_PER_RUN)
    await run({ batchSize: 50, runId: 'run-2' })
    expect(push.sent).toHaveLength(MAX_BATCHES_PER_RUN + 5)
  })

  it('processes at most `concurrency` users at once and never sends the same user twice', async () => {
    const clock = new FakeClock(new Date(SLOT.getTime() + minutes(3)))
    const repo = new InMemoryUserRepository(clock)
    const push = new FakePushSender(undefined, 5)
    const log = new InMemoryDeliveryLog()
    for (let i = 0; i < 12; i++) repo.put(user(`u${i}`))
    await runSendCycle({ clock, content: new FakeContentSource(contentOf(12)), users: repo, push, log }, cfg({ concurrency: 5 }))
    expect(push.maxInFlight).toBeGreaterThan(1)
    expect(push.maxInFlight).toBeLessThanOrEqual(5)
    expect(new Set(push.sent.map((s) => s.subscription.endpoint)).size).toBe(12)
  })

  it('two overlapping cycles never send the same slot twice', async () => {
    const clock = new FakeClock(new Date(SLOT.getTime() + minutes(3)))
    const repo = new InMemoryUserRepository(clock)
    const push = new FakePushSender(undefined, 2)
    const log = new InMemoryDeliveryLog()
    for (let i = 0; i < 10; i++) repo.put(user(`u${i}`))
    const deps = { clock, content: new FakeContentSource(contentOf(12)), users: repo, push, log }

    const [a, b] = await Promise.all([runSendCycle(deps, cfg({ runId: 'a', batchSize: 3 })), runSendCycle(deps, cfg({ runId: 'b', batchSize: 3 }))])

    expect(push.sent).toHaveLength(10)
    expect(a.sent + b.sent).toBe(10)
    expect(new Set(log.entries.filter((e) => e.status === 'sent').map((e) => e.userId)).size).toBe(10)
    for (let i = 0; i < 10; i++) expect(repo.get(`u${i}`)!.messageIndex).toBe(1)
  })
})

describe('runSendCycle: dry run', () => {
  it('plans send / skip_stale and performs zero writes and zero pushes', async () => {
    const { repo, push, log, clock, run } = setup()
    repo.put(user('fresh', { startIndex: 2, messageIndex: 1 }))
    repo.put(user('stale', { nextSendAt: new Date(clock.now().getTime() - 3 * 3600_000) }))

    const writes: string[] = []
    const spy = new Proxy(repo, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown
        if (typeof value === 'function' && ['claimDue', 'finalizeSent', 'finalizeSkipped', 'releaseClaim', 'markExpired', 'pruneInactive'].includes(String(prop))) {
          return (...args: unknown[]) => {
            writes.push(String(prop))
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        }
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      },
    }) as UserRepository
    const snapshot = JSON.stringify([repo.get('fresh'), repo.get('stale')])

    const report = await run({ dryRun: true }, spy)

    expect(writes).toEqual([])
    expect(push.sent).toHaveLength(0)
    expect(log.entries).toHaveLength(0)
    expect(log.runs).toHaveLength(0)
    expect(log.pruneCutoffs).toHaveLength(0)
    expect(JSON.stringify([repo.get('fresh'), repo.get('stale')])).toBe(snapshot)
    expect(report.dryRun).toBe(true)
    expect(report.plan.map((p) => [p.userId, p.action, p.messageIndex])).toEqual([
      ['stale', 'skip_stale', null],
      ['fresh', 'send', 3],
    ])
  })

  it('does nothing when content is invalid', async () => {
    const { repo, content, push, log, run } = setup()
    content.set('nope')
    repo.put(user('u1'))
    const report = await run({ dryRun: true })
    expect(report.outcome).toBe('aborted_invalid_content')
    expect(push.sent).toHaveLength(0)
    expect(log.runs).toHaveLength(0)
  })
})

describe('runSendCycle: privacy', () => {
  it('no log row, run summary or report contains message text, endpoints or keys', async () => {
    const { repo, push, log, run } = setup()
    repo.put(user('ok'))
    repo.put(user('stale', { nextSendAt: new Date(SLOT.getTime() - 5 * 3600_000) }))
    repo.put(user('fail'))
    push.setBehavior((s) =>
      s.subscription.endpoint.endsWith('/fail')
        ? { kind: 'failed', status: 500, retryable: true, error: 'http_500' }
        : { kind: 'accepted', status: 201 },
    )

    const report = await run()
    const dump = JSON.stringify({ entries: log.entries, runs: log.runs, report })

    expect(dump).not.toContain('UNIQUE-BODY')
    expect(dump).not.toContain('fcm.googleapis.com')
    expect(dump).not.toContain('P256')
    expect(dump).not.toContain('AUTH')
  })
})

describe('topic and tag', () => {
  it('topic is deterministic, URL-safe, at most 32 characters, and differs by tag', () => {
    const a = topicForTag('ntk-2027-01-11')
    expect(a).toBe(topicForTag('ntk-2027-01-11'))
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(a).not.toBe(topicForTag('ntk-2027-01-12'))
  })

  it('tag is ntk- plus the local calendar date', () => {
    expect(tagForDate({ y: 2027, m: 1, d: 5 })).toBe('ntk-2027-01-05')
  })

  it('uses the user local date, not the UTC date, for the tag', async () => {
    // 00:30 local in Jerusalem on 12 Jan is 22:30Z on 11 Jan.
    const slot = new Date('2027-01-11T22:30:00.000Z')
    const { repo, push, run } = setup({ at: new Date(slot.getTime() + minutes(3)) })
    repo.put(user('u1', { localTime: '00:30', nextSendAt: slot }))
    await run()
    expect(push.sent[0]!.payload.tag).toBe('ntk-2027-01-12')
  })
})

describe('runTestPush', () => {
  function tpSetup() {
    const clock = new FakeClock(new Date(SLOT.getTime() + minutes(3)))
    const repo = new InMemoryUserRepository(clock)
    const push = new FakePushSender()
    const content = new FakeContentSource(contentOf(12))
    const deps = { content, lookup: repo, push }
    const conf = { userId: 'u1', title: 'TITLE', ttlSeconds: 3600, urgency: 'normal' as const }
    return { repo, push, content, deps, conf }
  }

  it("sends the user's next message and changes nothing", async () => {
    const { repo, push, deps, conf } = tpSetup()
    repo.put(user('u1', { startIndex: 4, messageIndex: 2 }))
    const before = JSON.stringify(repo.get('u1'))

    const outcome = await runTestPush(deps, conf)

    expect(outcome).toEqual({ ok: true, result: { kind: 'accepted', status: 201 } })
    expect(push.sent[0]!.payload).toEqual({ v: 1, title: 'TITLE', body: bodyOf(6), tag: 'ntk-test' })
    expect(JSON.stringify(repo.get('u1'))).toBe(before)
  })

  it('refuses when the user is unknown or has no subscription, and with invalid content', async () => {
    const { repo, push, content, deps, conf } = tpSetup()
    expect(await runTestPush(deps, conf)).toEqual({ ok: false, reason: 'user_not_found' })
    repo.put(user('u1', { pushSubscription: null }))
    expect(await runTestPush(deps, conf)).toEqual({ ok: false, reason: 'no_subscription' })
    repo.put(user('u1'))
    content.set('broken')
    expect(await runTestPush(deps, conf)).toEqual({ ok: false, reason: 'invalid_content' })
    expect(push.sent).toHaveLength(0)
  })

  it('does not mark a gone subscription as expired (diagnostic only)', async () => {
    const { repo, push, deps, conf } = tpSetup()
    repo.put(user('u1'))
    push.setBehavior(() => ({ kind: 'gone', status: 410 }))
    expect(await runTestPush(deps, conf)).toEqual({ ok: true, result: { kind: 'gone', status: 410 } })
    expect(repo.get('u1')!.enabled).toBe(true)
  })
})
