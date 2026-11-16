export interface StoredPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface Subscription {
  /** Anonymous auth uid. */
  id: string
  pushSubscription: StoredPushSubscription | null
  /** "HH:MM", minutes 00 or 30. */
  localTime: string
  /** IANA timezone name. */
  timezone: string
  enabled: boolean
  /** Random int in [0, 2^31-1], set once. */
  startIndex: number
  /** The counter; monotonically increasing; never reduced. */
  messageIndex: number
  /** UTC; null when disabled. */
  nextSendAt: Date | null
  claimedUntil: Date | null
  updatedAt: Date
}

export interface UserRepository {
  /** Read-only (dry run). */
  peekDue(now: Date, limit: number): Promise<Subscription[]>
  /** Atomic lease. */
  claimDue(now: Date, limit: number, leaseSeconds: number): Promise<Subscription[]>
  /** Counter +1; compare-and-set on `nextSendAt`. */
  finalizeSent(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean>
  /** Counter unchanged; compare-and-set on `nextSendAt`. */
  finalizeSkipped(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean>
  /** Retry later; nothing else changes. */
  releaseClaim(id: string): Promise<void>
  /** Null subscription, enabled=false, next=null, release. */
  markExpired(id: string): Promise<void>
  /** Disabled rows untouched since `olderThan`. */
  pruneInactive(olderThan: Date): Promise<number>
}
