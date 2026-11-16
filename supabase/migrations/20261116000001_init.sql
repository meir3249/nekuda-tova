-- 0001_init: tables, constraints, indexes, updated_at trigger.
-- Idempotent: safe to re-run on a fresh or already-migrated database.

create table if not exists public.subscriptions (
  id                uuid primary key references auth.users (id) on delete cascade,
  push_subscription jsonb,
  local_time        text        not null,
  timezone          text        not null,
  enabled           boolean     not null default false,
  start_index       integer     not null,
  message_index     bigint      not null default 0,
  next_send_at      timestamptz,
  claimed_until     timestamptz,
  updated_at        timestamptz not null default now(),
  constraint subscriptions_local_time_slot
    check (local_time ~ '^([01][0-9]|2[0-3]):(00|30)$'),
  constraint subscriptions_timezone_len
    check (char_length(timezone) between 1 and 64),
  constraint subscriptions_start_index_nonneg
    check (start_index >= 0),
  constraint subscriptions_message_index_nonneg
    check (message_index >= 0),
  constraint subscriptions_enabled_requires_schedule
    check (enabled = false or (next_send_at is not null and push_subscription is not null))
);

create index if not exists subscriptions_due_idx
  on public.subscriptions (next_send_at)
  where enabled;

-- Delivery audit. user_id deliberately has NO foreign key so the audit survives row
-- deletion and is pruned by age. There is intentionally no column that can hold message text.
create table if not exists public.delivery_log (
  id            bigserial primary key,
  user_id       uuid        not null,
  scheduled_for timestamptz not null,
  attempted_at  timestamptz not null,
  delay_seconds integer     not null,
  status        text        not null,
  push_status   integer,
  counter_value bigint      not null,
  run_id        text,
  message_id    text,
  constraint delivery_log_status_check
    check (status in ('sent', 'skipped_stale', 'failed', 'expired_subscription'))
);

create index if not exists delivery_log_attempted_at_idx
  on public.delivery_log (attempted_at);

-- Heartbeat per sender run (P-04), used to detect dropped runs.
create table if not exists public.sender_runs (
  run_id        text primary key,
  started_at    timestamptz not null,
  finished_at   timestamptz not null,
  outcome       text        not null,
  claimed       integer     not null default 0,
  sent          integer     not null default 0,
  skipped_stale integer     not null default 0,
  failed        integer     not null default 0,
  expired       integer     not null default 0,
  constraint sender_runs_outcome_check
    check (outcome in ('ok', 'aborted_invalid_content', 'error'))
);

create index if not exists sender_runs_started_at_idx
  on public.sender_runs (started_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();
