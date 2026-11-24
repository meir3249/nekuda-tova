import { describe, expect, it } from 'vitest'
import { parseSenderConfig, type Env } from '../../src/sender/config.ts'
import { runSender, type BuildPorts, type SenderIo } from '../../src/sender/main.ts'
import { formatMarkdownSummary, formatReport, redact, shortId } from '../../src/sender/report.ts'
import { FakeClock } from '../fakes/fake-clock.ts'
import { FakeContentSource } from '../fakes/fake-content-source.ts'
import { FakePushSender } from '../fakes/fake-push-sender.ts'
import { InMemoryDeliveryLog } from '../fakes/in-memory-delivery-log.ts'
import { InMemoryUserRepository } from '../fakes/in-memory-user-repository.ts'

const PUB = 'B'.repeat(87)
const PRIV = 'c'.repeat(43)
const SERVICE_KEY = 'sb_secret_THIS-IS-A-TEST-KEY-1234567890'
const UID = '7b0f7c1e-4d3a-4f55-9d57-0c1f1b2a3d44'

const fullEnv: Env = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  VAPID_PUBLIC_KEY: PUB,
  VAPID_PRIVATE_KEY: PRIV,
  VAPID_SUBJECT: 'mailto:owner@example.com',
  GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_STEP_SUMMARY: '/tmp/summary.md',
}
const NOW = new Date('2027-01-11T07:03:00.000Z')

describe('parseSenderConfig', () => {
  it('parses a full environment', () => {
    const r = parseSenderConfig([], fullEnv, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config).toMatchObject({
      dryRun: false,
      testPushUserId: null,
      stepSummaryPath: '/tmp/summary.md',
      vapid: { subject: 'mailto:owner@example.com' },
      cycle: { runId: 'gh-123-2', dryRun: false, maxLateSeconds: 7200, ttlSeconds: 3600, urgency: 'normal', leaseSeconds: 900 },
    })
  })

  it('names every missing variable, never a value', () => {
    const r = parseSenderConfig([], { SUPABASE_URL: 'https://x.supabase.co' }, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'missing required environment variable SUPABASE_SERVICE_ROLE_KEY',
        'missing required environment variable VAPID_PUBLIC_KEY',
        'missing required environment variable VAPID_PRIVATE_KEY',
        'missing required environment variable VAPID_SUBJECT',
      ]),
    )
  })

  it('does not echo malformed secret values in its errors', () => {
    const r = parseSenderConfig([], { ...fullEnv, VAPID_PRIVATE_KEY: 'has spaces and !!', VAPID_SUBJECT: 'owner' }, NOW)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(JSON.stringify(r.errors)).not.toContain('has spaces')
    expect(r.errors.join('\n')).toContain('VAPID_PRIVATE_KEY')
    expect(r.errors.join('\n')).toContain('VAPID_SUBJECT')
  })

  it('a dry run needs no VAPID keys (DRY_RUN env or flag)', () => {
    const env = { SUPABASE_URL: fullEnv['SUPABASE_URL'], SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }
    expect(parseSenderConfig(['--dry-run'], env, NOW)).toMatchObject({ ok: true, config: { dryRun: true, vapid: null } })
    expect(parseSenderConfig([], { ...env, DRY_RUN: 'true' }, NOW)).toMatchObject({ ok: true, config: { dryRun: true } })
    expect(parseSenderConfig([], { ...env, DRY_RUN: 'false' }, NOW).ok).toBe(false)
  })

  it('accepts --test-push with a UUID and rejects bad usage', () => {
    expect(parseSenderConfig(['--test-push', UID], fullEnv, NOW)).toMatchObject({ ok: true, config: { testPushUserId: UID } })
    expect(parseSenderConfig(['--test-push'], fullEnv, NOW).ok).toBe(false)
    expect(parseSenderConfig(['--test-push', 'nope'], fullEnv, NOW).ok).toBe(false)
    expect(parseSenderConfig(['--dry-run', '--test-push', UID], fullEnv, NOW).ok).toBe(false)
    expect(parseSenderConfig(['--bogus'], fullEnv, NOW).ok).toBe(false)
  })

  it('falls back to a local run id outside GitHub', () => {
    const r = parseSenderConfig([], { ...fullEnv, GITHUB_RUN_ID: undefined }, NOW)
    expect(r.ok && r.config.cycle.runId).toBe(`local-${NOW.getTime()}`)
  })
})

describe('redact and report', () => {
  it('removes secrets and URLs', () => {
    const text = `failed calling https://fcm.googleapis.com/fcm/send/abc with ${SERVICE_KEY} and ${PRIV}`
    const out = redact(text, [SERVICE_KEY, PRIV])
    expect(out).not.toContain('fcm.googleapis')
    expect(out).not.toContain(SERVICE_KEY)
    expect(out).not.toContain(PRIV)
  })

  it('shortens ids to 8 characters', () => {
    expect(shortId(UID)).toBe('7b0f7c1e')
  })
})

// ---- end to end through runSender with fakes ----

function harness(raw?: string) {
  const clock = new FakeClock(NOW)
  const repo = new InMemoryUserRepository(clock)
  const push = new FakePushSender()
  const log = new InMemoryDeliveryLog()
  const content = new FakeContentSource(
    raw ?? JSON.stringify({ version: 1, messages: [{ id: 'msg_0001', content: 'SECRET-TEXT-ONE' }, { id: 'msg_0002', content: 'SECRET-TEXT-TWO' }] }),
  )
  const build: BuildPorts = () => ({ clock, content, users: repo, push, log })
  const out: string[] = []
  const err: string[] = []
  const files = new Map<string, string>()
  const io: SenderIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    debug: () => {},
    appendFile: (p, t) => files.set(p, (files.get(p) ?? '') + t),
  }
  repo.put({
    id: UID,
    pushSubscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/secret-endpoint', keys: { p256dh: 'P', auth: 'A' } },
    localTime: '09:00',
    timezone: 'Asia/Jerusalem',
    enabled: true,
    startIndex: 0,
    messageIndex: 0,
    nextSendAt: new Date('2027-01-11T07:00:00.000Z'),
    claimedUntil: null,
    updatedAt: new Date('2027-01-01T00:00:00.000Z'),
  })
  return { repo, push, log, build, io, out, err, files }
}

describe('runSender', () => {
  it('exit 2 on configuration errors, naming the variable and nothing else', async () => {
    const h = harness()
    const code = await runSender([], { SUPABASE_URL: 'https://x.supabase.co' }, h.io, h.build)
    expect(code).toBe(2)
    expect(h.err.join('\n')).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(h.push.sent).toHaveLength(0)
  })

  it('exit 0 after a real run; prints a summary and appends Markdown; output has no text, endpoints or secrets', async () => {
    const h = harness()
    const code = await runSender([], fullEnv, h.io, h.build)
    expect(code).toBe(0)
    expect(h.push.sent).toHaveLength(1)
    const all = [...h.out, ...h.err, ...h.files.values()].join('\n')
    expect(all).toContain('sent=1')
    expect(h.files.get('/tmp/summary.md')).toContain('| sent | 1 |')
    expect(all).not.toMatch(/SECRET-TEXT|secret-endpoint|THIS-IS-A-TEST-KEY/)
    expect(all).not.toContain(UID) // only the short id may appear
  })

  it('exit 0 even when an individual push fails, and the summary flags 401/403', async () => {
    const h = harness()
    h.push.setBehavior(() => ({ kind: 'failed', status: 401, retryable: false, error: 'http_401' }))
    const code = await runSender([], fullEnv, h.io, h.build)
    expect(code).toBe(0)
    const all = [...h.out, ...h.files.values()].join('\n')
    expect(all).toContain('failed=1')
    expect(all).toContain('401=1')
    expect(all).toContain('VAPID')
    expect(all).toContain(shortId(UID))
  })

  it('exit 1 for invalid content, with nothing sent', async () => {
    const h = harness('{"version":1,"messages":[]}')
    const code = await runSender([], fullEnv, h.io, h.build)
    expect(code).toBe(1)
    expect(h.push.sent).toHaveLength(0)
    expect(h.log.runs[0]).toMatchObject({ outcome: 'aborted_invalid_content' })
  })

  it('--dry-run: exit 0, plan printed, no pushes, no writes', async () => {
    const h = harness()
    const env = { SUPABASE_URL: fullEnv['SUPABASE_URL'], SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }
    const before = JSON.stringify(h.repo.get(UID))
    const code = await runSender(['--dry-run'], env, h.io, h.build)
    expect(code).toBe(0)
    expect(h.out.join('\n')).toContain('DRY RUN')
    expect(h.out.join('\n')).toContain('send')
    expect(h.push.sent).toHaveLength(0)
    expect(h.log.entries).toHaveLength(0)
    expect(h.log.runs).toHaveLength(0)
    expect(JSON.stringify(h.repo.get(UID))).toBe(before)
  })

  it('fatal errors exit 1 with secrets and URLs redacted', async () => {
    const h = harness()
    const build: BuildPorts = () => {
      throw new Error(`cannot reach https://proj.supabase.co with ${SERVICE_KEY}`)
    }
    const code = await runSender([], fullEnv, h.io, build)
    expect(code).toBe(1)
    const text = h.err.join('\n')
    expect(text).toContain('fatal')
    expect(text).not.toContain(SERVICE_KEY)
    expect(text).not.toContain('supabase.co')
  })

  it('--test-push: sends the next message, changes nothing, writes no log', async () => {
    const h = harness()
    const before = JSON.stringify(h.repo.get(UID))
    const code = await runSender(['--test-push', UID], fullEnv, h.io, h.build)
    expect(code).toBe(0)
    expect(h.push.sent).toHaveLength(1)
    expect(h.push.sent[0]!.payload.body).toBe('SECRET-TEXT-ONE')
    expect(JSON.stringify(h.repo.get(UID))).toBe(before)
    expect(h.log.entries).toHaveLength(0)
    expect(h.log.runs).toHaveLength(0)
    expect([...h.out, ...h.err].join('\n')).not.toMatch(/SECRET-TEXT|secret-endpoint/)
  })

  it('--test-push refuses when the user has no subscription', async () => {
    const h = harness()
    h.repo.put({ ...h.repo.get(UID)!, pushSubscription: null })
    const code = await runSender(['--test-push', UID], fullEnv, h.io, h.build)
    expect(code).toBe(1)
    expect(h.push.sent).toHaveLength(0)
    expect(h.err.join('\n')).toContain('no_subscription')
  })
})

describe('report formatting', () => {
  it('summary markdown lists counts and short ids only', async () => {
    const h = harness()
    h.push.setBehavior(() => ({ kind: 'failed', status: 500, retryable: true, error: 'http_500' }))
    await runSender([], fullEnv, h.io, h.build)
    const md = h.files.get('/tmp/summary.md') ?? ''
    expect(md).toContain('| failed | 1 |')
    expect(md).toContain(`failed: ${shortId(UID)}`)
    expect(typeof formatReport).toBe('function')
    expect(typeof formatMarkdownSummary).toBe('function')
  })
})
