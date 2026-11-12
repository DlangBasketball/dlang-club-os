-- ============================================================================
-- RPC tenant isolation suite: SECURITY DEFINER functions, EXECUTE grants,
-- uninvited signups and invitations.
--
-- tenant_isolation.sql proves table RLS. SECURITY DEFINER functions bypass
-- RLS, so each one must check the caller AND that the target row belongs to
-- the caller's org. This suite covers:
--   A. EXECUTE grants: anon may run no SECURITY DEFINER function except an
--      explicit allowlist; service-role-only functions are closed to anon
--      and authenticated; capture_* fail closed.
--   B. Cross-tenant RPC calls: an admin+finance user of Riverside (org B)
--      calling every id-taking RPC with the founding club's (org A) ids gets
--      an error or nothing, and org A's data is unchanged.
--   C. An uninvited signup belongs to no org and sees zero tenant rows.
--   D. Invitations cannot reference another org's family or coach.
--
-- Fixture identities (seed): org A …0001 (admin …f1, finance …f2, coach …f3,
-- parent …f4, families …061-063, athletes …071-074, invoice …091 'sent',
-- program session …051, attendance session …0a1, service …021, coach …012),
-- org B 10000000-…0002 (Riverside, no users in the seed; created here).
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema rt;
grant usage on schema rt to authenticated, anon;

create function rt.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function rt.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function rt.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Run p_sql as user p (null = anon). Returns 'OK:<first column as text>' or
-- 'ERR:<message>'. Side effects of a successful call are kept.
create function rt.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform rt.as_user(p);
    execute p_sql into v_res;
    perform rt.as_super();
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform rt.as_super();
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema rt to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures: a Riverside admin+finance user, a Riverside coach, a DLang
-- training booking, a fresh uninvited signup.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test'),
  ('b0000000-0000-0000-0000-0000000000c1', 'nobody@uninvited.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance');
insert into public.coaches (id, org_id, display_name)
values ('b0000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000002', 'Riverside Coach');

insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf)
select 'b0000000-0000-0000-0000-0000000000e1', a.org_id, a.id, '00000000-0000-0000-0000-000000000021',
       ca.coach_id, ca.starts_at, ca.ends_at, 'booked', 0
  from public.athletes a, public.coach_availability ca
 where a.id = '00000000-0000-0000-0000-000000000071' and ca.org_id = a.org_id
 order by ca.starts_at limit 1;

-- ===========================================================================
-- A. EXECUTE grants
-- ===========================================================================
do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('anon', p.oid, 'execute')
       and p.proname not in (
         'get_public_tenant', 'is_slug_available', 'register_public', 'training_public_catalog',
         'current_org_id', 'current_user_email', 'current_coach_id', 'has_role',
         'is_admin', 'is_finance', 'is_any_guardian', 'is_platform_admin', 'is_org_admin',
         'is_guardian_of_athlete', 'is_guardian_of_family', 'coach_can_access_athlete',
         'coach_coaches_program', 'coach_coaches_team', 'coach_leads_attendance_session',
         'guardian_has_athlete_in_program', 'guardian_has_athlete_on_team',
         'can_manage_event', 'can_read_event', 'event_team', 'sportsops_same_org',
         'suspended_org_ids')
  loop
    perform rt.ok(false, 'anon has EXECUTE on SECURITY DEFINER ' || r.sig || ' (not on the allowlist)');
    n := n + 1;
  end loop;
  perform rt.ok(n = 0, 'anon can execute only allowlisted SECURITY DEFINER functions');
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean)',
    'public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text)',
    'public.apply_stripe_refund(text, text, numeric, text, text)',
    'public.apply_stripe_dispute_loss(text, text, numeric, text, text)',
    'public.claim_stripe_event(text, text, text, boolean)',
    'public.finish_stripe_event(text, text, text)',
    'public.org_for_stripe_account(text)',
    'public.resolve_application_fee(uuid, bigint)',
    'public.refresh_installment_status(uuid)',
    'public.recompute_invoice(uuid)',
    'public.flag_overdue_invoices(uuid)',
    'public.next_invoice_number(uuid)',
    'public.gen_qr_reference(uuid, text)',
    'public.find_invoice_by_reference(uuid, text)'
  ] loop
    perform rt.ok(not has_function_privilege('anon', f::regprocedure, 'execute')
              and not has_function_privilege('authenticated', f::regprocedure, 'execute')
              and has_function_privilege('service_role', f::regprocedure, 'execute'),
              'service-role only: ' || f);
  end loop;
end $$;

-- Behaviour: anon cannot repoint a club's Stripe account or forge a payment.
do $$
declare v text; v_before jsonb;
begin
  select payment_settings into v_before from public.organizations where id = '00000000-0000-0000-0000-000000000001';
  v := rt.run_as(null, $q$select public.set_stripe_connect_account('00000000-0000-0000-0000-000000000001','acct_attacker','standard',true,true,true)::text$q$);
  perform rt.ok(v like 'ERR:%', 'anon set_stripe_connect_account is refused (' || v || ')');
  perform rt.ok((select payment_settings from public.organizations where id = '00000000-0000-0000-0000-000000000001') is not distinct from v_before,
                'org A payment_settings unchanged after anon attempt');

  v := rt.run_as(null, $q$select public.apply_stripe_payment('00000000-0000-0000-0000-000000000091',1490,'pi_forged_1')::text$q$);
  perform rt.ok(v like 'ERR:%', 'anon apply_stripe_payment is refused');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.apply_stripe_payment('00000000-0000-0000-0000-000000000091',1490,'pi_forged_2')::text$q$);
  perform rt.ok(v like 'ERR:%', 'finance user apply_stripe_payment is refused (service role only)');
  perform rt.ok((select status::text from public.invoices where id = '00000000-0000-0000-0000-000000000091') = 'sent',
                'invoice …091 still unpaid');

  v := rt.run_as(null, $q$select public.capture_all_usage_snapshots()::text$q$);
  perform rt.ok(v like 'ERR:%', 'anon capture_all_usage_snapshots is refused');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.capture_usage_snapshot('00000000-0000-0000-0000-000000000001')::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'club admin (not platform admin) capture_usage_snapshot is FORBIDDEN');
end $$;

-- Service role (no end-user identity) may still run the service functions.
do $$
declare v text;
begin
  begin
    execute 'set local role service_role';
    perform public.capture_usage_snapshot('00000000-0000-0000-0000-000000000001');
    v := public.org_for_stripe_account('acct_none')::text;
    execute 'reset role';
    perform rt.ok(true, 'service_role can call capture_usage_snapshot and org_for_stripe_account');
  exception when others then
    execute 'reset role';
    perform rt.ok(false, 'service_role can call service functions: ' || sqlerrm);
  end;
end $$;

-- Caller checks that used current_user (always the owner inside SECURITY
-- DEFINER) no longer let any signed-in user through.
do $$
declare v text;
begin
  v := rt.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.get_org_payment_profile('00000000-0000-0000-0000-000000000001')::text$q$);
  perform rt.ok(v = 'OK:<null>', 'org B admin get_org_payment_profile(org A) returns nothing (' || left(v, 60) || ')');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select (public.get_org_payment_profile('00000000-0000-0000-0000-000000000001')->>'org_id')$q$);
  perform rt.ok(v = 'OK:00000000-0000-0000-0000-000000000001', 'org A admin get_org_payment_profile(org A) works');
  v := rt.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.installments_due('00000000-0000-0000-0000-000000000001', '2100-01-01')$q$);
  perform rt.ok(v = 'OK:0', 'org B finance installments_due(org A) returns no rows');
  v := rt.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.run_recurring_billing('00000000-0000-0000-0000-000000000001')::text$q$);
  perform rt.ok(v like 'ERR:%NOT_AUTHORIZED%', 'org B finance run_recurring_billing(org A) is NOT_AUTHORIZED');
end $$;

-- ===========================================================================
-- B. Cross-tenant RPC calls by org B admin+finance against org A ids
-- ===========================================================================
do $$
declare
  b constant uuid := 'b0000000-0000-0000-0000-0000000000b1';
  v text;
begin
  v := rt.run_as(b, $q$select public.anonymise_family('00000000-0000-0000-0000-000000000062')::text$q$);
  perform rt.ok(v like 'ERR:%', 'anonymise_family(org A family) refused');
  perform rt.ok((select name from public.families where id = '00000000-0000-0000-0000-000000000062') <> '[deleted]',
                'org A family …062 not anonymised');

  v := rt.run_as(b, $q$select count(*)::text from public.athlete_safety('00000000-0000-0000-0000-000000000072')$q$);
  perform rt.ok(v = 'OK:0', 'athlete_safety(org A athlete) returns no rows');

  v := rt.run_as(b, $q$select count(*)::text from public.athlete_attendance_summary('00000000-0000-0000-0000-000000000071')$q$);
  perform rt.ok(v = 'OK:0', 'athlete_attendance_summary(org A athlete) returns no rows');

  v := rt.run_as(b, $q$select public.record_manual_payment('00000000-0000-0000-0000-000000000091', 1490, 'manual')::text$q$);
  perform rt.ok(v like 'ERR:%', 'record_manual_payment(org A invoice) refused');
  perform rt.ok((select status::text from public.invoices where id = '00000000-0000-0000-0000-000000000091') = 'sent',
                'org A invoice …091 not marked paid');

  v := rt.run_as(b, $q$select count(*)::text from public.session_roster('00000000-0000-0000-0000-0000000000a1')$q$);
  perform rt.ok(v like 'ERR:%' or v = 'OK:0', 'session_roster(org A session) returns nothing (' || v || ')');

  v := rt.run_as(b, $q$select public.save_attendance('00000000-0000-0000-0000-0000000000a1', '[]'::jsonb)::text$q$);
  perform rt.ok(v like 'ERR:%', 'save_attendance(org A session) refused');

  v := rt.run_as(b, $q$select public.open_attendance_session('00000000-0000-0000-0000-000000000051')::text$q$);
  perform rt.ok(v like 'ERR:%', 'open_attendance_session(org A program session) refused');

  v := rt.run_as(b, $q$select public.grant_training_credits('00000000-0000-0000-0000-000000000071', 'personal', 10)::text$q$);
  perform rt.ok(v like 'ERR:%', 'grant_training_credits(org A athlete) refused');

  v := rt.run_as(b, format($q$select public.withdraw_consent(%L)::text$q$,
                           (select id from public.consent_acceptances where org_id = '00000000-0000-0000-0000-000000000001' limit 1)));
  perform rt.ok(v like 'ERR:%', 'withdraw_consent(org A consent) refused');

  v := rt.run_as(b, format($q$select public.book_training_session('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000021', %L)::text$q$,
                           (select id from public.coach_availability where org_id = '00000000-0000-0000-0000-000000000001' and not is_booked limit 1)));
  perform rt.ok(v like 'ERR:%', 'book_training_session(org A athlete) refused');

  v := rt.run_as(b, $q$select public.cancel_training_booking('b0000000-0000-0000-0000-0000000000e1')::text$q$);
  perform rt.ok(v like 'ERR:%', 'cancel_training_booking(org A booking) refused');
  v := rt.run_as(b, format($q$select public.reschedule_booking('b0000000-0000-0000-0000-0000000000e1', %L)::text$q$,
                           (select id from public.coach_availability where org_id = '00000000-0000-0000-0000-000000000001' and not is_booked limit 1)));
  perform rt.ok(v like 'ERR:%', 'reschedule_booking(org A booking) refused');
  perform rt.ok((select status::text from public.training_bookings where id = 'b0000000-0000-0000-0000-0000000000e1') = 'booked',
                'org A booking still booked');

  v := rt.run_as(b, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000062","items":[{"description":"x","unit_price_chf":1}]}'::jsonb)::text$q$);
  perform rt.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'create_manual_invoice with org A family refused');

  -- Positive controls: org A staff still use the same RPCs on their own rows.
  v := rt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.session_roster('00000000-0000-0000-0000-0000000000a1')$q$);
  perform rt.ok(v like 'OK:%' and v <> 'OK:0', 'org A admin session_roster(own session) returns the roster (' || v || ')');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.record_manual_payment('00000000-0000-0000-0000-000000000091', 1, 'manual')->>'status'$q$);
  perform rt.ok(v like 'OK:%', 'org A finance record_manual_payment(own invoice) works (' || v || ')');
end $$;

-- ===========================================================================
-- B2. Payments review: in-body guards, cross-tenant booking prices, rounding
-- ===========================================================================
-- The webhook RPCs refuse API callers even if EXECUTE is granted again by
-- mistake (defence in depth behind the revokes in section A).
do $$
declare v text; f text; v_status_before text;
begin
  select status::text into v_status_before from public.invoices where id = '00000000-0000-0000-0000-000000000091';
  foreach f in array array[
    'public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean)',
    'public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text)',
    'public.apply_stripe_refund(text, text, numeric, text, text)',
    'public.apply_stripe_dispute_loss(text, text, numeric, text, text)',
    'public.claim_stripe_event(text, text, text, boolean)',
    'public.finish_stripe_event(text, text, text)'
  ] loop
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;

  v := rt.run_as(null, $q$select public.set_stripe_connect_account('00000000-0000-0000-0000-000000000001','acct_attacker','standard',true,true,true)::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'guard: anon set_stripe_connect_account FORBIDDEN even with EXECUTE (' || v || ')');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.apply_stripe_payment('00000000-0000-0000-0000-000000000091',1490,'pi_guard_1')::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'guard: finance apply_stripe_payment FORBIDDEN even with EXECUTE');
  v := rt.run_as(null, $q$select public.apply_stripe_refund('pi_x','re_guard',1)::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'guard: anon apply_stripe_refund FORBIDDEN');
  v := rt.run_as(null, $q$select public.apply_stripe_dispute_loss('pi_x','dp_guard',1)::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'guard: anon apply_stripe_dispute_loss FORBIDDEN');
  v := rt.run_as(null, $q$select public.claim_stripe_event('evt_guard','x')::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'guard: anon claim_stripe_event FORBIDDEN');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.finish_stripe_event('evt_guard','processed')::text$q$);
  perform rt.ok(v like 'ERR:%FORBIDDEN%', 'guard: admin finish_stripe_event FORBIDDEN');
  perform rt.ok((select status::text from public.invoices where id = '00000000-0000-0000-0000-000000000091') = v_status_before
                and not exists (select 1 from public.payments where stripe_payment_intent_id = 'pi_guard_1'),
                'guard: no forged payment on invoice …091');

  foreach f in array array[
    'public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean)',
    'public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text)',
    'public.apply_stripe_refund(text, text, numeric, text, text)',
    'public.apply_stripe_dispute_loss(text, text, numeric, text, text)',
    'public.claim_stripe_event(text, text, text, boolean)',
    'public.finish_stripe_event(text, text, text)'
  ] loop
    execute format('revoke execute on function %s from anon, authenticated', f);
  end loop;

  -- Service role still works through the guard.
  begin
    execute 'set local role service_role';
    perform public.claim_stripe_event('evt_guard_svc', 'x');
    perform public.finish_stripe_event('evt_guard_svc', 'processed');
    execute 'reset role';
    perform rt.ok(true, 'guard: service_role passes claim/finish_stripe_event');
  exception when others then
    execute 'reset role';
    perform rt.ok(false, 'guard: service_role passes claim/finish_stripe_event: ' || sqlerrm);
  end;
end $$;

-- book_training_session: a guardian of an org A athlete cannot take the price
-- or credits of an org B service, nor book an org B coach's slot.
do $$
declare
  v text;
  v_svc_b  uuid;
  v_slot_b uuid;
  v_slot_a uuid;
  n_before int;
begin
  update public.app_settings set settings = settings || '{"bookings_enabled": true}'::jsonb
   where org_id = '00000000-0000-0000-0000-000000000001';
  insert into public.training_services (org_id, slug, name, price_chf, credits_required)
  values ('10000000-0000-0000-0000-000000000002', 'free-b', 'Riverside free session', 0, 1)
  returning id into v_svc_b;
  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at)
  values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000d1',
          now() + interval '30 days', now() + interval '30 days 1 hour')
  returning id into v_slot_b;
  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012',
          now() + interval '31 days', now() + interval '31 days 1 hour')
  returning id into v_slot_a;
  select count(*) into n_before from public.invoices where org_id = '00000000-0000-0000-0000-000000000001';

  v := rt.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.book_training_session('00000000-0000-0000-0000-000000000071', %L, %L, 'invoice')::text$q$, v_svc_b, v_slot_a));
  perform rt.ok(v like 'ERR:%SERVICE_NOT_FOUND%', 'book_training_session with org B service refused (' || v || ')');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.book_training_session('00000000-0000-0000-0000-000000000071', %L, %L, 'invoice')::text$q$, v_svc_b, v_slot_a));
  perform rt.ok(v like 'ERR:%SERVICE_NOT_FOUND%', 'finance book_training_session with org B service refused');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.book_training_session('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000021', %L, 'invoice')::text$q$, v_slot_b));
  perform rt.ok(v like 'ERR:%SLOT_NOT_FOUND%', 'book_training_session with org B slot refused (' || v || ')');
  perform rt.ok(not (select is_booked from public.coach_availability where id = v_slot_b), 'org B slot not marked booked');
  perform rt.ok((select count(*) from public.invoices where org_id = '00000000-0000-0000-0000-000000000001') = n_before,
                'no invoice created by the refused bookings');
end $$;

-- record_manual_payment rounds to the invoice currency's minor unit.
do $$
declare v text; v_pay uuid;
begin
  v := rt.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.record_manual_payment('00000000-0000-0000-0000-000000000091', 0.004, 'manual')::text$q$);
  perform rt.ok(v like 'ERR:%INVALID_AMOUNT%', 'record_manual_payment(0.004 CHF) rounds to 0 and is refused (' || v || ')');
  v := rt.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.record_manual_payment('00000000-0000-0000-0000-000000000091', 1.006, 'manual')->>'payment_id'$q$);
  perform rt.ok(v like 'OK:%', 'record_manual_payment(1.006) accepted');
  if v like 'OK:%' then
    v_pay := substr(v, 4)::uuid;
    perform rt.ok((select amount_chf from public.payments where id = v_pay) = 1.01, 'stored amount rounded to 1.01');
  end if;
end $$;

-- ===========================================================================
-- C. Uninvited signup belongs to no org and sees no tenant rows
-- ===========================================================================
do $$
declare
  u constant uuid := 'b0000000-0000-0000-0000-0000000000c1';
  r record; n bigint; leaks int := 0;
begin
  perform rt.ok((select org_id from public.profiles where id = u) is null,
                'uninvited signup has profiles.org_id = null');
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'org_id' and t.table_type = 'BASE TABLE'
       and has_table_privilege('authenticated', format('%I.%I', c.table_schema, c.table_name), 'select')
     order by 1
  loop
    begin
      perform rt.as_user(u);
      execute format('select count(*) from public.%I where org_id is not null and %s',
                     r.table_name,
                     case r.table_name when 'programs' then 'not coalesce(is_public, false)' else 'true' end)
        into n;
      perform rt.as_super();
    exception when others then
      perform rt.as_super();
      n := 0;
    end;
    if n > 0 then
      leaks := leaks + 1;
      perform rt.ok(false, 'uninvited signup reads ' || n || ' row(s) of ' || r.table_name);
    end if;
  end loop;
  perform rt.ok(leaks = 0, 'uninvited signup sees zero tenant rows in every org table');
  perform rt.as_user(u);
  select count(*) into n from public.organizations;
  perform rt.as_super();
  perform rt.ok(n = 0, 'uninvited signup reads no organizations row (payment settings, IBAN) (' || n || ')');
end $$;

-- ===========================================================================
-- D. Invitations cannot reference another org's family or coach
-- ===========================================================================
do $$
declare
  b constant uuid := 'b0000000-0000-0000-0000-0000000000b1';
  v text;
begin
  v := rt.run_as(b, $q$insert into public.invitations (org_id, email, role, family_id) values ('10000000-0000-0000-0000-000000000002', 'x1@probe.test', 'parent', '00000000-0000-0000-0000-000000000062') returning id::text$q$);
  perform rt.ok(v like 'ERR:%', 'invitation with org A family_id refused (' || left(v, 60) || ')');
  v := rt.run_as(b, $q$insert into public.invitations (org_id, email, role, coach_id) values ('10000000-0000-0000-0000-000000000002', 'x2@probe.test', 'coach', '00000000-0000-0000-0000-000000000012') returning id::text$q$);
  perform rt.ok(v like 'ERR:%', 'invitation with org A coach_id refused');
  v := rt.run_as(b, $q$insert into public.invitations (org_id, email, role, coach_id) values ('10000000-0000-0000-0000-000000000002', 'x3@probe.test', 'coach', 'b0000000-0000-0000-0000-0000000000d1') returning id::text$q$);
  perform rt.ok(v like 'OK:%', 'invitation with own coach_id accepted (' || left(v, 60) || ')');

  -- The invitee signs up: lands in org B, linked to org B's coach only.
  insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000c3', 'x3@probe.test');
  perform rt.ok((select org_id from public.profiles where id = 'b0000000-0000-0000-0000-0000000000c3') = '10000000-0000-0000-0000-000000000002',
                'invited signup lands in the inviting org');
  perform rt.ok((select profile_id from public.coaches where id = 'b0000000-0000-0000-0000-0000000000d1') = 'b0000000-0000-0000-0000-0000000000c3',
                'invited coach linked to own-org coach record');
  perform rt.ok((select profile_id from public.coaches where id = '00000000-0000-0000-0000-000000000012') is distinct from 'b0000000-0000-0000-0000-0000000000c3',
                'org A coach record untouched');
end $$;
