/**
 * Thin logging wrappers around the real ports, used only when --verbose is active.
 * Wraps users, push, and log — every call logs its arguments and result to `dbg`.
 * Raw push response body/headers come via WebPushSender's onRawResponse hook (wired in main.ts).
 */
import type { DeliveryLog, DeliveryLogEntry, RunSummary } from '../core/ports/delivery-log.ts'
import type { PushOptions, PushPayload, PushResult, PushSender } from '../core/ports/push-sender.ts'
import type { StoredPushSubscription, Subscription, SubscriptionLookup, UserRepository } from '../core/ports/user-repository.ts'
import { shortId } from './report.ts'

export type Dbg = (line: string) => void

// ─── helpers ────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '')
}

function sub(s: Subscription): string {
  return (
    `{\n` +
    `    id:           ${s.id}\n` +
    `    timezone:     ${s.timezone}\n` +
    `    localTime:    ${s.localTime}\n` +
    `    messageIndex: ${s.messageIndex}\n` +
    `    startIndex:   ${s.startIndex}\n` +
    `    nextSendAt:   ${s.nextSendAt?.toISOString() ?? 'null'}\n` +
    `    claimedUntil: ${s.claimedUntil?.toISOString() ?? 'null'}\n` +
    `    enabled:      ${s.enabled}\n` +
    `    endpoint:     ${s.pushSubscription?.endpoint ?? 'null'}\n` +
    `    p256dh:       ${s.pushSubscription?.keys.p256dh ?? 'null'}\n` +
    `    auth:         ${s.pushSubscription?.keys.auth ?? 'null'}\n` +
    `  }`
  )
}

// ─── user repository proxy ───────────────────────────────────────────────────

export function verboseUsers(
  real: UserRepository & SubscriptionLookup,
  dbg: Dbg,
): UserRepository & SubscriptionLookup {
  return {
    async peekDue(now, limit) {
      dbg(`[${ts()}] DB ← peekDue(now=${now.toISOString()} limit=${limit})`)
      const rows = await real.peekDue(now, limit)
      dbg(`[${ts()}] DB → peekDue: ${rows.length} row(s)`)
      rows.forEach((r, i) => dbg(`  [${i}] ${sub(r)}`))
      return rows
    },

    async claimDue(now, limit, leaseSeconds) {
      dbg(`[${ts()}] DB ← claimDue(now=${now.toISOString()} limit=${limit} lease=${leaseSeconds}s)`)
      const rows = await real.claimDue(now, limit, leaseSeconds)
      dbg(`[${ts()}] DB → claimDue: ${rows.length} row(s)`)
      rows.forEach((r, i) => dbg(`  [${i}] ${sub(r)}`))
      return rows
    },

    async finalizeSent(id, expectedNextSendAt, newNextSendAt) {
      dbg(`[${ts()}] DB ← finalizeSent(id=${id} expected=${expectedNextSendAt.toISOString()} new=${newNextSendAt.toISOString()})`)
      const ok = await real.finalizeSent(id, expectedNextSendAt, newNextSendAt)
      dbg(`[${ts()}] DB → finalizeSent: ${ok ? 'ok (committed)' : 'false (raced — row changed mid-run)'}`)
      return ok
    },

    async finalizeSkipped(id, expectedNextSendAt, newNextSendAt) {
      dbg(`[${ts()}] DB ← finalizeSkipped(id=${id} expected=${expectedNextSendAt.toISOString()} new=${newNextSendAt.toISOString()})`)
      const ok = await real.finalizeSkipped(id, expectedNextSendAt, newNextSendAt)
      dbg(`[${ts()}] DB → finalizeSkipped: ${ok ? 'ok (committed)' : 'false (raced)'}`)
      return ok
    },

    async releaseClaim(id) {
      dbg(`[${ts()}] DB ← releaseClaim(id=${id})`)
      await real.releaseClaim(id)
      dbg(`[${ts()}] DB → releaseClaim: done`)
    },

    async markExpired(id) {
      dbg(`[${ts()}] DB ← markExpired(id=${id})`)
      await real.markExpired(id)
      dbg(`[${ts()}] DB → markExpired: done`)
    },

    async pruneInactive(olderThan) {
      dbg(`[${ts()}] DB ← pruneInactive(olderThan=${olderThan.toISOString()})`)
      const n = await real.pruneInactive(olderThan)
      dbg(`[${ts()}] DB → pruneInactive: ${n} rows deleted`)
      return n
    },

    async getById(id) {
      dbg(`[${ts()}] DB ← getById(id=${id})`)
      const row = await real.getById(id)
      dbg(`[${ts()}] DB → getById: ${row === null ? 'null (not found)' : sub(row)}`)
      return row
    },
  }
}

// ─── push sender proxy ───────────────────────────────────────────────────────

export function verbosePush(real: PushSender, dbg: Dbg): PushSender {
  return {
    async send(subscription: StoredPushSubscription, payload: PushPayload, options: PushOptions): Promise<PushResult> {
      dbg(
        `[${ts()}] PUSH ← send(\n` +
          `  endpoint: ${subscription.endpoint}\n` +
          `  p256dh:   ${subscription.keys.p256dh}\n` +
          `  auth:     ${subscription.keys.auth}\n` +
          `  payload:  ${JSON.stringify(payload)}\n` +
          `  options:  ${JSON.stringify(options)}\n` +
          `)`,
      )
      const result = await real.send(subscription, payload, options)
      const detail =
        result.kind === 'accepted'
          ? `accepted (HTTP ${result.status})`
          : result.kind === 'gone'
            ? `gone (HTTP ${result.status})`
            : `failed (status:${result.status ?? 'null'} error:${result.error} retryable:${result.retryable})`
      dbg(`[${ts()}] PUSH → send: ${detail}`)
      return result
    },
  }
}

// ─── delivery log proxy ──────────────────────────────────────────────────────

export function verboseLog(real: DeliveryLog, dbg: Dbg): DeliveryLog {
  return {
    async record(entry: DeliveryLogEntry) {
      dbg(`[${ts()}] LOG ← record(${JSON.stringify(entry, (k, v) => v instanceof Date ? v.toISOString() : v as unknown, 2)})`)
      await real.record(entry)
      dbg(`[${ts()}] LOG → record: done`)
    },

    async recordRun(summary: RunSummary) {
      dbg(`[${ts()}] LOG ← recordRun(${JSON.stringify(summary, (k, v) => v instanceof Date ? v.toISOString() : v as unknown, 2)})`)
      await real.recordRun(summary)
      dbg(`[${ts()}] LOG → recordRun: done`)
    },

    async pruneOlderThan(cutoff) {
      dbg(`[${ts()}] LOG ← pruneOlderThan(${cutoff.toISOString()})`)
      const n = await real.pruneOlderThan(cutoff)
      dbg(`[${ts()}] LOG → pruneOlderThan: ${n} rows deleted`)
      return n
    },
  }
}
