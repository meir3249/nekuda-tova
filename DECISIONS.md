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
| 4 Implementation | **In progress.** Tasks 01, 02 done (02 committed locally). Task 03 implemented, awaiting review. Tasks 04..08 pending. |

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

## 8. Task 03 implementation notes (2026-11-16)

- **Indexing convention:** 0-based. `index = (startIndex + counter) mod n`, in `[0, n-1]`. The counter is never reduced; `n` is read at send time. Spec example corrected: `562 mod 41 = 29` (the spec originally said 7).
- **DST gap/overlap rule (D-014), implemented in `localToInstant`:** ambiguous local time (fall back) returns the earlier (first) instant; nonexistent local time (spring forward) returns the transition instant, i.e. the first instant whose local wall time is at or after the requested time. Verified against runtime ICU data for Asia/Jerusalem, America/New_York, Australia/Lord_Howe (30-minute shift), Asia/Kolkata, Asia/Kathmandu, Pacific/Kiritimati, Pacific/Pago_Pago, UTC (see `tests/core/scheduling/next-send.test.ts`).
- **P-14 status:** implemented as specified. No once-per-day guard; a re-enable or time change computes the next strictly-upcoming occurrence (covered by a test).
- **Settings:** `applySettingsChange` takes an optional fifth parameter, the push endpoint allowlist (default `DEFAULT_PUSH_ENDPOINT_ALLOWLIST`, P-08), so the allowlist stays data. A subscription is validated only when the resulting state is enabled. Disabling always clears the stored subscription.
- **Timezone validity:** IANA-style names only (contains `/`, or `UTC`). Names such as `EST` or `EST5EDT` are rejected by design.
