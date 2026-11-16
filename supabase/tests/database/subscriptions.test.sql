-- Database tests (pgTAP). Run with:  npx supabase test db   (needs the local stack: Docker)
-- Covers spec 04 acceptance 2, 3, 5 (constraints), 7 (CAS, lease), 8 (retention), 11.
-- NOTE: the true two-connection concurrency check for claim_due_subscriptions
-- (FOR UPDATE SKIP LOCKED) cannot run inside one transaction; see docs/operations.md.
begin;
select * from no_plan();

-- Fixtures (as the superuser): five auth users.
insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', true),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', true),
  ('00000000-0000-0000-0000-00000000000c', 'authenticated', 'authenticated', true),
  ('00000000-0000-0000-0000-00000000000d', 'authenticated', 'authenticated', true),
  ('00000000-0000-0000-0000-00000000000e', 'authenticated', 'authenticated', true);

insert into public.subscriptions
  (id, push_subscription, local_time, timezone, enabled, start_index, message_index, next_send_at, updated_at)
values
  ('00000000-0000-0000-0000-00000000000a',
   '{"endpoint":"https://fcm.googleapis.com/fcm/send/a","keys":{"p256dh":"p","auth":"a"}}',
   '09:00', 'Asia/Jerusalem', true, 7, 10, '2027-01-11T07:00:00Z', now()),
  ('00000000-0000-0000-0000-00000000000b',
   null, '10:30', 'UTC', false, 3, 5, null, now());

------------------------------------------------------------------------------------------
-- Constraints
------------------------------------------------------------------------------------------
select throws_ok(
  $$insert into public.subscriptions (id, local_time, timezone, start_index)
    values ('00000000-0000-0000-0000-00000000000c', '09:15', 'UTC', 1)$$,
  '23514', null, 'slot 09:15 is rejected by CHECK');

select throws_ok(
  $$insert into public.subscriptions (id, local_time, timezone, start_index, enabled)
    values ('00000000-0000-0000-0000-00000000000c', '09:00', 'UTC', 1, true)$$,
  '23514', null, 'enabled without next_send_at/push_subscription is rejected');

select throws_ok(
  $$insert into public.subscriptions (id, local_time, timezone, start_index)
    values ('00000000-0000-0000-0000-00000000000c', '09:00', 'UTC', -1)$$,
  '23514', null, 'negative start_index is rejected');

select throws_ok(
  $$insert into public.subscriptions (id, local_time, timezone, start_index)
    values ('99999999-9999-9999-9999-999999999999', '09:00', 'UTC', 1)$$,
  '23503', null, 'id must reference auth.users');

------------------------------------------------------------------------------------------
-- RLS: user A sees only their own row; clients cannot write (P-01) or read secrets
------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from public.subscriptions), 1, 'A sees exactly one row');
select is((select id::text from public.subscriptions),
  '00000000-0000-0000-0000-00000000000a', 'A sees its own row');
select is((select local_time from public.subscriptions), '09:00', 'A can read local_time');

select throws_ok($$select push_subscription from public.subscriptions$$, '42501', null,
  'A cannot read push_subscription (column privilege)');
select throws_ok($$select message_index from public.subscriptions$$, '42501', null,
  'A cannot read the counter');
select throws_ok($$select start_index from public.subscriptions$$, '42501', null,
  'A cannot read start_index');

select throws_ok(
  $$insert into public.subscriptions (id, local_time, timezone, start_index)
    values ('00000000-0000-0000-0000-00000000000a', '09:00', 'UTC', 1)$$,
  '42501', null, 'direct INSERT is denied');
select throws_ok($$update public.subscriptions set enabled = false$$, '42501', null,
  'direct UPDATE is denied');
select throws_ok($$delete from public.subscriptions$$, '42501', null, 'direct DELETE is denied');

select throws_ok($$select * from public.delivery_log$$, '42501', null, 'delivery_log is not readable');
select throws_ok($$select * from public.sender_runs$$, '42501', null, 'sender_runs is not readable');
select throws_ok($$select public.count_subscriptions()$$, '42501', null,
  'server functions are not executable by clients');

-- User B cannot see A's row.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  0, 'B cannot read A''s row');
select is((select count(*)::int from public.subscriptions), 1, 'B sees only its own row');

reset role;

-- anon role has no access at all.
set local role anon;
select throws_ok($$select id from public.subscriptions$$, '42501', null, 'anon cannot read subscriptions');
reset role;

------------------------------------------------------------------------------------------
-- Server functions (service role)
------------------------------------------------------------------------------------------
set local role service_role;

select is(public.count_subscriptions(), 2::bigint, 'count_subscriptions');

-- Not due yet.
select is((select count(*)::int from public.claim_due_subscriptions('2027-01-11T06:59:59Z', 10, 600)),
  0, 'nothing is claimed before next_send_at');
select is((select count(*)::int from public.peek_due_subscriptions('2027-01-11T07:00:30Z', 10)),
  1, 'peek sees the due row');
select is((select claimed_until from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  null, 'peek does not lease');

-- Claim, then the lease prevents a second claim; it can be reclaimed after expiry.
select is((select count(*)::int from public.claim_due_subscriptions('2027-01-11T07:00:30Z', 10, 600)),
  1, 'due row is claimed');
select is((select count(*)::int from public.claim_due_subscriptions('2027-01-11T07:01:00Z', 10, 600)),
  0, 'second claim within the lease returns nothing');
select is((select count(*)::int from public.claim_due_subscriptions('2027-01-11T07:11:00Z', 10, 600)),
  1, 'row is claimable again after the lease expires');

-- Compare-and-set finalize.
select is(public.finalize_sent('00000000-0000-0000-0000-00000000000a',
  '2027-01-11T06:00:00Z', '2027-01-12T07:00:00Z'), false, 'stale CAS returns false');
select is((select message_index from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  10::bigint, 'stale CAS leaves the counter alone');
select is(public.finalize_sent('00000000-0000-0000-0000-00000000000a',
  '2027-01-11T07:00:00Z', '2027-01-12T07:00:00Z'), true, 'finalize_sent succeeds with the expected next_send_at');
select is((select message_index from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  11::bigint, 'finalize_sent increments the counter');
select is((select claimed_until from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  null, 'finalize_sent releases the lease');
select is(public.finalize_sent('00000000-0000-0000-0000-00000000000a',
  '2027-01-11T07:00:00Z', '2027-01-13T07:00:00Z'), false, 'replaying the same finalize is a no-op');

select is(public.finalize_skipped('00000000-0000-0000-0000-00000000000a',
  '2027-01-12T07:00:00Z', '2027-01-13T07:00:00Z'), true, 'finalize_skipped succeeds');
select is((select message_index from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  11::bigint, 'finalize_skipped does not change the counter');

-- Millisecond-precision CAS (migration 0004): the sender only knows milliseconds.
update public.subscriptions set next_send_at = '2027-01-13T07:00:00.123456Z'
 where id = '00000000-0000-0000-0000-00000000000a';
select is(public.finalize_skipped('00000000-0000-0000-0000-00000000000a',
  '2027-01-13T07:00:00.123Z', '2027-01-13T07:00:00Z'), true, 'CAS matches a microsecond value read back at ms precision');
select is(public.finalize_skipped('00000000-0000-0000-0000-00000000000a',
  '2027-01-13T07:00:00.001Z', '2027-01-14T07:00:00Z'), false, 'CAS still rejects a different millisecond');

-- A disabled row can never be finalized (user disabled mid-run).
select is(public.finalize_sent('00000000-0000-0000-0000-00000000000b',
  '2027-01-11T07:00:00Z', '2027-01-12T07:00:00Z'), false, 'disabled row: finalize returns false');

-- release_claim / mark_expired
select public.claim_due_subscriptions('2027-01-13T07:00:30Z', 10, 600);
select public.release_claim('00000000-0000-0000-0000-00000000000a');
select is((select claimed_until from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  null, 'release_claim clears the lease');
select public.mark_expired('00000000-0000-0000-0000-00000000000a');
select results_eq(
  $$select push_subscription is null, enabled, next_send_at is null, claimed_until is null
      from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'$$,
  $$values (true, false, true, true)$$,
  'mark_expired nulls the subscription and schedule and disables');
select is((select message_index from public.subscriptions where id = '00000000-0000-0000-0000-00000000000a'),
  11::bigint, 'mark_expired keeps the counter');

reset role;

------------------------------------------------------------------------------------------
-- Retention (backdated rows are inserted with explicit updated_at; the trigger only fires on UPDATE)
------------------------------------------------------------------------------------------
insert into public.subscriptions (id, local_time, timezone, start_index, enabled, updated_at) values
  ('00000000-0000-0000-0000-00000000000c', '09:00', 'UTC', 1, false, now() - interval '400 days'),
  ('00000000-0000-0000-0000-00000000000d', '09:00', 'UTC', 1, false, now() - interval '10 days');
insert into public.subscriptions
  (id, push_subscription, local_time, timezone, start_index, enabled, next_send_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000e',
   '{"endpoint":"https://fcm.googleapis.com/fcm/send/e","keys":{"p256dh":"p","auth":"a"}}',
   '09:00', 'UTC', 1, true, now() + interval '1 day', now() - interval '400 days');

set local role service_role;
select is(public.prune_inactive(now() - interval '365 days'), 1,
  'prune_inactive deletes exactly the old disabled row');
reset role;
select is((select count(*)::int from public.subscriptions
            where id in ('00000000-0000-0000-0000-00000000000c')), 0, 'old disabled row is gone');
select is((select count(*)::int from public.subscriptions
            where id in ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e')),
  2, 'recent disabled and old-but-enabled rows are kept');

insert into public.delivery_log (user_id, scheduled_for, attempted_at, delay_seconds, status, counter_value) values
  ('00000000-0000-0000-0000-00000000000a', now() - interval '100 days', now() - interval '100 days', 0, 'sent', 1),
  ('00000000-0000-0000-0000-00000000000a', now() - interval '1 day', now() - interval '1 day', 0, 'sent', 2);
insert into public.sender_runs (run_id, started_at, finished_at, outcome) values
  ('old-run', now() - interval '100 days', now() - interval '100 days', 'ok'),
  ('new-run', now() - interval '1 day', now() - interval '1 day', 'ok');

set local role service_role;
select is(public.prune_delivery_log(now() - interval '90 days'), 1, 'prune_delivery_log deletes only old entries');
reset role;
select is((select count(*)::int from public.delivery_log), 1, 'recent delivery_log entry kept');
select is((select count(*)::int from public.sender_runs), 1, 'old sender_runs entry pruned, recent kept');

select throws_ok(
  $$insert into public.delivery_log (user_id, scheduled_for, attempted_at, delay_seconds, status, counter_value)
    values ('00000000-0000-0000-0000-00000000000a', now(), now(), 0, 'bogus', 1)$$,
  '23514', null, 'delivery_log.status is constrained');

-- delivery_log survives deletion of the user (no FK); subscriptions cascade.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.subscriptions where id = '00000000-0000-0000-0000-00000000000d'),
  0, 'deleting the auth user cascades to subscriptions');

select * from finish();
rollback;
