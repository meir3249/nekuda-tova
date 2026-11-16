# Operations

This file grows with each task. Section 1 is the Supabase backend (Task 04).
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

The function imports `src/core` and `src/adapters/supabase` by relative path. This is an **ASSUMPTION** that the CLI bundler follows imports outside `supabase/functions/`; it has not been verified yet (see `DECISIONS.md`, Task 04 notes). If `functions deploy` fails to resolve them, the fallback is an `esbuild` bundle of `src/core` (needs approval to add the dependency).

### 1.5 Local stack and database tests (needs Docker Desktop running)
```
npx supabase start
npx supabase db reset          # applies all migrations to an empty database
npx supabase db reset          # run twice: migrations must be idempotent in a fresh DB
npx supabase test db           # pgTAP tests in supabase/tests/database
```

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
`prune_inactive` (disabled rows untouched for 365 days, P-03) and `prune_delivery_log` (delivery log and sender runs older than 90 days) are called by the sender workflow (Task 05).
