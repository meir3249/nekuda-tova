# Operations

This file grows with each task. Section 1 is the Supabase backend (Task 04); section 2 is the sender (Task 05).
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
