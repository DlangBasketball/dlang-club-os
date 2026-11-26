-- ============================================================================
-- Draft invoices are staff-only (migration 20250420103000).
--
-- Fixture identities (seed): org A …0001 (finance …f2, parent …f4 = guardian
-- of family …061), invoice …091 ('sent', family …061). Org B = Riverside
-- 10000000-…0002; its admin+finance user is created here.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema me;
grant usage on schema me to authenticated, anon;

create function me.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function me.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function me.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Count of rows of p_sql visible to user p.
create function me.count_as(p uuid, p_sql text) returns int language plpgsql as $$
declare v int;
begin
  perform me.as_user(p);
  execute 'select count(*) from (' || p_sql || ') x' into v;
  perform me.as_super();
  return v;
end $$;
grant execute on all functions in schema me to authenticated, anon;

-- Org B admin + finance
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test')
on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance')
on conflict do nothing;

do $$
declare
  v jsonb; v_inv uuid;
  c_fin constant uuid := '00000000-0000-0000-0000-0000000000f2';
  c_parent constant uuid := '00000000-0000-0000-0000-0000000000f4';
  c_other constant uuid := 'b0000000-0000-0000-0000-0000000000b1';
begin
  -- Finance drafts an invoice for the parent's family.
  perform me.as_user(c_fin);
  -- Revenue category required for manual invoices (migration 20250420103500).
  v := public.create_manual_invoice(jsonb_build_object(
         'family_id', '00000000-0000-0000-0000-000000000061', 'description', 'Draft for review', 'activity', 'camp',
         'items', jsonb_build_array(jsonb_build_object('description', 'Fee', 'quantity', 1, 'unit_price_chf', 100))));
  perform me.as_super();
  v_inv := (v->>'invoice_id')::uuid;
  perform me.ok((select status::text from public.invoices where id = v_inv) = 'draft', 'manual invoice starts as a draft');

  perform me.ok(me.count_as(c_fin, format('select id from public.invoices where id = %L', v_inv)) = 1, 'finance sees the draft');
  perform me.ok(me.count_as(c_parent, format('select id from public.invoices where id = %L', v_inv)) = 0, 'guardian does NOT see the draft invoice');
  perform me.ok(me.count_as(c_parent, format('select id from public.invoice_items where invoice_id = %L', v_inv)) = 0, 'guardian does NOT see the draft''s lines');
  perform me.ok(me.count_as(c_parent, 'select id from public.invoices where id = ''00000000-0000-0000-0000-000000000091''') = 1, 'guardian still sees the family''s sent invoice');
  perform me.ok(me.count_as(c_parent, 'select id from public.invoice_items where invoice_id = ''00000000-0000-0000-0000-000000000091''') >= 1, 'guardian still sees the sent invoice''s lines');

  -- Cross-tenant: another club's staff sees neither draft nor issued invoice.
  perform me.ok(me.count_as(c_other, format('select id from public.invoices where id = %L', v_inv)) = 0, 'cross-tenant: other club''s finance cannot see the draft');
  perform me.ok(me.count_as(c_other, 'select id from public.invoices where id = ''00000000-0000-0000-0000-000000000091''') = 0, 'cross-tenant: other club''s finance cannot see the sent invoice');

  -- Once issued, the guardian sees it.
  update public.invoices set status = 'sent', issued_at = now() where id = v_inv;
  perform me.ok(me.count_as(c_parent, format('select id from public.invoices where id = %L', v_inv)) = 1, 'guardian sees the invoice once it is sent');
  perform me.ok(me.count_as(c_parent, format('select id from public.invoice_items where invoice_id = %L', v_inv)) = 1, 'guardian sees its lines once it is sent');

  -- Anonymous never.
  perform me.ok(me.count_as(null, format('select id from public.invoices where id = %L', v_inv)) = 0, 'anon cannot see invoices');
end $$;

\echo PASS draft_invoices suite finished
