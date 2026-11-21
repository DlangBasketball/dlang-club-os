-- ============================================================================
-- Sponsored players suite (migration 20250420102400_sponsored_players.sql)
--
--   A. Column checks: kind / percent / scope / lengths / date window.
--   B. Staff-only guard: a guardian cannot set or change the sponsorship of
--      her child (other columns stay editable); admin and finance can; the
--      sponsored_by / sponsored_at stamps are server-set.
--   C. Cross-tenant denial: org B admin can neither read nor change org A
--      sponsorships, nor read org A ledger rows, nor run the admin action on
--      an org A player.
--   D. Audit trail.
--   E. Billing: season invoice fully sponsored (credit note, settled), partial
--      (credit note, balance left, what dunning sees), outside the date
--      window / out of scope / not sponsored (untouched), recurring periods
--      (fully sponsored: no invoice, partial: own line), memberships (fully
--      sponsored: active, no invoice), admin action (dry run, cancel).
--   F. Ledger visibility: admin / finance only.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4 of family …061 / athlete …071; family …062 = athletes …072,
-- …073; programme …043 recurring team, …041 camp). Org B …0002 from
-- seed_tenants.sql; its admin and records are created here.
-- Org A default language is fr-CH: labels are "Sponsorisé (…)".
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema spn;
grant usage on schema spn to authenticated, anon, service_role;
create table spn.ctx (k text primary key, v text);
grant all on spn.ctx to authenticated, anon, service_role;

create function spn.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service_role). Returns 'OK:<first column>' or 'ERR:<message>'.
create function spn.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role service_role'; else execute 'set local role authenticated'; end if;
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
grant execute on all functions in schema spn to authenticated, anon, service_role;

-- Synthetic invoice for org A: one line, issued (status sent).
create function spn.invoice(p_athlete uuid, p_family uuid, p_program uuid, p_amount numeric, p_number text) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency)
  values ('00000000-0000-0000-0000-000000000001', p_number, p_family, p_athlete, p_program, 'Season fee', 'sent', current_date + 30, 'CHF')
  returning id into v;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values ('00000000-0000-0000-0000-000000000001', v, 'Season fee', 1, p_amount, p_amount);
  update public.invoices set total_chf = p_amount where id = v;
  return v;
end $$;

-- Org B: admin, family, athlete (synthetic).
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000002c1', 'spn-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000002c1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000002c1', 'admin');
insert into public.families (id, org_id, name) values
  ('b0000000-0000-0000-0000-0000000002d1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('b0000000-0000-0000-0000-0000000002e1', '10000000-0000-0000-0000-000000000002',
   'b0000000-0000-0000-0000-0000000002d1', 'Test', 'Bplayer', '2015-01-01');

-- ===========================================================================
-- A. Column checks (admin of org A)
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'partial' where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'partial sponsorship without a percent is refused');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'partial', sponsorship_percent = 0 where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'percent 0 is refused');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'partial', sponsorship_percent = 101 where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'percent above 100 is refused');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'gift' where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'unknown kind is refused');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'full', sponsorship_scope = '{season,lunch}' where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'unknown scope value is refused');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'full', sponsorship_scope = '{}' where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'an empty scope is refused for a sponsorship');
  v := spn.run_as(admin_a, format($q$update public.athletes set sponsorship_kind = 'full', sponsor_name = %L where id = '00000000-0000-0000-0000-000000000073' returning id$q$, repeat('n', 121)));
  perform spn.ok(v like 'ERR:%', 'sponsor name longer than 120 characters is refused');
  v := spn.run_as(admin_a, format($q$update public.athletes set sponsorship_kind = 'full', sponsorship_reason = %L where id = '00000000-0000-0000-0000-000000000073' returning id$q$, repeat('r', 301)));
  perform spn.ok(v like 'ERR:%', 'reason longer than 300 characters is refused');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'full', sponsorship_from = '2026-09-01', sponsorship_until = '2026-08-01' where id = '00000000-0000-0000-0000-000000000073' returning id$q$);
  perform spn.ok(v like 'ERR:%', 'until before from is refused');
  perform spn.ok((select sponsorship_kind = 'none' and sponsorship_scope = '{season,recurring,membership}'
                    from public.athletes where id = '00000000-0000-0000-0000-000000000073'),
                 'defaults: kind none, scope season + recurring + membership');
end $$;

-- ===========================================================================
-- B. Staff-only guard
-- ===========================================================================
do $$
declare v text;
  admin_a   uuid := '00000000-0000-0000-0000-0000000000f1';
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  guardian  uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  v := spn.run_as(guardian, $q$update public.athletes set sponsorship_kind = 'full'
       where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  perform spn.ok(v like 'ERR:%SPONSORSHIP_STAFF_ONLY%', 'guardian cannot sponsor her own child (' || v || ')');
  v := spn.run_as(guardian, $q$update public.athletes set sponsor_name = 'Me'
       where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  perform spn.ok(v like 'ERR:%SPONSORSHIP_STAFF_ONLY%', 'guardian cannot set a sponsor name (' || v || ')');
  v := spn.run_as(guardian, $q$update public.athletes set school = 'Synthetic school'
       where id = '00000000-0000-0000-0000-000000000071' returning school$q$);
  perform spn.ok(v = 'OK:Synthetic school', 'guardian still edits other child fields (' || v || ')');
  v := spn.run_as(guardian, $q$insert into public.athletes (org_id, family_id, first_name, last_name, dob, sponsorship_kind, sponsorship_percent)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'New', 'Sibling', '2018-01-01', 'partial', 50) returning id$q$);
  perform spn.ok(v like 'ERR:%', 'guardian cannot add a sponsored child (' || v || ')');

  -- admin: full sponsorship for Lucas (072), seasons + recurring + membership
  v := spn.run_as(admin_a, $q$update public.athletes
         set sponsorship_kind = 'full', sponsorship_percent = 40, sponsor_name = 'Club – coach''s child',
             sponsorship_reason = 'Synthetic reason', sponsorship_from = '2026-01-01',
             sponsored_by = '00000000-0000-0000-0000-0000000000f4'
       where id = '00000000-0000-0000-0000-000000000072'
       returning sponsorship_percent::text || '/' || sponsored_by::text$q$);
  perform spn.ok(v = 'OK:100.00/00000000-0000-0000-0000-0000000000f1',
                 'admin sets a full sponsorship: percent forced to 100, sponsored_by = the caller (' || v || ')');
  -- finance: 50 % for Sophia (073), with scope season + recurring + membership + camp
  v := spn.run_as(finance_a, $q$update public.athletes
         set sponsorship_kind = 'partial', sponsorship_percent = 50, sponsor_name = 'Synthetic Company SA',
             sponsorship_scope = '{recurring,season,membership,camp,season}'
       where id = '00000000-0000-0000-0000-000000000073'
       returning sponsorship_percent::text || '/' || array_to_string(sponsorship_scope, ',') || '/' || sponsored_by::text$q$);
  perform spn.ok(v = 'OK:50.00/camp,membership,recurring,season/00000000-0000-0000-0000-0000000000f2',
                 'finance sets a partial sponsorship; scope de-duplicated (' || v || ')');
  perform spn.ok((select sponsored_at is not null from public.athletes where id = '00000000-0000-0000-0000-000000000073'),
                 'sponsored_at is stamped');
  v := spn.run_as(admin_a, $q$update public.athletes set sponsored_by = null, sponsored_at = '2000-01-01'
       where id = '00000000-0000-0000-0000-000000000073' returning sponsored_by::text$q$);
  perform spn.ok(v = 'OK:00000000-0000-0000-0000-0000000000f2', 'stamps cannot be rewritten by a client (' || v || ')');
  v := spn.run_as(guardian, $q$select coalesce(sponsor_name, 'none') from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform spn.ok(v = 'OK:none', 'guardian reads her child''s (empty) sponsorship (' || v || ')');
end $$;

-- ===========================================================================
-- C. Cross-tenant denial
-- ===========================================================================
do $$
declare v text;
  admin_b uuid := 'b0000000-0000-0000-0000-0000000002c1';
begin
  v := spn.run_as(admin_b, $q$select sponsor_name from public.athletes where id = '00000000-0000-0000-0000-000000000072'$q$);
  perform spn.ok(v = 'OK:<null>', 'org B admin cannot read an org A sponsorship (' || v || ')');
  v := spn.run_as(admin_b, $q$with u as (update public.athletes set sponsorship_kind = 'none'
       where id = '00000000-0000-0000-0000-000000000072' returning 1) select count(*)::text from u$q$);
  perform spn.ok(v = 'OK:0' or v like 'ERR:%', 'org B admin cannot change an org A sponsorship (' || v || ')');
  v := spn.run_as(admin_b, $q$select public.sponsorship_apply_open_invoices('00000000-0000-0000-0000-000000000072', true)::text$q$);
  perform spn.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'org B admin cannot run the admin action on an org A player (' || v || ')');
  v := spn.run_as(admin_b, $q$update public.athletes set sponsorship_kind = 'partial', sponsorship_percent = 25, sponsor_name = 'B sponsor'
       where id = 'b0000000-0000-0000-0000-0000000002e1' returning sponsorship_kind$q$);
  perform spn.ok(v = 'OK:partial', 'org B admin sponsors its own player (' || v || ')');
  perform spn.ok((select sponsorship_kind = 'full' from public.athletes where id = '00000000-0000-0000-0000-000000000072'),
                 'org A sponsorship unchanged after org B attempts');
end $$;

-- ===========================================================================
-- D. Audit
-- ===========================================================================
do $$
declare n int;
begin
  select count(*) into n from public.audit_logs
   where action = 'athlete.sponsorship.changed' and target_id = '00000000-0000-0000-0000-000000000072'
     and new_data ->> 'kind' = 'full' and actor_id = '00000000-0000-0000-0000-0000000000f1';
  perform spn.ok(n = 1, 'sponsorship change audited with the actor (' || n || ')');
  select count(*) into n from public.audit_logs
   where action = 'athlete.sponsorship.changed' and target_id = '00000000-0000-0000-0000-000000000073';
  perform spn.ok(n = 1, 'stamp-only update writes no extra audit row (' || n || ')');
  select count(*) into n from public.audit_logs
   where action = 'athlete.sponsorship.changed' and org_id = '10000000-0000-0000-0000-000000000002';
  perform spn.ok(n = 1, 'org B change audited in org B (' || n || ')');
end $$;

-- ===========================================================================
-- E. Billing
-- ===========================================================================
-- E1. Season invoices issued (the deferred trigger runs at commit).
do $$
begin
  insert into spn.ctx values
    ('inv_full',    spn.invoice('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000043', 290, 'SPN-1')::text),
    ('inv_partial', spn.invoice('00000000-0000-0000-0000-000000000073', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000043', 180, 'SPN-2')::text),
    ('inv_none',    spn.invoice('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000043', 290, 'SPN-3')::text),
    ('inv_manual',  spn.invoice('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000062', null, 50, 'SPN-4')::text);
end $$;

do $$
declare v_full uuid := (select v::uuid from spn.ctx where k = 'inv_full');
        v_part uuid := (select v::uuid from spn.ctx where k = 'inv_partial');
        v_none uuid := (select v::uuid from spn.ctx where k = 'inv_none');
        v_man  uuid := (select v::uuid from spn.ctx where k = 'inv_manual');
begin
  perform spn.ok((select status::text = 'paid' from public.invoices where id = v_full),
                 'fully sponsored season invoice is settled (status paid)');
  perform spn.ok((select public.invoice_amount_due(v_full) = 0 and public.invoice_net_paid(v_full) = 0),
                 'fully sponsored invoice: nothing due, nothing paid');
  perform spn.ok(exists (select 1 from public.invoice_adjustments where invoice_id = v_full and kind = 'credit_note'
                           and amount = 290 and description = 'Sponsorisé (Club – coach''s child)' and reason = 'sponsorship'),
                 'a labelled credit note "Sponsored (sponsor)" shows the value given');
  perform spn.ok(exists (select 1 from public.athlete_sponsorship_entries where invoice_id = v_full and amount = 290
                           and scope = 'season' and method = 'credit_note' and percent = 100),
                 'ledger row for the full sponsorship');
  perform public.recompute_invoice(v_full);
  perform spn.ok((select status::text = 'paid' from public.invoices where id = v_full),
                 'recompute keeps a settled zero-balance invoice paid');

  perform spn.ok((select status::text = 'sent' from public.invoices where id = v_part),
                 'partially sponsored invoice stays open');
  perform spn.ok((select public.invoice_amount_due(v_part) - public.invoice_net_paid(v_part) = 90),
                 'partial: the open balance (what dunning and autopay chase) is the family share only');
  perform spn.ok(exists (select 1 from public.athlete_sponsorship_entries where invoice_id = v_part and amount = 90 and percent = 50),
                 'ledger row for the partial sponsorship');

  perform spn.ok((select adjustments_total = 0 and status::text = 'sent' from public.invoices where id = v_none),
                 'invoice of a player who is not sponsored is untouched');
  perform spn.ok((select adjustments_total = 0 from public.invoices where id = v_man),
                 'invoice that is not a club fee (no programme / plan / membership) is untouched');
end $$;

-- E2. Idempotent: a later status change does not sponsor twice.
do $$
declare v_part uuid := (select v::uuid from spn.ctx where k = 'inv_partial');
begin
  update public.invoices set status = 'overdue' where id = v_part;
end $$;
do $$
declare v_part uuid := (select v::uuid from spn.ctx where k = 'inv_partial');
begin
  perform spn.ok((select count(*) = 1 from public.invoice_adjustments where invoice_id = v_part),
                 'sponsorship applied once per invoice and player');
end $$;

-- E3. Date window and scope.
do $$
begin
  update public.athletes set sponsorship_until = current_date - 1 where id = '00000000-0000-0000-0000-000000000072';
  insert into spn.ctx values
    ('inv_expired', spn.invoice('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000043', 290, 'SPN-5')::text);
end $$;
do $$
begin
  perform spn.ok((select adjustments_total = 0 from public.invoices where id = (select v::uuid from spn.ctx where k = 'inv_expired')),
                 'invoice after sponsorship_until is not sponsored');
  update public.athletes set sponsorship_until = null where id = '00000000-0000-0000-0000-000000000072';
  perform spn.ok(public.athlete_sponsorship_percent(a, 'camp', current_date) = 0
                 and public.athlete_sponsorship_percent(a, 'season', current_date) = 100
                 and public.athlete_sponsorship_percent(a, 'season', '2025-12-31') = 0, 'scope and from-date matching')
    from public.athletes a where a.id = '00000000-0000-0000-0000-000000000072';
end $$;

-- E4. Recurring fees: full = no invoice, partial = own line.
do $$
declare v_tpl uuid; n int;
begin
  insert into public.recurring_fee_templates (org_id, name, amount, currency, frequency, billing_day, start_date, proration, due_days)
  values ('00000000-0000-0000-0000-000000000001', 'Synthetic monthly fee', 100, 'CHF', 'monthly', 1, '2026-09-01', 'none', 10)
  returning id into v_tpl;
  perform spn.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.recurring_enrol(%L, array['00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000073']::uuid[], '2026-09-01')::text$q$, v_tpl));
  insert into spn.ctx values ('tpl', v_tpl::text);
  n := public.run_recurring_billing('00000000-0000-0000-0000-000000000001', '2026-09-05');
  perform spn.ok(n = 1, 'one period invoiced: the partially sponsored player only (' || n || ')');
end $$;
do $$
declare v_tpl uuid := (select v::uuid from spn.ctx where k = 'tpl'); r record;
begin
  select i.* into r from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
   where p.template_id = v_tpl and p.athlete_id = '00000000-0000-0000-0000-000000000072';
  perform spn.ok(r.status = 'skipped' and r.skipped_reason = 'sponsored' and r.invoice_id is null,
                 'fully sponsored period: skipped, no invoice issued');
  perform spn.ok(exists (select 1 from public.athlete_sponsorship_entries where installment_id = r.id and method = 'waived'
                           and amount = 100 and scope = 'recurring'),
                 'fully sponsored period recorded in the ledger (value waived)');
  select i.* into r from public.payment_plan_installments i join public.payment_plans p on p.id = i.plan_id
   where p.template_id = v_tpl and p.athlete_id = '00000000-0000-0000-0000-000000000073';
  perform spn.ok((select total_chf = 50 from public.invoices where id = r.invoice_id), 'partial period invoice total = 50');
  perform spn.ok(exists (select 1 from public.invoice_items where invoice_id = r.invoice_id and amount_chf = -50
                           and description = 'Sponsorisé (Synthetic Company SA)'),
                 'partial period invoice carries a "Sponsored (sponsor)" line');
  perform spn.ok((select count(*) = 1 from public.athlete_sponsorship_entries where invoice_id = r.invoice_id)
                 and (select adjustments_total = 0 from public.invoices where id = r.invoice_id),
                 'recurring invoice sponsored once (line, no extra credit note)');
end $$;

-- E5. Membership: fully sponsored = active, no invoice.
do $$
declare v_type uuid; v_res jsonb;
begin
  insert into public.membership_types (org_id, name, kind, scope, price, period, season_start_month)
  values ('00000000-0000-0000-0000-000000000001', 'Synthetic player membership', 'player', 'person', 120, 'season', 8)
  returning id into v_type;
  v_res := public.membership_create(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'type_id', v_type,
             'family_id', '00000000-0000-0000-0000-000000000062', 'athlete_id', '00000000-0000-0000-0000-000000000072'));
  perform spn.ok(v_res->>'invoice_id' is null and (v_res->>'amount')::numeric = 0 and (v_res->>'sponsored')::numeric = 120,
                 'fully sponsored membership: no invoice (' || v_res::text || ')');
  perform spn.ok((select status = 'active' from public.memberships where id = (v_res->>'membership_id')::uuid),
                 'fully sponsored membership is active at once');
  perform spn.ok(exists (select 1 from public.athlete_sponsorship_entries where membership_id = (v_res->>'membership_id')::uuid
                           and method = 'waived' and amount = 120),
                 'membership value recorded in the ledger');
  v_res := public.membership_create(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'type_id', v_type,
             'family_id', '00000000-0000-0000-0000-000000000062', 'athlete_id', '00000000-0000-0000-0000-000000000073'));
  perform spn.ok((v_res->>'amount')::numeric = 60 and (select total_chf = 60 from public.invoices where id = (v_res->>'invoice_id')::uuid),
                 'partially sponsored membership invoiced for the family share');
end $$;

-- E6. Admin action on open invoices issued before the sponsorship.
do $$
begin
  update public.athletes set sponsorship_kind = 'none' where id = '00000000-0000-0000-0000-000000000071';
  insert into spn.ctx values
    ('inv_before', spn.invoice('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000043', 290, 'SPN-6')::text);
end $$;
do $$
declare v text; v_inv uuid := (select c.v::uuid from spn.ctx c where c.k = 'inv_before');
  admin_a  uuid := '00000000-0000-0000-0000-0000000000f1';
  guardian uuid := '00000000-0000-0000-0000-0000000000f4';
begin
  perform spn.run_as(admin_a, $q$update public.athletes set sponsorship_kind = 'full', sponsor_name = 'Synthetic Foundation'
       where id = '00000000-0000-0000-0000-000000000071' returning id$q$);
  v := spn.run_as(guardian, $q$select public.sponsorship_apply_open_invoices('00000000-0000-0000-0000-000000000071', false)::text$q$);
  perform spn.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a guardian cannot run the admin action (' || v || ')');
  v := spn.run_as(admin_a, $q$select (public.sponsorship_apply_open_invoices('00000000-0000-0000-0000-000000000071', true) ->> 'invoices')$q$);
  perform spn.ok(v = 'OK:2', 'dry run lists the open invoices it would change (' || v || ')');
  perform spn.ok((select status::text = 'sent' from public.invoices where id = v_inv), 'dry run changes nothing');
  v := spn.run_as(admin_a, $q$select (public.sponsorship_apply_open_invoices('00000000-0000-0000-0000-000000000071', false) ->> 'invoices')$q$);
  perform spn.ok(v = 'OK:2', 'admin applies the sponsorship to open invoices (' || v || ')');
  perform spn.ok((select status::text = 'cancelled' and cancel_reason = 'Sponsorisé (Synthetic Foundation)' from public.invoices where id = v_inv),
                 'unpaid season invoice cancelled with the sponsorship as reason');
  perform spn.ok(exists (select 1 from public.athlete_sponsorship_entries where invoice_id = v_inv and method = 'cancellation' and amount = 290),
                 'cancelled invoice value recorded in the ledger');
  v := spn.run_as(admin_a, $q$select (public.sponsorship_apply_open_invoices('00000000-0000-0000-0000-000000000071', false) ->> 'invoices')$q$);
  perform spn.ok(v = 'OK:0', 'running it again changes nothing (' || v || ')');
end $$;

-- ===========================================================================
-- F. Ledger visibility
-- ===========================================================================
do $$
declare v text;
  finance_a uuid := '00000000-0000-0000-0000-0000000000f2';
  coach_a   uuid := '00000000-0000-0000-0000-0000000000f3';
  guardian  uuid := '00000000-0000-0000-0000-0000000000f4';
  admin_b   uuid := 'b0000000-0000-0000-0000-0000000002c1';
begin
  v := spn.run_as(finance_a, $q$select (count(*) > 0)::text from public.athlete_sponsorship_entries$q$);
  perform spn.ok(v = 'OK:true', 'finance reads the sponsorship ledger (' || v || ')');
  v := spn.run_as(coach_a, $q$select count(*)::text from public.athlete_sponsorship_entries$q$);
  perform spn.ok(v = 'OK:0', 'coach cannot read the ledger (' || v || ')');
  v := spn.run_as(guardian, $q$select count(*)::text from public.athlete_sponsorship_entries$q$);
  perform spn.ok(v = 'OK:0', 'guardian cannot read the ledger (' || v || ')');
  v := spn.run_as(admin_b, $q$select count(*)::text from public.athlete_sponsorship_entries$q$);
  perform spn.ok(v = 'OK:0', 'org B admin cannot read the org A ledger (' || v || ')');
  v := spn.run_as(finance_a, $q$insert into public.athlete_sponsorship_entries (org_id, athlete_id, scope, method, sponsorship_kind, percent,
         list_amount, amount, currency, service_date) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072',
         'season', 'waived', 'full', 100, 10, 10, 'CHF', current_date) returning id$q$);
  perform spn.ok(v like 'ERR:%', 'the ledger is written by the billing functions only (' || v || ')');
  v := spn.run_as(guardian, $q$select public.sponsorship_apply_service((select v::uuid from spn.ctx where k = 'inv_none'))::text$q$);
  perform spn.ok(v like 'ERR:%', 'clients cannot call the service apply (' || v || ')');
end $$;
