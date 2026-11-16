import type { SendCycleReport } from '../core/usecases/run-send-cycle.ts'

/** Public Actions logs: show only the first 8 characters of an anonymous user id. Enough to find the row. */
export const shortId = (id: string): string => id.slice(0, 8)

/**
 * Removes secrets (exact values) and any URL (push endpoints) from text before it is printed.
 * Applied to every unexpected error message. Values shorter than 8 characters are ignored to avoid mangling output.
 */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text.replace(/https?:\/\/\S+/gi, '[url]')
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]')
  }
  return out
}

function ids(label: string, list: readonly string[]): string {
  return list.length === 0 ? '' : `${label}: ${list.map(shortId).join(', ')}`
}

function statusLines(r: SendCycleReport): string[] {
  const entries = Object.entries(r.failedByStatus)
  if (entries.length === 0) return []
  const out = [`failed by status: ${entries.map(([k, v]) => `${k}=${v}`).join(' ')}`]
  if (r.failedByStatus['401'] || r.failedByStatus['403']) {
    out.push('WARNING: 401/403 from the push service usually means wrong VAPID keys or subject. Check the secrets.')
  }
  return out
}

/** Plain-text report for stdout. Counts, delays and short ids only; never message text or endpoints. */
export function formatReport(r: SendCycleReport): string {
  const lines: string[] = []
  lines.push(`run ${r.runId} ${r.dryRun ? '(DRY RUN, nothing written or sent) ' : ''}outcome=${r.outcome}`)
  if (r.note) lines.push(`note: ${r.note}`)

  if (r.dryRun) {
    lines.push(`due users: ${r.claimed}`)
    if (r.plan.length > 0) {
      lines.push('user      action      delay_s  message_index')
      for (const p of r.plan) {
        lines.push(
          `${shortId(p.userId).padEnd(9)} ${p.action.padEnd(11)} ${String(p.delaySeconds).padStart(7)}  ${p.messageIndex ?? '-'}`,
        )
      }
    }
  } else {
    lines.push(
      `claimed=${r.claimed} sent=${r.sent} skipped_stale=${r.skippedStale} failed=${r.failed} expired=${r.expired} raced=${r.raced}`,
    )
  }
  lines.push(`delay seconds: max=${r.maxDelaySeconds} median=${r.medianDelaySeconds}`)
  if (r.bookkeepingErrors > 0) lines.push(`bookkeeping errors (log/release): ${r.bookkeepingErrors}`)
  const stale = ids('skipped_stale', r.staleUserIds)
  const failed = ids('failed', r.failedUserIds)
  if (stale) lines.push(stale)
  if (failed) lines.push(failed)
  lines.push(...statusLines(r))
  return lines.join('\n')
}

/** Markdown for `$GITHUB_STEP_SUMMARY`. */
export function formatMarkdownSummary(r: SendCycleReport): string {
  const rows: [string, number][] = r.dryRun
    ? [['due', r.claimed]]
    : [
        ['claimed', r.claimed],
        ['sent', r.sent],
        ['skipped_stale', r.skippedStale],
        ['failed', r.failed],
        ['expired_subscription', r.expired],
        ['raced (settings changed mid-run)', r.raced],
      ]
  const out: string[] = [
    `### Sender run \`${r.runId}\`${r.dryRun ? ' (dry run: nothing sent or written)' : ''}`,
    '',
    `Outcome: **${r.outcome}**${r.note ? ` (${r.note})` : ''}`,
    '',
    '| Status | Count |',
    '|---|---|',
    ...rows.map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `Delay (seconds): max ${r.maxDelaySeconds}, median ${r.medianDelaySeconds}`,
  ]
  if (r.dryRun && r.plan.length > 0) {
    out.push('', '| User | Action | Delay (s) | Message index |', '|---|---|---|---|')
    for (const p of r.plan) out.push(`| ${shortId(p.userId)} | ${p.action} | ${p.delaySeconds} | ${p.messageIndex ?? '-'} |`)
  }
  if (r.staleUserIds.length > 0) out.push('', `skipped_stale: ${r.staleUserIds.map(shortId).join(', ')}`)
  if (r.failedUserIds.length > 0) out.push('', `failed: ${r.failedUserIds.map(shortId).join(', ')}`)
  for (const line of statusLines(r)) out.push('', line)
  if (r.bookkeepingErrors > 0) out.push('', `Bookkeeping errors (log write or claim release): ${r.bookkeepingErrors}`)
  if (r.outcome !== 'ok') out.push('', `> This run did not complete normally (${r.outcome}).`)
  return out.join('\n') + '\n'
}
