-- 0002_rls: row level security and privileges (P-01: the settings function is the only writer).

alter table public.subscriptions enable row level security;
alter table public.delivery_log  enable row level security;
alter table public.sender_runs   enable row level security;

-- Anonymous Supabase users have the `authenticated` role. They may read only their own row;
-- there are NO insert/update/delete policies, so direct client writes are denied.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own
  on public.subscriptions
  for select
  to authenticated
  using (auth.uid() = id);

-- delivery_log and sender_runs: RLS on, no policies => service role only.

-- Privileges: strip everything from client roles first (Supabase default privileges grant a lot).
revoke all on public.subscriptions from anon, authenticated;
revoke all on public.delivery_log  from anon, authenticated;
revoke all on public.sender_runs   from anon, authenticated;
revoke all on sequence public.delivery_log_id_seq from anon, authenticated;

-- Column-level read grant: a client may see its own schedule settings, but never the push
-- endpoint/keys, the start index, the counter, or the lease. (Stricter than table-level select.)
grant select (id, local_time, timezone, enabled, next_send_at, updated_at)
  on public.subscriptions to authenticated;
