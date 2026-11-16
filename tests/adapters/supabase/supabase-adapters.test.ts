import { describe, expect, it } from 'vitest'
import { createServiceClient } from '../../../src/adapters/supabase/create-client.ts'
import { RepositoryError, RepositoryUnavailableError } from '../../../src/adapters/supabase/errors.ts'
import { SupabaseDeliveryLog } from '../../../src/adapters/supabase/supabase-delivery-log.ts'
import { SupabaseSettingsStore } from '../../../src/adapters/supabase/supabase-settings-store.ts'
import { SupabaseUserRepository } from '../../../src/adapters/supabase/supabase-user-repository.ts'
import { FakeFetch } from '../../fakes/fake-fetch.ts'

const URL_ = 'https://proj.supabase.co'
const KEY = 'service-role-key-for-tests'
const UID = '7b0f7c1e-4d3a-4f55-9d57-0c1f1b2a3d44'

function setup(): { fake: FakeFetch; repo: SupabaseUserRepository; log: SupabaseDeliveryLog; store: SupabaseSettingsStore } {
  const fake = new FakeFetch()
  const client = createServiceClient(URL_, KEY, { fetch: fake.fetch })
  return { fake, repo: new SupabaseUserRepository(client), log: new SupabaseDeliveryLog(client), store: new SupabaseSettingsStore(client) }
}

const dbRow = {
  id: UID,
  push_subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } },
  local_time: '09:00',
  timezone: 'Asia/Jerusalem',
  enabled: true,
  start_index: 123,
  message_index: 562,
  next_send_at: '2027-01-11T07:00:00+00:00',
  claimed_until: '2027-01-11T07:10:00+00:00',
  updated_at: '2027-01-10T08:00:00.123456+00:00',
}

describe('SupabaseUserRepository', () => {
  it('claimDue calls the RPC with ISO args and maps rows to Subscription', async () => {
    const { fake, repo } = setup()
    fake.reply({ body: [dbRow] })
    const now = new Date('2027-01-11T07:00:30.000Z')
    const rows = await repo.claimDue(now, 50, 600)

    const req = fake.requests[0]!
    expect(req.method).toBe('POST')
    expect(req.url.pathname).toBe('/rest/v1/rpc/claim_due_subscriptions')
    expect(req.body).toEqual({ p_now: '2027-01-11T07:00:30.000Z', p_limit: 50, p_lease_seconds: 600 })
    expect(req.headers.get('apikey')).toBe(KEY)

    expect(rows).toHaveLength(1)
    const s = rows[0]!
    expect(s).toMatchObject({
      id: UID,
      localTime: '09:00',
      timezone: 'Asia/Jerusalem',
      enabled: true,
      startIndex: 123,
      messageIndex: 562,
    })
    expect(s.nextSendAt).toEqual(new Date('2027-01-11T07:00:00Z'))
    expect(s.claimedUntil).toEqual(new Date('2027-01-11T07:10:00Z'))
    expect(s.pushSubscription).toEqual(dbRow.push_subscription)
  })

  it('maps null columns and an empty result', async () => {
    const { fake, repo } = setup()
    fake.reply({ body: [{ ...dbRow, push_subscription: null, next_send_at: null, claimed_until: null }] }, { body: null })
    const [s] = await repo.peekDue(new Date('2027-01-11T07:00:00Z'), 5)
    expect(s!.pushSubscription).toBeNull()
    expect(s!.nextSendAt).toBeNull()
    expect(s!.claimedUntil).toBeNull()
    expect(fake.requests[0]!.url.pathname).toBe('/rest/v1/rpc/peek_due_subscriptions')
    expect(await repo.peekDue(new Date(), 5)).toEqual([])
  })

  it('finalizeSent / finalizeSkipped pass CAS arguments and return the boolean', async () => {
    const { fake, repo } = setup()
    const expected = new Date('2027-01-11T07:00:00.000Z')
    const next = new Date('2027-01-12T07:00:00.000Z')
    fake.reply({ body: true }, { body: false }, { body: true })
    expect(await repo.finalizeSent(UID, expected, next)).toBe(true)
    expect(await repo.finalizeSent(UID, expected, next)).toBe(false) // stale CAS
    expect(await repo.finalizeSkipped(UID, expected, next)).toBe(true)
    expect(fake.requests[0]!.url.pathname).toBe('/rest/v1/rpc/finalize_sent')
    expect(fake.requests[0]!.body).toEqual({
      p_id: UID,
      p_expected: '2027-01-11T07:00:00.000Z',
      p_new: '2027-01-12T07:00:00.000Z',
    })
    expect(fake.requests[2]!.url.pathname).toBe('/rest/v1/rpc/finalize_skipped')
  })

  it('releaseClaim, markExpired, pruneInactive call the right functions', async () => {
    const { fake, repo } = setup()
    fake.reply({ status: 204 }, { status: 204 }, { body: 7 })
    await repo.releaseClaim(UID)
    await repo.markExpired(UID)
    expect(await repo.pruneInactive(new Date('2026-01-01T00:00:00Z'))).toBe(7)
    expect(fake.requests.map((r) => r.url.pathname)).toEqual([
      '/rest/v1/rpc/release_claim',
      '/rest/v1/rpc/mark_expired',
      '/rest/v1/rpc/prune_inactive',
    ])
    expect(fake.requests[2]!.body).toEqual({ p_cutoff: '2026-01-01T00:00:00.000Z' })
  })

  it('network failure and 5xx → RepositoryUnavailableError; 4xx → RepositoryError', async () => {
    const { fake, repo } = setup()
    fake.reply(new TypeError('fetch failed'), { status: 503, body: { message: 'paused' } }, { status: 403, body: { message: 'denied', code: '42501' } })
    await expect(repo.claimDue(new Date(), 1, 60)).rejects.toBeInstanceOf(RepositoryUnavailableError)
    await expect(repo.claimDue(new Date(), 1, 60)).rejects.toBeInstanceOf(RepositoryUnavailableError)
    const err = await repo.claimDue(new Date(), 1, 60).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RepositoryError)
    expect((err as RepositoryError).code).toBe('42501')
  })

  it('error messages never contain the key', async () => {
    const { fake, repo } = setup()
    fake.reply(new TypeError('fetch failed'))
    const err = (await repo.claimDue(new Date(), 1, 60).catch((e: unknown) => e)) as Error
    expect(err.message).not.toContain(KEY)
  })
})

describe('SupabaseDeliveryLog', () => {
  it('record inserts ids and counts only, snake_case, no message text', async () => {
    const { fake, log } = setup()
    fake.reply({ status: 201 })
    await log.record({
      userId: UID,
      scheduledFor: new Date('2027-01-11T07:00:00Z'),
      attemptedAt: new Date('2027-01-11T07:05:00Z'),
      delaySeconds: 300,
      status: 'sent',
      pushStatus: 201,
      counterValue: 562,
      runId: 'run-1',
      messageId: 'm-007',
    })
    const req = fake.requests[0]!
    expect(req.url.pathname).toBe('/rest/v1/delivery_log')
    expect(req.method).toBe('POST')
    expect(req.body).toEqual({
      user_id: UID,
      scheduled_for: '2027-01-11T07:00:00.000Z',
      attempted_at: '2027-01-11T07:05:00.000Z',
      delay_seconds: 300,
      status: 'sent',
      push_status: 201,
      counter_value: 562,
      run_id: 'run-1',
      message_id: 'm-007',
    })
  })

  it('recordRun upserts by run_id', async () => {
    const { fake, log } = setup()
    fake.reply({ status: 201 })
    await log.recordRun({
      runId: 'run-1',
      startedAt: new Date('2027-01-11T07:00:00Z'),
      finishedAt: new Date('2027-01-11T07:01:00Z'),
      outcome: 'ok',
      claimed: 3,
      sent: 2,
      skippedStale: 1,
      failed: 0,
      expired: 0,
    })
    const req = fake.requests[0]!
    expect(req.url.pathname).toBe('/rest/v1/sender_runs')
    expect(req.url.searchParams.get('on_conflict')).toBe('run_id')
    expect(req.body).toMatchObject({ run_id: 'run-1', outcome: 'ok', skipped_stale: 1 })
  })

  it('pruneOlderThan returns the count; failures are typed', async () => {
    const { fake, log } = setup()
    fake.reply({ body: 12 }, { status: 500, body: { message: 'boom' } })
    expect(await log.pruneOlderThan(new Date('2026-08-01T00:00:00Z'))).toBe(12)
    await expect(log.pruneOlderThan(new Date())).rejects.toBeInstanceOf(RepositoryUnavailableError)
  })
})

describe('SupabaseSettingsStore', () => {
  it('get maps a row, and returns null when none', async () => {
    const { fake, store } = setup()
    fake.reply({ body: dbRow }, { status: 200, body: null })
    const row = await store.get(UID)
    expect(row).toMatchObject({ localTime: '09:00', startIndex: 123, messageIndex: 562, enabled: true })
    expect(fake.requests[0]!.url.searchParams.get('id')).toBe(`eq.${UID}`)
    expect(await store.get(UID)).toBeNull()
  })

  it('create inserts the full row; unique violation → "exists"', async () => {
    const { fake, store } = setup()
    fake.reply({ status: 201 }, { status: 409, body: { code: '23505', message: 'duplicate key' } })
    const row = {
      pushSubscription: null,
      localTime: '09:00',
      timezone: 'UTC',
      enabled: false,
      startIndex: 5,
      messageIndex: 0,
      nextSendAt: null,
    }
    expect(await store.create(UID, row)).toBe('created')
    expect(fake.requests[0]!.body).toEqual({
      id: UID,
      push_subscription: null,
      local_time: '09:00',
      timezone: 'UTC',
      enabled: false,
      start_index: 5,
      message_index: 0,
      next_send_at: null,
    })
    expect(await store.create(UID, row)).toBe('exists')
  })

  it('update sends only the patched columns and never counter/start index', async () => {
    const { fake, store } = setup()
    fake.reply({ status: 204 })
    await store.update(UID, { localTime: '10:30', nextSendAt: new Date('2027-01-11T08:30:00Z') })
    const req = fake.requests[0]!
    expect(req.method).toBe('PATCH')
    expect(req.url.searchParams.get('id')).toBe(`eq.${UID}`)
    expect(req.body).toEqual({ local_time: '10:30', next_send_at: '2027-01-11T08:30:00.000Z' })
  })

  it('update with an empty patch makes no request; null clears columns', async () => {
    const { fake, store } = setup()
    fake.reply({ status: 204 })
    await store.update(UID, {})
    expect(fake.requests).toHaveLength(0)
    await store.update(UID, { enabled: false, pushSubscription: null, nextSendAt: null })
    expect(fake.requests[0]!.body).toEqual({ enabled: false, push_subscription: null, next_send_at: null })
  })

  it('count uses the count_subscriptions function', async () => {
    const { fake, store } = setup()
    fake.reply({ body: 42 })
    expect(await store.count()).toBe(42)
    expect(fake.requests[0]!.url.pathname).toBe('/rest/v1/rpc/count_subscriptions')
  })
})

describe('createServiceClient', () => {
  it('requires url and key', () => {
    expect(() => createServiceClient('', KEY)).toThrow()
    expect(() => createServiceClient(URL_, '')).toThrow()
  })
})
