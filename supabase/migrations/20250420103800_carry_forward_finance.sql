-- Finance may carry a prior-season club balance forward (founder requirement:
-- "Allow Finance to carry forward a prior-season club balance"). Same function,
-- caller check widened from admin to admin or finance. Idempotent.

create or replace function public.membership_carry_forward(p_from uuid, p_to uuid, p_amount numeric, p_reason text, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  f public.memberships; t public.memberships; sf public.seasons; st public.seasons;
  v_amount numeric; v_inv uuid; v_num text; v_prev public.invoices;
begin
  if v_org is null or not (public.is_admin() or public.is_finance()) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':invoice:' || p_request_id::text, 0));
    select * into v_prev from public.invoices where org_id = v_org and request_id = p_request_id;
    if found then return jsonb_build_object('invoice_id', v_prev.id, 'number', v_prev.number, 'amount', v_prev.total_chf, 'replayed', true); end if;
  end if;
  select * into f from public.memberships where id = p_from and org_id = v_org and kind = 'season_fee';
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into t from public.memberships where id = p_to and org_id = v_org and kind = 'season_fee' for update;
  if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
  if t.status = 'cancelled' then raise exception 'MEMBERSHIP_CANCELLED' using errcode = 'P0001'; end if;
  if f.id = t.id or f.athlete_id is distinct from t.athlete_id then raise exception 'CARRY_FORWARD_MISMATCH' using errcode = 'P0001'; end if;
  select * into sf from public.seasons where id = f.season_id;
  select * into st from public.seasons where id = t.season_id;
  if st.starts_on <= sf.starts_on then raise exception 'CARRY_FORWARD_SEASON_ORDER' using errcode = 'P0001'; end if;
  v_amount := round(coalesce(p_amount, 0), public.currency_exponent(t.currency));
  if v_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;

  v_num := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, athlete_id, description, status, due_date, currency, total_chf, created_by,
                               activity, activity_source, membership_id, charge_kind, request_id)
  values (v_org, v_num, t.family_id, t.athlete_id, left(btrim(p_reason), 500), 'sent', public.ca_org_today(v_org) + 30, t.currency,
          v_amount, auth.uid(), 'club_membership', 'set', t.id, 'carry_forward', p_request_id)
  returning id into v_inv;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (v_org, v_inv, left(btrim(p_reason), 500), 1, v_amount, v_amount);
  perform public.money_audit(v_org, 'MEMBERSHIP_CARRY_FORWARD', 'invoices', v_inv, null,
    jsonb_build_object('from_membership', f.id, 'to_membership', t.id, 'amount', v_amount, 'reason', btrim(p_reason)));
  return jsonb_build_object('invoice_id', v_inv, 'number', v_num, 'amount', v_amount, 'replayed', false);
end;
$$;

-- Money of one membership: season fee (charge_kind season_fee) separate from
-- carry-forwards and adjustments. RLS applies (security invoker).
create or replace function public.membership_summary(p_membership uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with inv as (
    select i.id, i.charge_kind, i.status::text as status, i.currency,
           case when i.status::text in ('cancelled', 'void') then 0 else i.total_chf + coalesce(i.adjustments_total, 0) end as due,
           public.invoice_net_paid(i.id) as paid
      from public.invoices i where i.membership_id = p_membership
  )
  select jsonb_build_object(
    'membership_id', m.id, 'season_id', m.season_id, 'agreed_fee', m.agreed_fee, 'currency', m.currency, 'sponsored', m.sponsored,
    'season_fee', jsonb_build_object(
       'invoiced', coalesce((select sum(due) from inv where charge_kind = 'season_fee'), 0),
       'paid', coalesce((select sum(paid) from inv where charge_kind = 'season_fee'), 0),
       'balance', coalesce((select sum(greatest(due - paid, 0)) from inv where charge_kind = 'season_fee'), 0)),
    'carry_forward', jsonb_build_object(
       'invoiced', coalesce((select sum(due) from inv where charge_kind = 'carry_forward'), 0),
       'paid', coalesce((select sum(paid) from inv where charge_kind = 'carry_forward'), 0),
       'balance', coalesce((select sum(greatest(due - paid, 0)) from inv where charge_kind = 'carry_forward'), 0)),
    'other', jsonb_build_object(
       'invoiced', coalesce((select sum(due) from inv where coalesce(charge_kind, 'adjustment') = 'adjustment'), 0),
       'paid', coalesce((select sum(paid) from inv where coalesce(charge_kind, 'adjustment') = 'adjustment'), 0)),
    'invoice_ids', coalesce((select jsonb_agg(id) from inv), '[]'::jsonb))
  from public.memberships m where m.id = p_membership
$$;

-- ===========================================================================
-- 20. invoice_source: the record an invoice was raised for
-- ===========================================================================
create or replace function public.invoice_source(p_invoice uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare v record; x record;
begin
  select i.id, i.membership_id, i.registration_id, i.program_id into v from public.invoices i where i.id = p_invoice;
  if not found then return null; end if;
  if v.membership_id is not null then
    select m.id, coalesce(s.name, mt.name) as label into x
      from public.memberships m left join public.seasons s on s.id = m.season_id left join public.membership_types mt on mt.id = m.membership_type_id
     where m.id = v.membership_id;
    if found then return jsonb_build_object('kind', 'membership', 'id', x.id, 'label', x.label); end if;
  end if;
  select m.id, mt.name as label into x from public.memberships m left join public.membership_types mt on mt.id = m.membership_type_id
   where m.invoice_id = p_invoice limit 1;
  if found then return jsonb_build_object('kind', 'membership', 'id', x.id, 'label', x.label); end if;
  select a.id, p.name as label into x from public.program_applications a join public.programs p on p.id = a.program_id
   where a.invoice_id = p_invoice order by a.created_at desc limit 1;
  if found then return jsonb_build_object('kind', 'programme', 'id', x.id, 'label', x.label, 'program_id', (select program_id from public.program_applications where id = x.id)); end if;
  select r.id, p.name as label into x from public.registrations r left join public.programs p on p.id = r.program_id
   where r.id = v.registration_id or r.invoice_id = p_invoice order by coalesce(r.id = v.registration_id, false) desc limit 1;
  if found then return jsonb_build_object('kind', 'registration', 'id', x.id, 'label', x.label); end if;
  select b.id, ts.name || ' · ' || to_char(b.slot_start, 'YYYY-MM-DD HH24:MI') as label into x
    from public.training_bookings b left join public.training_services ts on ts.id = b.service_id
   where b.invoice_id = p_invoice order by b.slot_start limit 1;
  if found then return jsonb_build_object('kind', 'booking', 'id', x.id, 'label', x.label); end if;
  select tp.id, ts.name as label into x from public.training_package_purchases tp left join public.training_services ts on ts.id = tp.service_id
   where tp.invoice_id = p_invoice limit 1;
  if found then return jsonb_build_object('kind', 'training_package', 'id', x.id, 'label', x.label); end if;
  select so.id, so.number as label into x from public.shop_orders so where so.invoice_id = p_invoice limit 1;
  if found then return jsonb_build_object('kind', 'shop', 'id', x.id, 'label', x.label); end if;
  if v.program_id is not null then
    select p.id, p.name as label into x from public.programs p where p.id = v.program_id;
    if found then return jsonb_build_object('kind', 'programme', 'id', x.id, 'label', x.label, 'program_id', x.id); end if;
  end if;
  return null;
end $$;
