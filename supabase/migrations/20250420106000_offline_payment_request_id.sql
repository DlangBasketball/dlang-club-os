-- Manual payment idempotency: a retry or a double click on "Record payment"
-- (cash / bank transfer / TWINT / QR-bill) must not book the same payment
-- twice. record_offline_payment_once() wraps the existing
-- record_offline_payment() with a client request id:
--   * the same request id on the same invoice returns the first payment
--     (replayed = true) and books nothing;
--   * concurrent calls with one request id are serialised with a
--     transaction-scoped advisory lock;
--   * payments are append-only, so the request id is kept in a small
--     mapping table offline_payment_requests (org, request, invoice ->
--     payment), written only by this function.
-- Role, org and amount checks stay in record_offline_payment(). Additive and
-- idempotent; the existing function is unchanged.

create table if not exists public.offline_payment_requests (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  request_id  uuid not null,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  payment_id  uuid not null references public.payments(id) on delete cascade,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, request_id, invoice_id)
);
create index if not exists idx_offline_payment_requests_org on public.offline_payment_requests(org_id);
create index if not exists idx_offline_payment_requests_payment on public.offline_payment_requests(payment_id);
alter table public.offline_payment_requests enable row level security;

-- Read: finance / admin of the same club. Writes: only the security definer
-- function below (no insert / update / delete policy for clients).
drop policy if exists offline_payment_requests_select on public.offline_payment_requests;
create policy offline_payment_requests_select on public.offline_payment_requests
  for select to authenticated using (org_id = public.current_org_id() and (public.is_finance() or public.is_admin()));
drop policy if exists offline_payment_requests_insert on public.offline_payment_requests;
create policy offline_payment_requests_insert on public.offline_payment_requests
  for insert to authenticated with check (false);
drop policy if exists offline_payment_requests_update on public.offline_payment_requests;
create policy offline_payment_requests_update on public.offline_payment_requests
  for update to authenticated using (false) with check (false);
drop policy if exists offline_payment_requests_delete on public.offline_payment_requests;
create policy offline_payment_requests_delete on public.offline_payment_requests
  for delete to authenticated using (false);

create or replace function public.record_offline_payment_once(
  p_invoice uuid, p_amount numeric, p_method text,
  p_paid_on date default null, p_reference text default null, p_note text default null,
  p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := public.current_org_id();
  v_pay  uuid;
  v_res  jsonb;
begin
  if v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_request_id is null then
    return public.record_offline_payment(p_invoice, p_amount, p_method, p_paid_on, p_reference, p_note);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('offline_payment:' || p_request_id::text, 0));
  select payment_id into v_pay from public.offline_payment_requests
   where org_id = v_org and request_id = p_request_id and invoice_id = p_invoice;
  if v_pay is not null then
    return jsonb_build_object('payment_id', v_pay, 'invoice_id', p_invoice, 'replayed', true);
  end if;
  v_res := public.record_offline_payment(p_invoice, p_amount, p_method, p_paid_on, p_reference, p_note);
  insert into public.offline_payment_requests (org_id, request_id, invoice_id, payment_id, created_by)
  values (v_org, p_request_id, p_invoice, (v_res->>'payment_id')::uuid, auth.uid())
  on conflict do nothing;
  return v_res || jsonb_build_object('replayed', false);
end $$;

revoke all on function public.record_offline_payment_once(uuid, numeric, text, date, text, text, uuid) from public, anon;
grant execute on function public.record_offline_payment_once(uuid, numeric, text, date, text, text, uuid) to authenticated, service_role;
