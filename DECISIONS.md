# DECISIONS.md — Nekuda Tova

Persistent decision log. Nothing important lives only in chat.
Last updated: 2026-11-16 (Phase 3 approved; Phase 4 in progress, Task 01).

Status legend: **Approved** (user said so explicitly) · **Proposed** (written in specs, NOT yet approved) · **Open** (needs a user answer) · **Superseded**.

---

## 1. Process state

| Phase | State |
|---|---|
| 1 Discovery | Done |
| 2 Plan (PWA + Supabase + GitHub Actions) | **Approved** by user (D-010 and refinements D-011..D-014) |
| 3 Specifications (`specs/`) | **Approved** by user on 2026-11-16 (repo structure, 8 task specs, order, acceptance criteria, P-01..P-15) |
| 4 Implementation | **In progress.** Tasks 01, 02, 03 done and committed locally. Task 04 implemented except the database tests and live-project steps that need Docker or a Supabase project. Tasks 05..08 pending. |

---

## 2. Approved product decisions (unchanged by the pivot)

| ID | Decision | Status |
|---|---|---|
| D-001 | Vision: one small moment of positive thought per day. Non-demanding: no streaks, scores, achievements, engagement rewards, guilt, required interaction, or personal metrics. | Approved |
| D-002 | Openness: no religion, ideology, or lifestyle promoted. | Approved |
| D-003 | Message-writing principles: no preaching or moralizing; no pretending to know the user; no required response; no call to open the app; humor/curiosity/wonder allowed; room for interpretation; no repetitive templates. Product name only in the notification **title**, never in the body. | Approved |
| D-004 | UI scope: one minimal settings screen (time picker, enable/disable, small "How it works"/manifesto section). No feed, history, accounts, gamification, analytics dashboard, manual refresh. OS controls sounds. No blocking loading screen. | Approved |
| D-005 | Progression: messages in file order; index-based; modulo over current message count; counter never reduced by modulo; advances daily regardless of interaction; tags are metadata only. | Approved |
| D-006 | Pause/resume: disabling pauses (counter unchanged); re-enabling resumes from the same counter. Calendar days while disabled do not advance the sequence. | Approved |
| D-007 | Missed/late notifications are never delivered retroactively or in bulk. (Refined by D-011: a bounded 2-hour lateness window.) | Approved |
| D-008 | Content: `data/messages.json` in the same repo is the single source of truth. Full-replace semantics: the file at send time is the truth; the user's counter is preserved numerically; repeats/skips after content edits are an accepted consequence. IDs are stable and never reused. | Approved |
| D-009 | **Absolute cost constraint:** every tool, library, service, and platform must be 100% free for the MVP. No paid tier, no trial that turns paid. Unavoidable costs must be disclosed and approved before use. | Approved |

## 3. Architecture pivot

| ID | Decision | Status |
|---|---|---|
| D-010 | **Pivot:** PWA on GitHub Pages (public repo) + Web Push (VAPID) + Supabase free tier (Postgres, anonymous auth, RLS) + GitHub Actions cron running a Node.js/TypeScript sender every 30 minutes + `data/messages.json` read from the checkout. Flutter, native apps, APK/stores, OS local scheduling, on-device sync, and local DB are abandoned. | Approved |
| D-011 | **Late jobs:** send if up to 2 hours late; MUST record scheduled vs actual attempt time (audit trail, `delivery_log.delay_seconds`). More than 2 h late → skip that day, log `skipped_stale`, do NOT advance the counter, move `next_send_at` to the next occurrence. | Approved |
| D-012 | **Time picker:** 30-minute slots only (`:00`, `:30`). The server rejects anything else. | Approved |
| D-013 | **Permission UX by environment** (feature detection preferred; UA only as a hint): iOS Safari not standalone → dismissible "Add to Home Screen" overlay that never blocks settings. iOS standalone, Android, desktop → request permission on a user tap, never on page load. Denied → polite explanation; settings stay usable. | Approved |
| D-014 | **Timezone:** store `local_time` ("09:00") + IANA `timezone` ("Asia/Jerusalem"); the **server** computes `next_send_at` (UTC) so DST is handled automatically. Nonexistent local time (spring forward) → send at the next valid instant. Ambiguous local time (fall back) → first occurrence. | Approved |
| D-015 | Core logic is pure TypeScript in `src/core/`, shared by the PWA, the sender, and the Supabase Edge Function. It must not import infrastructure. Ports: `UserRepository`, `ContentSource`, `PushSender`, `Clock`, `DeliveryLog`. Adapters: Supabase, repo-file, web-push, system clock. Enforced by lint rule + boundary test + fake-based tests. | Approved (from brief; mechanics Proposed in spec 01) |
| D-016 | Counter advances only when the push service accepts the message (2xx). Push-service acceptance ≠ device delivery ≠ user interaction; only acceptance is observable. | Approved |
| D-017 | Notification tap: service worker has no click action beyond closing the notification. iOS may still open the PWA (platform behavior, to be verified). | Approved |

## 4. Superseded decisions and questions

| ID | Was | Superseded by |
|---|---|---|
| S-001 | Flutter/Dart, Hive/Isar, `flutter_local_notifications`, Clean Architecture on mobile | D-010 |
| S-002 | OS-level local scheduled notifications, pending-notification limits, queue replenishment, reboot recovery | D-010 |
| S-003 | On-device content sync, ETags, atomic local DB replacement, offline-first notifications | D-010 (content is read server-side from the checkout; the device stores no content) |
| S-004 | Synchronization toasts ("Importing data…", etc.) | D-010; only a tiny "saved" confirmation remains |
| S-005 | Discovery Q1 (platform scope), Q2 (iOS tap), Q3 (count missed slots) | D-010, D-011, D-017 |
| S-006 | "Missed notifications are dropped silently" in the original brief | D-011 (late up to 2 h is still sent) |

## 5. Proposals P-01..P-15 — **ALL APPROVED** by the user on 2026-11-16

These were my recommendations or small additions beyond the brief. The user approved all of them ("Q-06 & Proposals: All approved"). The status column in the Phase 3 draft that said "Proposed" now reads Approved for every row below.

| ID | Proposal | Where |
|---|---|---|
| P-01 | **All writes go through a Supabase Edge Function** (`settings`). The client has read-only RLS access to its own row. Reason: server computes `next_send_at` with shared core code, and clients cannot tamper with the counter. | 04 |
| P-02 | **Disable = privacy-delete of the push subscription.** Disabling nulls `push_subscription` and `next_send_at`, keeps `start_index`, `message_index`, `local_time`, `timezone`. Re-enable creates a fresh subscription. | 04, 07 |
| P-03 | **Row retention:** rows that are disabled and untouched for 365 days are deleted by the sender (counter lost; acceptable). `delivery_log` pruned at 90 days (approved by brief). | 04, 05 |
| P-04 | Extra audit columns: `delivery_log.run_id`, `delivery_log.message_id` (id only, never text); and a small `sender_runs` table (heartbeat + per-run counts) so dropped cron runs are detectable. | 04, 05 |
| P-05 | `claimed_until` lease column + compare-and-set finalize for idempotent claiming. Web Push `Topic`/notification `tag` set to the scheduled date so an accidental duplicate replaces rather than stacks. | 04, 05 |
| P-06 | Push **TTL = 3600 s**, urgency `normal` (tunable constants). | 05 |
| P-07 | Cron at minutes `3,33` (not `0,30`) to avoid the busiest scheduler instants. Still "every 30 minutes". Delivery "around" the slot, typically a few minutes after. | 05 |
| P-08 | **Endpoint allowlist** for push endpoints (HTTPS + known push-service hosts) to block SSRF via user-supplied endpoints. | 04, 05 |
| P-09 | **Subscription cap** (default 5000 rows) to stay inside free limits and limit anonymous-auth abuse. | 04 |
| P-10 | Content rules beyond the brief: message length ≤ 280 chars; tags `[a-z0-9_-]{1,32}`, ≤ 10 per message; exact-duplicate content (normalized) is an error; optional top-level `retiredIds` array (ids removed from the file; must never reappear in `messages`), and CI fails if a PR removes an id without adding it to `retiredIds`. | 02 |
| P-11 | Keep-alive: the workflow re-enables itself through the GitHub API each run (resets the 60-day auto-disable timer) with a documented manual fallback. To be verified in Task 5. | 05 |
| P-12 | **Vanilla TypeScript + Vite** for the PWA (no UI framework); **Vitest**; `esbuild`-bundled core for the Edge Function if direct import fails. | 01, 04, 06 |
| P-13 | Default time picker value **09:00** until the user chooses (product default). | 06 |
| P-14 | No "once per calendar day" guard: if a user changes the time after today's notification already fired, they may get a second one the same day (follows "next upcoming occurrence"). | 03 |
| P-15 | Default new users to `enabled=false` until they grant permission and tap the toggle; no row is created until the first settings change (no junk rows from page loads). | 06, 07 |

## 6. Resolved questions (answered 2026-11-16)

| ID | Question | Answer |
|---|---|---|
| Q-01 | Language | **Hebrew** for UI, notification title **"נקודה טובה"**, and `messages.json` content. PWA must use proper RTL (`dir="rtl"`, `lang="he"`). Supersedes the English default in specs 02/06/07: strings module is Hebrew; the sample `messages.json` placeholders are Hebrew; the manifest `lang` is `he` and `dir` is `rtl`. Product name in the **title** is the Hebrew name. The "no product name in body" rule applies to both "נקודה טובה" and "Nekuda Tova". |
| Q-02 | Repo name | `nekuda-tova` (placeholder for repo name/owner). Pages base path `/nekuda-tova/`. Owner still to be set when the remote exists. |
| Q-03 | Supabase region | Europe (Frankfurt, `eu-central-1`), or the closest European region available on the free tier. User owns the account and keys and will add them to GitHub Secrets later. The agent never receives secrets. |
| Q-04 | Icon | Simple generated placeholder is fine. |
| Q-05 | "How it works" copy | I draft it in Hebrew from the manifesto; the user reviews and edits. (Task 06) |
| Q-06 | Confirm P-01..P-15 | Approved, all. |

## 7. Approved assumptions

None beyond D-xxx above. Any assumption in the specs is labeled `ASSUMPTION` and appears in `specs/research-notes.md`.

## 8. Risks (see `specs/research-notes.md` for evidence)

| ID | Risk | Mitigation |
|---|---|---|
| R-01 | GitHub scheduled runs can be delayed or dropped under load; exact time is not guaranteed. | 2 h late window, runs every 30 min (≈4 attempts per slot), audit log, `sender_runs` heartbeat, honest docs. |
| R-02 | Scheduled workflows in public repos auto-disable after 60 days without repo activity. | Self re-enable step (P-11) + documented manual fallback + heartbeat detection. |
| R-03 | Supabase free projects pause after about a week of low activity. | The 30-minute claim query is DB activity; verify in Task 4/5; documented restore path. |
| R-04 | iOS web push requires Home Screen install (iOS 16.4+) and a user gesture; installed PWA has separate storage from Safari tab. | Overlay (D-013), no account created before install, documented. |
| R-05 | Push delivery is not guaranteed by push services or browsers; permission can be revoked. | Documented; only acceptance (2xx) observable. |
| R-06 | iOS may revoke subscriptions that receive pushes without a shown notification. | Service worker always calls `showNotification`, even on malformed payloads. |
| R-07 | Anonymous auth is open to scripted abuse. | Subscription cap (P-09), per-IP auth rate limits, input validation, endpoint allowlist. |
| R-08 | `web-push` license: brief says MIT; my recollection is MPL-2.0. | Verify in Task 1 (`DEPENDENCIES.md`); MPL-2.0 is free and acceptable as an unmodified dependency, but record it. |
| R-09 | Edge Function bundling may not resolve imports outside `supabase/functions/`. | Fallback build step (P-12), verified in Task 4. |
| R-10 | Push endpoint is a pseudonymous identifier. | Privacy note, deleted on disable (P-02), retention rules (P-03). |

## 9. Change log

| Date | Change | Reason |
|---|---|---|
| 2026-11-16 | Created from brief (`specs/init.md`, unchanged). | Phase 1 |
| 2026-11-16 | Recorded pivot D-010 and approved refinements D-011..D-014. | User approval |
| 2026-11-16 | Drafted specs 00–08, proposals P-01..P-15, questions Q-01..Q-06. | Phase 3 |
| 2026-11-16 | Task 01 implemented. TypeScript pinned to 6.0.3 (not 7.0.2) because `typescript-eslint` 8.73.0 peers `<6.1.0`. Relative imports use explicit `.ts` extensions (Node 24 type stripping, no extra runner). ESLint covers bare/`node:` imports and infra paths in core; the boundary test is authoritative for escaping relative paths. Local CI green; GitHub CI not yet run (no remote). | Spec 01 |
| 2026-11-16 | Task 02 implemented: content schema v1, pure validator and diff in `src/core/content`, `RepoFileContentSource`, `validate-content` and `check-content-diff` scripts, CI content steps, `docs/content-management.md`, 12 Hebrew **placeholder** messages. Refinements recorded in spec 02 (INVALID_MESSAGE, RETIRED_ID_DROPPED, COUNT_CHANGED on any N change). P-10 implemented as approved. | Spec 02 |
| 2026-11-16 | User approved all specs, repo structure, task order, P-01..P-15; answered Q-01..Q-06 (Hebrew + RTL, `nekuda-tova`, Frankfurt, placeholder icon, I draft copy). Phase 4 started. | Phase 3 gate passed |
| 2026-11-16 | Task 04 verified against the local stack and committed. Task 05 implemented: sender, `web-push` 4.0.0 (MPL-2.0, R-08 resolved), `send.yml`, migration 0004 (CAS precision fix). See section 10. | Spec 05 |
| 2026-11-16 | Task 05 committed. Task 06 implemented: PWA shell, settings screen, service worker, `pages.yml`. Q-05 copy drafted for review. See section 11. | Spec 06 |

## 8. Task 03 implementation notes (2026-11-16)

- **Indexing convention:** 0-based. `index = (startIndex + counter) mod n`, in `[0, n-1]`. The counter is never reduced; `n` is read at send time. Spec example corrected: `562 mod 41 = 29` (the spec originally said 7).
- **DST gap/overlap rule (D-014), implemented in `localToInstant`:** ambiguous local time (fall back) returns the earlier (first) instant; nonexistent local time (spring forward) returns the transition instant, i.e. the first instant whose local wall time is at or after the requested time. Verified against runtime ICU data for Asia/Jerusalem, America/New_York, Australia/Lord_Howe (30-minute shift), Asia/Kolkata, Asia/Kathmandu, Pacific/Kiritimati, Pacific/Pago_Pago, UTC (see `tests/core/scheduling/next-send.test.ts`).
- **P-14 status:** implemented as specified. No once-per-day guard; a re-enable or time change computes the next strictly-upcoming occurrence (covered by a test).
- **Settings:** `applySettingsChange` takes an optional fifth parameter, the push endpoint allowlist (default `DEFAULT_PUSH_ENDPOINT_ALLOWLIST`, P-08), so the allowlist stays data. A subscription is validated only when the resulting state is enabled. Disabling always clears the stored subscription.
- **Timezone validity:** IANA-style names only (contains `/`, or `UTC`). Names such as `EST` or `EST5EDT` are rejected by design.

## 9. Task 04 implementation notes (2026-11-16)

Status of proposals touched by this task:
- **P-01 (only the Edge Function writes):** implemented in SQL. RLS on, one `SELECT` policy (own row), no write policies, client privileges revoked. *Verified by static migration tests and written pgTAP tests; the pgTAP tests have not been executed (see below).*
- **P-02 (disable removes the subscription, keeps the counter):** implemented in core and exercised through the handler tests.
- **P-03 (365-day retention of disabled rows) and P-04 (sender heartbeat table):** `prune_inactive`, `sender_runs`, `prune_delivery_log` exist; scheduling them is Task 05.
- **P-05 (claim lease):** `claim_due_subscriptions` uses a lease plus `FOR UPDATE SKIP LOCKED`.
- **P-08 (endpoint allowlist):** enforced by core `validatePushSubscription` inside the function; the allowlist is data in `src/core/settings/push-endpoint-allowlist.ts`.
- **P-09 (capacity cap):** `MAX_SUBSCRIPTIONS` (default 5000); new users only, existing users are never blocked.

Choices made while implementing (flagged for review):
1. **Column-level read grant.** Clients may `SELECT` only `id, local_time, timezone, enabled, next_send_at, updated_at` from `subscriptions`. They cannot read their own push endpoint/keys, start index, counter or lease. This is stricter than the spec's table-level grant. Consequence: a client `select *` fails with a permission error; the PWA reads through the `settings` function.
2. **Settings updates write only changed columns.** The function never writes `start_index` or `message_index` on an existing row, and writes `next_send_at` only when it changed. This stops a settings request that raced the sender from rewinding the counter or re-arming a just-sent message. New rows are inserted once; if two first requests race, the loser re-applies on top of the winner.
3. **`userId` in a POST body.** The spec says both "unknown keys rejected" and "body `userId` is ignored". Resolved by accepting `userId` as a known key that is always ignored; identity comes from the verified token.
4. **Extra SQL functions:** `peek_due_subscriptions` (read-only dry run for `UserRepository.peekDue`) and `count_subscriptions` (capacity cap) were added; both are service-role only.
5. **Typed errors:** `RepositoryUnavailableError` for network failure/status 0/5xx (including a paused project); `RepositoryError` otherwise.
6. **Server key lookup:** the function reads `SUPABASE_SECRET_KEYS` (new projects) and falls back to the legacy `SUPABASE_SERVICE_ROLE_KEY`.

**Bundling decision (R-09):** the function imports `src/core` and `src/adapters/supabase` by relative path (no `esbuild` added). **Unverified:** I could not run `supabase functions serve/deploy` (Docker daemon not running, no project yet), so whether the CLI bundler follows those imports is still an assumption. The handler itself is fully tested under Vitest. Fallback if deploy fails: bundle `src/core` with `esbuild` (needs approval to add the dependency).

**Not executed in this environment:** `supabase/tests/database/subscriptions.test.sql`, the two-connection claim concurrency check, the idempotent double `db reset`, and anything against a real Supabase project. See `docs/operations.md` section 1.5 and 1.6.

**Update (Task 05 session, 2026-11-16):** with Docker running, `supabase db reset` applied all migrations, `supabase test db` passed (46 tests at the time, 48 after migration 0004), and `supabase functions serve settings` loaded the function in the edge runtime with its relative imports (OPTIONS 204, unauthenticated GET 401). So the relative-import bundling assumption holds for the local runtime; `functions deploy` to a real project is still unverified. The two-connection concurrency check (operations 1.6) is still manual and not executed.

## 10. Task 05 implementation notes (2026-11-16)

Status of proposals touched by this task:
- **P-04 (audit columns, heartbeat):** every run writes a `sender_runs` row (also when nobody is due, and for `aborted_invalid_content` and `error`). `delivery_log.run_id` and `message_id` are filled; no message text is stored.
- **P-05 (lease + CAS, tag/topic):** claims use a 900 s lease; finalize is compare-and-set. Notification `tag` is `ntk-<local date of the slot>`; the Web Push `Topic` is a deterministic 17-character hash of the tag. Residual risk stays as specified: a crash after the push service accepted but before finalize can resend within the window; identical tag/topic make it replace rather than stack.
- **P-06:** TTL 3600 s, urgency `normal` (constants in `src/sender/config.ts`).
- **P-07:** cron `3,33 * * * *`.
- **P-08:** the web-push adapter re-checks every endpoint (HTTPS, no credentials, allowlisted host) before any request.
- **P-11 (keep-alive):** implemented as a final `PUT .../actions/workflows/send.yml/enable` step on scheduled runs. **Not verified**: the repository has no GitHub remote yet, so no workflow has run. Fallback documented in `docs/operations.md` 2.4.

Choices made while implementing (flagged for review):
1. **Bug found and fixed: CAS precision (migration 0004).** The local integration run showed `finalize_sent`/`finalize_skipped` returning false for rows whose `next_send_at` has microseconds (Postgres keeps microseconds, a JS `Date` keeps milliseconds). Rows written by the settings function are minute-aligned so it would rarely bite, but any other writer (manual SQL, a future change) would leave the user stuck. Migration 0004 compares at millisecond precision on both sides; two pgTAP tests cover it. Migration 0003 is unchanged.
2. **Failed pushes release their claim at the end of the run, not immediately.** Releasing immediately would let the next batch in the same run reclaim and retry the same user in a loop. Deferring keeps "retried by the next run" exact. Rows whose finalize raced are released the same way.
3. **Bookkeeping never turns a delivered push into a failure.** If writing a `delivery_log` row, pruning, or releasing a claim fails, the run continues and counts it as `bookkeepingErrors` (shown in the summary). A fatal error (claiming fails, e.g. Supabase down) records an `error` run when possible and exits 1; leases expire on their own.
4. **A claimed row with no subscription is marked expired** (defensive; the claim SQL already filters these out).
5. **`--test-push` is a separate core use case (`runTestPush`) that receives no write port**, so by construction it cannot change the counter, the schedule, or the log. It uses the tag `ntk-test`, so it never replaces a real daily notification, and a 404/410 is reported but does not disable the user. It needs a read-only `SubscriptionLookup.getById` port (new, small).
6. **A dry run needs no VAPID secrets** and wires a push sender that throws if called. It does not prune and does not write a `sender_runs` row (zero writes).
7. **Public logs show user ids shortened to 8 characters.** Actions logs of a public repo are public; full anonymous ids are not needed to debug. Message text, endpoints and keys never appear; unexpected error messages pass through `redact` (secret values and any URL removed).
8. **Workflow inputs are passed via environment variables**, never interpolated into the shell script. `test_push_user` takes precedence over `dry_run`. `npm ci --omit=dev --ignore-scripts` in the send job (no CLI binary download, no install scripts); verified locally that the sender runs from a runtime-only install.
9. **Exit code for `--test-push`:** 0 only if the push service accepted; otherwise 1.
10. **`web-push` typings:** the package ships none and `@types/web-push` (3.6.4) lags 4.0.0, so a minimal local declaration (`src/adapters/web-push/web-push.d.ts`) covers the three functions used.

Verified in this environment: unit tests with fakes (core cycle, test push, sender CLI, web-push mapping), a full cycle against the local Supabase stack with the real repository and log adapters and a stubbed HTTP layer (sent / skipped_stale / failed rows and the run heartbeat written correctly, all claims released), a dry run against the local stack (zero writes, checked in the database), `actionlint` on both workflows.

Not verified: a real push to a device (needs the PWA subscription from Task 07), the workflow on GitHub, the keep-alive step, observed cron delays.

## 11. Task 06 implementation notes (2026-11-16)

Status of proposals and questions touched by this task:
- **P-12 (vanilla TypeScript + Vite):** implemented. No UI or CSS framework. `vite` 8.3.8 and `happy-dom` 21.0.4 added (MIT, see `DEPENDENCIES.md`).
- **P-13 (default 09:00):** implemented (cache default and the pre-rendered `selected` option).
- **P-15 (off by default, no row until the first change):** implemented. Opening the app creates no session and no row; the first time change does.
- **Q-01 (Hebrew, RTL):** UI, manifest (`lang: he`, `dir: rtl`) and notification fallback title are Hebrew. Product name only in `strings.appName` (tested).
- **Q-02 (`nekuda-tova`):** the base path comes from the repository name in `pages.yml`; `/nekuda-tova/` was used for local verification.
- **Q-04 (icon):** generated placeholder: a warm dot (a "point") on a light background, `scripts/generate-icons.ts`.
- **Q-05 ("How it works" copy):** **draft in Hebrew, awaiting your review**, in `src/pwa/strings.ts` (`howItWorks`, four short paragraphs). The last paragraph states exactly what is stored; please check it against the privacy note in Task 08.

Choices made while implementing (flagged for review):
1. **Static text at first paint.** `index.html` is a template; the build fills it from `strings.ts` and pre-renders the 48 options (24-hour `HH:MM` labels), so the first paint is complete before JavaScript runs. JavaScript then only applies cached values.
2. **Content-Security-Policy** in the built HTML: `'self'` plus the Supabase origin only, no inline script or style. This enforces "no third-party requests" in the browser, not just by review. The dev server has no CSP (Vite's HMR is inline).
3. **Service worker built separately** as a classic, self-contained `sw.js` at the base root, with the precache list and a content hash injected. Cache-first app shell; only same-origin precached files are served from cache; Supabase is never intercepted. A minimal push handler is included (payload v1, title-only fallback, never silent) so `--test-push` can be tried as soon as Task 07 subscribes; Task 07 owns and finishes it.
4. **Saving always sends the current time and timezone**, plus whatever changed, because a first save creates the row and the server requires both. Patches are debounced 400 ms and coalesced; a change made during an in-flight request is sent after it.
5. **Retry policy.** `NETWORK`, `INTERNAL`, `UNAUTHORIZED`, 429 and 5xx keep the change pending (saved in `ntk.pending.v1`) and retry on `online` and on the next open. Other errors (bad request, capacity reached) drop that change and show a calm line; capacity has its own wording. A pending change wins over the server state on the next open.
6. **Feature flag `PUSH_FLOW_ENABLED = false`** (`src/pwa/config.ts`). Turning the switch on explains "coming soon" and returns it to off; nothing is saved. A cached or server `enabled: true` is shown as off while the flag is off. Task 07 removes the flag.
7. **Timezone:** read on every open and sent with every save; the local cache keeps the device timezone. Re-saving automatically when only the timezone changed is left to Task 07's auto-follow rule.
8. **Bundle size:** about 226 kB (60 kB gzipped), almost all `@supabase/supabase-js` (auth, functions, realtime, storage). It is loaded after first paint and cached by the service worker. Trimming it (for example, plain `fetch` calls to the auth endpoints) is possible but not done; tell me if you want it.
9. **Type checking:** the main program now includes the DOM library; `sw.ts` is checked separately with the WebWorker library (`tsconfig.sw.json`), because the two libraries conflict.
10. **Privacy link** goes to `docs/privacy.md` on GitHub; that file is Task 08, so the link 404s until then. The footer is omitted when no URL is configured.

Verified: see `docs/verification/task-06-pwa-checklist.md`. In headless Chrome there were no installability errors, the service worker activated, an offline reload worked, and the only origins contacted were the app and Supabase. Not verified: the deployed Pages URL, real devices (Android, iOS), a real Supabase round trip, screen readers, 200% zoom.

Design revision after your UI review (2026-11-16), now in spec 06 "Visual design":
11. **"Cosmic ocean" visual design.** A single deep indigo/night-blue palette with a soft CSS gradient and two faint glows (no images, no blur filters), generous fluid spacing, rounded cards and controls, a small breathing "point" above the title (disabled under reduced motion). **Dark only:** the previous light/dark pair is dropped because the palette is the product's identity. Manifest, `theme-color` and the placeholder icons now use the same night blue.
12. **24-hour time labels always** (`15:00`, never `3:00 PM`), independent of the browser locale; the locale dependency was removed.
13. **Styled native select.** Kept native for keyboard, screen reader and mobile-picker support, restyled (no native chrome, large numerals, custom chevron). In Chromium with customizable selects the open list is a fully styled rounded panel; on other browsers and on phones the OS picker opens.
14. **Toast instead of the inline status line.** Same live region, now fixed at the bottom, centred, 80% wide, rounded. Notices other than "Saved" now dismiss themselves after 6 s instead of staying; the pending change keeps retrying silently.

Second review refinements (2026-11-16):
15. **Rubik font, self-hosted.** You asked to import Rubik from Google Fonts. Loading it from Google's servers would send every visitor's IP address to Google and break the "no third-party requests" rule and the CSP, so the same font files (OFL 1.1, v31, Hebrew + Latin subsets, 44 kB) were downloaded once and are served from the app's own origin, precached for offline use. The visual result is identical. The system font stack stays as the fallback.
16. **Picker label "שעת התראה", no helper text.** The "arrives around the time you chose" note moved into "How it works", stated honestly: sometimes a little after; more than 2 hours late means that day is skipped (D-011).
17. **"How it works" open state:** a hairline under the header and a softer lifted tint behind the text.
18. **Icons** show the screen's glowing orb (highlight, warm rim, soft halo) on the night-blue gradient; the maskable icon keeps the orb inside the safe zone.

## 12. Calm-space principle (2026-11-16, from your steering)

You asked that the app be a space of peace, where the screen itself is the space, never messy, crowded or bustling. This is now a convention in spec 00 §3 and governs specs 06–08:
- **Screen:** the time picker sits on the same row as its label (as the switch does); the privacy link moved from a separate footer to one quiet line at the end of "How it works"; the controls card holds only the two rows (tested).
- **One channel:** every message goes through the single toast, one at a time, only after a user action; toast copy is one short gentle sentence (tested: ≤ 60 characters, no alarm words, no exclamation marks).
- **Spec 07 rewritten accordingly** (it previously had persistent inline lines for denied, unsupported and iOS-tab states, an overlay on every open with a four-step list and a diagram, and guilt-tinged denied copy): quiet switches (`aria-disabled`, still tappable) with a toast on tap; the denied copy is neutral ("Notifications are off in your device settings. You can turn them on there anytime.").
- **Behavior change for your review:** the iOS install hint is now a soft bottom sheet (no dimmed backdrop) that appears automatically **once**, then only when the switch is tapped, instead of on every open. D-013 still holds (dismissible, never blocks settings).
- Specs 06/07/08 gained calm-space acceptance criteria and checklist rows.
- **Off hint (your request):** while notifications are off, one soft rose line under the switch ("כל עוד ההתראות כבויות, לא יגיעו אליך הודעות."), the single named exception to "no text under controls", because without notifications the app does nothing. Contrast tested (rose on the card ≥ 4.5:1); part of the switch's accessible description; hidden when on.
