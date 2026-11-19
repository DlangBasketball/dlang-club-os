-- ============================================================================
-- Club administration (migration 20250420101500_club_admin.sql):
--   * migration re-applies cleanly (idempotent)
--   * membership: period maths, join (invoice -> pending -> paid -> active),
--     renewal dates, age rule, is_member(), expiry, member price hook,
--     RLS (guardian / finance / coach / other family) + cross-tenant denial
--   * waiting lists: no offer while full, offer chain on a freed spot,
--     decline -> next, expiry -> next, accept -> confirmed registration +
--     invoice, capacity re-check, camp week acceptance, reorder, guardian
--     join / RLS, service-only RPCs, cross-tenant denial
--   * J+S / AHV: checksum, admin-only storage + export, consent required,
--     finance / coach / parent / other club denied, audit holds no number
--   * staff compliance: coach adds own certificate (pending only), admin
--     verifies, missing kinds, youth-team block + admin override
--   * incident log privacy: admin / guardian / the athlete's coach read;
--     finance, other coaches, other families and other clubs denied;
--     audit redacts the description
--
-- Fixtures (seed): org A …0001 (admin …f1, finance …f2, coach …f3 = coach
-- record …011, parent …f4 = guardian of family …061 / athlete …071), family
-- …062 (athletes …072, …073, registered in programme …043 that coach …011
-- leads). Org B = …0002. Extra users are created here.
-- Every assertion prints PASS / FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\i supabase/migrations/20250420101500_club_admin.sql

create schema ca;
grant usage on schema ca to authenticated, anon;

create function ca.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function ca.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function ca.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- p_sql as user p: 'OK:<first column>' or 'ERR:<message>'.
create function ca.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform ca.as_user(p);
    execute p_sql into v_res;
    perform ca.as_super();
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform ca.as_super();
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;

-- p_sql as the service (superuser session, no end user): 'OK:…' / 'ERR:…'.
create function ca.svc(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform ca.as_super();
    execute p_sql into v_res;
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema ca to authenticated, anon;

create table ca.ctx (k text primary key, v text);
grant all on ca.ctx to authenticated, anon;
create function ca.get(p text) returns text language sql as $$ select v from ca.ctx where k = p $$;
grant execute on function ca.get(text) to authenticated, anon;

-- ---- extra users ----------------------------------------------------------
insert into auth.users (id, email) values
  ('c0000000-0000-0000-0000-0000000000a2', 'parent2@dlang.test'),
  ('c0000000-0000-0000-0000-0000000000c2', 'coach2@dlang.test'),
  ('c0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test')
on conflict do nothing;
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000c2');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-0000000000b1';
insert into public.family_members (family_id, profile_id, relation, is_primary)
values ('00000000-0000-0000-0000-000000000062', 'c0000000-0000-0000-0000-0000000000a2', 'father', true) on conflict do nothing;
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c2', 'coach'),
  ('10000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000b1', 'admin')
on conflict do nothing;
update public.coaches set profile_id = 'c0000000-0000-0000-0000-0000000000c2' where id = '00000000-0000-0000-0000-000000000012';

insert into ca.ctx values
  ('admin', '00000000-0000-0000-0000-0000000000f1'), ('finance', '00000000-0000-0000-0000-0000000000f2'),
  ('coach', '00000000-0000-0000-0000-0000000000f3'), ('parent', '00000000-0000-0000-0000-0000000000f4'),
  ('parent2', 'c0000000-0000-0000-0000-0000000000a2'), ('coach2', 'c0000000-0000-0000-0000-0000000000c2'),
  ('adminB', 'c0000000-0000-0000-0000-0000000000b1');

-- ===========================================================================
-- 1. Idempotency + period maths
-- ===========================================================================
do $$
begin
  perform ca.ok(to_regclass('public.memberships') is not null and to_regclass('public.waitlist_entries') is not null
            and to_regclass('public.incident_reports') is not null, 'migration re-applied cleanly (idempotent)');
  perform ca.ok((select period_start = '2026-08-01' and period_end = '2027-07-31' from public.membership_period('season', 8, '2026-11-18')),
                'season period (Aug start) containing 18 Nov 2026 = 1 Aug 2026 – 31 Jul 2027');
  perform ca.ok((select period_start = '2025-08-01' and period_end = '2026-07-31' from public.membership_period('season', 8, '2026-07-31')),
                'season period: 31 Jul belongs to the season that started the previous August');
  perform ca.ok((select period_start = '2026-01-01' and period_end = '2026-12-31' from public.membership_period('calendar_year', 8, '2026-11-18')),
                'calendar-year period = 1 Jan – 31 Dec');
end $$;

-- ===========================================================================
-- 2. Membership: types, join, payment, renewal, is_member, RLS
-- ===========================================================================
do $$
declare r text; v_res jsonb; v_m uuid; v_inv uuid; v_r2 jsonb;
begin
  r := ca.run_as(ca.get('admin')::uuid, $q$insert into public.membership_types (org_id, name, kind, scope, price, period, season_start_month, min_age, max_age)
       values ('00000000-0000-0000-0000-000000000001', 'Player membership', 'player', 'person', 120, 'season', 8, 5, 20) returning id$q$);
  perform ca.ok(r like 'OK:%', 'admin creates a membership type');
  insert into ca.ctx values ('type_player', substr(r, 4));
  r := ca.run_as(ca.get('admin')::uuid, $q$insert into public.membership_types (org_id, name, kind, scope, price, period)
       values ('00000000-0000-0000-0000-000000000001', 'Supporter', 'supporter', 'family', 0, 'calendar_year') returning id$q$);
  insert into ca.ctx values ('type_supporter', substr(r, 4));
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, $q$insert into public.membership_types (org_id, name, price) values ('00000000-0000-0000-0000-000000000001', 'x', 0) returning id$q$) like 'ERR:%',
                'a parent cannot create membership types');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, $q$insert into public.membership_types (org_id, name, price) values ('00000000-0000-0000-0000-000000000001', 'x', 0) returning id$q$) like 'ERR:%',
                'cross-tenant: another club''s admin cannot create a type in this club');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, 'select count(*) from public.membership_types') = 'OK:2',
                'parents of the club read the membership types');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.membership_types') = 'OK:0',
                'cross-tenant: another club sees no types');

  -- join (service): invoice issued, pending payment
  v_res := public.membership_create(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001',
             'type_id', ca.get('type_player'), 'family_id', '00000000-0000-0000-0000-000000000061',
             'athlete_id', '00000000-0000-0000-0000-000000000071', 'valid_from', '2026-09-01'));
  v_m := (v_res->>'membership_id')::uuid; v_inv := (v_res->>'invoice_id')::uuid;
  insert into ca.ctx values ('m1', v_m::text), ('m1_inv', v_inv::text);
  perform ca.ok((select status = 'pending_payment' and valid_from = '2026-09-01' and valid_until = '2027-07-31' and price_amount = 120
                   from public.memberships where id = v_m), 'join: pending payment, valid 1 Sep 2026 – 31 Jul 2027 (season end)');
  perform ca.ok((select total_chf = 120 and status::text = 'sent' and family_id = '00000000-0000-0000-0000-000000000061'
                   from public.invoices where id = v_inv) and (select count(*) = 1 from public.invoice_items where invoice_id = v_inv),
                'join: invoice with one line for the membership fee');
  perform ca.ok(not public.is_member('00000000-0000-0000-0000-000000000061', '2026-10-01'), 'is_member: not yet (unpaid)');
  update public.invoices set status = 'paid', paid_at = now() where id = v_inv;
  perform ca.ok((select status from public.memberships where id = v_m) = 'active', 'paid invoice -> membership active');
  perform ca.ok(public.is_member('00000000-0000-0000-0000-000000000061', '2026-10-01')
            and not public.is_member('00000000-0000-0000-0000-000000000061', '2027-08-01')
            and not public.is_member('00000000-0000-0000-0000-000000000062', '2026-10-01'),
                'is_member: inside validity only, and only for that family');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, $q$select public.is_member('00000000-0000-0000-0000-000000000061', '2026-10-01')$q$) = 'OK:false',
                'cross-tenant: is_member() answers false to another club');

  perform ca.ok(ca.svc(format($q$select public.membership_create('{"org_id":"00000000-0000-0000-0000-000000000001","type_id":"%s","family_id":"00000000-0000-0000-0000-000000000061","athlete_id":"00000000-0000-0000-0000-000000000071","valid_from":"2026-10-01"}')::text$q$, ca.get('type_player'))) like 'ERR:ALREADY_MEMBER%',
                'join twice for an overlapping period -> ALREADY_MEMBER');
  perform ca.ok(ca.svc(format($q$select public.membership_create('{"org_id":"00000000-0000-0000-0000-000000000001","type_id":"%s","family_id":"00000000-0000-0000-0000-000000000062"}')::text$q$, ca.get('type_player'))) like 'ERR:ATHLETE_REQUIRED%',
                'person membership without an athlete -> ATHLETE_REQUIRED');
  update public.membership_types set min_age = 12 where id = ca.get('type_player')::uuid;
  perform ca.ok(ca.svc(format($q$select public.membership_create('{"org_id":"00000000-0000-0000-0000-000000000001","type_id":"%s","family_id":"00000000-0000-0000-0000-000000000062","athlete_id":"00000000-0000-0000-0000-000000000073","valid_from":"2026-09-01"}')::text$q$, ca.get('type_player'))) like 'ERR:AGE_OUT_OF_RANGE%',
                'age rule: a 9-year-old cannot take a 12+ membership');
  update public.membership_types set min_age = 5 where id = ca.get('type_player')::uuid;
  perform ca.ok(ca.svc(format($q$select public.membership_create('{"org_id":"10000000-0000-0000-0000-000000000002","type_id":"%s","family_id":"00000000-0000-0000-0000-000000000061","athlete_id":"00000000-0000-0000-0000-000000000071"}')::text$q$, ca.get('type_player'))) like 'ERR:%',
                'cross-tenant: membership_create with another club''s org refuses this club''s type / family');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, $q$select public.membership_create('{}'::jsonb)::text$q$) like 'ERR:%',
                'membership_create is service only (admin API call refused)');

  -- renewal: starts the day after, next season
  v_r2 := public.membership_create(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'renew_from_id', v_m));
  perform ca.ok((v_r2->>'valid_from') = '2027-08-01' and (v_r2->>'valid_until') = '2028-07-31',
                'renewal: 1 Aug 2027 – 31 Jul 2028');
  perform ca.ok(ca.svc(format($q$select public.membership_create('{"org_id":"00000000-0000-0000-0000-000000000001","renew_from_id":"%s"}')::text$q$, v_m)) like 'ERR:ALREADY_RENEWED%',
                'renewal is one-click once (second renewal refused)');

  -- free supporter membership (family scope) is active at once
  v_res := public.membership_create(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001',
             'type_id', ca.get('type_supporter'), 'family_id', '00000000-0000-0000-0000-000000000062', 'valid_from', '2026-03-01'));
  perform ca.ok((select status = 'active' and invoice_id is null and athlete_id is null and valid_until = '2026-12-31'
                   from public.memberships where id = (v_res->>'membership_id')::uuid), 'free family membership: active, no invoice, calendar year');
  insert into ca.ctx values ('m_supporter', v_res->>'membership_id');

  -- RLS
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, 'select count(*) from public.memberships') = 'OK:2', 'guardian sees own family''s memberships only');
  perform ca.ok(ca.run_as(ca.get('parent2')::uuid, 'select count(*) from public.memberships') = 'OK:1', 'other family sees only its own membership');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, 'select count(*) from public.memberships') = 'OK:3', 'finance sees memberships (billing)');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, 'select count(*) from public.memberships') = 'OK:0', 'coach does not see memberships');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.memberships') = 'OK:0', 'cross-tenant: another club sees no memberships');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, format($q$update public.memberships set status = 'active' where id = '%s' returning id$q$, v_r2->>'membership_id')) = 'OK:<null>',
                'guardian cannot change a membership');

  -- expiry
  update public.memberships set valid_until = current_date - 1, valid_from = current_date - 30 where id = ca.get('m_supporter')::uuid;
  perform public.membership_expire_due('00000000-0000-0000-0000-000000000001');
  perform ca.ok((select status from public.memberships where id = ca.get('m_supporter')::uuid) = 'expired',
                'membership_expire_due: past validity -> expired');
end $$;

-- ===========================================================================
-- 3. Member price hook (camp registration)
-- ===========================================================================
do $$
declare v_prog uuid; v_ed uuid; v_opt uuid; v_grp uuid; v_inv uuid; v_reg uuid; v_inv2 uuid; v_reg2 uuid; v_res jsonb;
begin
  -- family …061 is a member today (fresh membership for the test window)
  update public.memberships set valid_from = current_date - 10, valid_until = current_date + 200, status = 'active'
   where id = ca.get('m1')::uuid;
  insert into public.programs (org_id, slug, name, kind, price_chf, status, is_public)
  values ('00000000-0000-0000-0000-000000000001', 'ca-test-camp', 'CA Test Camp', 'camp', 0, 'published', true) returning id into v_prog;
  insert into public.camp_editions (org_id, program_id, starts_on, ends_on, capacity, status)
  values ('00000000-0000-0000-0000-000000000001', v_prog, current_date + 20, current_date + 24, 1, 'published') returning id into v_ed;
  insert into public.camp_price_options (org_id, program_id, label, days_count, price, member_price)
  values ('00000000-0000-0000-0000-000000000001', v_prog, '5 days', 5, 300, 250) returning id into v_opt;
  insert into public.camp_age_groups (org_id, program_id, label, min_age, max_age)
  values ('00000000-0000-0000-0000-000000000001', v_prog, '5–17', 5, 17) returning id into v_grp;
  insert into ca.ctx values ('camp', v_prog::text), ('edition', v_ed::text), ('option', v_opt::text), ('group', v_grp::text);

  insert into public.invoices (org_id, number, family_id, program_id, status, currency, total_chf)
  values ('00000000-0000-0000-0000-000000000001', 'CA-T-1', '00000000-0000-0000-0000-000000000061', v_prog, 'sent', 'CHF', 300) returning id into v_inv;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values ('00000000-0000-0000-0000-000000000001', v_inv, 'Camp', 1, 300, 300);
  perform set_config('app.camp_pricing', 'on', true);
  insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id, camp_price_option_id, camp_age_group_id,
                                    invoice_id, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', v_prog, 'pending', v_ed, v_opt, v_grp,
          v_inv, 300, 0, 300, 'CHF', '{}') returning id into v_reg;
  perform set_config('app.camp_pricing', 'off', true);

  v_res := public.apply_member_price('camp_registration', v_reg, 'Member price');
  perform ca.ok((v_res->>'applied')::boolean and (v_res->>'amount')::numeric = 50, 'member price: 50 off for a member family');
  perform ca.ok((select total_chf from public.invoices where id = v_inv) = 250
            and (select price_amount = 250 and (price_snapshot->>'member_price_applied')::boolean from public.registrations where id = v_reg),
                'member price: invoice total 250, snapshot records it');
  v_res := public.apply_member_price('camp_registration', v_reg, 'Member price');
  perform ca.ok(not (v_res->>'applied')::boolean and (select total_chf from public.invoices where id = v_inv) = 250,
                'member price is applied once (idempotent)');

  -- non-member family pays the list price
  insert into public.invoices (org_id, number, family_id, program_id, status, currency, total_chf)
  values ('00000000-0000-0000-0000-000000000001', 'CA-T-2', '00000000-0000-0000-0000-000000000062', v_prog, 'sent', 'CHF', 300) returning id into v_inv2;
  perform set_config('app.camp_pricing', 'on', true);
  insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id, camp_price_option_id, camp_age_group_id,
                                    invoice_id, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', v_prog, 'cancelled', v_ed, v_opt, v_grp,
          v_inv2, 300, 0, 300, 'CHF', '{}') returning id into v_reg2;
  perform set_config('app.camp_pricing', 'off', true);
  v_res := public.apply_member_price('camp_registration', v_reg2, 'Member price');
  perform ca.ok(not (v_res->>'applied')::boolean and v_res->>'reason' = 'not_member', 'member price: non-member family pays the list price');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$select public.apply_member_price('camp_registration', '%s', null)::text$q$, v_reg)) like 'ERR:%',
                'apply_member_price is service only');
end $$;

-- ===========================================================================
-- 4. Waiting lists
-- ===========================================================================
do $$
declare v_prog uuid; v_e1 uuid; v_e2 uuid; v_offers jsonb; v_tok text; v_tok2 text; v_res jsonb; r text; v_e3 uuid;
begin
  insert into public.programs (org_id, slug, name, kind, price_chf, capacity, status)
  values ('00000000-0000-0000-0000-000000000001', 'ca-wl-team', 'CA Waitlist Team', 'recurring_team', 180, 1, 'published') returning id into v_prog;
  insert into ca.ctx values ('wl_prog', v_prog::text);
  insert into public.registrations (org_id, athlete_id, program_id, status)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', v_prog, 'confirmed');

  -- guardian joins for own child; cannot join for another family's child
  r := ca.run_as(ca.get('parent')::uuid, format($q$insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id)
        values ('00000000-0000-0000-0000-000000000001', 'program', '%s', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061') returning id$q$, v_prog));
  perform ca.ok(r like 'OK:%', 'guardian joins the waiting list for their child');
  v_e1 := substr(r, 4)::uuid;
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, format($q$insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id)
        values ('00000000-0000-0000-0000-000000000001', 'program', '%s', '00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000062') returning id$q$, v_prog)) like 'ERR:%',
                'guardian cannot put another family''s child on a waiting list');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, format($q$insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id, status, offer_token_hash, offer_expires_at)
        values ('00000000-0000-0000-0000-000000000001', 'program', '%s', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061', 'offered', 'x', now() + interval '1 day') returning id$q$, v_prog)) like 'ERR:%',
                'guardian cannot insert an offered entry');
  r := ca.run_as(ca.get('admin')::uuid, format($q$insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id)
        values ('00000000-0000-0000-0000-000000000001', 'program', '%s', '00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000062') returning id$q$, v_prog));
  v_e2 := substr(r, 4)::uuid;
  perform ca.ok((select position from public.waitlist_entries where id = v_e1) = 1 and (select position from public.waitlist_entries where id = v_e2) = 2,
                'entries are appended in order (positions 1, 2)');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, format($q$insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id)
        values ('00000000-0000-0000-0000-000000000001', 'program', '%s', '00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000062') returning id$q$, v_prog)) like 'ERR:%',
                'cross-tenant: another club''s admin cannot add to this club''s list');

  -- full: no offer
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null);
  perform ca.ok(jsonb_array_length(v_offers) = 0, 'list full: no offer is made');

  -- reorder: second to first, then back
  r := ca.run_as(ca.get('admin')::uuid, format($q$select public.waitlist_move('%s', 1)::text$q$, v_e2));
  perform ca.ok(r like 'OK:%' and (select position from public.waitlist_entries where id = v_e2) = 1
            and (select position from public.waitlist_entries where id = v_e1) = 2,
                'admin reorders the list (move to first)');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, format($q$select public.waitlist_move('%s', 1)::text$q$, v_e1)) like 'ERR:%',
                'a parent cannot reorder the list');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, format($q$select public.waitlist_move('%s', 1)::text$q$, v_e1)) like 'ERR:%',
                'cross-tenant: another club cannot reorder this list');
  update public.waitlist_entries set position = 1 where id = v_e1;
  update public.waitlist_entries set position = 2 where id = v_e2;

  -- a spot frees up: offer to #1 only
  update public.registrations set status = 'cancelled' where program_id = v_prog and athlete_id = '00000000-0000-0000-0000-000000000072';
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null);
  perform ca.ok(jsonb_array_length(v_offers) = 1 and (v_offers->0->>'entry_id')::uuid = v_e1, 'freed spot: offered to the first in line only');
  v_tok := v_offers->0->>'token';
  perform ca.ok((select status = 'offered' and offer_expires_at between now() + interval '47 hours' and now() + interval '49 hours'
                       and offer_token_hash <> v_tok from public.waitlist_entries where id = v_e1),
                'offer: 48 h acceptance window; only the token hash is stored');
  perform ca.ok(jsonb_array_length(public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null)) = 0,
                'an open offer holds the spot (no second offer)');
  perform ca.ok((public.waitlist_offer_lookup(v_tok)->>'child_first_name') = 'Mateo'
            and not ((public.waitlist_offer_lookup(v_tok)) ? 'child_last_name'),
                'offer lookup by token shows the child''s first name only');

  -- decline -> next in line
  v_res := public.waitlist_respond(v_tok, false);
  perform ca.ok(v_res->>'status' = 'declined', 'decline recorded');
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', v_res->>'target_key', null);
  perform ca.ok(jsonb_array_length(v_offers) = 1 and (v_offers->0->>'entry_id')::uuid = v_e2, 'after a decline the next person gets the offer');
  v_tok2 := v_offers->0->>'token';

  -- expiry -> next (nobody left)
  update public.waitlist_entries set offer_expires_at = now() - interval '1 minute' where id = v_e2;
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null);
  perform ca.ok((select status from public.waitlist_entries where id = v_e2) = 'expired' and jsonb_array_length(v_offers) = 0,
                'expired offer: entry expired, nobody left to offer');
  perform ca.ok(ca.svc(format($q$select public.waitlist_respond('%s', true)::text$q$, v_tok2)) like 'ERR:OFFER_NOT_OPEN%',
                'an expired offer cannot be accepted');

  -- re-join and accept -> confirmed registration + invoice
  insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id)
  values ('00000000-0000-0000-0000-000000000001', 'program', v_prog, '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061')
  returning id into v_e3;
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null);
  v_tok := v_offers->0->>'token';
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, format($q$select public.waitlist_respond('%s', true)::text$q$, v_tok)) like 'ERR:%',
                'waitlist_respond is service only (no direct API call)');
  v_res := public.waitlist_respond(v_tok, true);
  perform ca.ok(v_res->>'status' = 'accepted'
            and (select status::text from public.registrations where id = (v_res->>'registration_id')::uuid) = 'confirmed'
            and (select total_chf from public.invoices where id = (v_res->>'invoice_id')::uuid) = 180,
                'accept: registration confirmed + invoice for the programme price');
  perform ca.ok(ca.svc(format($q$select public.waitlist_respond('%s', true)::text$q$, v_tok)) like 'ERR:OFFER_NOT_OPEN%',
                'an offer is accepted once');

  -- capacity re-check on accept
  update public.programs set capacity = 2 where id = v_prog;
  insert into public.waitlist_entries (org_id, target_kind, program_id, athlete_id, family_id)
  values ('00000000-0000-0000-0000-000000000001', 'program', v_prog, '00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000062');
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null);
  v_tok := v_offers->0->>'token';
  update public.registrations set status = 'confirmed' where program_id = v_prog and athlete_id = '00000000-0000-0000-0000-000000000072';
  perform ca.ok(ca.svc(format($q$select public.waitlist_respond('%s', true)::text$q$, v_tok)) like 'ERR:NO_SPOT_LEFT%',
                'accept re-checks capacity (spot taken meanwhile -> NO_SPOT_LEFT)');

  -- RLS on entries
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, 'select count(*) from public.waitlist_entries') = 'OK:2', 'guardian sees own child''s entries only');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, format($q$update public.waitlist_entries set position = 0 where id = '%s' returning id$q$, v_e3)) = 'OK:<null>',
                'guardian cannot edit an entry');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, 'select count(*) from public.waitlist_entries') = 'OK:0', 'finance does not see waiting lists');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.waitlist_entries') = 'OK:0', 'cross-tenant: another club sees no entries');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, 'select count(*) from public.waitlist_entries') = 'OK:4', 'admin sees the whole list');
end $$;

-- Camp week waiting list: accept creates a priced camp registration.
do $$
declare v_e uuid; v_offers jsonb; v_res jsonb;
begin
  -- the edition (capacity 1) is taken by the member registration from §3
  insert into public.waitlist_entries (org_id, target_kind, camp_edition_id, athlete_id, family_id, request)
  values ('00000000-0000-0000-0000-000000000001', 'camp_edition', ca.get('edition')::uuid, '00000000-0000-0000-0000-000000000073',
          '00000000-0000-0000-0000-000000000062', jsonb_build_object('price_option_id', ca.get('option'), 'age_group_id', ca.get('group')))
  returning id into v_e;
  perform ca.ok((select program_id::text from public.waitlist_entries where id = v_e) = ca.get('camp'), 'camp week entry: programme filled from the edition');
  perform ca.ok(jsonb_array_length(public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null)) = 0, 'camp week full: no offer');
  update public.camp_editions set capacity = 2 where id = ca.get('edition')::uuid;
  v_offers := public.waitlist_process('00000000-0000-0000-0000-000000000001', null, null);
  perform ca.ok(jsonb_array_length(v_offers) = 1, 'capacity increase: the next person gets an offer');
  v_res := public.waitlist_respond(v_offers->0->>'token', true);
  perform ca.ok((select status::text = 'confirmed' and camp_edition_id::text = ca.get('edition') and price_amount = 300
                        and array_length(camp_days, 1) = 5 and price_snapshot->>'source' = 'waitlist'
                   from public.registrations where id = (v_res->>'registration_id')::uuid),
                'camp week accept: confirmed registration with price snapshot and 5 days');
end $$;

-- ===========================================================================
-- 5. J+S: AHV number (admin only, encrypted, consent required)
-- ===========================================================================
do $$
declare r text;
begin
  perform ca.ok(public.ahv_is_valid('756.1234.5678.97') and not public.ahv_is_valid('756.1234.5678.98')
            and not public.ahv_is_valid('757.1234.5678.97') and not public.ahv_is_valid('756.1234'),
                'AHV checksum: valid 756.1234.5678.97, wrong check digit / prefix / length rejected');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, $q$select public.set_athlete_ahv('00000000-0000-0000-0000-000000000072', '756.1234.5678.97', '')::text$q$) like 'ERR:CONSENT_REQUIRED%',
                'AHV needs a recorded consent');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, $q$select public.set_athlete_ahv('00000000-0000-0000-0000-000000000072', '756.1234.5678.98', 'Signed J+S form')::text$q$) like 'ERR:AHV_INVALID%',
                'invalid AHV refused');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, $q$select public.set_athlete_ahv('00000000-0000-0000-0000-000000000072', '756.1234.5678.97', 'Signed J+S form 2026')::text$q$) like 'OK:%',
                'admin stores an AHV number with consent');
  perform ca.ok((select ahv_last4 = '7897' and position('7561234567897' in encode(ahv_cipher, 'escape')) = 0
                   from public.athlete_identifiers where athlete_id = '00000000-0000-0000-0000-000000000072'),
                'AHV stored encrypted (only the last 4 digits in clear)');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, 'select count(*) from public.athlete_identifiers') = 'OK:1', 'admin sees the identifier row');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, 'select count(*) from public.athlete_identifiers') = 'OK:0', 'finance cannot read AHV rows');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, 'select count(*) from public.athlete_identifiers') = 'OK:0', 'coach cannot read AHV rows');
  perform ca.ok(ca.run_as(ca.get('parent2')::uuid, 'select count(*) from public.athlete_identifiers') = 'OK:0', 'even the guardian cannot read the AHV row');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.athlete_identifiers') = 'OK:0', 'cross-tenant: another club sees no AHV rows');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, $q$select ahv from public.js_ahv_numbers(array['00000000-0000-0000-0000-000000000072']::uuid[])$q$) = 'OK:756.1234.5678.97',
                'admin export decrypts the AHV number (formatted)');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, $q$select ahv from public.js_ahv_numbers(array['00000000-0000-0000-0000-000000000072']::uuid[])$q$) like 'ERR:NOT_AUTHORIZED%',
                'finance cannot export AHV numbers');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, $q$select ahv from public.js_ahv_numbers(array['00000000-0000-0000-0000-000000000072']::uuid[])$q$) like 'ERR:NOT_AUTHORIZED%',
                'coach cannot export AHV numbers');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, $q$select public.set_athlete_ahv('00000000-0000-0000-0000-000000000072', '756.1234.5678.97', 'x')::text$q$) like 'ERR:NOT_AUTHORIZED%',
                'cross-tenant: another club cannot set this club''s athlete AHV');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, $q$select count(*) from public.js_ahv_numbers(array['00000000-0000-0000-0000-000000000072']::uuid[])$q$) = 'OK:0',
                'cross-tenant: another club''s export returns nothing');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, $q$insert into public.athlete_identifiers (org_id, athlete_id) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073') returning id$q$) like 'ERR:%',
                'no direct insert of identifiers (RPC only)');
  perform ca.ok(not exists (select 1 from public.audit_logs where (coalesce(old_data::text, '') || coalesce(new_data::text, '')) like '%7561234567897%'
                                                         or (coalesce(old_data::text, '') || coalesce(new_data::text, '')) like '%756.1234.5678.97%'),
                'audit logs never hold the AHV number');
  perform ca.ok(exists (select 1 from public.audit_logs where action = 'athlete.ahv.export'), 'AHV export is audit-logged');
end $$;

-- ===========================================================================
-- 6. Staff compliance
-- ===========================================================================
do $$
declare r text; v_team uuid; k text;
begin
  r := ca.run_as(ca.get('coach')::uuid, $q$insert into public.staff_certificates (org_id, coach_id, kind, title, valid_until)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'first_aid', 'First aid', current_date + 20) returning id$q$);
  perform ca.ok(r like 'OK:%', 'coach adds their own certificate (pending)');
  insert into ca.ctx values ('cert1', substr(r, 4));
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, $q$insert into public.staff_certificates (org_id, coach_id, kind, status, verified_at)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', 'child_protection', 'verified', now()) returning id$q$) like 'ERR:%',
                'coach cannot self-verify');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, $q$insert into public.staff_certificates (org_id, coach_id, kind)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000012', 'first_aid') returning id$q$) like 'ERR:%',
                'coach cannot add a certificate for another coach');
  perform ca.ok(ca.run_as(ca.get('coach2')::uuid, 'select count(*) from public.staff_certificates') = 'OK:0', 'another coach does not see the certificate');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, 'select count(*) from public.staff_certificates') = 'OK:0', 'finance does not see certificates');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.staff_certificates') = 'OK:0', 'cross-tenant: another club sees no certificates');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$update public.staff_certificates set status = 'verified', verified_at = now(), verified_by = '%s' where id = '%s' returning status$q$, ca.get('admin'), ca.get('cert1'))) = 'OK:verified',
                'admin verifies the certificate');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, format($q$update public.staff_certificates set valid_until = current_date + 900 where id = '%s' returning id$q$, ca.get('cert1'))) like 'ERR:%',
                'coach cannot change a verified certificate');
  perform ca.ok(public.coach_compliance_missing('00000000-0000-0000-0000-000000000011', null) = array['criminal_record_youth', 'child_protection']
            and public.coach_compliance_missing('00000000-0000-0000-0000-000000000011', current_date + 30) = array['criminal_record_youth', 'child_protection', 'first_aid'],
                'missing kinds today; first aid counts as missing once expired');

  -- youth block
  insert into public.teams (org_id, name, is_youth) values ('00000000-0000-0000-0000-000000000001', 'CA U12', true) returning id into v_team;
  insert into ca.ctx values ('team', v_team::text);
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$insert into public.team_coaches (team_id, coach_id, org_id) values ('%s', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001') returning role$q$, v_team)) like 'OK:%',
                'block off (default): assignment allowed');
  delete from public.team_coaches where team_id = v_team;
  insert into public.club_admin_settings (org_id, compliance_block_youth) values ('00000000-0000-0000-0000-000000000001', true)
  on conflict (org_id) do update set compliance_block_youth = true;
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$insert into public.team_coaches (team_id, coach_id, org_id) values ('%s', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001') returning role$q$, v_team)) like 'ERR:COACH_COMPLIANCE_MISSING%',
                'block on: a coach without mandatory checks cannot be assigned to a youth team');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, format($q$select public.assign_coach_with_override('%s', '00000000-0000-0000-0000-000000000012', 'assistant', 'Course booked next week')::text$q$, v_team)) like 'ERR:%',
                'a coach cannot override');
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$select public.assign_coach_with_override('%s', '00000000-0000-0000-0000-000000000012', 'assistant', 'x')::text$q$, v_team)) like 'ERR:REASON_REQUIRED%',
                'override needs a reason');
  r := ca.run_as(ca.get('admin')::uuid, format($q$select public.assign_coach_with_override('%s', '00000000-0000-0000-0000-000000000012', 'assistant', 'Course booked next week')::text$q$, v_team));
  perform ca.ok(r like 'OK:%'
            and exists (select 1 from public.team_coaches where team_id = v_team and coach_id = '00000000-0000-0000-0000-000000000012')
            and (select missing = array['criminal_record_youth', 'child_protection', 'first_aid'] from public.coach_assignment_overrides where team_id = v_team),
                'admin override assigns the coach and records the reason and what was missing');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, format($q$select public.assign_coach_with_override('%s', '00000000-0000-0000-0000-000000000012', 'assistant', 'Course booked next week')::text$q$, v_team)) like 'ERR:%',
                'cross-tenant: another club cannot override');
  -- compliant coach passes
  foreach k in array array['criminal_record_youth', 'child_protection'] loop
    insert into public.staff_certificates (org_id, coach_id, kind, status, verified_at, valid_until)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011', k, 'verified', now(), current_date + 365);
  end loop;
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$insert into public.team_coaches (team_id, coach_id, org_id) values ('%s', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001') returning role$q$, v_team)) like 'OK:%',
                'block on: a compliant coach is assigned normally');
  update public.teams set is_youth = false where id = v_team;
  delete from public.team_coaches where team_id = v_team and coach_id = '00000000-0000-0000-0000-000000000012';
  delete from public.coach_assignment_overrides where team_id = v_team;
  perform ca.ok(ca.run_as(ca.get('admin')::uuid, format($q$insert into public.team_coaches (team_id, coach_id, org_id) values ('%s', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001') returning role$q$, v_team)) like 'OK:%',
                'adult team: no block');
end $$;

-- ===========================================================================
-- 7. Incident log privacy
-- ===========================================================================
do $$
declare r text; v_inc uuid;
begin
  r := ca.run_as(ca.get('admin')::uuid, $q$insert into public.incident_reports (org_id, athlete_id, occurred_at, description, body_part, severity, reported_by)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', now(), 'Twisted ankle on landing', 'ankle', 'moderate', '00000000-0000-0000-0000-0000000000f1') returning id$q$);
  perform ca.ok(r like 'OK:%', 'admin reports an incident');
  v_inc := substr(r, 4)::uuid;
  insert into ca.ctx values ('inc', v_inc::text);
  r := ca.run_as(ca.get('coach')::uuid, $q$insert into public.incident_reports (org_id, athlete_id, occurred_at, description, reported_by)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', now(), 'Bumped head, no symptoms', '00000000-0000-0000-0000-0000000000f3') returning id$q$);
  perform ca.ok(r like 'OK:%', 'the athlete''s coach reports an incident from the coach app');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, $q$insert into public.incident_reports (org_id, athlete_id, occurred_at, description, reported_by)
        values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', now(), 'Not my athlete', '00000000-0000-0000-0000-0000000000f3') returning id$q$) like 'ERR:%',
                'a coach cannot report for an athlete they do not coach');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, 'select count(*) from public.incident_reports') = 'OK:2', 'the athlete''s coach reads both reports');
  perform ca.ok(ca.run_as(ca.get('parent2')::uuid, 'select count(*) from public.incident_reports') = 'OK:2', 'the guardian reads their children''s reports');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, 'select count(*) from public.incident_reports') = 'OK:0', 'another family is denied');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, 'select count(*) from public.incident_reports') = 'OK:0', 'finance is denied');
  perform ca.ok(ca.run_as(ca.get('coach2')::uuid, 'select count(*) from public.incident_reports') = 'OK:0', 'another coach (not coaching the athlete) is denied');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.incident_reports') = 'OK:0', 'cross-tenant: another club is denied');
  perform ca.ok(ca.run_as(ca.get('parent2')::uuid, format($q$update public.incident_reports set severity = 'minor' where id = '%s' returning id$q$, v_inc)) = 'OK:<null>',
                'a guardian cannot edit a report');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, format($q$update public.incident_reports set return_status = 'modified' where id = '%s' returning return_status$q$, v_inc)) = 'OK:modified',
                'the athlete''s coach updates follow-up / return to play while open');
  perform ca.ok(ca.run_as(ca.get('coach')::uuid, format($q$delete from public.incident_reports where id = '%s' returning id$q$, v_inc)) = 'OK:<null>',
                'a coach cannot delete a report');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, format($q$update public.incident_reports set status = 'closed' where id = '%s' returning id$q$, v_inc)) = 'OK:<null>',
                'finance cannot edit a report');
  perform ca.ok(not exists (select 1 from public.audit_logs where target_table = 'incident_reports'
                                                         and coalesce(new_data::text, '') || coalesce(old_data::text, '') like '%Twisted ankle%')
            and exists (select 1 from public.audit_logs where target_table = 'incident_reports' and target_id = v_inc),
                'incident changes are audited without the description');
end $$;

-- ===========================================================================
-- 8. Settings RLS
-- ===========================================================================
do $$
begin
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, 'select count(*) from public.club_admin_settings') = 'OK:1', 'finance reads club admin settings');
  perform ca.ok(ca.run_as(ca.get('finance')::uuid, $q$update public.club_admin_settings set waitlist_offer_hours = 2 returning org_id$q$) = 'OK:<null>',
                'finance cannot change settings');
  perform ca.ok(ca.run_as(ca.get('parent')::uuid, 'select count(*) from public.club_admin_settings') = 'OK:0', 'parents cannot read settings');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, 'select count(*) from public.club_admin_settings') = 'OK:0', 'cross-tenant: another club cannot read settings');
  perform ca.ok(ca.run_as(ca.get('adminB')::uuid, $q$insert into public.club_admin_settings (org_id) values ('00000000-0000-0000-0000-000000000001') returning org_id$q$) like 'ERR:%',
                'cross-tenant: another club cannot write settings');
end $$;
