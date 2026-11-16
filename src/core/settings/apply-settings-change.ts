import { randomStartIndex } from '../progression/index.ts'
import type { StoredPushSubscription, Subscription } from '../ports/user-repository.ts'
import { nextOccurrenceAfter } from '../scheduling/next-send.ts'
import { isValidSlot } from '../scheduling/slots.ts'
import { isValidTimezone } from '../scheduling/timezone.ts'
import { DEFAULT_PUSH_ENDPOINT_ALLOWLIST, type PushEndpointAllowlist } from './push-endpoint-allowlist.ts'
import { validatePushSubscription } from './validate-push-subscription.ts'

export interface SettingsRequest {
  localTime?: string
  timezone?: string
  enabled?: boolean
  pushSubscription?: StoredPushSubscription | null
}

export type SettingsRow = Omit<Subscription, 'id' | 'updatedAt' | 'claimedUntil'>

export type SettingsErrorCode =
  | 'INVALID_SLOT'
  | 'INVALID_TIMEZONE'
  | 'MISSING_FIELDS'
  | 'SUBSCRIPTION_REQUIRED'
  | 'INVALID_SUBSCRIPTION'

export type SettingsResult =
  | { ok: true; row: SettingsRow }
  | { ok: false; code: SettingsErrorCode; message: string }

/**
 * Pure settings-change rules (spec 03). On error nothing is changed: the caller
 * receives only the error and must not write.
 */
export function applySettingsChange(
  current: SettingsRow | null,
  req: SettingsRequest,
  now: Date,
  rng: () => number,
  allowlist: PushEndpointAllowlist = DEFAULT_PUSH_ENDPOINT_ALLOWLIST,
): SettingsResult {
  const err = (code: SettingsErrorCode, message: string): SettingsResult => ({ ok: false, code, message })

  // 1. New rows require time and timezone.
  if (current === null && (req.localTime === undefined || req.timezone === undefined)) {
    return err('MISSING_FIELDS', 'localTime and timezone are required')
  }

  // 2. Validate what was provided.
  if (req.localTime !== undefined && !isValidSlot(req.localTime)) {
    return err('INVALID_SLOT', 'localTime must be HH:00 or HH:30')
  }
  if (req.timezone !== undefined && !isValidTimezone(req.timezone)) {
    return err('INVALID_TIMEZONE', 'timezone must be a valid IANA timezone name')
  }

  const localTime = req.localTime ?? current?.localTime
  const timezone = req.timezone ?? current?.timezone
  if (localTime === undefined || timezone === undefined) {
    return err('MISSING_FIELDS', 'localTime and timezone are required')
  }
  const enabled = req.enabled ?? current?.enabled ?? false

  // 3./4. Subscription handling.
  let pushSubscription: StoredPushSubscription | null = null
  if (enabled) {
    let candidate: StoredPushSubscription | null
    if (req.pushSubscription !== undefined) {
      if (req.pushSubscription === null) return err('SUBSCRIPTION_REQUIRED', 'A push subscription is required to enable')
      const v = validatePushSubscription(req.pushSubscription, allowlist)
      if (!v.ok) return err('INVALID_SUBSCRIPTION', v.message)
      candidate = v.value
    } else {
      candidate = current?.pushSubscription ?? null
    }
    if (candidate === null) return err('SUBSCRIPTION_REQUIRED', 'A push subscription is required to enable')
    pushSubscription = candidate
  }
  // Disabled: pushSubscription stays null (rule 4).

  // 5.–7. Schedule.
  let nextSendAt: Date | null = null
  if (enabled) {
    const wasEnabled = current?.enabled === true
    const timeChanged = current !== null && (localTime !== current.localTime || timezone !== current.timezone)
    if (wasEnabled && !timeChanged && current?.nextSendAt != null) {
      nextSendAt = current.nextSendAt // renewal / no-op: keep the schedule (rule 6)
    } else {
      nextSendAt = nextOccurrenceAfter(localTime, timezone, now)
    }
  }

  return {
    ok: true,
    row: {
      pushSubscription,
      localTime,
      timezone,
      enabled,
      // Rules 1 and 8: set once on creation; counter never touched here.
      startIndex: current?.startIndex ?? randomStartIndex(rng),
      messageIndex: current?.messageIndex ?? 0,
      nextSendAt,
    },
  }
}
