# Remaining work

Saved 2026-11-23. Everything that can be done from the repository is done; what is left needs a real device, real time, or a decision from the owner. Update this file as items close.

## Done since Task 08 started
- Docs: README, privacy, limitations, operations (section 4), verification checklists and report template.
- Doc consistency tests (`tests/docs/docs.test.ts`).
- License: AGPL-3.0-or-later (`LICENSE`, `package.json`, README, DEPENDENCIES).
- Fresh-copy walkthrough on a clean folder: `npm ci`, `npm run ci` (532 tests), `npm run build:pwa`, `npm run validate:content` all pass; sender dry run against the local Supabase stack exits 0.
- SQL and RLS tests: `npx supabase test db` passes (48 tests).
- Found and fixed: Windows PowerShell 5.1 swallows `--`, so `npm run sender -- --dry-run` becomes a real run. Docs now use `DRY_RUN=1`.

## Needs a real device (Not run)
Rows are in [verification/device-checklist.md](verification/device-checklist.md). Record date, tester and result there.
- [ ] Android Chrome, desktop Chrome, desktop Firefox: enable, `--test-push`, scheduled push arrives.
- [ ] iOS Safari tab (16.4+): install sheet once, no row created.
- [ ] iOS installed app: permission prompt, push arrives, tap behavior recorded (D-017).
- [ ] iPadOS.
- [ ] Disable and re-enable keep the same message index; time change and timezone change; revoked permission.
- [ ] Reconcile the push endpoint allowlist with real hosts seen (`src/core/settings/push-endpoint-allowlist.ts`).
- [ ] Measure touch targets, 200% zoom, keyboard walk-through, TalkBack and VoiceOver ([verification/accessibility-checklist.md](verification/accessibility-checklist.md)).

## Needs the deployed environment
- [ ] GitHub: confirm the `main` push triggered CI, then add secrets and variables (operations 2.1 and 3.1), enable Pages (source: Actions), run **Pages** and **Send** (dry run, then real).
- [ ] Confirm the Edge Function `ALLOWED_ORIGINS` equals the Pages origin.
- [ ] Open the deployed URL: installability, offline reload, privacy link resolves.
- [ ] Confirm the keep-alive step re-enables the workflow (R-02).

## Needs time
- [ ] 7-day soak with at least one real test subscription. Record delay min, median, max from `delivery_log`, dropped runs from `sender_runs`, keep-alive result, and whether Supabase paused (R-01..R-03). Fill `DECISIONS.md` section 8 with observed data.
- [ ] Fill in `verification/final-report.md` from [the template](verification/final-report-template.md); present it for acceptance (Definition of Done).

## Needs the owner
- [ ] Review the Hebrew UI copy (Q-05) and the privacy wording before a public launch.
- [ ] Replace the 12 placeholder messages in `data/messages.json` (see [content-management.md](content-management.md)).
- [ ] Replace the placeholder icons if wanted (`npm run icons:generate`).
- [ ] AGPL section 13: if you modify and host this, users must be able to get the source. Decide whether to add a quiet source link to the app (this touches the calm-space rules, so it was not added) or rely on the public repository and README.
- [ ] Decide on content licensing: AGPL covers the code; `data/messages.json` is your own writing and can carry a different license (for example CC BY-SA 4.0) if you want one.
- [ ] Optional: the bundle is about 226 kB, mostly supabase-js; trimming it to plain `fetch` is possible (DECISIONS section 11, item 8).
- [ ] Optional: upgrade the Supabase CLI (3.3.0 is available).

## Known caveats
- `web-push` is MPL-2.0; AGPL compatibility rests on MPL-2.0 section 3.3. Re-check when upgrading.
- Free-tier numbers in the docs are dated 2026-11-16; re-verify before relying on them.
