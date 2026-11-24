-- ============================================================================
-- Manual payment idempotency (migration 20250420106000): a retry or double
-- click with the same request id books the payment once.
--
-- Fixture identities (seed): org A …0001 (finance …f2, parent …f4 = guardian
-- of family …061), invoice …091 ('sent', family …061). Org B = Riverside
-- 10000000-…0002; its admin+finance user is created here.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema op;
grant usage on schema op to authenticated, anon;

create function op.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function op.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function op.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
grant execute on all functions in schema op to authenticated, anon;

insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b9', 'finance-op@riverside.test')
on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000b9';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b9', 'finance')
on conflict do nothing;

do $$
declare
  v jsonb; v2 jsonb; v_inv uuid; v_req uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid(); n0 int; n int; ok boolean;
  c_fin constant uuid := '00000000-0000-0000-0000-0000000000f2';
  c_parent constant uuid := '00000000-0000-0000-0000-0000000000f4';
  c_other constant uuid := 'b0000000-0000-0000-0000-0000000000b9';
begin
  perform op.as_user(c_fin);
  v := public.create_manual_invoice(jsonb_build_object(
         'family_id', '00000000-0000-0000-0000-000000000061', 'description', 'Idempotency check', 'activity', 'camp',
         'items', jsonb_build_array(jsonb_build_object('description', 'Fee', 'quantity', 1, 'unit_price_chf', 300))));
  perform op.as_super();
  v_inv := (v->>'invoice_id')::uuid;
  update public.invoices set status = 'sent', issued_at = now() where id = v_inv;
  select count(*) into n0 from public.payments where invoice_id = v_inv;

  perform op.as_user(c_fin);
  v := public.record_offline_payment_once(v_inv, 100, 'bank_transfer', current_date, 'OP-1', null, v_req);
  v2 := public.record_offline_payment_once(v_inv, 100, 'bank_transfer', current_date, 'OP-1', null, v_req);
  perform op.as_super();
  select count(*) into n from public.payments where invoice_id = v_inv;
  perform op.ok(n = n0 + 1, 'same request id twice books one payment (' || n - n0 || ')');
  perform op.ok((v2->>'replayed')::boolean and v2->>'payment_id' = v->>'payment_id', 'the retry returns the first payment (replayed)');
  perform op.ok((select payment_id from public.offline_payment_requests where request_id = v_req and invoice_id = v_inv) = (v->>'payment_id')::uuid, 'the request id maps to the payment');
  perform op.as_user(c_parent);
  perform op.ok((select count(*) from public.offline_payment_requests) = 0, 'guardian cannot read the request map');
  perform op.as_user(c_other);
  perform op.ok((select count(*) from public.offline_payment_requests) = 0, 'cross-tenant: other club cannot read the request map');
  perform op.as_super();
  perform op.ok(public.invoice_net_paid(v_inv) = 100, 'invoice paid amount counted once (100)');

  perform op.as_user(c_fin);
  v := public.record_offline_payment_once(v_inv, 50, 'twint', current_date, null, null, v_req2);
  perform op.as_super();
  perform op.ok(public.invoice_net_paid(v_inv) = 150 and not (v->>'replayed')::boolean, 'a new request id books a second payment (150)');

  -- Without a request id it behaves like record_offline_payment (no replay).
  perform op.as_user(c_fin);
  v := public.record_offline_payment_once(v_inv, 10, 'manual', current_date, null, null, null);
  perform op.as_super();
  perform op.ok(public.invoice_net_paid(v_inv) = 160, 'no request id: plain booking');

  -- A guardian cannot record payments.
  ok := false;
  begin
    perform op.as_user(c_parent);
    perform public.record_offline_payment_once(v_inv, 10, 'manual', current_date, null, null, gen_random_uuid());
  exception when others then ok := true; end;
  perform op.as_super();
  perform op.ok(ok and public.invoice_net_paid(v_inv) = 160, 'guardian is refused');

  -- Another club's finance cannot book on this invoice, nor replay its request id.
  ok := false;
  begin
    perform op.as_user(c_other);
    perform public.record_offline_payment_once(v_inv, 10, 'manual', current_date, null, null, v_req);
  exception when others then ok := true; end;
  perform op.as_super();
  perform op.ok(ok and public.invoice_net_paid(v_inv) = 160, 'cross-tenant: other club refused');

  -- Anonymous never.
  ok := false;
  begin
    perform op.as_user(null);
    perform public.record_offline_payment_once(v_inv, 10, 'manual', current_date, null, null, gen_random_uuid());
  exception when others then ok := true; end;
  perform op.as_super();
  perform op.ok(ok, 'anon refused');
end $$;

\echo PASS offline_payment_idempotency suite finished
