// Sender entry point (spec 05). Wires adapters to the core use cases.
//   node src/sender/main.ts [--dry-run] [--test-push <userId>]
// Exit codes: 0 success (even if some pushes failed individually), 1 aborted (invalid content) or fatal error,
// 2 configuration error. Output never contains secrets, push endpoints or message text.
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { RepoFileContentSource } from '../adapters/repo-file/repo-file-content-source.ts'
import { createServiceClient } from '../adapters/supabase/create-client.ts'
import { SupabaseDeliveryLog } from '../adapters/supabase/supabase-delivery-log.ts'
import { SupabaseUserRepository } from '../adapters/supabase/supabase-user-repository.ts'
import { SystemClock } from '../adapters/system/system-clock.ts'
import { WebPushSender } from '../adapters/web-push/web-push-sender.ts'
import type { Clock } from '../core/ports/clock.ts'
import type { ContentSource } from '../core/ports/content-source.ts'
import type { DeliveryLog } from '../core/ports/delivery-log.ts'
import type { PushSender } from '../core/ports/push-sender.ts'
import type { SubscriptionLookup, UserRepository } from '../core/ports/user-repository.ts'
import { runSendCycle } from '../core/usecases/run-send-cycle.ts'
import { runTestPush } from '../core/usecases/run-test-push.ts'
import { parseSenderConfig, type Env, type SenderConfig } from './config.ts'
import { formatMarkdownSummary, formatReport, redact, shortId } from './report.ts'

export const CONTENT_PATH = 'data/messages.json'

export interface SenderPorts {
  clock: Clock
  content: ContentSource
  users: UserRepository & SubscriptionLookup
  push: PushSender
  log: DeliveryLog
}

export interface SenderIo {
  out(line: string): void
  err(line: string): void
  appendFile(path: string, text: string): void
}

export type BuildPorts = (config: SenderConfig) => SenderPorts

/** A sender that fails loudly: used in dry-run mode so a bug can never send a real push. */
const forbiddenPush: PushSender = {
  send() {
    throw new Error('push attempted during a dry run')
  },
}

export const buildRealPorts: BuildPorts = (config) => {
  const client = createServiceClient(config.supabaseUrl, config.serviceKey)
  return {
    clock: new SystemClock(),
    content: new RepoFileContentSource(CONTENT_PATH),
    users: new SupabaseUserRepository(client),
    push: config.vapid ? new WebPushSender(config.vapid) : forbiddenPush,
    log: new SupabaseDeliveryLog(client),
  }
}

const realIo: SenderIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  appendFile: (path, text) => appendFileSync(path, text),
}

export async function runSender(
  argv: readonly string[],
  env: Env,
  io: SenderIo = realIo,
  build: BuildPorts = buildRealPorts,
): Promise<number> {
  const secrets = [env['SUPABASE_SERVICE_ROLE_KEY'], env['VAPID_PRIVATE_KEY'], env['VAPID_PUBLIC_KEY']].filter(
    (s): s is string => typeof s === 'string' && s !== '',
  )

  const parsed = parseSenderConfig(argv, env, new Date())
  if (!parsed.ok) {
    for (const e of parsed.errors) io.err(`configuration error: ${e}`)
    return 2
  }
  const { config } = parsed

  try {
    const ports = build(config)

    if (config.testPushUserId !== null) {
      const outcome = await runTestPush(
        { content: ports.content, lookup: ports.users, push: ports.push },
        {
          userId: config.testPushUserId,
          title: config.cycle.title,
          ttlSeconds: config.cycle.ttlSeconds,
          urgency: config.cycle.urgency,
        },
      )
      const id = shortId(config.testPushUserId)
      if (!outcome.ok) {
        io.err(`test push to ${id}: not sent (${outcome.reason})`)
        return 1
      }
      const r = outcome.result
      io.out(`test push to ${id}: ${r.kind}${r.status === null ? '' : ` (HTTP ${r.status})`}${r.kind === 'failed' ? ` [${r.error}]` : ''}`)
      return r.kind === 'accepted' ? 0 : 1
    }

    const report = await runSendCycle(ports, config.cycle)
    io.out(formatReport(report))
    if (config.stepSummaryPath) {
      try {
        io.appendFile(config.stepSummaryPath, formatMarkdownSummary(report))
      } catch {
        io.err('warning: could not write the step summary')
      }
    }
    return report.outcome === 'ok' ? 0 : 1
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error'
    const message = e instanceof Error ? e.message : 'unknown error'
    io.err(`fatal: ${name}: ${redact(message, secrets)}`)
    return 1
  }
}

// Run only when executed directly (not when imported by tests).
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await runSender(process.argv.slice(2), process.env)
}
