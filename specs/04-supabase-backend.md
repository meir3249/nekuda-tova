# 04 — Supabase Schema, RLS, Adapters, Settings Edge Function

## Purpose and scope
The persistence and server-side write path: SQL migrations, RLS, the `settings` Edge Function (the only writer), the Supabase adapters for `UserRepository` and `DeliveryLog`, retention, and anonymous auth flow used by the PWA.

## Relevant requirements
Brief §10; hand-off Req 7, 9; Architecture section. D-006, D-010, D-011, D-014, P-01..P-05, P-08, P-09.

## Technical design

### Pre-work (must happen before building; recorded in `DEPENDENCIES.md`)
Verify against official Supabase docs and write down current free-tier limits: DB size, auth MAU, anonymous sign-in rate limits, Edge Function invocation limits and bundle size, project pausing behavior. If any limit or feature (anonymous auth, Edge Functions) is **not** free, stop and report before proceeding (D-009).

### Tables (migration `0001_init.sql`)
`public.subscriptions`
| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | = `auth.uid()`; FK to `auth.users(id) on delete cascade` |
| `push_subscription` | `jsonb` null | `{endpoint, keys:{p256dh,auth}}` |
| `local_time` | `text` not null | CHECK `~ '^([01][0-9]|2[0-3]):(00|30)$'` |
| `timezone` | `text` not null | length ≤ 64; deeper validation in function |
| `enabled` | `boolean` not null default false | |
| `start_index` | `integer` not null | CHECK ≥ 0 |
| `message_index` | `bigint` not null default 0 | CHECK ≥ 0 |
| `next_send_at` | `timestamptz` null | CHECK `(enabled = false) or (next_send_at is not null and push_subscription is not null)` |
| `claimed_until` | `timestamptz` null | lease (P-05) |
| `updated_at` | `timestamptz` not null default now() | trigger-maintained |
Index: partial on `(next_send_at) where enabled`.

`public.delivery_log`: `id bigserial`, `user_id uuid` (**no FK**, so the audit survives row deletion and is pruned by age), `scheduled_for`, `attempted_at`, `delay_seconds int`, `status text` CHECK in (`sent`,`skipped_stale`,`failed`,`expired_subscription`), `push_status int null`, `counter_value bigint`, `run_id text null`, `message_id text null`. Index on `attempted_at`. **No message text column exists.**

`public.sender_runs` (P-04): `run_id text pk`, `started_at`, `finished_at`, `outcome`, `claimed`, `sent`, `skipped_stale`, `failed`, `expired`. Heartbeat for dropped-run detection.

### RLS (migration `0002_rls.sql`)
- RLS **enabled** on all three tables.
- `subscriptions`: one policy: `SELECT` to `authenticated` using `auth.uid() = id`. **No INSERT/UPDATE/DELETE policies** → direct client writes are denied (P-01). Anonymous users have the `authenticated` role in Supabase.
- `delivery_log`, `sender_runs`: RLS on, **no policies** (service role only; the service role bypasses RLS).
- Revoke default privileges for `anon`; grant `select` on `subscriptions` to `authenticated`.

### Server functions (migration `0003_functions.sql`)
All `security definer` with `set search_path = public`, execute granted to `service_role` only.
- `claim_due_subscriptions(p_now timestamptz, p_limit int, p_lease_seconds int)`: single statement `UPDATE … SET claimed_until = p_now + lease WHERE id IN (SELECT id FROM subscriptions WHERE enabled AND push_subscription IS NOT NULL AND next_send_at <= p_now AND (claimed_until IS NULL OR claimed_until < p_now) ORDER BY next_send_at LIMIT p_limit FOR UPDATE SKIP LOCKED) RETURNING *`. Concurrent runs never claim the same row (idempotency, hand-off Req).
- `finalize_sent(p_id, p_expected timestamptz, p_new timestamptz)`: `UPDATE … SET message_index = message_index + 1, next_send_at = p_new, claimed_until = NULL WHERE id = p_id AND next_send_at = p_expected AND enabled` → returns whether a row changed (compare-and-set).
- `finalize_skipped(...)`: same without the counter increment.
- `release_claim(p_id)`: `claimed_until = NULL`.
- `mark_expired(p_id)`: `push_subscription = NULL, enabled = false, next_send_at = NULL, claimed_until = NULL`.
- `prune_inactive(p_cutoff)`: delete rows `enabled = false AND updated_at < p_cutoff` (365 days, P-03), returns count.
- `prune_delivery_log(p_cutoff)`: delete rows `attempted_at < p_cutoff` (90 days), returns count. Also prunes `sender_runs` older than 90 days.
- Race note: if a user disables or edits between claim and finalize, the CAS fails (`enabled` false or `next_send_at` changed), the sender discards the result and does not increment. A push may already have been accepted in that instant; accepted and documented.

### Edge Function `settings` (`supabase/functions/settings/`)
- `POST` JSON body: `{ localTime?, timezone?, enabled?, pushSubscription? }`; `GET` returns the caller's row; `DELETE` is **not** provided in v1 (disable already removes the subscription; erasure of the row is the retention job). *(Deleting the whole row on request is a possible later addition; not proposed now.)*
- Requires a valid user JWT (`verify_jwt = true`); `userId` comes from the verified token, never from the body.
- Loads the row with the service-role client, runs core `applySettingsChange(current, body, now, Math.random)`, writes the result. New rows are created only here.
- Enforces the **subscription cap** (P-09): if `count(*) ≥ MAX_SUBSCRIPTIONS` (env, default 5000) and the caller has no row → `429`-style error `CAPACITY_REACHED` with a friendly message. 
- Push endpoint allowlist (P-08), configured as data: HTTPS only; hosts `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com`, hosts ending `.push.apple.com`, hosts ending `.notify.windows.com`. Unknown host → `INVALID_SUBSCRIPTION`. (Allowlist reviewed against real subscriptions during Task 7.)
- Response: `200 { settings: {localTime, timezone, enabled, nextSendAt} }` (never returns the push subscription, counter, or start index). Errors: `400 {code, message}` using core codes; `401`; `429 CAPACITY_REACHED`; `500 INTERNAL` (generic, no details).
- CORS: allow the Pages origin and `http://localhost:*` for development only; `OPTIONS` handled.
- Input hardening: body ≤ 8 KiB, JSON only, unknown keys rejected.
- Core reuse: imports `src/core` through the Supabase bundler. **ASSUMPTION:** bundling files outside `supabase/functions/` works with the current CLI. If not, `scripts/build-edge-core.ts` bundles `src/core` with `esbuild` into `supabase/functions/_shared/core.js` (generated, committed or built in CI) and the function imports that (P-12, R-09). Decision recorded in `DECISIONS.md`.

### Adapters
- `src/adapters/supabase/supabase-user-repository.ts` implements `UserRepository` (00 §4) using `@supabase/supabase-js` with the **service-role** key (sender only). Maps rows ↔ `Subscription`, converts timestamps, calls the SQL functions above.
- `src/adapters/supabase/supabase-delivery-log.ts` implements `DeliveryLog` (inserts, `recordRun`, prune).
- `src/adapters/supabase/create-client.ts`: factories; never logs keys.
- PWA-side `src/pwa/api/settings-api.ts` (used by Tasks 6–7): `ensureSession()` → `supabase.auth.signInAnonymously()` lazily (P-15), `getSettings()`, `saveSettings(patch)`; the anon key and URL come from build-time public env.

### Secrets and keys
Public (shipped to client): Supabase URL, anon key, VAPID public key. Secret (GitHub Secrets only): service-role key, VAPID private key. The service-role key is never present in `src/pwa` bundles (verified by a test that scans the built bundle for the key pattern and for `service_role`).

## Files and components
`supabase/migrations/0001_init.sql`, `0002_rls.sql`, `0003_functions.sql`; `supabase/functions/settings/index.ts`; `supabase/config.toml`; `src/adapters/supabase/*`; `src/pwa/api/settings-api.ts`; `supabase/tests/*.sql` (RLS tests); `tests/adapters/supabase/*`; `docs/operations.md` (Supabase setup steps: create project, run migrations, set function secrets, set Auth: enable anonymous sign-ins).

## Interfaces and contracts
`UserRepository` and `DeliveryLog` per 00 §4; Edge Function HTTP contract above; error codes shared with core.

## Dependencies
Tasks 01, 03. New packages (exact pins, license-verified): `@supabase/supabase-js`. Supabase CLI as a dev tool. User must create a free Supabase project (Q-03).

## Acceptance criteria
1. Migrations apply cleanly to an empty free project (or local Supabase stack) and are idempotent in a fresh DB.
2. As anonymous user A: `settings` POST creates a row; GET returns it; direct `insert/update/delete` on `subscriptions` through the client is rejected.
3. As anonymous user B: cannot read A's row (empty result).
4. Unauthenticated call → `401`. Body `userId` is ignored.
5. Invalid slot (`09:15`), invalid timezone, enabling without a subscription, non-allowlisted endpoint → `400` with the right code and **no row change**.
6. Enabling computes `nextSendAt` equal to core `nextOccurrenceAfter(...)`; disabling nulls subscription and next send but keeps the counter; re-enabling resumes with the same counter.
7. Two concurrent `claim_due_subscriptions` calls never return the same row; a stale CAS finalize returns `false`.
8. Pruning functions delete only rows older than the cutoff.
9. Capacity cap returns `CAPACITY_REACHED` for new users only.
10. Built PWA bundle contains no service-role key or VAPID private key.
11. `delivery_log` has no column capable of holding message text (schema test).

## Unit tests
Adapter mapping with a mocked client; Edge Function handler with fake request/auth and fake repository (handler logic factored into a pure function `handleSettings(req, deps)` so it is testable without Deno).

## Integration tests
SQL/RLS tests run against a local Supabase stack (CLI, Docker, free) **or**, if Docker is unavailable, a documented manual script against the free project (`docs/operations.md`), with results pasted into the PR. Concurrency test: two parallel claims. CAS test. Retention tests with backdated rows.

## Error cases
Network failure to Supabase → adapter throws a typed `RepositoryUnavailableError`; project paused → same, documented restore steps; function timeout → `500`; malformed JSON → `400 BAD_REQUEST`.

## Edge cases
User calls POST twice rapidly (last write wins; both valid); user changes timezone and time in one request; clock skew between function runtime and DB (function uses its own `now()` once per request); re-enable after the 365-day prune (new row, new random start, counter 0); row exists but `auth.users` entry removed (cascade deletes row).

## Definition of Done
Acceptance criteria met; limits recorded in `DEPENDENCIES.md`; `docs/operations.md` Supabase section complete; `DECISIONS.md` updated (P-01..P-05, P-08, P-09 status; bundling decision).
