# 00 — Overview, Repository Structure, Shared Contracts

Status: **Draft, awaiting approval.** No code exists yet. `specs/init.md` is the original brief and is unchanged.

## 1. Spec index

| # | Spec | Demoable result |
|---|---|---|
| 01 | [Scaffold, tooling, CI, boundaries](01-scaffold-and-boundaries.md) | CI green; boundary test passes |
| 02 | [Content schema, validator, docs](02-content-schema-and-validator.md) | Validator accepts sample file, rejects bad ones |
| 03 | [Core progression and scheduling](03-core-progression-and-scheduling.md) | Test suite: 562 mod 41, DST, pause/resume |
| 04 | [Supabase schema, RLS, adapters, settings function](04-supabase-backend.md) | Anonymous user writes/reads own row; cross-user denied |
| 05 | [Sender and GitHub Actions](05-sender-and-workflow.md) | Dry run; real push to a test subscription |
| 06 | [PWA shell and settings UI](06-pwa-shell-and-settings-ui.md) | Installable PWA on Pages saves settings |
| 07 | [Push subscription and permission flows](07-push-and-permission-flows.md) | End-to-end push on Android Chrome and installed iOS PWA |
| 08 | [Documentation and verification](08-docs-and-verification.md) | README, privacy, limitations, device checklist |

Order and dependencies: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08. 02 and 03 could run in parallel after 01. 06 can start after 04. Each task ends with green CI.

Supporting: [research-notes.md](research-notes.md), root [DECISIONS.md](../DECISIONS.md).

## 2. Proposed repository structure (needs approval)

```
/
├─ README.md
├─ DECISIONS.md
├─ DEPENDENCIES.md                 # exact versions, licenses, free-tier limits (Task 1, updated per task)
├─ package.json  tsconfig.json  eslint.config.js  vitest.config.ts  vite.config.ts  .nvmrc
├─ data/
│  └─ messages.json                # single source of truth for content
├─ docs/
│  ├─ content-management.md
│  ├─ privacy.md
│  ├─ limitations.md
│  ├─ operations.md                # secrets, keep-alive, restore a paused project
│  └─ verification/                # device checklist + final report template
├─ specs/                          # this directory; init.md untouched
├─ src/
│  ├─ core/                        # PURE. No infra imports. Only relative imports inside core.
│  │  ├─ ports/                    # Clock, ContentSource, UserRepository, PushSender, DeliveryLog
│  │  ├─ content/                  # schema + validator
│  │  ├─ progression/              # modulo
│  │  ├─ scheduling/               # slots, timezone, nextSendAt, staleness
│  │  ├─ settings/                 # applySettingsChange
│  │  ├─ environment/              # detectEnvironment (pure, inputs injected)
│  │  └─ usecases/                 # runSendCycle
│  ├─ adapters/
│  │  ├─ system/                   # SystemClock
│  │  ├─ repo-file/                # RepoFileContentSource
│  │  ├─ supabase/                 # UserRepository, DeliveryLog, sender_runs
│  │  └─ web-push/                 # PushSender
│  ├─ sender/                      # Node entry point: wires adapters + core
│  └─ pwa/                         # Vite root: index.html, main.ts, sw.ts, manifest, strings
├─ supabase/
│  ├─ migrations/
│  ├─ functions/settings/          # Edge Function using core
│  ├─ tests/                       # SQL/RLS tests
│  └─ config.toml
├─ tests/
│  ├─ fakes/                       # FakeClock, InMemoryUserRepository, FakePushSender, ...
│  ├─ core/  adapters/  sender/  pwa/  boundary/
├─ scripts/                        # validate-content, generate-vapid-keys, dev helpers
└─ .github/workflows/
   ├─ ci.yml                       # lint, typecheck, test, boundary, content validation
   ├─ send.yml                     # cron sender
   └─ pages.yml                    # build + deploy PWA
```

Dependency rule: `pwa`, `sender`, `adapters`, `supabase/functions` may import `core`. `core` imports nothing outside `core`. `adapters` never import each other. `pwa` never imports `adapters/web-push` or `sender`.

## 3. Conventions

- TypeScript strict, ESM, Node LTS pinned in `.nvmrc` (version chosen in Task 1 from the current Active LTS).
- All time values at boundaries are `Date` (UTC instants) or ISO-8601 strings with `Z`. `local_time` is `"HH:MM"` 24-hour.
- Indexing: **0-based**. `messages[i]` with `0 ≤ i < N`.
- Errors in core: return typed results for expected failures; throw only for programmer errors (e.g. `N ≤ 0`).
- UI strings live in `src/pwa/strings.ts` (Hebrew, RTL; Q-01) and follow the Calm-space principle below.
- No analytics, no third-party scripts, no fonts or assets from a third party (the one font, Rubik, is self-hosted).
- Secrets never committed. Agent never asks for or receives secret values.
- **Calm-space principle.** Nekuda Tova is a space of peace: the screen itself is the space; the content only lives in it. It is never messy, crowded or bustling. Wide breathing room on a deep night-blue field, a few soft rounded cards, and each label sharing one quiet row with its control. Nothing appears by itself on load, except a one-time, dismissible install hint in iOS Safari. At most one gentle notice is visible at a time, always in the single floating toast (or that one soft sheet). No banners, inline status or error lines, helper text under controls, diagrams, badges or stacked messages. Copy is one short, warm sentence, never alarming or guilt-inducing. Accessibility and the permission rules (D-013) are met through semantics and focus, not extra visible text. Every new element must justify itself against this; when in doubt, leave it out.

## 4. Shared contracts (authoritative; every task conforms to these)

```ts
// src/core/ports/clock.ts
export interface Clock { now(): Date }

// src/core/ports/content-source.ts
export interface ContentSource { loadRaw(): Promise<string> }   // raw JSON text; validation is core's job

// src/core/ports/push-sender.ts
export interface PushPayload { v: 1; title: string; body: string; tag: string }
export interface PushOptions { ttlSeconds: number; urgency: 'very-low'|'low'|'normal'|'high'; topic?: string }
export type PushResult =
  | { kind: 'accepted'; status: number }                       // 2xx from the push service
  | { kind: 'gone'; status: 404 | 410 }                        // subscription expired
  | { kind: 'failed'; status: number | null; retryable: boolean; error: string }
export interface PushSender {
  send(subscription: StoredPushSubscription, payload: PushPayload, options: PushOptions): Promise<PushResult>
}

// src/core/ports/user-repository.ts
export interface StoredPushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }
export interface Subscription {
  id: string                       // anonymous auth uid
  pushSubscription: StoredPushSubscription | null
  localTime: string                // "HH:MM", minutes 00 or 30
  timezone: string                 // IANA
  enabled: boolean
  startIndex: number               // random int in [0, 2^31-1], set once
  messageIndex: number             // the counter; monotonically increasing; never reduced
  nextSendAt: Date | null          // UTC; null when disabled
  claimedUntil: Date | null
  updatedAt: Date
}
export interface UserRepository {
  peekDue(now: Date, limit: number): Promise<Subscription[]>                      // read-only (dry run)
  claimDue(now: Date, limit: number, leaseSeconds: number): Promise<Subscription[]> // atomic lease
  finalizeSent(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean>  // counter +1; CAS
  finalizeSkipped(id: string, expectedNextSendAt: Date, newNextSendAt: Date): Promise<boolean> // counter unchanged; CAS
  releaseClaim(id: string): Promise<void>                                           // retry later; nothing else changes
  markExpired(id: string): Promise<void>                                            // null sub, enabled=false, next=null, release
  pruneInactive(olderThan: Date): Promise<number>                                   // disabled rows untouched since
}

// src/core/ports/delivery-log.ts
export type DeliveryStatus = 'sent' | 'skipped_stale' | 'failed' | 'expired_subscription'
export interface DeliveryLogEntry {
  userId: string; scheduledFor: Date; attemptedAt: Date; delaySeconds: number
  status: DeliveryStatus; pushStatus: number | null; counterValue: number
  runId: string | null; messageId: string | null      // id only; never message text
}
export interface RunSummary { runId: string; startedAt: Date; finishedAt: Date; outcome: 'ok'|'aborted_invalid_content'|'error'
  claimed: number; sent: number; skippedStale: number; failed: number; expired: number }
export interface DeliveryLog {
  record(entry: DeliveryLogEntry): Promise<void>
  recordRun(summary: RunSummary): Promise<void>
  pruneOlderThan(cutoff: Date): Promise<number>
}
```

Notes:
- `counterValue` in a log entry is the counter used for the attempt (value **before** any increment).
- Message text is never stored in any table or log.

## 5. Behavior summary (single place to read the whole system)

1. A user opens the PWA, picks a 30-minute slot, taps the notifications switch, grants permission. The PWA calls the `settings` Edge Function, which validates, creates or updates the row, and computes `next_send_at`.
2. Every 30 minutes the sender validates `data/messages.json`, then claims rows with `enabled AND next_send_at <= now`.
3. For each claimed row: `delay = attempt − scheduled`. If `delay > 7200 s` → skip, log `skipped_stale`, `next_send_at = next occurrence after now`, counter unchanged.
4. Otherwise message index = `(start_index + message_index) mod N` (0-based), push with short TTL.
5. 2xx → counter + 1, next occurrence, log `sent` with delay. 404/410 → subscription removed, user disabled, log `expired_subscription`. Other failure → counter unchanged, lease released, retried next run until stale, log `failed`.
6. Disabling pauses everything; re-enabling resumes with the same counter.

## 6. Approval checklist for the user

Please answer the proposals in `DECISIONS.md` §5 (P-01..P-15) and questions §6 (Q-01..Q-06), and confirm:
- the repo structure above;
- the eight task specs, their order, and their acceptance criteria.
