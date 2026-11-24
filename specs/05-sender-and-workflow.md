# 05 — Sender Script and GitHub Actions Workflow

## Purpose and scope
The scheduled sender: validate content, claim due users, apply the staleness policy, send Web Push, advance state safely, write the audit trail, and run on a 30-minute GitHub Actions cron with keep-alive handling.

## Relevant requirements
Hand-off Req 1, 7, 8, 9 and the Architecture sender flow. D-007, D-011, D-016, P-04..P-08, P-11. Brief §7 (fakes-based verification).

## Technical design

### Core use case: `runSendCycle` (`src/core/usecases/run-send-cycle.ts`)
Pure orchestration over ports. Signature:
```ts
runSendCycle(deps: { clock: Clock; content: ContentSource; users: UserRepository; push: PushSender; log: DeliveryLog },
             cfg: { runId: string; batchSize: number; leaseSeconds: number; maxLateSeconds: number; ttlSeconds: number;
                    urgency: PushOptions['urgency']; title: string; dryRun: boolean; concurrency: number;
                    inactiveRetentionDays: number; logRetentionDays: number }): Promise<RunSummary>
```
Steps (exact order):
1. `raw = content.loadRaw()`; `validateContent(raw)`. If invalid → record run `aborted_invalid_content`, **send nothing, change nothing**, throw/return failure so the workflow run is marked failed (visible to the owner). `N = messages.length`.
2. Unless `dryRun`: prune (`users.pruneInactive(now − 365 d)`, `log.pruneOlderThan(now − 90 d)`).
3. `now = clock.now()`. Rows = `dryRun ? users.peekDue(...) : users.claimDue(now, batchSize, leaseSeconds)`. Loop batches until fewer than `batchSize` are returned (cap of 20 batches per run).
4. For each row (bounded concurrency, default 5), with `scheduled = row.nextSendAt`, `attempt = clock.now()`:
   - `evaluateDelay(scheduled, attempt, maxLateSeconds)`.
   - **Stale** → `finalizeSkipped(id, scheduled, nextOccurrenceAfter(localTime, tz, attempt))`; log `skipped_stale` (with `delaySeconds`, `counterValue = row.messageIndex`).
   - **Not stale** → `idx = messageIndexFor(startIndex, messageIndex, N)`; `payload = { v:1, title: cfg.title, body: messages[idx].content, tag: "ntk-" + localDateOf(tz, scheduled) }`; `options = { ttlSeconds, urgency, topic: sameTagHash }` (Topic must be ≤ 32 URL-safe chars; derived deterministically from the tag).
     - `accepted` → `finalizeSent(...)` (counter +1, next occurrence after `attempt`); log `sent` with `pushStatus`, `delaySeconds`, `messageId`, `runId`.
     - `gone` → `markExpired(id)`; log `expired_subscription`.
     - `failed` → `releaseClaim(id)`; log `failed` with `pushStatus` (null on network error); counter and `next_send_at` unchanged so the next run retries until the 2 h window closes (then it is skipped as stale).
   - If `finalizeSent`/`finalizeSkipped` returns `false` (user changed settings mid-run), log nothing further and count as `raced`; never retry.
   - Exceptions for one user (`RangeError`, adapter errors) are caught per user: `releaseClaim`, counted as `failed`, run continues.
5. `log.recordRun(summary)` and return summary. **No message text ever enters a log or table.**

Dry run (`dryRun: true`): reads due rows via `peekDue`, computes what would happen (send / skip_stale / index), calls **no** write method and **no** `PushSender`, prints a table. Used for the first demo.

### Entry point `src/sender/main.ts`
- Reads env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` or https URL), `DRY_RUN`, `VERBOSE`, `GITHUB_RUN_ID`, `GITHUB_STEP_SUMMARY`. Missing required secret → exit 2 with a message naming the variable (never the value).
- CLI flags: `--dry-run`, `--verbose`, `--test-push <userId>` (sends the user's *next* message to that user's stored subscription **without** changing counter/schedule or writing `delivery_log`; used only for demo and diagnostics; refuses when the user has no subscription).
- Prints a per-run summary to stdout and appends a Markdown table to `GITHUB_STEP_SUMMARY`: counts by status, max/median delay, list of `skipped_stale` and `failed` user ids (ids only).
- Redacts secrets and push endpoints from all output.
- Exit codes: `0` success (even if some pushes failed individually), `1` aborted for invalid content or unexpected fatal error, `2` configuration error.
- **`SenderIo`** has `out`, `err`, `appendFile`, and `debug`. `debug` is a no-op in production; in verbose mode it writes to stderr. All test harnesses pass `debug: () => {}`.

### Local development: `sender:local` and `--verbose`
`npm run sender:local` runs `node --env-file=.env src/sender/main.ts`, loading `.env` into `process.env` with no extra dependencies (Node ≥ 20.6 built-in). `.env` is gitignored and never committed.

Add `--verbose` (or set `VERBOSE=1` in `.env`) to enable detailed stderr logging of every port call:
```
npm run sender:local -- --dry-run --verbose
npm run sender:local -- --verbose
npm run sender:local -- --test-push <userId> --verbose
```

Verbose output (to stderr) covers:
- **DB calls**: every `claimDue`, `peekDue`, `finalizeSent`, `finalizeSkipped`, `releaseClaim`, `markExpired`, `pruneInactive`, `getById` — arguments and return values. Subscription rows are logged as `{id, tz, localTime, msgIdx, nextSendAt, hasSub}` (never the push endpoint or keys).
- **Push calls**: endpoint truncated to 40 chars, full payload `{v, title, body(Nchars), tag}`, options `{ttl, urgency, topic}`, and the `PushResult` kind + HTTP status.
- **Delivery log calls**: every `record` and `recordRun` — full entry/summary structs (no endpoints, no message text in keys, no secrets).

Verbose mode is implemented via thin proxy wrappers in `src/sender/debug-proxies.ts` (`verboseUsers`, `verbosePush`, `verboseLog`). Each wraps the real port, calls the real method, and logs before and after. The proxies are only applied when `config.verbose === true`; CI and production never set that flag and are unaffected.

### Adapter `src/adapters/web-push/web-push-sender.ts`
- Implements `PushSender` using `web-push` (`setVapidDetails`, `sendNotification` with `TTL`, `urgency`, `topic`). Payload `JSON.stringify(PushPayload)` (encrypted by the library).
- Defensive endpoint re-check against the allowlist (P-08) before sending; mismatch → `failed`, `retryable: false`, row not sent.
- Result mapping: 2xx → `accepted`; 404/410 → `gone`; 429/5xx/network/timeouts → `failed, retryable:true` (honors `Retry-After` by not retrying within the run); other 4xx (400, 401, 403, 413) → `failed, retryable:false` (still retried next run, bounded by the 2 h window). Request timeout 10 s.
- **License check (R-08):** record the actual `web-push` license and maintenance state in `DEPENDENCIES.md` before adding. If it is unmaintained or not free, stop and propose an alternative (e.g. a small WebCrypto-based implementation) for approval.

### Workflow `.github/workflows/send.yml`
```
on:
  schedule: [{ cron: '3,33 * * * *' }]     # P-07: every 30 min, off the top-of-hour peak
  workflow_dispatch: { inputs: { dry_run: { type: boolean, default: true }, test_push_user: { type: string, default: '' } } }
concurrency: { group: nekuda-send, cancel-in-progress: false }
permissions: { contents: read, actions: write }   # actions: write only for the keep-alive step
jobs.send: runs-on ubuntu-latest, timeout-minutes: 10
steps: checkout (default branch) → setup-node (from .nvmrc, npm cache) → npm ci → npm run sender -- [flags]
       env from secrets; keep-alive step (below); `if: always()` summary
```
- `schedule` always runs on the default branch checkout, so `data/messages.json` read is the merged content.
- `workflow_dispatch` defaults to **dry run** so a manual click can never send by accident; a real manual send requires unchecking the box.
- **Keep-alive (P-11, R-02):** final step calls `PUT /repos/{owner}/{repo}/actions/workflows/send.yml/enable` with the built-in `GITHUB_TOKEN` (needs `actions: write`) so the 60-day inactivity timer resets. **ASSUMPTION** that this works and counts as activity; must be verified over a real run and recorded. Fallback documented in `docs/operations.md`: make any commit at least every 60 days, or re-enable the workflow manually; detect by checking `sender_runs` freshness. If keep-alive proves ineffective, report to the user (do not add a hack that spams commits without approval).
- **Honesty about timing** is documented: runs may be late or skipped; the 2 h window gives roughly four attempts (at :03/:33).
- Actions pinned by commit SHA; no third-party actions except first-party (`actions/checkout`, `actions/setup-node`).

## Files and components
`src/core/usecases/run-send-cycle.ts`, `src/core/scheduling/*` (reused), `src/sender/main.ts`, `src/sender/config.ts`, `src/sender/debug-proxies.ts`, `src/adapters/web-push/web-push-sender.ts`, `scripts/generate-vapid-keys.ts`, `.github/workflows/send.yml`, `docs/operations.md` (secrets setup, keep-alive, runbook), `tests/fakes/{in-memory-user-repository,fake-push-sender,in-memory-delivery-log}.ts`, `tests/core/usecases/run-send-cycle.test.ts`, `tests/sender/*`.

## Interfaces and contracts
Ports per 00 §4. `PushPayload` v1: `{ v:1, title, body, tag }` — the service worker (Task 6) depends on exactly this shape; any change bumps `v`.

## Dependencies
Tasks 01–04. New package: `web-push` (exact pin, license verified). Secrets are set by the user in GitHub; the agent never receives them.

## Acceptance criteria
1. `--dry-run` prints due users and planned outcomes and performs **zero** writes (asserted with a spy repository in tests; verified manually on the real project).
2. On-time user: sent, counter +1, `next_send_at` = next occurrence, log row `sent` with `delay_seconds`.
3. 1 h 59 m late: still sent, `delay_seconds ≈ 7140`, logged. Exactly 7200 s: sent. 7201 s: `skipped_stale`, counter unchanged, `next_send_at` = next occurrence after now.
4. Invalid or empty `messages.json`: no pushes, no state change, run recorded as `aborted_invalid_content`, exit code 1.
5. Push `accepted` → counter +1. `failed` → counter unchanged, claim released, retried next run, `failed` logged. `gone` (404/410) → subscription nulled, user disabled, `expired_subscription` logged.
6. Two overlapping cycles over the same data never double-send the same slot (concurrency test with the in-memory repo honoring lease semantics, plus the real SQL test from Task 4).
7. Disabled users are never touched; re-enabled users resume at the same counter.
8. Message index uses current `N` at send time (test: content shrinks from 41 to 38 between runs).
9. Per-user exceptions do not abort the run.
10. The log and run summary contain no message text, no endpoints, no keys.
11. Real test: `--test-push <userId>` delivers a notification to a real subscription made in Task 7 (verified manually; recorded in the verification doc).
12. `send.yml` runs on schedule on the default branch, shows the summary, passes the keep-alive step (or the documented fallback is in effect and the user is informed).

## Unit tests (all with fakes; no network)
Matrix of: due/not due; fresh/stale/boundary; accepted/gone/failed(retryable and not); counter and next-send results; log entries; invalid content; empty content; N changes; pause/resume; CAS false (race); per-user exception; batch loop cap; concurrency of 5 with ordering-insensitive assertions; dry run write-spy. `web-push` adapter mapping tested with a stubbed HTTP layer.

## Integration tests
Real Supabase (free project or local) with a fake `PushSender`: full cycle writing real `delivery_log` rows. Optional manual: real push to a device.

## Error cases
Supabase unreachable/paused → exit 1 with clear message, no partial state (claims expire by lease); VAPID misconfiguration → every send `failed` with 401/403, summary highlights it; push service rate limit (429); runner timeout (leases expire after 15 min; rows retried next run within window).

## Edge cases
Crash after push accepted but before finalize: the lease expires and the user may receive the same message again within the window. Mitigated by identical `tag` and `topic` so it replaces instead of stacking; documented residual risk. User with `next_send_at` days in the past (workflow was disabled): skipped as stale, advanced to the next occurrence, no burst. DST gap day. Content with a 280-character message (payload size well under limits). Two slots same minute for many users (batching). Zero due users (still records a `sender_runs` heartbeat).

## Definition of Done
Acceptance criteria met; `DEPENDENCIES.md` has `web-push` license/maintenance; secrets docs written; keep-alive verified or fallback documented and reported; `DECISIONS.md` updated (P-04..P-08, P-11 status, observed cron delay numbers once available).
