-- ============================================================================
-- Billing foundation suite (migration 20250420103500_billing_foundation.sql)
--
--   A. Migration rules: invoice classification, issuing entity on every
--      invoice, imported club fees -> season memberships, review flags,
--      idempotent re-run.
--   B. Activities at runtime: insert trigger, link triggers (booking), lock
--      after issue, admin reclassification, split inherits the parent.
--   C. Billing entities: default per org, routing per activity, snapshot
--      locked after issue, roles (admin manages, finance reads), cross-tenant.
--   D. Club season settings + exact instalment schedule (shared fixtures with
--      tests/unit/membership-schedule.test.ts).
--   E. Season memberships: preview (shares, rounding), issue (one invoice +
--      plan per payer), idempotent replay, one per athlete and season, payer
--      visibility, carry-forward, team assignment never bills.
--   F. Credits scoped to an activity; family_balance_by_activity.
--   G. Receipts: one transfer over several invoices, unallocated remainder,
--      idempotent replay, limits, reversal, bank entry link, roles.
--   H. Manual invoice idempotency; invoice_source; review flags; seasons.
--   I. Revenue categories + invoice numbering: per-category prefix series,
--      draft -> final number at issue, sequence per prefix/year, two
--      concurrent issues (dblink) get distinct numbers, retry returns the same
--      number, number/category locked after issue, inheritance (split,
--      instalments, credit note), mixed categories refused, category
--      required on manual invoices, link-time category + number in the
--      creation transaction, totals by category, other-org isolation.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4 of family …061 / athlete …071; family …062 = athletes …072,
-- …073). Org B …0002 (seed_tenants.sql). SYNTHETIC DATA ONLY.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;
\set sched_fx `cat tests/unit/fixtures/club-installment-schedule.json`

create schema bf;
grant usage on schema bf to authenticated, anon, service_role;
create table bf.ctx (k text primary key, v text);
grant all on bf.ctx to authenticated, anon, service_role;
create table bf.fx (doc jsonb);
grant all on bf.fx to authenticated, anon, service_role;
insert into bf.fx values (:'sched_fx'::jsonb);

create function bf.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function bf.put(p_k text, p_v text) returns void language sql as $$
  insert into bf.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function bf.get(p_k text) returns text language sql stable as $$ select v from bf.ctx where k = p_k $$;
create function bf.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from bf.ctx where k = p_k $$;
create function bf.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql into v_res;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema bf to authenticated, anon, service_role;

-- Fixtures ---------------------------------------------------------------------
-- Org A: a second guardian of family …061, two extra athletes, a current
-- season 2026-27 and the next one, a selection programme and a team pair.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005e1', 'bf-guardian2@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Guardian Two'
 where id = '00000000-0000-0000-0000-0000000005e1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005e1', 'parent');
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000005e1', 'guardian');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-000000000574', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Synthetic', 'Mixed', '2014-01-01', 'active'),
  ('00000000-0000-0000-0000-000000000575', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Synthetic', 'Odd', '2013-01-01', 'active');
update public.seasons set is_current = false where org_id = '00000000-0000-0000-0000-000000000001';
insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000001', 'Synthetic season 2026-27', '2026-08-01', '2027-07-31', true),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-000000000001', 'Synthetic season 2027-28', '2027-08-01', '2028-07-31', false);
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled)
values ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-000000000001', 'bf-eybl', 'Synthetic EYBL', 'selection', 0, false, true, 'published', true);
insert into public.teams (id, org_id, name, sport) values
  ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000000001', 'Synthetic U14 National', 'basketball'),
  ('00000000-0000-0000-0000-0000000005c2', '00000000-0000-0000-0000-000000000001', 'Synthetic U16 Regional', 'basketball');

-- Org B: admin, finance, a family with an athlete and an invoice.
insert into auth.users (id, email) values
  ('b0000000-0000-0000-0000-0000000005f1', 'bf-admin-b@example.test'),
  ('b0000000-0000-0000-0000-0000000005f2', 'bf-finance-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id in ('b0000000-0000-0000-0000-0000000005f1', 'b0000000-0000-0000-0000-0000000005f2');
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000005f1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000005f2', 'finance');
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000005f3', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('b0000000-0000-0000-0000-0000000005f4', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000005f3', 'Synthetic', 'Bplayer', '2014-05-05', 'active');
insert into public.seasons (id, org_id, name, starts_on, ends_on, is_current) values
  ('b0000000-0000-0000-0000-0000000005f5', '10000000-0000-0000-0000-000000000002', 'B season', '2026-08-01', '2027-07-31', false);
insert into public.invoices (id, org_id, number, family_id, athlete_id, description, total_chf, status, due_date)
values ('b0000000-0000-0000-0000-0000000005f6', '10000000-0000-0000-0000-000000000002', 'BF-B-001', 'b0000000-0000-0000-0000-0000000005f3',
        'b0000000-0000-0000-0000-0000000005f4', 'Synthetic B invoice', 100, 'sent', current_date + 30);

-- ===========================================================================
-- A. Migration rules
-- ===========================================================================
do $$
begin
  perform bf.ok(not exists (select 1 from public.invoices where activity is null or activity_source is null),
                'every invoice has an activity and a classification source');
  perform bf.ok((select activity = 'camp' and activity_source = 'migration_rule' from public.invoices where id = '00000000-0000-0000-0000-000000000091'),
                'seed camp invoice classified camp by rule');
  perform bf.ok((select activity = 'other' and activity_source = 'migration_default' from public.invoices where id = '00000000-0000-0000-0000-000000000093'),
                'seed team invoice (no rule) defaults to other, marked migration_default');
  perform bf.ok(not exists (select 1 from public.invoices i where i.billing_entity_id is null
                              and exists (select 1 from public.billing_entities e where e.org_id = i.org_id)),
                'every invoice of an org with an entity has an issuing entity');
  perform bf.ok((select billing_entity_source = 'migration_default' and billing_entity_snapshot->>'name' is not null
                   from public.invoices where id = '00000000-0000-0000-0000-000000000091'),
                'existing invoices get the default entity (migration_default) with a snapshot');
  perform bf.ok((select count(*) = 1 from public.billing_entities where org_id = '00000000-0000-0000-0000-000000000001' and is_default),
                'org A has exactly one default billing entity');
  perform bf.ok((select count(*) = 1 from public.billing_entities where org_id = '10000000-0000-0000-0000-000000000002' and is_default),
                'org B (created after the migration) got its default entity automatically');
  perform bf.ok((select activity = 'other' and billing_entity_id = (select id from public.billing_entities
                   where org_id = '10000000-0000-0000-0000-000000000002' and is_default) from public.invoices where id = 'b0000000-0000-0000-0000-0000000005f6'),
                'org B invoice: default activity and org B''s own default entity');
end $$;

-- Rule classifier on linked records (booking / package / shop / selection).
do $$
declare v_inv uuid; v_bk uuid;
begin
  insert into public.invoices (org_id, number, family_id, athlete_id, description, total_chf, status, due_date)
  values ('00000000-0000-0000-0000-000000000001', 'BF-CL-1', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071',
          'Synthetic session', 75, 'sent', current_date + 10) returning id into v_inv;
  perform bf.ok((select activity = 'other' and activity_source = 'default' from public.invoices where id = v_inv),
                'new invoice without any link: other (default)');
  insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, invoice_id)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000021',
          '00000000-0000-0000-0000-000000000011', now() + interval '20 days', now() + interval '20 days 1 hour', 'booked', 75, v_inv)
  returning id into v_bk;
  perform bf.ok((select activity = 'training' and activity_source = 'linked' from public.invoices where id = v_inv),
                'linking a paid training booking classifies its invoice as training (linked)');
  perform bf.ok(public.billing_classify_invoice(v_inv) = 'training', 'migration rule classifier: paid booking -> training');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = v_inv and reason_code = 'CATEGORY_AMBIGUOUS' and resolved_at is not null),
                'the review flag of the unclassified invoice is resolved by the link');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000093'
                         and reason_code = 'CATEGORY_AMBIGUOUS' and resolved_at is null and original_reference = 'INV-2026-0182'),
                'legacy invoice without a reliable category is flagged with its original number');
  perform bf.ok(public.billing_classify_invoice('00000000-0000-0000-0000-000000000091') = 'camp', 'migration rule classifier: camp');
  perform bf.ok(public.billing_classify_invoice('00000000-0000-0000-0000-000000000093') is null, 'migration rule classifier: no rule -> null');
  perform bf.put('booking_invoice', v_inv::text);
  perform bf.put('booking', v_bk::text);
end $$;

-- Imported club fees (synthetic copies of the founder's import pattern).
do $$
declare r jsonb;
begin
  insert into public.invoices (id, org_id, number, family_id, athlete_id, description, total_chf, status, due_date, cancel_reason, cancelled_at)
  values
    -- 071: received (paid) + balance (sent) -> membership 1500, linked
    ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000001', 'BF-IMP-01', '00000000-0000-0000-0000-000000000061',
     '00000000-0000-0000-0000-000000000071', 'Membership fee 2026-27 – payments received (imported 2026-06-30)', 300, 'paid', '2026-06-30', null, null),
    ('00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000001', 'BF-IMP-02', '00000000-0000-0000-0000-000000000061',
     '00000000-0000-0000-0000-000000000071', 'Membership fee 2026-27 (U14 National) – balance', 1200, 'sent', current_date + 60, null, null),
    -- 072: received + balance cancelled for sponsorship -> membership 200, sponsored
    ('00000000-0000-0000-0000-000000000503', '00000000-0000-0000-0000-000000000001', 'BF-IMP-03', '00000000-0000-0000-0000-000000000062',
     '00000000-0000-0000-0000-000000000072', 'Membership fee 2026-27 – payments received (imported 2026-06-30)', 200, 'paid', '2026-06-30', null, null),
    ('00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000001', 'BF-IMP-04', '00000000-0000-0000-0000-000000000062',
     '00000000-0000-0000-0000-000000000072', 'Membership fee 2026-27 (U16 Regional) – balance – cancelled: sponsored', 1300, 'cancelled', current_date + 60, 'sponsored', now()),
    -- 073: two season patterns -> flagged
    ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000001', 'BF-IMP-05', '00000000-0000-0000-0000-000000000062',
     '00000000-0000-0000-0000-000000000073', 'Membership fee 2025-26 – balance', 400, 'sent', current_date + 60, null, null),
    ('00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000001', 'BF-IMP-06', '00000000-0000-0000-0000-000000000062',
     '00000000-0000-0000-0000-000000000073', 'Membership fee 2026-27 – balance', 900, 'sent', current_date + 60, null, null),
    -- 574: invoices in two families -> flagged
    ('00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000001', 'BF-IMP-07', '00000000-0000-0000-0000-000000000061',
     '00000000-0000-0000-0000-000000000574', 'Membership fee 2026-27 – payments received (imported)', 100, 'paid', '2026-06-30', null, null),
    ('00000000-0000-0000-0000-000000000508', '00000000-0000-0000-0000-000000000001', 'BF-IMP-08', '00000000-0000-0000-0000-000000000062',
     '00000000-0000-0000-0000-000000000574', 'Membership fee 2026-27 – balance', 900, 'sent', current_date + 60, null, null),
    -- 575: unknown fee pattern -> flagged
    ('00000000-0000-0000-0000-000000000509', '00000000-0000-0000-0000-000000000001', 'BF-IMP-09', '00000000-0000-0000-0000-000000000062',
     '00000000-0000-0000-0000-000000000575', 'Membership fee 2026-27 – special arrangement', 700, 'sent', current_date + 60, null, null),
    -- no athlete -> flagged
    ('00000000-0000-0000-0000-000000000510', '00000000-0000-0000-0000-000000000001', 'BF-IMP-10', '00000000-0000-0000-0000-000000000062',
     null, 'Membership fee 2026-27 – balance', 500, 'sent', current_date + 60, null, null);
  perform bf.ok((select count(*) = 10 from public.invoices where id::text like '00000000-0000-0000-0000-0000000005%'
                  and number like 'BF-IMP-%' and activity = 'club_membership'),
                'imported club-fee descriptions without a programme are club_membership');

  r := public.billing_migrate_club_fees('00000000-0000-0000-0000-000000000001');
  perform bf.ok((r->>'memberships')::int = 2 and (r->>'athletes_flagged')::int = 3, 'club-fee migration: 2 memberships, 3 athletes flagged (' || r::text || ')');
  perform bf.ok((select agreed_fee = 1500 and not sponsored and kind = 'season_fee' and source = 'migration'
                       and season_id = '00000000-0000-0000-0000-0000000005a1' and valid_from = '2026-08-01' and valid_until = '2027-07-31'
                   from public.memberships where athlete_id = '00000000-0000-0000-0000-000000000071' and kind = 'season_fee'),
                'athlete 071: one season membership, agreed fee 1500 (received 300 + balance 1200)');
  perform bf.ok((select count(*) = 2 from public.invoices i join public.memberships m on m.id = i.membership_id
                  where m.athlete_id = '00000000-0000-0000-0000-000000000071' and i.charge_kind = 'season_fee'),
                'both 071 invoices linked to the membership (season_fee)');
  perform bf.ok((select status::text = 'paid' and total_chf = 300 from public.invoices where id = '00000000-0000-0000-0000-000000000501')
                and (select status::text = 'sent' and total_chf = 1200 from public.invoices where id = '00000000-0000-0000-0000-000000000502'),
                'imported invoices unchanged (status and amount)');
  perform bf.ok((select mp.payer_kind = 'family' and mp.share_kind = 'fixed' and mp.amount = 1500 and mp.family_id = '00000000-0000-0000-0000-000000000061'
                        and mp.invoice_id = '00000000-0000-0000-0000-000000000502'
                   from public.membership_payers mp join public.memberships m on m.id = mp.membership_id
                  where m.athlete_id = '00000000-0000-0000-0000-000000000071' and m.kind = 'season_fee'),
                'payer row: the family, fixed 1500, linked to the open balance invoice');
  perform bf.ok((select agreed_fee = 200 and sponsored from public.memberships where athlete_id = '00000000-0000-0000-0000-000000000072' and kind = 'season_fee'),
                'athlete 072: sponsored membership, fee = paid part only (cancelled balance excluded)');
  perform bf.ok((select membership_id is not null from public.invoices where id = '00000000-0000-0000-0000-000000000504'),
                'the cancelled sponsorship balance invoice is linked too (reference kept)');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000073' and reason_code = 'SEVERAL_SEASON_PATTERNS'),
                'athlete 073 (two season patterns) flagged, not guessed');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000574' and reason_code = 'SEVERAL_FAMILIES'),
                'athlete 574 (invoices in two families) flagged');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000575' and reason_code = 'FEE_PATTERN_MISMATCH'),
                'athlete 575 (unknown fee pattern) flagged');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000510' and reason_code = 'NO_ATHLETE'),
                'invoice without athlete flagged');
  perform bf.ok(not exists (select 1 from public.invoices where id in ('00000000-0000-0000-0000-000000000505', '00000000-0000-0000-0000-000000000506',
                  '00000000-0000-0000-0000-000000000507', '00000000-0000-0000-0000-000000000508', '00000000-0000-0000-0000-000000000509',
                  '00000000-0000-0000-0000-000000000510') and membership_id is not null),
                'flagged invoices keep their original references (not linked)');
  perform bf.ok((select original_reference like '%BF-IMP-05%' from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000073' limit 1),
                'flag keeps the original invoice numbers');

  r := public.billing_migrate_club_fees('00000000-0000-0000-0000-000000000001');
  perform bf.ok((r->>'memberships')::int = 0, 'club-fee migration is idempotent (' || r::text || ')');
  perform bf.ok((select count(*) from public.data_review_flags where org_id = '00000000-0000-0000-0000-000000000001'
                  and reason_code in ('SEVERAL_SEASON_PATTERNS', 'SEVERAL_FAMILIES', 'FEE_PATTERN_MISMATCH', 'NO_ATHLETE') and resolved_at is null) = 4,
                'no duplicate open flags after a re-run');
  perform bf.ok((select count(*) = 1 from public.memberships where athlete_id = '00000000-0000-0000-0000-000000000071' and kind = 'season_fee'),
                'still one membership per athlete and season');
  perform bf.put('m071', (select id::text from public.memberships where athlete_id = '00000000-0000-0000-0000-000000000071' and kind = 'season_fee'));
end $$;

do $$
declare v text;
begin
  v := bf.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.billing_migrate_club_fees(null)::text$q$);
  perform bf.ok(v like 'ERR:%', 'club-fee migration is not callable by an admin session (' || left(v, 40) || ')');
end $$;

-- ===========================================================================
-- B. Activities at runtime
-- ===========================================================================
do $$
declare v text; v_inv uuid;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  -- A selection programme invoice derives 'selection'.
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","athlete_id":"00000000-0000-0000-0000-000000000071","program_id":"00000000-0000-0000-0000-0000000005b1","items":[{"description":"EYBL fee","quantity":1,"unit_price_chf":3000}]}')->>'invoice_id'$q$);
  v_inv := substr(v, 4)::uuid;
  perform bf.ok((select activity = 'selection' and activity_source = 'derived' from public.invoices where id = v_inv), 'selection programme invoice: selection (derived)');
  update public.invoices set status = 'sent' where id = v_inv;
  perform bf.put('sel_invoice', v_inv::text);

  -- Locked after issue.
  v := bf.run_as(finance_a, format($q$update public.invoices set activity = 'camp' where id = %L returning activity$q$, v_inv));
  perform bf.ok(v like 'ERR:%ACTIVITY_LOCKED%', 'issued invoice: activity cannot change (' || left(v, 60) || ')');
  v := bf.run_as(admin_a, format($q$select public.invoice_set_activity(%L, 'camp', 'fix')::text$q$, v_inv));
  perform bf.ok(v like 'ERR:%ACTIVITY_LOCKED%', 'an invoice classified by a rule after issue is not reclassified (' || left(v, 60) || ')');
  -- Defaulted invoice: admin can reclassify with a reason, finance cannot.
  v := bf.run_as(finance_a, $q$select public.invoice_set_activity('00000000-0000-0000-0000-000000000093', 'training', 'team fee')::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot reclassify');
  v := bf.run_as(admin_a, $q$select public.invoice_set_activity('00000000-0000-0000-0000-000000000093', 'training', '')::text$q$);
  perform bf.ok(v like 'ERR:%REASON_REQUIRED%', 'reclassification needs a reason');
  v := bf.run_as(admin_a, $q$select public.invoice_set_activity('00000000-0000-0000-0000-000000000093', 'training', 'team fee')->>'activity'$q$);
  perform bf.ok(v = 'OK:training', 'admin reclassifies a migration_default invoice (' || v || ')');
  v := bf.run_as(admin_a, format($q$select public.invoice_set_activity(%L, 'camp', 'x')::text$q$, '00000000-0000-0000-0000-000000000502'));
  perform bf.ok(v like 'ERR:%ACTIVITY_LOCKED%', 'a membership invoice cannot leave club_membership');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select public.invoice_set_activity('00000000-0000-0000-0000-000000000093', 'shop', 'x')::text$q$);
  perform bf.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B admin cannot reclassify an org A invoice');

  -- A membership invoice must be club_membership; a split child inherits.
  v := bf.run_as(admin_a, format($q$insert into public.invoices (org_id, number, family_id, description, total_chf, status, membership_id, activity)
       values ('00000000-0000-0000-0000-000000000001', 'BF-X-1', '00000000-0000-0000-0000-000000000061', 'x', 10, 'sent', %L, 'selection') returning id$q$, bf.get('m071')));
  perform bf.ok(v like 'ERR:%ACTIVITY_MISMATCH%', 'membership invoice with another activity refused (' || left(v, 60) || ')');
  v := bf.run_as(admin_a, format($q$insert into public.invoices (org_id, number, family_id, description, total_chf, status, split_from_invoice_id, activity)
       values ('00000000-0000-0000-0000-000000000001', 'BF-X-2', '00000000-0000-0000-0000-000000000061', 'x', 10, 'sent', %L, 'camp') returning id$q$, '00000000-0000-0000-0000-000000000502'));
  perform bf.ok(v like 'ERR:%ACTIVITY_MISMATCH%', 'split child with another activity refused (' || left(v, 60) || ')');
  v := bf.run_as(admin_a, format($q$insert into public.invoices (org_id, number, family_id, description, total_chf, status, split_from_invoice_id, membership_id, charge_kind)
       values ('00000000-0000-0000-0000-000000000001', 'BF-X-3', '00000000-0000-0000-0000-000000000061', 'x', 10, 'draft', %L, %L, 'season_fee') returning activity || '/' || coalesce(billing_entity_id::text, '-')$q$,
       '00000000-0000-0000-0000-000000000502', bf.get('m071')));
  perform bf.ok(v like 'OK:club_membership/%' and v not like 'OK:club_membership/-', 'split child inherits activity and entity (' || left(v, 40) || ')');
  v := bf.run_as(admin_a, format($q$insert into public.invoices (org_id, number, family_id, description, total_chf, status, split_from_invoice_id)
       values ('00000000-0000-0000-0000-000000000001', 'BF-X-4', '00000000-0000-0000-0000-000000000061', 'x', 10, 'draft', %L) returning id$q$, '00000000-0000-0000-0000-000000000502'));
  perform bf.ok(v like 'ERR:%ACTIVITY_MISMATCH%', 'split child without the parent''s membership refused');
  delete from public.invoices where number = 'BF-X-3';
end $$;

-- ===========================================================================
-- C. Billing entities
-- ===========================================================================
do $$
declare v text; v_ent uuid; v_inv uuid; v_snap jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000005f1';
begin
  v := bf.run_as(finance_a, $q$select public.billing_entity_save('{"name":"Synthetic Academy SA"}')::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot create a billing entity');
  v := bf.run_as(admin_a, $q$select public.billing_entity_save('{"name":"Synthetic Academy SA","iban":"XX12"}')::text$q$);
  perform bf.ok(v like 'ERR:%INVALID_IBAN%', 'invalid IBAN refused');
  v := bf.run_as(admin_a, $q$select public.billing_entity_save('{"name":"Synthetic Academy SA","legal_name":"Synthetic Academy SA","street":"Rue Test","building_number":"1","postal_code":"1000","city":"Lausanne","country":"CH","iban":"CH93 0076 2011 6238 5295 7","qr_iban":"CH44 3199 9123 0008 8901 2"}')->>'id'$q$);
  perform bf.ok(v like 'OK:%' and v <> 'OK:<null>', 'admin creates a second billing entity');
  v_ent := substr(v, 4)::uuid;
  perform bf.put('ent2', v_ent::text);
  v := bf.run_as(finance_a, $q$select count(*)::text from public.billing_entities$q$);
  perform bf.ok(v = 'OK:2', 'finance reads the club''s entities (' || v || ')');
  v := bf.run_as(guardian, $q$select count(*)::text from public.billing_entities$q$);
  perform bf.ok(v = 'OK:0', 'a guardian reads no billing entity');
  v := bf.run_as(admin_b, $q$select count(*)::text from public.billing_entities where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform bf.ok(v = 'OK:0', 'org B sees no org A entity');
  v := bf.run_as(admin_b, format($q$select public.billing_entity_route_set('selection', %L)::text$q$, v_ent));
  perform bf.ok(v like 'ERR:%BILLING_ENTITY_NOT_FOUND%', 'org B cannot route to an org A entity');
  v := bf.run_as(admin_b, $q$insert into public.billing_entities (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Cross') returning id$q$);
  perform bf.ok(v like 'ERR:%', 'org B cannot insert an entity into org A');
  v := bf.run_as(admin_b, format($q$update public.billing_entities set name = 'Hijack' where id = %L returning id$q$, v_ent));
  perform bf.ok(v = 'OK:<null>', 'org B cannot update an org A entity');
  v := bf.run_as(finance_a, format($q$select public.billing_entity_route_set('selection', %L)::text$q$, v_ent));
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot change routing');
  v := bf.run_as(admin_a, format($q$select public.billing_entity_route_set('selection', %L)->>'activity'$q$, v_ent));
  perform bf.ok(v = 'OK:selection', 'admin routes selection to the second entity');
  v := bf.run_as(admin_a, $q$select public.billing_entity_route_set('bogus', null)::text$q$);
  perform bf.ok(v like 'ERR:%INVALID_ACTIVITY%', 'unknown activity refused');

  -- New selection invoice -> routed entity + snapshot.
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000062","athlete_id":"00000000-0000-0000-0000-000000000072","program_id":"00000000-0000-0000-0000-0000000005b1","items":[{"description":"EYBL fee","quantity":1,"unit_price_chf":1000}]}')->>'invoice_id'$q$);
  v_inv := substr(v, 4)::uuid;
  perform bf.ok((select billing_entity_id = v_ent and billing_entity_source = 'route' and billing_entity_snapshot->>'name' = 'Synthetic Academy SA'
                   from public.invoices where id = v_inv), 'selection invoice issued by the routed entity (snapshot taken)');
  perform bf.ok((select billing_entity_source = 'default' and billing_entity_id <> v_ent from public.invoices where id = bf.uid('booking_invoice')),
                'unrouted activity uses the default entity');
  -- Draft: only admin corrects the entity.
  v := bf.run_as(finance_a, format($q$update public.invoices set billing_entity_id = (select id from public.billing_entities where is_default) where id = %L returning id$q$, v_inv));
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot change a draft''s issuing entity (' || left(v, 60) || ')');
  v := bf.run_as(admin_a, format($q$select public.invoice_set_billing_entity(%L, (select id from public.billing_entities where is_default))->>'invoice_id'$q$, v_inv));
  perform bf.ok(v like 'OK:%', 'admin corrects the issuing entity of a draft');
  v := bf.run_as(admin_a, format($q$select public.invoice_set_billing_entity(%L, %L)->>'invoice_id'$q$, v_inv, v_ent));
  update public.invoices set status = 'sent' where id = v_inv;
  v_snap := (select billing_entity_snapshot from public.invoices where id = v_inv);
  perform bf.ok(v_snap->>'name' = 'Synthetic Academy SA', 'issuing captures the entity snapshot');
  -- Entity edited later: the issued invoice keeps its snapshot.
  v := bf.run_as(admin_a, format($q$select public.billing_entity_save(jsonb_build_object('id', %L, 'name', 'Synthetic Academy Renamed', 'country', 'CH'))->>'id'$q$, v_ent));
  perform bf.ok((select billing_entity_snapshot->>'name' = 'Synthetic Academy SA' from public.invoices where id = v_inv), 'issued invoice keeps the entity as it was');
  v := bf.run_as(admin_a, format($q$update public.invoices set billing_entity_id = (select id from public.billing_entities where is_default) where id = %L returning id$q$, v_inv));
  perform bf.ok(v like 'ERR:%BILLING_ENTITY_LOCKED%', 'issued invoice: entity locked even for admin (' || left(v, 60) || ')');
  v := bf.run_as(admin_a, format($q$select public.invoice_set_billing_entity(%L, %L)::text$q$, v_inv, v_ent));
  perform bf.ok(v like 'ERR:%BILLING_ENTITY_LOCKED%', 'invoice_set_billing_entity refuses an issued invoice');
  -- Default entity rules.
  v := bf.run_as(admin_a, $q$select public.billing_entity_save(jsonb_build_object('id', (select id from public.billing_entities where is_default), 'name', 'X', 'is_default', false))::text$q$);
  perform bf.ok(v like 'ERR:%DEFAULT_REQUIRED%', 'the default entity cannot be un-defaulted directly');
  v := bf.run_as(admin_a, format($q$delete from public.billing_entities where id = %L returning id$q$, v_ent));
  perform bf.ok(v = 'OK:<null>', 'an entity used by invoices cannot be deleted');
  perform bf.ok(not exists (select 1 from public.audit_logs where new_data::text like '%CH9300762011623852957%' or old_data::text like '%CH9300762011623852957%'),
                'the entity IBAN never lands in audit_logs');
  perform bf.put('sel_invoice2', v_inv::text);
end $$;

-- ===========================================================================
-- D. Season settings + instalment schedule (shared fixtures)
-- ===========================================================================
do $$
declare f jsonb; v_got jsonb; v_exp jsonb; v_err text; v_months jsonb;
begin
  for f in select jsonb_array_elements(doc) from bf.fx loop
    v_err := null; v_got := null;
    begin
      select coalesce(jsonb_agg(jsonb_build_array(seq, due_on::text, amount::text) order by seq), '[]'::jsonb) into v_got
        from public.club_installment_schedule((f->>'total')::numeric, (f->>'count')::int, (f->>'firstDueMonth')::date,
                                              (f->>'dueDay')::int, nullif(f->>'seasonEnd', '')::date, f->>'currency');
    exception when others then v_err := sqlerrm;
    end;
    if f ? 'error' then
      perform bf.ok(v_err like (f->>'error') || '%', 'schedule fixture "' || (f->>'name') || '" refused with ' || (f->>'error') || ' (' || coalesce(v_err, 'no error') || ')');
    else
      v_exp := f->'installments';
      perform bf.ok(v_err is null and v_got = v_exp, 'schedule fixture "' || (f->>'name') || '" ' || coalesce(v_err, v_got::text));
      perform bf.ok((select sum(x.amount) from public.club_installment_schedule((f->>'total')::numeric, (f->>'count')::int,
                       (f->>'firstDueMonth')::date, (f->>'dueDay')::int, nullif(f->>'seasonEnd', '')::date, f->>'currency') x) = (f->>'total')::numeric,
                    'schedule fixture "' || (f->>'name') || '" sums exactly to the total');
      select coalesce(jsonb_agg(m::text order by m), '[]'::jsonb) into v_months
        from public.club_season_months_without_installment((f->>'firstDueMonth')::date, (f->>'count')::int,
                                                           nullif(f->>'seasonStart', '')::date, nullif(f->>'seasonEnd', '')::date) m;
      perform bf.ok(v_months = f->'monthsWithout', 'months without instalment for "' || (f->>'name') || '" ' || v_months::text);
    end if;
  end loop;
end $$;

do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  v := bf.run_as(finance_a, $q$select (public.club_billing_settings()->>'season_start_month') || '/' || (public.club_billing_settings()->>'installment_count') || '/' || (public.club_billing_settings()->>'installment_due_day')$q$);
  perform bf.ok(v = 'OK:8/11/28', 'club defaults: season starts in August, 11 instalments on the 28th (' || v || ')');
  v := bf.run_as(guardian, $q$select public.club_billing_settings()::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardians do not read club billing settings');
  v := bf.run_as(finance_a, $q$select public.club_billing_settings_set('{"installment_count":10}')::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot change club billing settings');
  v := bf.run_as(admin_a, $q$select public.club_billing_settings_set('{"installment_count":13}')::text$q$);
  perform bf.ok(v like 'ERR:%INVALID_SETTINGS%', 'out-of-range instalment count refused');
  v := bf.run_as(admin_a, $q$select public.club_billing_settings_set('{"installment_count":10,"first_installment_month":9}')->>'installment_count'$q$);
  perform bf.ok(v = 'OK:10', 'admin changes the instalment count');
  v := bf.run_as(admin_a, $q$select public.club_billing_settings_set('{"installment_count":11,"first_installment_month":null}')->>'first_installment_month'$q$);
  perform bf.ok(v = 'OK:8', 'first instalment month back to the season start month');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select public.club_billing_settings()->>'installment_count'$q$);
  perform bf.ok(v = 'OK:11', 'org B keeps its own defaults');
  v := bf.run_as(admin_a, $q$select starts_on::text || '..' || ends_on::text from public.club_season_bounds('2026-11-22')$q$);
  perform bf.ok(v = 'OK:2026-08-01..2027-07-31', 'season bounds for a November date (' || v || ')');
  v := bf.run_as(admin_a, $q$select starts_on::text from public.club_season_bounds('2027-07-31')$q$);
  perform bf.ok(v = 'OK:2026-08-01', 'last season day belongs to the season');
  v := bf.run_as(admin_a, $q$select public.season_set_current('00000000-0000-0000-0000-0000000005a2')->>'season_id'$q$);
  perform bf.ok((select is_current from public.seasons where id = '00000000-0000-0000-0000-0000000005a2')
                and not (select is_current from public.seasons where id = '00000000-0000-0000-0000-0000000005a1'), 'admin switches the current season');
  v := bf.run_as(admin_a, $q$select public.season_set_current('00000000-0000-0000-0000-0000000005a1')->>'season_id'$q$);
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select public.season_set_current('00000000-0000-0000-0000-0000000005a1')::text$q$);
  perform bf.ok(v like 'ERR:%SEASON_NOT_FOUND%', 'org B cannot touch org A seasons');
  v := bf.run_as(finance_a, $q$select public.season_set_current('00000000-0000-0000-0000-0000000005a1')::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot change the current season');
end $$;

-- ===========================================================================
-- E. Season memberships
-- ===========================================================================
do $$
declare v text; j jsonb; v_payload text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach uuid := '00000000-0000-0000-0000-0000000000f3';
begin
  v_payload := $p${"athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":1500.01,
    "payers":[{"kind":"sponsor","name":"Synthetic Sponsor AG","share_kind":"fixed","share_value":300},
              {"kind":"guardian","profile_id":"00000000-0000-0000-0000-0000000000f4","share_kind":"percent","share_value":50},
              {"kind":"guardian","profile_id":"00000000-0000-0000-0000-0000000005e1","share_kind":"percent","share_value":50}]}$p$;
  perform bf.put('payload', v_payload);
  v := bf.run_as(finance_a, format($q$select public.membership_preview(%L::jsonb)::text$q$, v_payload));
  j := substr(v, 4)::jsonb;
  perform bf.ok(v like 'OK:%', 'finance previews a membership');
  perform bf.ok((j->'payers'->0->>'amount')::numeric = 300 and (j->'payers'->1->>'amount')::numeric = 600.01
                and (j->'payers'->2->>'amount')::numeric = 600.00,
                'shares: fixed 300 first, 50/50 of the rest, last payer absorbs the centime (' || (j->'payers')::text || ')');
  perform bf.ok((j->>'installment_count')::int = 11 and j->>'first_due_month' = '2027-08-01' and (j->>'due_day')::int = 28,
                'defaults: 11 instalments from the season start month on the 28th');
  perform bf.ok(jsonb_array_length(j->'payers'->1->'schedule') = 11
                and (select sum((x->>'amount')::numeric) from jsonb_array_elements(j->'payers'->1->'schedule') x) = 600.01,
                'each payer schedule sums to the payer amount');
  perform bf.ok(j->'months_without_installment' = '["2028-07-01"]'::jsonb, 'July has no instalment (' || (j->'months_without_installment')::text || ')');
  perform bf.ok(not exists (select 1 from public.memberships where season_id = '00000000-0000-0000-0000-0000000005a2'), 'preview writes nothing');

  v := bf.run_as(finance_a, $q$select public.membership_preview('{"athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":1000,"payers":[{"kind":"family","share_kind":"fixed","share_value":900}]}')::text$q$);
  perform bf.ok(v like 'ERR:%SHARES_MISMATCH%', 'fixed shares must equal the fee');
  v := bf.run_as(finance_a, $q$select public.membership_preview('{"athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":1000,"payers":[{"kind":"family","share_kind":"percent","share_value":60},{"kind":"family","share_kind":"percent","share_value":30}]}')::text$q$);
  perform bf.ok(v like 'ERR:%SHARES_MISMATCH%', 'percent shares must total 100');
  v := bf.run_as(finance_a, $q$select public.membership_preview('{"athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":1000,"payers":[{"kind":"guardian","profile_id":"00000000-0000-0000-0000-0000000004e2","share_kind":"percent","share_value":100}]}')::text$q$);
  perform bf.ok(v like 'ERR:%PAYER_NOT_GUARDIAN%', 'a guardian payer must be a guardian of the athlete');
  v := bf.run_as(finance_a, $q$select public.membership_preview('{"athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":1000,"payers":[{"kind":"sponsor","share_kind":"percent","share_value":100}]}')::text$q$);
  perform bf.ok(v like 'ERR:%PAYER_NAME_REQUIRED%', 'a sponsor needs a name');
  v := bf.run_as(finance_a, $q$select public.membership_preview('{"athlete_id":"00000000-0000-0000-0000-000000000071","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":1000,"installment_count":12,"first_due_month":"2027-09-01","payers":[{"kind":"family","share_kind":"percent","share_value":100}]}')::text$q$);
  perform bf.ok(v like 'ERR:%SCHEDULE_AFTER_SEASON_END%', 'schedule after the season end refused');
  v := bf.run_as(coach, format($q$select public.membership_preview(%L::jsonb)::text$q$, v_payload));
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot preview');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select public.membership_preview(%L::jsonb)::text$q$, v_payload));
  perform bf.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'org B cannot preview an org A athlete');

  -- Issue.
  v := bf.run_as(finance_a, format($q$select public.membership_issue(%L::jsonb || '{"request_id":"00000000-0000-0000-0000-0000000005d1"}')::text$q$, v_payload));
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot issue a membership');
  v := bf.run_as(admin_a, format($q$select public.membership_issue(%L::jsonb)::text$q$, v_payload));
  perform bf.ok(v like 'ERR:%REQUEST_ID_REQUIRED%', 'issue needs a request id');
  v := bf.run_as(admin_a, format($q$select public.membership_issue(%L::jsonb || '{"request_id":"00000000-0000-0000-0000-0000000005d1","description":"Club membership 2027-28"}')::text$q$, v_payload));
  j := substr(v, 4)::jsonb;
  perform bf.ok(v like 'OK:%' and jsonb_array_length(j->'invoices') = 3 and not (j->>'replayed')::boolean, 'admin issues: 3 payer invoices (' || left(v, 80) || ')');
  perform bf.put('m072x', j->>'membership_id');
  perform bf.put('inv_sponsor', j->'invoices'->0->>'invoice_id');
  perform bf.put('inv_g1', j->'invoices'->1->>'invoice_id');
  perform bf.put('inv_g2', j->'invoices'->2->>'invoice_id');
  perform bf.ok((select count(*) = 3 from public.invoices where membership_id = (j->>'membership_id')::uuid
                  and activity = 'club_membership' and charge_kind = 'season_fee' and status::text = 'sent'),
                'payer invoices: club_membership, season_fee, issued');
  perform bf.ok((select payer_kind = 'sponsor' and payer_name = 'Synthetic Sponsor AG' and payer_profile_id is null and total_chf = 300
                   from public.invoices where id = bf.uid('inv_sponsor')), 'sponsor invoice carries the sponsor as payer');
  perform bf.ok((select payer_profile_id = '00000000-0000-0000-0000-0000000000f4' and total_chf = 600.01 from public.invoices where id = bf.uid('inv_g1')),
                'guardian 1 invoice: 600.01, payer set');
  perform bf.ok((select count(*) = 3 from public.payment_plans p where p.invoice_id in (bf.uid('inv_sponsor'), bf.uid('inv_g1'), bf.uid('inv_g2'))
                   and p.installment_count = 11 and p.source = 'season'), 'each payer invoice has its own 11-instalment plan');
  perform bf.ok((select sum(amount) = 600.01 and min(due_date) = '2027-08-28' and max(due_date) = '2028-06-28'
                   from public.payment_plan_installments where invoice_id = bf.uid('inv_g1')), 'guardian 1 instalments sum to 600.01, Aug..Jun');
  perform bf.ok((select billing_entity_id is not null from public.invoices where id = bf.uid('inv_g1')), 'membership invoices get an issuing entity');

  -- Replay and uniqueness.
  v := bf.run_as(admin_a, format($q$select public.membership_issue(%L::jsonb || '{"request_id":"00000000-0000-0000-0000-0000000005d1"}')::text$q$, v_payload));
  perform bf.ok(v like 'OK:%' and (substr(v, 4)::jsonb->>'replayed')::boolean and substr(v, 4)::jsonb->>'membership_id' = bf.get('m072x'),
                'same request id returns the original membership');
  perform bf.ok((select count(*) = 3 from public.invoices where membership_id = bf.uid('m072x')), 'replay created no invoice');
  v := bf.run_as(admin_a, format($q$select public.membership_issue(%L::jsonb || '{"request_id":"00000000-0000-0000-0000-0000000005d2"}')::text$q$, v_payload));
  perform bf.ok(v like 'ERR:%ALREADY_MEMBER%', 'one season fee per athlete and season');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select public.membership_issue(%L::jsonb || '{"request_id":"00000000-0000-0000-0000-0000000005d3"}')::text$q$, v_payload));
  perform bf.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'org B cannot issue for an org A athlete');
end $$;

-- Payer visibility.
do $$
declare v text;
  g1 uuid := '00000000-0000-0000-0000-0000000000f4';
  g2 uuid := '00000000-0000-0000-0000-0000000005e1';
begin
  v := bf.run_as(g1, format($q$select string_agg(id::text, ',') from public.invoices where membership_id = %L$q$, bf.get('m072x')));
  perform bf.ok(v = 'OK:' || bf.get('inv_g1'), 'guardian 1 sees only their own share invoice');
  v := bf.run_as(g2, format($q$select string_agg(id::text, ',') from public.invoices where membership_id = %L$q$, bf.get('m072x')));
  perform bf.ok(v = 'OK:' || bf.get('inv_g2'), 'guardian 2 sees only their own share invoice');
  v := bf.run_as(g2, format($q$select count(*)::text from public.invoices where id = %L$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:0', 'second parent cannot see the first parent''s share');
  v := bf.run_as(g1, format($q$select count(*)::text from public.invoices where id = %L$q$, bf.get('inv_sponsor')));
  perform bf.ok(v = 'OK:0', 'the sponsor share is not shown to the family');
  v := bf.run_as(g2, format($q$select count(*)::text from public.payment_plans where invoice_id = %L$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:0', 'second parent cannot see the first parent''s instalment plan');
  v := bf.run_as(g2, format($q$select count(*)::text from public.payment_plan_installments where invoice_id = %L$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:0', 'second parent cannot see the first parent''s instalments');
  v := bf.run_as(g1, format($q$select count(*)::text from public.payment_plan_installments where invoice_id = %L$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:11', 'guardian 1 sees their own 11 instalments (' || v || ')');
  v := bf.run_as(g1, $q$select count(*)::text from public.invoices where id = '00000000-0000-0000-0000-000000000502'$q$);
  perform bf.ok(v = 'OK:1', 'an invoice without a payer stays visible to the family''s guardians');
  v := bf.run_as(g2, format($q$select count(*)::text from public.membership_payers where membership_id = %L$q$, bf.get('m072x')));
  perform bf.ok(v = 'OK:1', 'a guardian reads only their own payer row (' || v || ')');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select count(*)::text from public.invoices where membership_id = %L$q$, bf.get('m072x')));
  perform bf.ok(v = 'OK:3', 'finance sees every share');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select count(*)::text from public.invoices where membership_id = %L$q$, bf.get('m072x')));
  perform bf.ok(v = 'OK:0', 'other org sees nothing');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select count(*)::text from public.membership_payers$q$);
  perform bf.ok(v = 'OK:0', 'other org reads no payer rows');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.membership_payers (org_id, membership_id, payer_kind, share_kind, share_value, amount, currency)
       select org_id, id, 'other', 'fixed', 1, 1, 'CHF' from public.memberships limit 1 returning id$q$);
  perform bf.ok(v like 'ERR:%', 'payer rows are written only by the membership functions');
end $$;

-- Carry-forward and summary.
do $$
declare v text; j jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := bf.run_as(admin_a, format($q$select public.membership_carry_forward(%L, %L, 150, 'Unpaid balance 2026-27', '00000000-0000-0000-0000-0000000005d9')::text$q$, bf.get('m071'), bf.get('m072x')));
  j := substr(v, 4)::jsonb;
  perform bf.ok(v like 'OK:%' and (j->>'amount')::numeric = 150, 'carry-forward invoice created (' || left(v, 80) || ')');
  perform bf.ok((select activity = 'club_membership' and charge_kind = 'carry_forward' and membership_id = bf.uid('m072x')
                   from public.invoices where id = (j->>'invoice_id')::uuid), 'carry-forward: separate club_membership invoice on the new season');
  v := bf.run_as(admin_a, format($q$select public.membership_carry_forward(%L, %L, 150, 'Unpaid balance 2026-27', '00000000-0000-0000-0000-0000000005d9')->>'replayed'$q$, bf.get('m071'), bf.get('m072x')));
  perform bf.ok(v = 'OK:true', 'carry-forward replay with the same request id');
  v := bf.run_as(admin_a, format($q$select public.membership_carry_forward(%L, %L, 150, 'backwards')::text$q$, bf.get('m072x'), bf.get('m071')));
  perform bf.ok(v like 'ERR:%CARRY_FORWARD_SEASON_ORDER%', 'carry-forward only to a later season');
  v := bf.run_as(admin_a, format($q$select public.membership_summary(%L)::text$q$, bf.get('m072x')));
  j := substr(v, 4)::jsonb;
  perform bf.ok((j->'season_fee'->>'invoiced')::numeric = 1500.01 and (j->'carry_forward'->>'invoiced')::numeric = 150,
                'season-fee totals exclude the carry-forward (' || coalesce(j::text, v) || ')');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.membership_carry_forward(%L, %L, 10, 'Finance carry-forward')::text$q$, bf.get('m071'), bf.get('m072x')));
  perform bf.ok(v like 'OK:%', 'finance can carry forward (' || left(v, 60) || ')');
end $$;

-- Team assignment never bills.
do $$
declare v text; n_inv int; n_mem int;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  n_inv := (select count(*) from public.invoices where org_id = '00000000-0000-0000-0000-000000000001');
  n_mem := (select count(*) from public.memberships where org_id = '00000000-0000-0000-0000-000000000001');
  v := bf.run_as(admin_a, $q$insert into public.team_memberships (org_id, team_id, athlete_id, status)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000000071', 'active') returning id$q$);
  perform bf.ok(v like 'OK:%', 'player added to a first team');
  v := bf.run_as(admin_a, $q$insert into public.team_memberships (org_id, team_id, athlete_id, status)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000005c2', '00000000-0000-0000-0000-000000000071', 'active') returning id$q$);
  perform bf.ok(v like 'OK:%', 'same player added to a second team');
  perform bf.ok((select count(*) from public.invoices where org_id = '00000000-0000-0000-0000-000000000001') = n_inv,
                'team assignment created no invoice');
  perform bf.ok((select count(*) from public.memberships where org_id = '00000000-0000-0000-0000-000000000001') = n_mem,
                'team assignment created no membership fee');
  perform bf.ok((select count(*) = 1 from public.memberships where athlete_id = '00000000-0000-0000-0000-000000000071'
                  and season_id = '00000000-0000-0000-0000-0000000005a1' and kind = 'season_fee' and status <> 'cancelled'),
                'still one season fee for a player on two teams');
end $$;

-- ===========================================================================
-- F. Credits scoped to an activity
-- ===========================================================================
do $$
declare v text; v_camp uuid; v_camp2 uuid;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  -- Overpay a camp invoice and move the overpayment to credit.
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","activity":"camp","items":[{"description":"Camp A","quantity":1,"unit_price_chf":100}]}')->>'invoice_id'$q$);
  v_camp := substr(v, 4)::uuid;
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","activity":"camp","items":[{"description":"Camp B","quantity":1,"unit_price_chf":100}]}')->>'invoice_id'$q$);
  v_camp2 := substr(v, 4)::uuid;
  update public.invoices set status = 'sent' where id in (v_camp, v_camp2);
  v := bf.run_as(finance_a, format($q$select public.record_offline_payment(%L, 150, 'manual')->>'overpaid'$q$, v_camp));
  perform bf.ok(v = 'OK:50.00', 'camp invoice overpaid by 50');
  v := bf.run_as(finance_a, format($q$select public.transfer_overpayment_to_credit(%L, null, 'Paid twice')->>'family_credit'$q$, v_camp));
  perform bf.ok(v like 'OK:50%', 'overpayment moved to credit');
  perform bf.ok((select activity = 'camp' from public.family_credit_entries where invoice_id = v_camp and kind = 'overpayment'),
                'the credit belongs to the camp activity');
  v := bf.run_as(finance_a, format($q$select public.apply_family_credit(%L)::text$q$, bf.get('sel_invoice')));
  perform bf.ok(v like 'ERR:%ACTIVITY_MISMATCH%', 'camp credit cannot pay a selection invoice (' || left(v, 60) || ')');
  v := bf.run_as(finance_a, format($q$select public.apply_family_credit(%L, 30)->>'amount'$q$, v_camp2));
  perform bf.ok(v = 'OK:30.00', 'camp credit pays another camp invoice');
  v := bf.run_as(finance_a, $q$select public.adjust_family_credit('00000000-0000-0000-0000-000000000061', 'CHF', -20, 'payout', 'selection')::text$q$);
  perform bf.ok(v like 'ERR:%CREDIT_NEGATIVE%', 'a selection pool cannot go negative');
  begin
    insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, reason, activity)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', -20, 'CHF', 'manual', 'bypass', 'selection');
    perform bf.ok(false, 'direct ledger insert cannot drain another pool');
  exception when others then perform bf.ok(sqlerrm like 'ACTIVITY_MISMATCH%', 'direct ledger insert cannot drain another pool (' || sqlerrm || ')');
  end;
  -- Unassigned (manual) credit can be assigned to an activity.
  v := bf.run_as(finance_a, $q$select public.adjust_family_credit('00000000-0000-0000-0000-000000000061', 'CHF', 40, 'Goodwill')->>'balance'$q$);
  v := bf.run_as(finance_a, $q$select public.family_credit_assign_activity('00000000-0000-0000-0000-000000000061', 'CHF', 'selection', 25, 'EYBL goodwill')->>'activity_credit'$q$);
  perform bf.ok(v = 'OK:25.00', 'unassigned credit assigned to selection (' || v || ')');
  v := bf.run_as(finance_a, format($q$select public.apply_family_credit(%L, 40)::text$q$, bf.get('sel_invoice')));
  perform bf.ok(v like 'OK:%', 'selection invoice uses its own pool then the unassigned rest (' || left(v, 80) || ')');
  perform bf.ok(public.family_credit_balance_activity('00000000-0000-0000-0000-000000000061', 'CHF', 'selection') = 0
                and public.family_credit_balance_activity('00000000-0000-0000-0000-000000000061', 'CHF', null) = 0
                and public.family_credit_balance_activity('00000000-0000-0000-0000-000000000061', 'CHF', 'camp') = 20,
                'pools after use: selection 0, unassigned 0, camp 20');
  v := bf.run_as(finance_a, $q$select public.family_credit_assign_activity('00000000-0000-0000-0000-000000000061', 'CHF', 'selection', 1, 'x')::text$q$);
  perform bf.ok(v like 'ERR:%AMOUNT_TOO_HIGH%', 'cannot assign more unassigned credit than there is');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f2', $q$select public.adjust_family_credit('00000000-0000-0000-0000-000000000061', 'CHF', 10, 'x', 'camp')::text$q$);
  perform bf.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'org B finance cannot credit an org A family');

  -- Balance by activity.
  v := bf.run_as(finance_a, $q$select string_agg(activity || ':' || balance::text || ':' || credit::text, ',' order by activity) from public.family_balance_by_activity('00000000-0000-0000-0000-000000000061') where currency = 'CHF'$q$);
  perform bf.ok(v like 'OK:%camp:%' and v like '%club_membership:%' and v like '%selection:%', 'family balance split by activity (' || v || ')');
  v := bf.run_as(finance_a, $q$select credit::text from public.family_balance_by_activity('00000000-0000-0000-0000-000000000061') where activity = 'camp'$q$);
  perform bf.ok(v = 'OK:20.00', 'camp credit reported on the camp row (' || v || ')');
  v := bf.run_as(guardian, $q$select count(*)::text from public.family_balance_by_activity('00000000-0000-0000-0000-000000000061') where activity = 'club_membership'$q$);
  perform bf.ok(v = 'OK:1', 'a guardian sees the per-activity balance of their family');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select count(*)::text from public.family_balance_by_activity('00000000-0000-0000-0000-000000000061')$q$);
  perform bf.ok(v = 'OK:0', 'other org gets no balance rows');
end $$;

-- ===========================================================================
-- G. Receipts
-- ===========================================================================
do $$
declare v text; j jsonb; v_rec uuid; v_bal_club numeric; v_pay uuid;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach uuid := '00000000-0000-0000-0000-0000000000f3';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
  finance_b uuid := 'b0000000-0000-0000-0000-0000000005f2';
  club uuid := '00000000-0000-0000-0000-000000000502';
begin
  perform bf.put('club_paid_before', public.invoice_net_paid(club)::text);
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', '00000000-0000-0000-0000-0000000005e9',
       'family_id', '00000000-0000-0000-0000-000000000061', 'payer_name', 'Synthetic Payer', 'amount', 1000, 'method', 'bank_transfer',
       'reference', 'BANK-1', 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 600),
                                                               jsonb_build_object('invoice_id', %L, 'amount', 300))))::text$q$,
       club, bf.get('sel_invoice2')));
  j := substr(v, 4)::jsonb;
  perform bf.ok(v like 'OK:%' and (j->>'allocated')::numeric = 900 and (j->>'unallocated')::numeric = 100 and j->>'status' = 'partially_allocated',
                'one transfer of 1000 over two invoices; 100 stays unallocated (' || left(v, 120) || ')');
  v_rec := (j->>'receipt_id')::uuid;
  perform bf.put('receipt', v_rec::text);
  perform bf.ok((select count(*) = 2 from public.payments where receipt_id = v_rec and request_id = '00000000-0000-0000-0000-0000000005e9'),
                'each allocation is its own payment row');
  perform bf.ok(public.invoice_net_paid(club) = bf.get('club_paid_before')::numeric + 600
                and (select status::text = 'partially_paid' from public.invoices where id = club), 'club invoice balance updated as today');
  perform bf.ok((select status::text = 'partially_paid' from public.invoices where id = bf.uid('sel_invoice2')), 'selection invoice balance updated separately');

  -- Replay.
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', '00000000-0000-0000-0000-0000000005e9',
       'amount', 1000, 'method', 'bank_transfer', 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 600))))::text$q$, club));
  perform bf.ok(v like 'OK:%' and (substr(v, 4)::jsonb->>'replayed')::boolean and substr(v, 4)::jsonb->>'receipt_id' = v_rec::text,
                'same request id returns the original receipt');
  perform bf.ok((select count(*) = 2 from public.payments where receipt_id = v_rec), 'replay booked nothing');
  perform bf.ok((select count(*) = 1 from public.payment_receipts where request_id = '00000000-0000-0000-0000-0000000005e9'), 'one receipt per request id');

  -- Unallocated list.
  v := bf.run_as(finance_a, $q$select string_agg(unallocated::text, ',') from public.receipt_unallocated()$q$);
  perform bf.ok(v = 'OK:100.00', 'receipt listed with 100 unallocated (' || v || ')');
  -- Limits.
  v := bf.run_as(finance_a, format($q$select public.receipt_allocate(%L, jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 150)))::text$q$, v_rec, club));
  perform bf.ok(v like 'ERR:%ALLOCATION_EXCEEDS_RECEIPT%', 'cannot allocate more than the receipt holds');
  v := bf.run_as(finance_a, format($q$select public.receipt_allocate(%L, jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 100)))::text$q$,
       v_rec, '00000000-0000-0000-0000-000000000093'));
  perform bf.ok(v like 'ERR:%INVOICE_NOT_PAYABLE%', 'a paid invoice cannot take an allocation');
  v := bf.run_as(finance_a, format($q$select public.receipt_allocate(%L, jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', -5)))::text$q$, v_rec, club));
  perform bf.ok(v like 'ERR:%INVALID_AMOUNT%', 'allocations must be positive');
  v := bf.run_as(finance_a, format($q$select public.receipt_allocate(%L, jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 10), jsonb_build_object('invoice_id', %L, 'amount', 10)))::text$q$, v_rec, club, club));
  perform bf.ok(v like 'ERR:%DUPLICATE_ALLOCATION%', 'one allocation per invoice per call');
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 5000, 'method', 'bank_transfer',
       'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 5000))))::text$q$, bf.get('inv_g1')));
  perform bf.ok(v like 'ERR:%ALLOCATION_EXCEEDS_BALANCE%', 'an allocation cannot exceed the invoice balance');
  perform bf.ok(not exists (select 1 from public.payment_receipts where amount = 5000), 'a refused receipt leaves nothing behind');
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 50, 'currency', 'EUR', 'method', 'bank_transfer',
       'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 50))))::text$q$, bf.get('inv_g1')));
  perform bf.ok(v like 'ERR:%CURRENCY_MISMATCH%', 'allocation currency must match');
  -- Allocate the rest later (idempotent).
  v := bf.run_as(finance_a, format($q$select public.receipt_allocate(%L, jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 100,
       'installment_id', (select id from public.payment_plan_installments where invoice_id = %L and seq = 1))), '00000000-0000-0000-0000-0000000005ea')->>'status'$q$,
       v_rec, bf.get('inv_g1'), bf.get('inv_g1')));
  perform bf.ok(v = 'OK:allocated', 'rest allocated later to a guardian share (instalment noted)');
  perform bf.ok((select amount_paid = 54.55 from public.payment_plan_installments where invoice_id = bf.uid('inv_g1') and seq = 1)
                and (select amount_paid = 45.45 from public.payment_plan_installments where invoice_id = bf.uid('inv_g1') and seq = 2),
                'instalments updated by the normal plan allocation');
  v := bf.run_as(finance_a, format($q$select public.receipt_allocate(%L, jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 100)), '00000000-0000-0000-0000-0000000005ea')->>'replayed'$q$,
       v_rec, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:true', 'allocation replay with the same request id books nothing');
  v := bf.run_as(finance_a, $q$select count(*)::text from public.receipt_unallocated()$q$);
  perform bf.ok(v = 'OK:0', 'fully allocated receipt leaves the worklist');

  -- Reversal through the existing payment void.
  v_pay := (select id from public.payments where receipt_id = v_rec and invoice_id = club and reverses_payment_id is null);
  v := bf.run_as(finance_a, format($q$select public.edit_manual_payment(%L, '{"amount":500}', 'typo')::text$q$, v_pay));
  perform bf.ok(v like 'ERR:%RECEIPT_PAYMENT_LOCKED%', 'a receipt allocation is not edited in place (' || left(v, 60) || ')');
  v := bf.run_as(finance_a, format($q$select public.void_payment(%L, 'wrong invoice')::text$q$, v_pay));
  perform bf.ok(v like 'OK:%', 'allocation reversed with the existing payment void');
  perform bf.ok(public.invoice_net_paid(club) = bf.get('club_paid_before')::numeric, 'club invoice balance restored');
  v := bf.run_as(finance_a, $q$select string_agg(unallocated::text, ',') from public.receipt_unallocated()$q$);
  perform bf.ok(v = 'OK:600.00', 'reversed money is unallocated on the receipt again (' || v || ')');
  perform bf.ok((select status = 'partially_allocated' from public.payment_receipts where id = v_rec), 'receipt status follows');

  -- Roles and tenants.
  v := bf.run_as(coach, $q$select public.receipt_record('{"request_id":"00000000-0000-0000-0000-0000000005eb","amount":10}')::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot record receipts');
  v := bf.run_as(guardian, $q$select count(*)::text from public.payment_receipts$q$);
  perform bf.ok(v = 'OK:0', 'a guardian reads no receipts');
  v := bf.run_as(finance_b, $q$select count(*)::text from public.payment_receipts$q$);
  perform bf.ok(v = 'OK:0', 'org B reads no org A receipt');
  v := bf.run_as(finance_b, format($q$select public.receipt_allocate(%L, '[]')::text$q$, v_rec));
  perform bf.ok(v like 'ERR:%RECEIPT_NOT_FOUND%', 'org B cannot allocate an org A receipt');
  v := bf.run_as(finance_b, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 10, 'method', 'bank_transfer',
       'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 10))))::text$q$, club));
  perform bf.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B cannot allocate to an org A invoice');
  v := bf.run_as(finance_b, $q$select count(*)::text from public.receipt_unallocated()$q$);
  perform bf.ok(v = 'OK:0', 'org B worklist is empty');
  v := bf.run_as(admin_a, $q$insert into public.payment_receipts (org_id, amount, currency, received_on, method, request_id)
       values ('00000000-0000-0000-0000-000000000001', 1, 'CHF', current_date, 'manual', gen_random_uuid()) returning id$q$);
  perform bf.ok(v like 'ERR:%', 'receipts are written only by the receipt functions');
  -- Void an empty receipt.
  v := bf.run_as(finance_a, $q$select public.receipt_record('{"request_id":"00000000-0000-0000-0000-0000000005ec","amount":10,"method":"manual"}')->>'receipt_id'$q$);
  v := bf.run_as(finance_a, format($q$select public.receipt_void(%L, 'entered twice')->>'status'$q$, substr(v, 4)));
  perform bf.ok(v = 'OK:void', 'an unallocated receipt can be voided');
  v := bf.run_as(finance_a, format($q$select public.receipt_void(%L, 'x')::text$q$, v_rec));
  perform bf.ok(v like 'ERR:%RECEIPT_HAS_ALLOCATIONS%', 'a receipt with allocations cannot be voided');
end $$;

-- Bank entry booked as a receipt.
do $$
declare v text; v_imp uuid; v_ent uuid;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  insert into public.bank_statement_imports (org_id, file_name, file_sha256, format, currency)
  values ('00000000-0000-0000-0000-000000000001', 'synthetic.xml', repeat('b', 64), 'camt.054', 'CHF') returning id into v_imp;
  insert into public.bank_entries (org_id, import_id, bank_ref, amount, currency, booking_date, reference_type, status)
  values ('00000000-0000-0000-0000-000000000001', v_imp, 'BF-BANK-1', 200, 'CHF', current_date, 'NON', 'unmatched') returning id into v_ent;
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 200, 'method', 'bank_transfer',
       'bank_entry_id', %L, 'allocations', '[]'::jsonb))::text$q$, v_ent));
  perform bf.ok(v like 'ERR:%BANK_ENTRY_NEEDS_ALLOCATION%', 'a bank entry receipt needs at least one allocation');
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 150, 'method', 'bank_transfer',
       'bank_entry_id', %L, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 100))))::text$q$, v_ent, bf.get('inv_g2')));
  perform bf.ok(v like 'ERR:%BANK_AMOUNT_MISMATCH%', 'receipt amount must equal the bank entry');
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 200, 'method', 'bank_transfer',
       'bank_entry_id', %L, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 100),
                                                            jsonb_build_object('invoice_id', %L, 'amount', 100))))->>'receipt_id'$q$,
       v_ent, bf.get('inv_g2'), bf.get('sel_invoice2')));
  perform bf.ok(v like 'OK:%' and v <> 'OK:<null>', 'bank entry split over two invoices of different activities');
  perform bf.ok((select status = 'booked' and receipt_id = substr(v, 4)::uuid and payment_id is not null from public.bank_entries where id = v_ent),
                'bank entry booked and linked to the receipt');
  v := bf.run_as(finance_a, format($q$select public.receipt_record(jsonb_build_object('request_id', gen_random_uuid(), 'amount', 200, 'method', 'bank_transfer',
       'bank_entry_id', %L, 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 10))))::text$q$, v_ent, bf.get('inv_g2')));
  perform bf.ok(v like 'ERR:%ENTRY_ALREADY_BOOKED%', 'a bank entry is booked once');
end $$;

-- ===========================================================================
-- H. Manual invoice idempotency, invoice_source, review flags
-- ===========================================================================
do $$
declare v text; v2 text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"request_id":"00000000-0000-0000-0000-0000000005f9","activity":"shop","family_id":"00000000-0000-0000-0000-000000000061","items":[{"description":"Kit","quantity":1,"unit_price_chf":40}]}')->>'invoice_id'$q$);
  v2 := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"request_id":"00000000-0000-0000-0000-0000000005f9","activity":"shop","family_id":"00000000-0000-0000-0000-000000000061","items":[{"description":"Kit","quantity":1,"unit_price_chf":40}]}')->>'invoice_id'$q$);
  perform bf.ok(v like 'OK:%' and v = v2, 'manual invoice retry returns the same invoice');
  perform bf.ok((select count(*) = 1 from public.invoices where request_id = '00000000-0000-0000-0000-0000000005f9'), 'no duplicate manual invoice');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","activity":"club_membership","items":[]}')::text$q$);
  perform bf.ok(v like 'ERR:%USE_MEMBERSHIP_ISSUE%', 'club fees go through membership_issue');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","activity":"nonsense","items":[]}')::text$q$);
  perform bf.ok(v like 'ERR:%INVALID_ACTIVITY%', 'unknown activity refused');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f2', $q$select public.create_manual_invoice('{"request_id":"00000000-0000-0000-0000-0000000005f9","activity":"shop","family_id":"b0000000-0000-0000-0000-0000000005f3","items":[]}')->>'replayed'$q$);
  perform bf.ok(v = 'OK:false', 'request ids are per org (org B gets its own invoice)');

  -- invoice_source
  v := bf.run_as(finance_a, format($q$select public.invoice_source(%L)->>'kind'$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:membership', 'source of a membership invoice: membership');
  v := bf.run_as(finance_a, format($q$select (public.invoice_source(%L)->>'kind') || '/' || (public.invoice_source(%L)->>'id')$q$, bf.get('booking_invoice'), bf.get('booking_invoice')));
  perform bf.ok(v = 'OK:booking/' || bf.get('booking'), 'source of a booking invoice: the booking (' || v || ')');
  v := bf.run_as(finance_a, $q$select public.invoice_source('00000000-0000-0000-0000-000000000091')->>'kind'$q$);
  perform bf.ok(v = 'OK:registration', 'source of a camp registration invoice: registration');
  v := bf.run_as(finance_a, format($q$select public.invoice_source(%L)->>'kind'$q$, bf.get('sel_invoice')));
  perform bf.ok(v = 'OK:programme', 'source of a programme invoice: programme');
  v := bf.run_as(guardian, format($q$select public.invoice_source(%L)->>'kind'$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:membership', 'the paying guardian reads the source');
  v := bf.run_as(guardian, format($q$select coalesce(public.invoice_source(%L)::text, 'none')$q$, bf.get('inv_sponsor')));
  perform bf.ok(v = 'OK:none', 'no source for an invoice the guardian cannot see');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select coalesce(public.invoice_source(%L)::text, 'none')$q$, bf.get('inv_g1')));
  perform bf.ok(v = 'OK:none', 'other org gets no source');

  -- Review flags
  v := bf.run_as(finance_a, $q$select count(*)::text from public.data_review_flags where resolved_at is null$q$);
  perform bf.ok(v <> 'OK:0', 'finance reads the review flags (' || v || ')');
  v := bf.run_as(guardian, $q$select count(*)::text from public.data_review_flags$q$);
  perform bf.ok(v = 'OK:0', 'a guardian reads no review flag');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', $q$select count(*)::text from public.data_review_flags where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform bf.ok(v = 'OK:0', 'other org reads no review flag');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f1', format($q$select public.data_review_flag_resolve((select id from public.data_review_flags where entity_id = %L limit 1))::text$q$,
       '00000000-0000-0000-0000-000000000510'));
  perform bf.ok(v like 'ERR:%FLAG_NOT_FOUND%', 'other org cannot resolve a flag');
  v := bf.run_as(admin_a, $q$insert into public.data_review_flags (org_id, entity_table, reason_code) values ('00000000-0000-0000-0000-000000000001', 'x', 'MANUAL') returning id$q$);
  perform bf.ok(v like 'ERR:%', 'flags are not inserted by clients');
  v := bf.run_as(finance_a, format($q$select public.data_review_flag_resolve(%L, 'Checked with the family')->>'resolved_at'$q$,
       (select id from public.data_review_flags where entity_id = '00000000-0000-0000-0000-000000000510' and reason_code = 'NO_ATHLETE')));
  perform bf.ok(v like 'OK:2%', 'finance resolves a flag');
  v := bf.run_as(finance_a, $q$delete from public.data_review_flags returning id$q$);
  perform bf.ok(v = 'OK:<null>', 'flags are never deleted');

  -- Season date fix moves the season-fee validity.
  update public.seasons set ends_on = '2027-06-30' where id = '00000000-0000-0000-0000-0000000005a1';
  perform bf.ok((select valid_until = '2027-06-30' from public.memberships where id = bf.uid('m071')), 'season date fix updates the membership validity');
end $$;

-- ===========================================================================
-- I. Revenue categories + invoice numbering
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  admin_b uuid := 'b0000000-0000-0000-0000-0000000005f1';
begin
  v := bf.run_as(finance_a, $q$select public.invoice_number_series_set('camp', 'BF CAMP')::text$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot set number prefixes');
  v := bf.run_as(admin_a, $q$select public.invoice_number_series_set('other', 'BF X')::text$q$);
  perform bf.ok(v like 'ERR:%OTHER_NOT_ALLOWED%', 'no series for the legacy category other');
  v := bf.run_as(admin_a, $q$select public.invoice_number_series_set('camp', ' bad-prefix- ')::text$q$);
  perform bf.ok(v like 'ERR:%INVALID_PREFIX%', 'malformed prefix refused (' || left(v, 50) || ')');
  v := bf.run_as(admin_a, $q$select concat_ws(',', public.invoice_number_series_set('club_membership', 'BF CLUB')->>'prefix',
                             public.invoice_number_series_set('selection', 'BF EYBL')->>'prefix',
                             public.invoice_number_series_set('training', 'BF PT')->>'prefix',
                             public.invoice_number_series_set('shop', 'BF Shop')->>'prefix',
                             public.invoice_number_series_set('camp', 'BF CAMP')->>'prefix')$q$);
  perform bf.ok(v = 'OK:BF CLUB,BF EYBL,BF PT,BF Shop,BF CAMP', 'admin configures one prefix per category (spaces allowed)');
  v := bf.run_as(admin_a, $q$select public.invoice_number_series_set('shop', 'BF CAMP')::text$q$);
  perform bf.ok(v like 'ERR:%PREFIX_IN_USE%', 'a prefix belongs to one category');
  v := bf.run_as(admin_b, $q$select count(*)::text from public.invoice_number_series$q$);
  perform bf.ok(v = 'OK:0', 'org B sees no org A series');
  v := bf.run_as(admin_b, $q$insert into public.invoice_number_series (org_id, category, prefix) values ('00000000-0000-0000-0000-000000000001', 'shop', 'HIJACK') returning id$q$);
  perform bf.ok(v like 'ERR:%', 'org B cannot add a series to org A');
  v := bf.run_as(admin_a, $q$insert into public.invoice_number_counters (org_id, prefix, year, last_value) values ('00000000-0000-0000-0000-000000000001', 'BF CAMP', 2026, 99) returning prefix$q$);
  perform bf.ok(v like 'ERR:%', 'counters are not writable by clients');
  perform bf.put('year', extract(year from (now() at time zone 'Europe/Zurich'))::int::text);
end $$;

-- Manual invoice: category required; draft gets a provisional number; issue assigns the series number.
do $$
declare v text; v1 uuid; v2 uuid; v_num text;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","items":[{"description":"x","quantity":1,"unit_price_chf":10}]}')::text$q$);
  perform bf.ok(v like 'ERR:%CATEGORY_REQUIRED%', 'a manual invoice without a category is refused');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"activity":"other","family_id":"00000000-0000-0000-0000-000000000061","items":[]}')::text$q$);
  perform bf.ok(v like 'ERR:%OTHER_NOT_ALLOWED%', 'other is not selectable for a new invoice');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"activity":"camp","program_id":"00000000-0000-0000-0000-0000000005b1","family_id":"00000000-0000-0000-0000-000000000061","items":[]}')::text$q$);
  perform bf.ok(v like 'ERR:%ACTIVITY_MISMATCH%', 'mixed categories refused: camp category on a selection programme');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"activity":"camp","request_id":"00000000-0000-0000-0000-0000000006a1","family_id":"00000000-0000-0000-0000-000000000061","items":[{"description":"Camp day","quantity":1,"unit_price_chf":120}]}')->>'invoice_id'$q$);
  v1 := substr(v, 4)::uuid;
  perform bf.ok((select number like 'DRAFT-%' and status::text = 'draft' from public.invoices where id = v1), 'a draft has no final number');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"activity":"camp","family_id":"00000000-0000-0000-0000-000000000061","items":[{"description":"Camp day 2","quantity":1,"unit_price_chf":80}]}')->>'invoice_id'$q$);
  v2 := substr(v, 4)::uuid;
  v := bf.run_as(finance_a, format($q$update public.invoices set status = 'sent' where id = %L returning number$q$, v1));
  perform bf.ok(v = 'OK:BF CAMP-' || bf.get('year') || '-0001', 'issue assigns <prefix>-<YYYY>-0001 (' || v || ')');
  v := bf.run_as(finance_a, format($q$update public.invoices set status = 'sent' where id = %L returning number$q$, v2));
  perform bf.ok(v = 'OK:BF CAMP-' || bf.get('year') || '-0002', 'next issue in the same category: 0002 (' || v || ')');
  perform bf.ok((select payment_reference = public.billing_reference_for(org_id, number) from public.invoices where id = v1),
                'payment reference follows the final number');
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"activity":"camp","request_id":"00000000-0000-0000-0000-0000000006a1","family_id":"00000000-0000-0000-0000-000000000061","items":[]}')->>'number'$q$);
  perform bf.ok(v = 'OK:BF CAMP-' || bf.get('year') || '-0001', 'retry with the same request id returns the same invoice and number (' || v || ')');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f1', format($q$update public.invoices set number = 'BF CAMP-2000-0001' where id = %L returning number$q$, v1));
  perform bf.ok(v like 'ERR:%NUMBER_LOCKED%', 'the number is locked after issue (' || left(v, 50) || ')');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f1', format($q$update public.invoices set activity = 'shop' where id = %L returning activity$q$, v1));
  perform bf.ok(v like 'ERR:%ACTIVITY_LOCKED%', 'the category is locked after issue');
  perform bf.put('camp1', v1::text);
  perform bf.put('camp2', v2::text);

  -- A shop invoice has its own sequence.
  v := bf.run_as(finance_a, $q$select public.create_manual_invoice('{"activity":"shop","family_id":"00000000-0000-0000-0000-000000000061","items":[{"description":"Kit","quantity":1,"unit_price_chf":30}]}')->>'invoice_id'$q$);
  v := bf.run_as(finance_a, format($q$update public.invoices set status = 'sent' where id = %L returning number$q$, substr(v, 4)));
  perform bf.ok(v = 'OK:BF Shop-' || bf.get('year') || '-0001', 'each prefix has its own counter (' || v || ')');
  -- Selection invoice issued directly (programme link) -> EYBL series + source label.
  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, total_chf, status, due_date)
  values ('00000000-0000-0000-0000-000000000001', public.next_invoice_number('00000000-0000-0000-0000-000000000001'),
          '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000005b1',
          'EYBL fee', 500, 'sent', current_date + 30)
  returning number into v_num;
  perform bf.ok(v_num = 'BF EYBL-' || bf.get('year') || '-0001', 'selection invoice: EYBL series (' || v_num || ')');
  perform bf.ok((select source_label = 'Synthetic EYBL' and public.billing_category_label(id) = 'Synthetic EYBL' from public.invoices where number = v_num),
                'selection source label and category label from the programme');
  -- Org without a series for a category keeps today's numbers.
  perform bf.ok((select number = 'BF-CL-1' from public.invoices where id = bf.uid('booking_invoice')),
                'invoices issued before a series existed keep their number');
end $$;

-- Membership invoices use the club series and the season as source label.
do $$
declare v text;
begin
  v := bf.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.membership_issue('{"request_id":"00000000-0000-0000-0000-0000000006b1","athlete_id":"00000000-0000-0000-0000-000000000072","season_id":"00000000-0000-0000-0000-0000000005a2","agreed_fee":100,"installment_count":1,"payers":[{"kind":"family","share_kind":"fixed","share_value":100}]}')->'invoices'->0->>'number'$q$);
  perform bf.ok(v = 'OK:BF CLUB-' || bf.get('year') || '-0001', 'membership invoice numbered in the club series (' || v || ')');
  perform bf.ok((select source_label = 'Synthetic season 2027-28' from public.invoices where number = substr(v, 4)), 'membership source label: the season');
end $$;

-- Link-time category inside the creation transaction (training booking path).
do $$
declare v_inv uuid;
begin
  insert into public.invoices (org_id, number, family_id, athlete_id, description, total_chf, status, due_date)
  values ('00000000-0000-0000-0000-000000000001', public.next_invoice_number('00000000-0000-0000-0000-000000000001'),
          '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071', 'Session', 75, 'sent', current_date + 7)
  returning id into v_inv;
  insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, invoice_id)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000021',
          '00000000-0000-0000-0000-000000000011', now() + interval '30 days', now() + interval '30 days 1 hour', 'booked', 75, v_inv);
  perform bf.ok((select activity = 'training' and number = 'BF PT-' || bf.get('year') || '-0001' and source_label = '1-on-1 Personal Training'
                   and payment_reference = public.billing_reference_for(org_id, number) from public.invoices where id = v_inv),
                'booking invoice: training category, PT number and source label assigned in the creation transaction');
  perform bf.ok(exists (select 1 from public.data_review_flags where entity_id = v_inv and reason_code = 'CATEGORY_AMBIGUOUS' and resolved_at is not null),
                'its temporary review flag is resolved');
end $$;

-- Inheritance: split child, instalments, credit note.
do $$
declare v_child uuid; v text;
begin
  insert into public.invoices (org_id, number, family_id, description, total_chf, status, split_from_invoice_id)
  values ('00000000-0000-0000-0000-000000000001', public.next_invoice_number('00000000-0000-0000-0000-000000000001'),
          '00000000-0000-0000-0000-000000000061', 'Share', 10, 'sent', bf.uid('camp1'))
  returning id into v_child;
  perform bf.ok((select c.activity = p.activity and c.billing_entity_id = p.billing_entity_id and c.source_label is not distinct from p.source_label
                        and c.number = 'BF CAMP-' || bf.get('year') || '-0003'
                   from public.invoices c join public.invoices p on p.id = c.split_from_invoice_id where c.id = v_child),
                'split child inherits category, entity and source; numbered in the parent''s series');
  perform bf.ok(not exists (select 1 from public.payment_plan_installments pi where pi.invoice_id <> (select pp.invoice_id from public.payment_plans pp where pp.id = pi.plan_id)
                              and pi.plan_id in (select id from public.payment_plans where invoice_id = bf.uid('inv_g1'))),
                'instalments stay on their invoice (same category, entity, number)');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 20, 'goodwill')::text$q$, bf.get('camp1')));
  perform bf.ok(v like 'OK:%', 'credit note on the camp invoice');
end $$;

do $$
declare v text;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
begin
  v := bf.run_as(finance_a, $q$select invoiced::text from public.invoice_totals_by_category(current_date - 1, current_date + 1) where category = 'camp' and currency = 'CHF'$q$);
  -- camp: 120 - 20 (credit note) + 80 + 10 (split child) + the two camp invoices of section F (100 + 100)
  perform bf.ok(v = 'OK:390.00', 'totals by category: the credit note counts under the original''s category (' || v || ')');
  v := bf.run_as(finance_a, $q$select string_agg(category, ',' order by category) from public.invoice_totals_by_category(current_date - 1, current_date + 1)$q$);
  perform bf.ok(v like 'OK:%club_membership%' and v like '%selection%' and v like '%training%' and v like '%shop%', 'totals per stored category (' || v || ')');
  v := bf.run_as(finance_a, format($q$select count(*)::text from public.invoice_totals_by_category(null, null, %L)$q$, bf.get('ent2')));
  perform bf.ok(v <> 'OK:0', 'totals filtered by issuing entity');
  v := bf.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.invoice_totals_by_category(null, null)$q$);
  perform bf.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardians get no totals');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f2', $q$select coalesce(sum(invoiced), 0)::text from public.invoice_totals_by_category(null, null) where category <> 'other'$q$);
  perform bf.ok(v = 'OK:0', 'org B totals contain no org A money (' || v || ')');
  v := bf.run_as('b0000000-0000-0000-0000-0000000005f2', $q$select public.create_manual_invoice('{"activity":"camp","family_id":"b0000000-0000-0000-0000-0000000005f3","items":[{"description":"x","quantity":1,"unit_price_chf":5}]}')->>'number'$q$);
  perform bf.ok(v like 'OK:RHS-%', 'org B (no series) keeps its own invoice pattern (' || v || ')');
end $$;

-- Two concurrent issues get distinct, consecutive numbers (two real sessions).
do $$
declare v1 uuid; v2 uuid;
begin
  insert into public.invoices (org_id, number, family_id, description, total_chf, status, activity)
  values ('00000000-0000-0000-0000-000000000001', 'tmp-c1', '00000000-0000-0000-0000-000000000061', 'Concurrent 1', 10, 'draft', 'shop') returning id into v1;
  insert into public.invoices (org_id, number, family_id, description, total_chf, status, activity)
  values ('00000000-0000-0000-0000-000000000001', 'tmp-c2', '00000000-0000-0000-0000-000000000061', 'Concurrent 2', 10, 'draft', 'shop') returning id into v2;
  perform bf.put('cc1', v1::text);
  perform bf.put('cc2', v2::text);
end $$;

do $$
declare v_conn text; n2 text; n1 text; v_ok boolean := true;
begin
  begin
    create extension if not exists dblink;
    v_conn := format('dbname=%s host=localhost port=%s user=%s password=postgres', current_database(), current_setting('port'), current_user);
    perform dblink_connect('bf_c1', v_conn);
    perform dblink_connect('bf_c2', v_conn);
  exception when others then
    v_ok := false;
    raise notice 'INFO — concurrency check skipped (no second session: %)', sqlerrm;
  end;
  if v_ok then
    perform dblink_exec('bf_c1', 'begin');
    select x into n1 from dblink('bf_c1', format('update public.invoices set status = ''sent'' where id = %L returning number', bf.get('cc1'))) as t(x text);
    -- Session 2 waits on the counter row until session 1 commits.
    perform dblink_send_query('bf_c2', format('update public.invoices set status = ''sent'' where id = %L returning number', bf.get('cc2')));
    perform dblink_exec('bf_c1', 'commit');
    select x into n2 from dblink_get_result('bf_c2') as t(x text);
    perform dblink_disconnect('bf_c1');
    perform dblink_disconnect('bf_c2');
    perform bf.ok(n1 is not null and n2 is not null and n1 <> n2
                  and right(n2, 4)::int = right(n1, 4)::int + 1 and n1 like 'BF Shop-%',
                  'two concurrent issues get distinct consecutive numbers (' || coalesce(n1, '-') || ', ' || coalesce(n2, '-') || ')');
  end if;
end $$;

-- QR references are unique across categories that share the same running number;
-- numbers outside any series keep the previous rule.
do $$
declare o uuid := '00000000-0000-0000-0000-000000000001'; a text; c text; e text;
begin
  a := public.billing_reference_for(o, 'BF CLUB-2026-0001');
  c := public.billing_reference_for(o, 'BF CAMP-2026-0001');
  e := public.billing_reference_for(o, 'BF EYBL-2026-0001');
  perform bf.ok(a <> c and a <> e and c <> e, 'same running number in two categories -> different QR references (' || a || ', ' || c || ')');
  perform bf.ok(public.billing_reference_for(o, 'XX-2026-0001') = public.gen_qr_reference(o, 'XX-2026-0001'),
                'numbers outside any series keep the previous reference rule');
end $$;
