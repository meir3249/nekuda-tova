import type { SendCycleConfig } from '../core/usecases/run-send-cycle.ts'

export interface SenderConfig {
  supabaseUrl: string
  serviceKey: string
  /** Null in dry-run mode, where nothing is sent. */
  vapid: { subject: string; publicKey: string; privateKey: string } | null
  dryRun: boolean
  verbose: boolean
  testPushUserId: string | null
  stepSummaryPath: string | null
  cycle: SendCycleConfig
}

export type ConfigResult = { ok: true; config: SenderConfig } | { ok: false; errors: string[] }

// Tunables (D-011, P-06, spec 05). Constants rather than env so a workflow edit is a reviewed change.
export const NOTIFICATION_TITLE = 'נקודה טובה'
const CYCLE_DEFAULTS = {
  batchSize: 50,
  leaseSeconds: 900,
  maxLateSeconds: 7200,
  ttlSeconds: 3600,
  urgency: 'normal',
  title: NOTIFICATION_TITLE,
  concurrency: 5,
  inactiveRetentionDays: 365,
  logRetentionDays: 90,
} as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VAPID_KEY = /^[A-Za-z0-9_-]{43,100}$/

export type Env = Readonly<Record<string, string | undefined>>

const truthy = (v: string | undefined): boolean => v !== undefined && ['1', 'true', 'yes'].includes(v.trim().toLowerCase())

/**
 * Pure: parses flags and environment. Errors name the variable or flag, never the value.
 * A real send needs VAPID keys; a dry run does not (it sends nothing).
 */
export function parseSenderConfig(argv: readonly string[], env: Env, now: Date): ConfigResult {
  const errors: string[] = []

  let dryRun = truthy(env['DRY_RUN'])
  let verbose = truthy(env['VERBOSE'])
  let testPushUserId: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--verbose') verbose = true
    else if (arg === '--test-push') {
      const value = argv[++i]
      if (value === undefined || !UUID.test(value)) errors.push('--test-push needs a user id (a UUID)')
      else testPushUserId = value
    } else errors.push(`unknown argument "${String(arg).slice(0, 40)}"`)
  }
  if (dryRun && testPushUserId !== null) errors.push('--dry-run and --test-push cannot be combined')

  const need = (name: string): string => {
    const v = env[name]?.trim()
    if (!v) {
      errors.push(`missing required environment variable ${name}`)
      return ''
    }
    return v
  }

  const supabaseUrl = need('SUPABASE_URL')
  const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY')
  if (supabaseUrl && !/^https?:\/\//.test(supabaseUrl)) errors.push('SUPABASE_URL must start with https:// (or http:// locally)')

  let vapid: SenderConfig['vapid'] = null
  if (!dryRun) {
    const publicKey = need('VAPID_PUBLIC_KEY')
    const privateKey = need('VAPID_PRIVATE_KEY')
    const subject = need('VAPID_SUBJECT')
    if (publicKey && !VAPID_KEY.test(publicKey)) errors.push('VAPID_PUBLIC_KEY is not a URL-safe base64 key')
    if (privateKey && !VAPID_KEY.test(privateKey)) errors.push('VAPID_PRIVATE_KEY is not a URL-safe base64 key')
    if (subject && !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) {
      errors.push('VAPID_SUBJECT must be a mailto: address or an https: URL')
    }
    vapid = { subject, publicKey, privateKey }
  }

  if (errors.length > 0) return { ok: false, errors }

  const runId = env['GITHUB_RUN_ID']
    ? `gh-${env['GITHUB_RUN_ID']}-${env['GITHUB_RUN_ATTEMPT'] ?? '1'}`
    : `local-${now.getTime()}`

  return {
    ok: true,
    config: {
      supabaseUrl,
      serviceKey,
      vapid,
      dryRun,
      verbose,
      testPushUserId,
      stepSummaryPath: env['GITHUB_STEP_SUMMARY']?.trim() || null,
      cycle: { ...CYCLE_DEFAULTS, runId, dryRun },
    },
  }
}
