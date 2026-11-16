import { describe, expect, it } from 'vitest'
import {
  applySettingsChange,
  type SettingsRequest,
  type SettingsRow,
} from '../../../src/core/settings/apply-settings-change.ts'
import { validatePushSubscription } from '../../../src/core/settings/validate-push-subscription.ts'
import {
  DEFAULT_PUSH_ENDPOINT_ALLOWLIST,
  isAllowedPushHost,
} from '../../../src/core/settings/push-endpoint-allowlist.ts'
import { nextOccurrenceAfter } from '../../../src/core/scheduling/next-send.ts'
import { messageIndexFor } from '../../../src/core/progression/index.ts'

const NOW = new Date('2027-01-10T08:00:00.000Z')
const rng = () => 0.25
const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
}

function ok(r: ReturnType<typeof applySettingsChange>): SettingsRow {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}`)
  return r.row
}
function code(r: ReturnType<typeof applySettingsChange>): string {
  if (r.ok) throw new Error('expected error')
  return r.code
}

const enabledRow = (): SettingsRow =>
  ok(applySettingsChange(null, { localTime: '09:00', timezone: 'Asia/Jerusalem', enabled: true, pushSubscription: SUB }, NOW, rng))

describe('applySettingsChange: new row (rule 1)', () => {
  it('requires localTime and timezone', () => {
    expect(code(applySettingsChange(null, {}, NOW, rng))).toBe('MISSING_FIELDS')
    expect(code(applySettingsChange(null, { localTime: '09:00' }, NOW, rng))).toBe('MISSING_FIELDS')
    expect(code(applySettingsChange(null, { timezone: 'UTC' }, NOW, rng))).toBe('MISSING_FIELDS')
  })

  it('creates a disabled row by default with random start index and counter 0', () => {
    const row = ok(applySettingsChange(null, { localTime: '09:00', timezone: 'UTC' }, NOW, () => 0.5))
    expect(row).toEqual({
      pushSubscription: null,
      localTime: '09:00',
      timezone: 'UTC',
      enabled: false,
      startIndex: 2 ** 30,
      messageIndex: 0,
      nextSendAt: null,
    })
  })

  it('creates an enabled row with computed nextSendAt', () => {
    const row = enabledRow()
    expect(row.enabled).toBe(true)
    expect(row.pushSubscription).toEqual(SUB)
    expect(row.nextSendAt?.toISOString()).toBe(nextOccurrenceAfter('09:00', 'Asia/Jerusalem', NOW).toISOString())
    expect(row.messageIndex).toBe(0)
  })
})

describe('applySettingsChange: validation (rules 2, 3) and no partial change', () => {
  it('rejects invalid slot/timezone and leaves nothing to write', () => {
    const cur = enabledRow()
    const snapshot = structuredClone(cur)
    expect(code(applySettingsChange(cur, { localTime: '09:15' }, NOW, rng))).toBe('INVALID_SLOT')
    expect(code(applySettingsChange(cur, { timezone: 'Asia/Nowhere' }, NOW, rng))).toBe('INVALID_TIMEZONE')
    expect(code(applySettingsChange(cur, { timezone: '+02:00' }, NOW, rng))).toBe('INVALID_TIMEZONE')
    // A valid change combined with an invalid one must not apply either.
    expect(code(applySettingsChange(cur, { localTime: '10:00', timezone: 'IST' }, NOW, rng))).toBe('INVALID_TIMEZONE')
    expect(cur).toEqual(snapshot)
  })

  it('invalid slot on a new row', () => {
    expect(code(applySettingsChange(null, { localTime: '24:00', timezone: 'UTC' }, NOW, rng))).toBe('INVALID_SLOT')
  })

  it('enable requires a subscription (request or stored)', () => {
    expect(code(applySettingsChange(null, { localTime: '09:00', timezone: 'UTC', enabled: true }, NOW, rng))).toBe(
      'SUBSCRIPTION_REQUIRED',
    )
    const disabled = ok(applySettingsChange(null, { localTime: '09:00', timezone: 'UTC' }, NOW, rng))
    expect(code(applySettingsChange(disabled, { enabled: true }, NOW, rng))).toBe('SUBSCRIPTION_REQUIRED')
    expect(code(applySettingsChange(disabled, { enabled: true, pushSubscription: null }, NOW, rng))).toBe(
      'SUBSCRIPTION_REQUIRED',
    )
  })

  it('rejects malformed or non-allowlisted subscriptions', () => {
    const base: SettingsRequest = { localTime: '09:00', timezone: 'UTC', enabled: true }
    const bad = (sub: unknown) =>
      code(applySettingsChange(null, { ...base, pushSubscription: sub as NonNullable<SettingsRequest['pushSubscription']> }, NOW, rng))
    expect(bad({ ...SUB, endpoint: 'https://evil.example.com/x' })).toBe('INVALID_SUBSCRIPTION')
    expect(bad({ ...SUB, endpoint: 'http://fcm.googleapis.com/x' })).toBe('INVALID_SUBSCRIPTION')
    expect(bad({ ...SUB, keys: { ...SUB.keys, auth: 'not base64url!!' } })).toBe('INVALID_SUBSCRIPTION')
    expect(bad({ endpoint: SUB.endpoint })).toBe('INVALID_SUBSCRIPTION')
  })

  it('stored subscription satisfies enable', () => {
    const cur = enabledRow()
    const off = ok(applySettingsChange(cur, { enabled: false }, NOW, rng))
    // Disable cleared the subscription, so re-enabling without a new one must fail.
    expect(code(applySettingsChange(off, { enabled: true }, NOW, rng))).toBe('SUBSCRIPTION_REQUIRED')
  })
})

describe('applySettingsChange: disable / enable (rules 4, 5, 8)', () => {
  it('disable nulls subscription and nextSendAt, keeps everything else', () => {
    const cur = { ...enabledRow(), messageIndex: 12 }
    const off = ok(applySettingsChange(cur, { enabled: false }, NOW, rng))
    expect(off.enabled).toBe(false)
    expect(off.pushSubscription).toBeNull()
    expect(off.nextSendAt).toBeNull()
    expect(off.startIndex).toBe(cur.startIndex)
    expect(off.messageIndex).toBe(12)
    expect(off.localTime).toBe('09:00')
    expect(off.timezone).toBe('Asia/Jerusalem')
  })

  it('re-enable recomputes nextSendAt and never touches the counter', () => {
    const cur = { ...enabledRow(), messageIndex: 12 }
    const off = ok(applySettingsChange(cur, { enabled: false }, NOW, rng))
    const later = new Date('2027-02-20T12:00:00.000Z')
    const on = ok(applySettingsChange(off, { enabled: true, pushSubscription: SUB }, later, rng))
    expect(on.messageIndex).toBe(12)
    expect(on.startIndex).toBe(cur.startIndex)
    expect(on.nextSendAt?.toISOString()).toBe(nextOccurrenceAfter('09:00', 'Asia/Jerusalem', later).toISOString())
  })

  it('disabling a disabled row is idempotent', () => {
    const off = ok(applySettingsChange(null, { localTime: '09:00', timezone: 'UTC' }, NOW, rng))
    expect(ok(applySettingsChange(off, { enabled: false }, NOW, rng))).toEqual(off)
  })
})

describe('applySettingsChange: schedule changes (rules 5, 6, 7)', () => {
  it('changing localTime or timezone while enabled replaces the schedule', () => {
    const cur = enabledRow()
    const t = ok(applySettingsChange(cur, { localTime: '21:30' }, NOW, rng))
    expect(t.nextSendAt?.toISOString()).toBe(nextOccurrenceAfter('21:30', 'Asia/Jerusalem', NOW).toISOString())
    const z = ok(applySettingsChange(cur, { timezone: 'America/New_York' }, NOW, rng))
    expect(z.nextSendAt?.toISOString()).toBe(nextOccurrenceAfter('09:00', 'America/New_York', NOW).toISOString())
    expect(t.pushSubscription).toEqual(SUB)
    expect(t.messageIndex).toBe(cur.messageIndex)
  })

  it('subscription-only renewal keeps nextSendAt unchanged', () => {
    const cur = enabledRow()
    const later = new Date('2027-01-10T20:00:00.000Z')
    const renewed = ok(
      applySettingsChange(cur, { pushSubscription: { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/renewed' } }, later, rng),
    )
    expect(renewed.nextSendAt?.toISOString()).toBe(cur.nextSendAt?.toISOString())
    expect(renewed.pushSubscription?.endpoint).toBe('https://fcm.googleapis.com/fcm/send/renewed')
  })

  it('re-sending the same time/timezone while enabled is a no-op for the schedule', () => {
    const cur = enabledRow()
    const later = new Date('2027-01-10T20:00:00.000Z')
    const same = ok(applySettingsChange(cur, { localTime: '09:00', timezone: 'Asia/Jerusalem' }, later, rng))
    expect(same.nextSendAt?.toISOString()).toBe(cur.nextSendAt?.toISOString())
  })

  it('edits while disabled are stored and nextSendAt stays null', () => {
    const off = ok(applySettingsChange(null, { localTime: '09:00', timezone: 'UTC' }, NOW, rng))
    const edited = ok(applySettingsChange(off, { localTime: '18:30', timezone: 'Asia/Kolkata' }, NOW, rng))
    expect(edited.localTime).toBe('18:30')
    expect(edited.timezone).toBe('Asia/Kolkata')
    expect(edited.nextSendAt).toBeNull()
    expect(edited.enabled).toBe(false)
  })

  it('P-14: no once-per-day guard — re-enabling the same day schedules the next slot again', () => {
    const cur = enabledRow()
    const off = ok(applySettingsChange(cur, { enabled: false }, NOW, rng))
    const on = ok(applySettingsChange(off, { enabled: true, pushSubscription: SUB }, NOW, rng))
    expect(on.nextSendAt?.toISOString()).toBe(cur.nextSendAt?.toISOString())
  })
})

describe('pause/resume scenario (acceptance 2)', () => {
  it('counter unchanged across N calendar days; next message equals the one before pausing', () => {
    const n = 41
    const cur = { ...enabledRow(), messageIndex: 100, startIndex: 7 }
    const before = messageIndexFor(cur.startIndex, cur.messageIndex, n)
    const off = ok(applySettingsChange(cur, { enabled: false }, NOW, rng))
    for (const days of [1, 3, 30, 365]) {
      const resumeAt = new Date(NOW.getTime() + days * 86_400_000)
      const on = ok(applySettingsChange(off, { enabled: true, pushSubscription: SUB }, resumeAt, rng))
      expect(on.messageIndex).toBe(cur.messageIndex)
      expect(messageIndexFor(on.startIndex, on.messageIndex, n)).toBe(before)
    }
  })
})

describe('validatePushSubscription / allowlist', () => {
  it('accepts allowlisted hosts', () => {
    for (const host of [
      'fcm.googleapis.com',
      'updates.push.services.mozilla.com',
      'web.push.apple.com',
      'api.sandbox.push.apple.com',
      'db5.notify.windows.com',
    ]) {
      const r = validatePushSubscription({ ...SUB, endpoint: `https://${host}/p/1` }, DEFAULT_PUSH_ENDPOINT_ALLOWLIST)
      expect(r.ok, host).toBe(true)
    }
  })

  it('rejects look-alike hosts, credentials, bad URLs, and oversize payloads', () => {
    const v = (endpoint: string, keys = SUB.keys) => validatePushSubscription({ endpoint, keys }, DEFAULT_PUSH_ENDPOINT_ALLOWLIST).ok
    expect(v('https://fcm.googleapis.com.evil.com/x')).toBe(false)
    expect(v('https://evilpush.apple.com.example/x')).toBe(false)
    expect(v('https://notpush.apple.com/x')).toBe(false) // "notpush.apple.com" lacks the ".push.apple.com" suffix
    expect(v('https://user:pw@fcm.googleapis.com/x')).toBe(false)
    expect(v('not a url')).toBe(false)
    expect(v(`https://fcm.googleapis.com/${'a'.repeat(5000)}`)).toBe(false)
    expect(validatePushSubscription(null, DEFAULT_PUSH_ENDPOINT_ALLOWLIST).ok).toBe(false)
  })

  it('suffix match requires a subdomain', () => {
    expect(isAllowedPushHost('push.apple.com', DEFAULT_PUSH_ENDPOINT_ALLOWLIST)).toBe(false)
    expect(isAllowedPushHost('x.push.apple.com', DEFAULT_PUSH_ENDPOINT_ALLOWLIST)).toBe(true)
    expect(isAllowedPushHost('FCM.GOOGLEAPIS.COM', DEFAULT_PUSH_ENDPOINT_ALLOWLIST)).toBe(true)
  })

  it('returns a normalized copy without extra fields', () => {
    const r = validatePushSubscription({ ...SUB, extra: 'x', expirationTime: null }, DEFAULT_PUSH_ENDPOINT_ALLOWLIST)
    expect(r.ok && r.value).toEqual(SUB)
  })
})
