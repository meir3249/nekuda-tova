-- 0003_functions: server-side functions used by the sender (service role only).
-- All are SECURITY DEFINER with a fixed search_path; execute is revoked from everyone but service_role.

create or replace function public.claim_due_subscriptions(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.subscriptions
language sql
security definer
set search_path = public
as $$
  update public.subscriptions s
     set claimed_until = p_now + make_interval(secs => p_lease_seconds)
   where s.id in (
     select id
       from public.subscriptions
      where enabled
        and push_subscription is not null
        and next_send_at <= p_now
        and (claimed_until is null or claimed_until < p_now)
      order by next_send_at
      limit p_limit
        for update skip locked
   )
  returning s.*;
$$;

-- Read-only variant for dry runs.
create or replace function public.peek_due_subscriptions(
  p_now timestamptz,
  p_limit integer
)
returns setof public.subscriptions
language sql
stable
security definer
set search_path = public
as $$
  select *
    from public.subscriptions
   where enabled
     and push_subscription is not null
     and next_send_at <= p_now
     and (claimed_until is null or claimed_until < p_now)
   order by next_send_at
   limit p_limit;
$$;

-- Compare-and-set: counter +1, schedule advanced, lease released. False if the row changed meanwhile.
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
     and next_send_at = p_expected
     and enabled;
  return found;
end;
$$;

-- Same compare-and-set without the counter increment (stale skip).
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
     and next_send_at = p_expected
     and enabled;
  return found;
end;
$$;

create or replace function public.release_claim(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.subscriptions set claimed_until = null where id = p_id;
$$;

create or replace function public.mark_expired(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.subscriptions
     set push_subscription = null,
         enabled = false,
         next_send_at = null,
         claimed_until = null
   where id = p_id;
$$;

-- Retention (P-03): disabled rows untouched since the cutoff.
create or replace function public.prune_inactive(p_cutoff timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.subscriptions
   where enabled = false
     and updated_at < p_cutoff;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Retention: delivery_log and sender_runs older than the cutoff. Returns the delivery_log count.
create or replace function public.prune_delivery_log(p_cutoff timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.delivery_log where attempted_at < p_cutoff;
  get diagnostics n = row_count;
  delete from public.sender_runs where started_at < p_cutoff;
  return n;
end;
$$;

-- Subscription count for the capacity cap (P-09), without exposing rows.
create or replace function public.count_subscriptions()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.subscriptions;
$$;

-- Lock down execution: service_role only.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.claim_due_subscriptions(timestamptz, integer, integer)',
    'public.peek_due_subscriptions(timestamptz, integer)',
    'public.finalize_sent(uuid, timestamptz, timestamptz)',
    'public.finalize_skipped(uuid, timestamptz, timestamptz)',
    'public.release_claim(uuid)',
    'public.mark_expired(uuid)',
    'public.prune_inactive(timestamptz)',
    'public.prune_delivery_log(timestamptz)',
    'public.count_subscriptions()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
