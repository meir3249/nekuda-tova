-- 0004: compare-and-set at millisecond precision.
-- Postgres timestamptz keeps microseconds; the sender's JavaScript Date keeps milliseconds. A row whose
-- next_send_at had sub-millisecond digits (e.g. written with now()) could never be finalized, because the
-- value the sender read back and sent as p_expected was truncated. Found by the Task 05 local integration run.
-- Both sides are truncated the same way (JS parses ".197062" as 197 ms; date_trunc truncates too).
-- The where clause remains a single-row CAS on the primary key; no index is needed.

create or replace function public.finalize_sent(
  p_id uuid,
  p_expected timestamptz,
  p_new timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
     set message_index = message_index + 1,
         next_send_at  = p_new,
         claimed_until = null
   where id = p_id
     and date_trunc('milliseconds', next_send_at) = date_trunc('milliseconds', p_expected)
     and enabled;
  return found;
end;
$$;

create or replace function public.finalize_skipped(
  p_id uuid,
  p_expected timestamptz,
  p_new timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subscriptions
     set next_send_at  = p_new,
         claimed_until = null
   where id = p_id
     and date_trunc('milliseconds', next_send_at) = date_trunc('milliseconds', p_expected)
     and enabled;
  return found;
end;
$$;

-- `create or replace` keeps existing grants, but restate them so this file is correct on its own.
revoke all on function public.finalize_sent(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_skipped(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_sent(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.finalize_skipped(uuid, timestamptz, timestamptz) to service_role;
