import type { SettingsRow } from '../settings/apply-settings-change.ts'
import type { StoredPushSubscription } from './user-repository.ts'

/** Only the fields that changed. The counter and start index are never part of an update. */
export interface SettingsPatch {
  pushSubscription?: StoredPushSubscription | null
  localTime?: string
  timezone?: string
  enabled?: boolean
  nextSendAt?: Date | null
}

/** Persistence used by the `settings` Edge Function (the only writer of `subscriptions`). */
export interface SettingsStore {
  get(id: string): Promise<SettingsRow | null>
  count(): Promise<number>
  /** Inserts a new row; returns `'exists'` (and changes nothing) if the id already has one. */
  create(id: string, row: SettingsRow): Promise<'created' | 'exists'>
  /** Updates only the given fields, so concurrent sender progress (counter, schedule) is never overwritten. */
  update(id: string, patch: SettingsPatch): Promise<void>
}
