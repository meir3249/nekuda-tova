# Operations

This file grows with each task. Section 1 is the Supabase backend (Task 04); section 2 is the sender (Task 05); section 3 is the PWA on GitHub Pages (Task 06).
Nothing here costs money (D-009); see `DEPENDENCIES.md` for the limits that were checked.

## 1. Supabase

### 1.1 What you create (free plan)
1. A free Supabase account and one project (free plan: 500 MB database, 50,000 monthly active users, 500,000 Edge Function invocations a month).
2. In the dashboard under **Authentication → Sign In / Providers**, turn **Allow anonymous sign-ins** ON. (The local stack already has it on via `supabase/config.toml`.)

### 1.2 Keys: what is public and what is secret
| Value | Where it goes | Public? |
|---|---|---|
| Project URL (`https://<ref>.supabase.co`) | PWA build env, GitHub Actions, Edge Function (automatic) | Yes |
| anon / publishable key | PWA build env | Yes (RLS protects data) |
| service-role / secret key | **GitHub Secrets only** (sender). The Edge Function receives it automatically from the platform. | **No. Never commit, never put in the PWA** |

Never paste a secret key into a chat, an issue, or a commit.

### 1.3 Apply the schema
```
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```
Migrations are in `supabase/migrations/` and are written to be re-runnable.

### 1.4 Deploy the `settings` function
```
npx supabase secrets set ALLOWED_ORIGINS=https://<github-user>.github.io
npx supabase functions deploy settings
```
Optional secrets: `MAX_SUBSCRIPTIONS` (default 5000, P-09), `ALLOW_LOCALHOST=true` (development only; leave unset in production).

`config.toml` sets `verify_jwt = true`. The function also resolves the user from the token itself (`auth.getUser`), so if the platform's JWT gate ever conflicts with the project's signing keys, `--no-verify-jwt` is a safe fallback; record it in `DECISIONS.md` if you use it.

The function imports `src/core` and `src/adapters/supabase` by relative path. Verified with the local edge runtime (`supabase functions serve settings`, 2026-11-16): the imports resolve. Still an **ASSUMPTION** for `functions deploy` to a real project. If deploy fails to resolve them, the fallback is an `esbuild` bundle of `src/core` (needs approval to add the dependency).

### 1.5 Local stack and database tests (needs Docker Desktop running)
```
npx supabase start
npx supabase db reset          # applies all migrations to an empty database
npx supabase db reset          # run twice: migrations must be idempotent in a fresh DB
npx supabase test db           # pgTAP tests in supabase/tests/database
```
Last run 2026-11-16: 48 of 48 pgTAP tests passed.

### 1.6 Manual concurrency check (acceptance 7)
`FOR UPDATE SKIP LOCKED` cannot be exercised inside a single transaction. With the local stack running, open two `psql` sessions against it, insert one due row, and in both run (almost simultaneously):
```sql
begin;
select id from public.claim_due_subscriptions(now(), 10, 600);
-- keep the transaction open in session 1 while running the same statement in session 2
```
Expected: only one session returns the row; the other returns zero rows. Then `rollback;` in both.

### 1.7 Free-plan behavior to plan around
- **Pausing:** a free project is paused after one week of inactivity. The 30-minute sender run keeps the database active while anyone is enabled; the keep-alive for the empty case is part of Task 05. To restore a paused project, use **Restore** in the dashboard. Adapters raise `RepositoryUnavailableError` while it is down; the sender retries on its next run.
- **Anonymous sign-ins** are rate limited per IP (30 per hour by default). That is plenty for this app; a shared network (a school, a cafe) can hit it.
- **Edge Function limits:** 150 s wall clock, 2 s CPU per request, 20 MB bundle. The settings function uses a few milliseconds.
- **Logs:** retained for 1 day on the free plan.

### 1.8 Retention
`prune_inactive` (disabled rows untouched for 365 days, P-03) and `prune_delivery_log` (delivery log and sender runs older than 90 days) are called at the start of every real sender run (not in dry runs).

## 2. Sender (GitHub Actions)

The sender is `src/sender/main.ts`, run by `.github/workflows/send.yml` every 30 minutes (at :03 and :33 UTC).

### 2.1 One-time setup
1. Generate VAPID keys on your own machine (nothing is written to disk):
   ```
   npm run vapid:generate
   ```
   The **public** key is not secret; the PWA needs it (Task 07). The **private** key is a secret.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Add:

   | Secret | Value |
   |---|---|
   | `SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | The project's **secret** key (`sb_secret_...`) or the legacy `service_role` key. Dashboard → Project Settings → API Keys |
   | `VAPID_PUBLIC_KEY` | from step 1 |
   | `VAPID_PRIVATE_KEY` | from step 1 |
   | `VAPID_SUBJECT` | `mailto:<your address>` or an `https://` URL you control. Push services use it to contact you about problems |

   Never put these in a file in the repository, an issue, or a chat. Do not change the VAPID keys once users have subscribed: existing subscriptions are bound to the public key, and every user would have to subscribe again.
3. Make sure Actions are enabled for the repository and the default branch contains `send.yml`. Scheduled runs only happen on the default branch.

### 2.2 Running it by hand
**Actions → Send → Run workflow.**
- `dry_run` is **checked by default**: the run reads due users, prints what it would do (send, or skip as stale, with message index), and sends and writes **nothing**. It does not even need the VAPID secrets.
- Uncheck `dry_run` for a real send cycle (the same as a scheduled run).
- `test_push_user` (a user id): sends that user their **next** message to their stored subscription. It changes nothing: no counter, no schedule, no log row. The notification uses the tag `ntk-test`, so it does not replace a real one. Use it for the demo and to check a device. It fails if the user has no subscription.

Locally (for example against the local Supabase stack):
```
$env:SUPABASE_URL = "http://127.0.0.1:54321"
$env:SUPABASE_SERVICE_ROLE_KEY = "<local secret key from: npx supabase status>"
$env:DRY_RUN = "1"                    # PowerShell 5.1 swallows "--", so do not rely on: npm run sender -- --dry-run
npm run sender
```
On macOS or Linux:
```
export SUPABASE_URL="http://127.0.0.1:54321"
export SUPABASE_SERVICE_ROLE_KEY="<local secret key from: npx supabase status>"
npm run sender -- --dry-run
```

Exit codes: `0` success (individual pushes may still have failed: see the summary), `1` content invalid or a fatal error (for example Supabase unreachable), `2` configuration error (a required variable is missing; the message names it, never its value).

### 2.3 Reading a run
Each run prints a summary and adds a table to the run's **Summary** page: counts of `sent`, `skipped_stale`, `failed`, `expired_subscription`, maximum and median delay, and the first 8 characters of the ids of users who were skipped or failed. Message text, push endpoints and keys are never printed (Actions logs of a public repository are public).

- **Many `failed` with 401 or 403**: the VAPID keys or subject are wrong. The summary prints a warning. Fix the secrets. Users are retried on the next runs until their 2-hour window closes.
- **`aborted_invalid_content`**: `data/messages.json` on the default branch is invalid. Nothing was sent or changed. Fix the file (`npm run validate:content`); the next run sends normally.
- **`error` / exit 1 with "Supabase unavailable"**: the project is paused or down. Restore it in the dashboard (1.7). Claimed users are released automatically after 15 minutes.
- **`raced`**: a user changed their settings while their message was being sent. Expected occasionally; nothing to do.

Every run, including runs with nobody due, writes one row to `sender_runs`. To see whether runs are happening:
```sql
select run_id, started_at, outcome, claimed, sent, skipped_stale, failed, expired
  from public.sender_runs order by started_at desc limit 20;
```
A gap of more than about an hour means GitHub skipped or delayed runs, or the workflow was disabled (2.4).

### 2.4 Keep-alive: the 60-day rule
GitHub disables scheduled workflows in a public repository after 60 days without repository activity. The last step of every scheduled run calls the API to re-enable `send.yml`, which is meant to reset that timer.

**This is an assumption, not yet verified.** Check it after the repository has been live for a while: the step must show "keep-alive: workflow re-enabled", and the workflow must still be enabled after 60 days without commits. Record the result in `DECISIONS.md` (P-11).

Fallback if keep-alive does not work, or the step shows a warning:
- make any commit to the default branch at least once every 60 days (editing content counts), or
- re-enable the workflow by hand: **Actions → Send → Enable workflow**.

How you notice: `sender_runs` has no new rows, and GitHub shows a banner on the Actions page. GitHub usually also emails the owner before disabling.

### 2.5 Timing: what to expect
Scheduled runs are often a few minutes late and are sometimes skipped, especially around the top of the hour. A message is sent up to 2 hours after its slot (D-011) and skipped beyond that (counter unchanged; the user gets the next message the next day). With runs at :03 and :33, a slot normally gets about four attempts. Observed delays will be recorded in `DECISIONS.md` once the workflow is live.

### 2.6 Known residual risk
If a run crashes after a push service accepted a message but before the database was updated, the next run within the window sends the same message again. The notification tag and Web Push topic are the same, so the second one replaces the first instead of stacking.

## 3. PWA on GitHub Pages

### 3.1 One-time setup
1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables** (not Secrets: these values end up in the public bundle, by design):

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | The **publishable** key (`sb_publishable_...`) or the legacy anon key. **Never** the secret/service-role key |
   | `VITE_VAPID_PUBLIC_KEY` | The VAPID **public** key from `npm run vapid:generate` (used from Task 07) |

3. Set the Edge Function's allowed origin to the Pages origin (section 1.4): `ALLOWED_ORIGINS=https://<github-user>.github.io`. The origin has no path.

`pages.yml` runs on every push to the default branch that touches the PWA, core, build scripts or dependencies, and on demand (**Actions → Pages → Run workflow**). It fails instead of publishing if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing. The base path is the repository name (`/nekuda-tova/` for Q-02), taken automatically. The privacy link points at `docs/privacy.md` on the default branch.

### 3.2 Local development
```
npm run dev:pwa                       # Vite dev server (no CSP, no service worker build)
npm run build:pwa                     # full build into dist/ (app + sw.js)
$env:PWA_BASE = "/nekuda-tova/"; npx vite preview   # serve dist/ like Pages
```
Without the `VITE_*` variables the app still builds and works on screen; saving shows the gentle "couldn't save" line and keeps the change pending. To save against the local Supabase stack, set `VITE_SUPABASE_URL=http://127.0.0.1:54321` and the local publishable key, and run the function with `ALLOW_LOCALHOST=true`.

### 3.3 Updates and caching
The service worker precaches the app shell (HTML, the hashed JS/CSS, manifest, icons). Every build changes `sw.js` (it embeds a hash of the output), so after a deploy the browser installs the new version in the background and the **next** open shows it. Supabase requests are never intercepted or cached.

Clearing site data, or the browser evicting it, gives the device a new anonymous identity. The old row stays disabled or keeps sending to the old subscription until that subscription expires (404/410 disables it); disabled rows are deleted after 365 days (P-03).

### 3.4 Placeholder icons
`npm run icons:generate` rewrites `src/pwa/public/icons/*` (a warm dot on a light background, Q-04). To use a real icon, replace those files with the same names and sizes (192, 512, maskable 512 with the motif inside the central 80%, 180 for iOS, and an SVG favicon).

## 4. Maintenance

### 4.1 Rotating VAPID keys
Existing push subscriptions are bound to the public key, so after a rotation **every user must subscribe again**: their pushes fail until they open the app, turn notifications off and on, and a failed push may disable the row. Rotate only if the private key leaked.
1. `npm run vapid:generate`.
2. Replace `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the GitHub Actions secrets, and the `VITE_VAPID_PUBLIC_KEY` variable (section 3.1). Re-run **Pages**.
3. Expect `expired_subscription` or `failed` rows in `delivery_log` until users resubscribe.

### 4.2 Tunable constants
These live in `src/sender/config.ts` (and `src/core/scheduling/staleness.ts` for the window default). Changing them needs a deploy and a documentation update.

| Constant | Value | Effect |
|---|---|---|
| `maxLateSeconds` | 7200 | Later than this, a send is skipped for that day (D-011) |
| `ttlSeconds` | 3600 | How long the push service may hold a message for an offline device |
| `leaseSeconds` | 900 | How long a claimed row is hidden from other runs after a crash |
| `batchSize` | 50 | Rows claimed per run |
| `inactiveRetentionDays` | 365 | Disabled rows older than this are deleted |
| `logRetentionDays` | 90 | Delivery log and run rows older than this are deleted |

### 4.3 If a free tier changes
Every number in this document was true on the date it was written. Re-verify limits on the Supabase and GitHub pricing pages before relying on them. The pieces are replaceable: any Postgres with the migrations in `supabase/migrations/`, any scheduler that runs `npm run sender` every 30 minutes, and any static host for the PWA.
