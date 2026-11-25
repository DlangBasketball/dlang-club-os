-- ============================================================================
-- Payer invoice access (migration 20250420106800_booker_invoice_access.sql)
--
-- A person who booked for another family's child pays the invoice (payer_kind
-- 'other'): they read that invoice, its items and payments, nothing else of
-- the family. Draft invoices stay hidden; other users, the child's other
-- invoices and other clubs are denied; writes stay finance-only.
-- Fixtures: synthetic only (ids …b8…).
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema bia;
grant usage on schema bia to authenticated, anon, service_role;
create function bia.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function bia.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    execute 'set local role authenticated';
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
grant execute on all functions in schema bia to authenticated, anon, service_role;

-- b801 guardian of family F, b802 booker (own family G), b803 another parent, b891 org B admin.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000b801', 'bia-guardian@example.test'),
  ('00000000-0000-0000-0000-00000000b802', 'bia-booker@example.test'),
  ('00000000-0000-0000-0000-00000000b803', 'bia-other@example.test'),
  ('b0000000-0000-0000-0000-00000000b891', 'bia-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('00000000-0000-0000-0000-00000000b801', '00000000-0000-0000-0000-00000000b802', '00000000-0000-0000-0000-00000000b803');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-00000000b891';
insert into public.staff_roles (org_id, profile_id, role) values ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000b891', 'admin');
insert into public.families (id, org_id, name) values
  ('00000000-0000-0000-0000-00000000b821', '00000000-0000-0000-0000-000000000001', 'Synthetic BIA Family F'),
  ('00000000-0000-0000-0000-00000000b822', '00000000-0000-0000-0000-000000000001', 'Synthetic BIA Family G'),
  ('00000000-0000-0000-0000-00000000b823', '00000000-0000-0000-0000-000000000001', 'Synthetic BIA Family H');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-00000000b821', '00000000-0000-0000-0000-00000000b801', 'guardian', true),
  ('00000000-0000-0000-0000-00000000b822', '00000000-0000-0000-0000-00000000b802', 'guardian', true),
  ('00000000-0000-0000-0000-00000000b823', '00000000-0000-0000-0000-00000000b803', 'guardian', true);

-- I1: camp invoice of family F paid by the booker; I2: F's own invoice; I3: draft paid by the booker.
insert into public.invoices (id, org_id, number, family_id, status, currency, total_chf, payer_kind, payer_profile_id) values
  ('00000000-0000-0000-0000-0000000b8a01', '00000000-0000-0000-0000-000000000001', 'BIA-1', '00000000-0000-0000-0000-00000000b821', 'sent', 'CHF', 300, 'other', '00000000-0000-0000-0000-00000000b802'),
  ('00000000-0000-0000-0000-0000000b8a02', '00000000-0000-0000-0000-000000000001', 'BIA-2', '00000000-0000-0000-0000-00000000b821', 'sent', 'CHF', 120, null, null),
  ('00000000-0000-0000-0000-0000000b8a03', '00000000-0000-0000-0000-000000000001', 'BIA-3', '00000000-0000-0000-0000-00000000b821', 'draft', 'CHF', 80, 'other', '00000000-0000-0000-0000-00000000b802');
insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b8a01', 'Synthetic camp week', 1, 300, 300),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b8a02', 'Synthetic club fee', 1, 120, 120);
insert into public.payments (org_id, invoice_id, amount_chf, method, status, paid_at) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b8a01', 100, 'twint', 'succeeded', now()),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b8a02', 120, 'twint', 'succeeded', now());

do $$
declare r text;
  b uuid := '00000000-0000-0000-0000-00000000b802';
begin
  r := bia.run_as(b, 'select string_agg(number, '','' order by number) from public.invoices');
  perform bia.ok(r = 'OK:BIA-1', 'booker sees only the issued invoice they pay (' || r || ')');
  r := bia.run_as(b, 'select count(*)::text from public.invoice_items');
  perform bia.ok(r = 'OK:1', 'booker sees that invoice''s items only (' || r || ')');
  r := bia.run_as(b, 'select coalesce(sum(amount_chf), 0)::text from public.payments');
  perform bia.ok(r = 'OK:100.00' or r = 'OK:100', 'booker sees the payments of that invoice only (' || r || ')');
  r := bia.run_as(b, 'select count(*)::text from public.families where id = ''00000000-0000-0000-0000-00000000b821''');
  perform bia.ok(r = 'OK:0', 'booker does not see the child''s family (' || r || ')');
  r := bia.run_as(b, $q$update public.invoices set total_chf = 1 where id = '00000000-0000-0000-0000-0000000b8a01' returning 1$q$);
  perform bia.ok(r = 'OK:<null>' and (select total_chf = 300 from public.invoices where id = '00000000-0000-0000-0000-0000000b8a01'),
                 'booker cannot change the invoice (' || r || ')');
  r := bia.run_as(b, $q$insert into public.payments (org_id, invoice_id, amount_chf, method, status) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000b8a01', 200, 'manual', 'succeeded') returning 1$q$);
  perform bia.ok(r like 'ERR:%', 'booker cannot record a payment (' || left(r, 60) || ')');
  r := bia.run_as(b, $q$select public.is_invoice_payer('00000000-0000-0000-0000-0000000b8a01')::text || '/' || public.is_invoice_payer('00000000-0000-0000-0000-0000000b8a03')::text$q$);
  perform bia.ok(r = 'OK:true/false', 'is_invoice_payer: issued yes, draft no (' || r || ')');

  r := bia.run_as('00000000-0000-0000-0000-00000000b801', 'select string_agg(number, '','' order by number) from public.invoices');
  perform bia.ok(r = 'OK:BIA-2', 'guardian of F keeps seeing only the family-paid invoice, not the booker''s (' || r || ')');
  r := bia.run_as('00000000-0000-0000-0000-00000000b803', 'select count(*)::text from public.invoices where number like ''BIA-%''');
  perform bia.ok(r = 'OK:0', 'another parent sees none (' || r || ')');
  r := bia.run_as('00000000-0000-0000-0000-00000000b803', $q$select public.is_invoice_payer('00000000-0000-0000-0000-0000000b8a01')::text$q$);
  perform bia.ok(r = 'OK:false', 'another parent is not the payer');
  r := bia.run_as('b0000000-0000-0000-0000-00000000b891', 'select count(*)::text from public.invoices where number like ''BIA-%''');
  perform bia.ok(r = 'OK:0', 'other club admin sees none (' || r || ')');
  r := bia.run_as(null, 'select count(*)::text from public.invoices where number like ''BIA-%''');
  perform bia.ok(r like 'ERR:%' or r = 'OK:0', 'anonymous sees none (' || r || ')');
end $$;

-- A payer via billing_payers (profile on the payer record) also qualifies.
do $$
declare r text; v_payer uuid;
begin
  insert into public.billing_payers (org_id, kind, name, profile_id)
  values ('00000000-0000-0000-0000-000000000001', 'other', 'Synthetic Booker Payer', '00000000-0000-0000-0000-00000000b803')
  returning id into v_payer;
  update public.invoices set payer_profile_id = null, payer_id = v_payer where id = '00000000-0000-0000-0000-0000000b8a01';
  r := bia.run_as('00000000-0000-0000-0000-00000000b803', 'select string_agg(number, '','') from public.invoices where number like ''BIA-%''');
  perform bia.ok(r = 'OK:BIA-1', 'payer linked through billing_payers sees the invoice (' || r || ')');
  r := bia.run_as('00000000-0000-0000-0000-00000000b802', 'select count(*)::text from public.invoices where number like ''BIA-%''');
  perform bia.ok(r = 'OK:0', 'the previous payer no longer sees it (' || r || ')');
end $$;
