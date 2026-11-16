# 08 — Documentation and Verification

## Purpose and scope
Final documentation, honest limitations, privacy note, operations runbook, the manual device checklist, and the final verification report. No new product behavior.

## Relevant requirements
Brief §11, §12 Phase 5, §13. D-001..D-017, R-01..R-10.

## Technical design

### `README.md` (complete)
What the app does (in the manifesto's voice, non-promotional); principles; architecture overview with the diagram from the plan; repository structure (from 00); development prerequisites (Node LTS from `.nvmrc`, Git, optional Docker for the local Supabase stack, Supabase CLI); how to run (`npm ci`, `npm run dev` for the PWA, `npm run sender -- --dry-run` with env); how to run tests (`npm test`, boundary, content validation, SQL tests); how to build and deploy (Pages workflow); how to set up Supabase and GitHub secrets (link to `docs/operations.md`); content management pointer; known limitations pointer; license note. Costs section: everything is free; lists the services.

### `docs/limitations.md` (guarantees that cannot be provided)
- Delivery by push services/browsers/OS cannot be guaranteed; we only observe push-service acceptance (D-016). Doze, battery savers, Focus modes, offline devices, and revoked permissions can all prevent display.
- Exact-time delivery cannot be guaranteed: GitHub scheduled runs may be late or skipped; typical target is "around" the chosen slot, up to 2 hours late, otherwise skipped for that day (D-011). Slots are 30 minutes (D-012).
- iOS requires an installed Home Screen app on iOS/iPadOS 16.4+ and a tap to grant permission; installed and Safari-tab storage differ.
- iOS may open the PWA when a notification is tapped (platform behavior; handler does nothing).
- GitHub may auto-disable scheduled workflows after 60 days without repo activity; keep-alive mitigates but cannot be guaranteed.
- Supabase free projects pause after about a week of inactivity; the 30-minute query mitigates but cannot be guaranteed.
- Each browser/device is a separate anonymous identity; no cross-device sync.
- Clearing site data loses the identity; the old row is pruned after retention.
- If the user doesn't open the app after changing timezones, the schedule stays in the old zone.
- Index-based progression means content edits can repeat or skip messages (accepted, D-008).
- A crash between a push being accepted and state being saved can produce one repeat within the window (mitigated by `tag`/`topic`).
- No guarantee of operation if free tiers change their terms; migration notes in operations doc.

### `docs/privacy.md`
Plain-language note: what is stored (anonymous id, selected time, timezone, enabled flag, message position counter, push subscription token, delivery audit rows without message text); why; where (Supabase, GitHub); how long (subscription removed on disable; disabled rows deleted after 365 days; audit rows after 90 days); what is **not** collected (no name, email, analytics, location beyond timezone name, no third-party trackers); how to remove data (disable notifications removes the push token; clearing site data detaches the identity; row is deleted by retention). A push endpoint is a pseudonymous identifier. Not legal advice; the user should review before public launch.

### `docs/operations.md` (runbook)
Create Supabase project; enable anonymous sign-ins; run migrations; deploy the Edge Function and set `MAX_SUBSCRIPTIONS`; generate VAPID keys (script) and store secrets/variables; enable Pages (source: Actions); first dry run; first real send; monitoring (`sender_runs` freshness, `delivery_log` delays, queries provided); what to do when the workflow was disabled; restoring a paused Supabase project (1-year window per official docs); rotating VAPID keys (all users must resubscribe; documented consequence); adjusting constants (TTL, window) and their effects.

### `docs/verification/`
- `device-checklist.md`: per device (Android Chrome tab and installed, desktop Chrome, desktop Firefox, iOS Safari tab, iOS installed, iPadOS) — steps, expected, observed, date, tester, pass/fail/not-run. Includes: install flow, permission denied path, enable/disable/re-enable, time change, timezone change, tap behavior, offline settings, notification arrival and measured delay from `delivery_log`.
- `final-report-template.md`: completed requirements (mapped to D-xxx and brief sections), test results (commands and outcomes), known limitations, outstanding issues, deviations from specs, recommended next steps.
- `accessibility-checklist.md` from Task 6.

### Decision log finalization
`DECISIONS.md`: every P-xx marked Approved/Rejected with date; Q-xx resolved; risks updated with observed data (cron delay distribution after ≥ 7 days, keep-alive result, Supabase pause behavior); change log complete.

### Final verification (Phase 5)
Run `npm run ci`; run SQL/RLS tests; run a 7-day soak on the real project with at least one test subscription and record observed delays and any dropped runs; run the boundary test; review code for unapproved dependencies and for any message text in logs; fill in the final report. Platforms not tested are listed as **not verified**.

## Files and components
`README.md`, `docs/limitations.md`, `docs/privacy.md`, `docs/operations.md`, `docs/content-management.md` (final review), `docs/verification/*`, `DECISIONS.md`, `DEPENDENCIES.md`.

## Interfaces and contracts
Docs must match the implemented behavior; where behavior changed during implementation, the spec change was approved first (Phase 4 rules).

## Dependencies
Tasks 01–07 complete.

## Acceptance criteria
1. A new developer can follow README + operations to run tests, deploy the PWA, deploy the function, and run a dry-run sender without asking questions (verified by a fresh-clone walkthrough, recorded).
2. `limitations.md` lists every item above and every risk in `DECISIONS.md` §8 is either mitigated in docs or explicitly accepted.
3. Privacy note matches the actual schema and retention constants (checked by a test that greps the migration for column names and retention values quoted in the doc).
4. Device checklist exists and states which rows were run; unverified rows are marked **not run**, never blank-passed.
5. Final report is produced, with test output summaries and links to commits.
6. No doc claims guaranteed delivery, exact timing, or background-execution certainty.
7. All links in docs resolve (link check script, offline-safe for internal links).

## Unit tests
Doc consistency checks: retention constants in docs equal constants in code; list of limitations contains required headings; link checker for internal links.

## Integration tests
Fresh-clone walkthrough; 7-day soak test summary.

## Error cases
Docs referencing removed features; stale diagrams; outdated free-tier numbers (each number in docs is dated; the operations doc says to re-verify before relying on it).

## Edge cases
Hebrew/RTL content in docs examples; Windows vs Unix command differences (both provided for key commands); user without Docker (documented manual SQL path).

## Definition of Done
Acceptance criteria met; final report presented to the user; outstanding issues and deviations listed; the user explicitly accepts or requests follow-up work.
