-- Selection programmes: a payment period (e.g. EYBL: September - June).
-- * programs.payment_starts_on / payment_ends_on (optional, per programme; set in Set-up).
-- * The first due date defaults to the payment period start.
-- * A fee arrangement whose last instalment falls after the payment period end is refused
--   (SCHEDULE_PAST_PAYMENT_END): raise the monthly amount or move the first due date.
-- Additive and idempotent.

alter table public.programs add column if not exists payment_starts_on date;
alter table public.programs add column if not exists payment_ends_on date;
do $$ begin
  alter table public.programs add constraint programs_payment_period_chk
    check (payment_starts_on is null or payment_ends_on is null or payment_ends_on >= payment_starts_on);
exception when duplicate_object then null; end $$;
comment on column public.programs.payment_starts_on is 'Selection programmes: first month of the payment period (default first due date of a fee arrangement).';
comment on column public.programs.payment_ends_on is 'Selection programmes: last day of the payment period; no instalment may fall after it.';

create or replace function public.selection_apply_arrangement_internal(
  p_application uuid, p_kind text, p_package uuid, p_monthly numeric, p_first date, p_reason text, p_fee numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a       public.program_applications;
  pkg     public.program_packages;
  prog    public.programs;
  v       public.invoices;
  v_cur   text;
  v_fee   numeric;
  v_first date := p_first;
  v_inv   uuid;
  v_paid  boolean;
  v_diff  numeric;
  v_dates date[];
  v_amts  numeric[];
  v_n     int;
  v_plan  uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old   jsonb;
begin
  select * into a from public.program_applications where id = p_application for update;
  if not found then raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002'; end if;
  if a.status not in ('accepted', 'enrolled') then raise exception 'NOT_ACCEPTED' using errcode = 'P0001'; end if;
  select * into pkg from public.program_packages where id = coalesce(p_package, a.package_id) and program_id = a.program_id;
  if not found then raise exception 'PACKAGE_REQUIRED' using errcode = 'P0001'; end if;
  if p_kind not in ('full', 'monthly') then raise exception 'INVALID_ARRANGEMENT' using errcode = 'P0001'; end if;
  select * into prog from public.programs where id = a.program_id;
  v_first := coalesce(v_first, prog.payment_starts_on, current_date);
  v_cur := upper(coalesce(nullif(prog.currency, ''), (select currency from public.app_settings where org_id = a.org_id),
                          (select currency from public.organizations where id = a.org_id), 'CHF'));
  v_fee := round(coalesce(p_fee, pkg.price), public.currency_exponent(v_cur));
  if v_fee <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  -- A fee other than the package price needs a reason (admin / finance only: callers check).
  if v_fee <> round(pkg.price, public.currency_exponent(v_cur)) and v_reason is null then
    raise exception 'FEE_REASON_REQUIRED' using errcode = 'P0001';
  end if;
  -- Validates the schedule (monthly amount, count <= 24) before anything changes.
  select array_agg(s.due_on order by s.seq), array_agg(s.amount order by s.seq)
    into v_dates, v_amts
    from public.selection_arrangement_schedule(v_fee, p_kind, p_monthly, v_first, v_cur) s;
  v_n := cardinality(v_dates);
  if prog.payment_ends_on is not null and v_dates[v_n] > prog.payment_ends_on then
    raise exception 'SCHEDULE_PAST_PAYMENT_END' using errcode = 'P0001';
  end if;
  v_old := jsonb_build_object('package_id', a.package_id, 'agreed_fee', a.agreed_fee, 'arrangement_kind', a.arrangement_kind,
                              'monthly_amount', a.monthly_amount, 'first_due_on', a.first_due_on, 'invoice_id', a.invoice_id);

  v_inv := a.invoice_id;
  if v_inv is not null and (select status::text from public.invoices where id = v_inv) in ('cancelled', 'void') then
    v_inv := null;
  end if;
  v_paid := v_inv is not null and exists (select 1 from public.payments where invoice_id = v_inv and status::text = 'succeeded'
                                                                       and voided_at is null and amount_chf > 0);

  if v_inv is not null and not v_paid then
    -- Clean re-issue (history: the old invoice stays, cancelled with the reason).
    if not public.selection_cancel_invoice(v_inv, coalesce(v_reason, 'Fee arrangement changed')) then
      raise exception 'ARRANGEMENT_LOCKED' using errcode = 'P0001';
    end if;
    v_inv := null;
  end if;

  update public.program_applications set package_id = pkg.id where id = a.id;

  if v_inv is null then
    v_inv := public.selection_issue_invoice(a.id, v_fee);
    update public.invoices set due_date = v_first where id = v_inv;
  else
    -- Money received: the paid invoice is never edited. A reason is needed only
    -- when the amount changes (credit / debit note); a schedule-only change needs none.
    v_diff := v_fee - coalesce(a.agreed_fee, (select total_chf from public.invoices where id = v_inv));
    if v_diff <> 0 and v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
    v_reason := coalesce(v_reason, 'Payment schedule changed');
    if v_diff > 0 then
      perform public.issue_invoice_adjustment(v_inv, 'debit_note', v_diff, v_reason, null);
    elsif v_diff < 0 then
      perform public.issue_invoice_adjustment(v_inv, 'credit_note', -v_diff, v_reason, null);
    end if;
    update public.payment_plan_installments set status = 'cancelled'
     where invoice_id = v_inv and status = 'scheduled'
       and plan_id in (select id from public.payment_plans where invoice_id = v_inv and kind = 'installments' and status in ('active', 'paused'));
    update public.payment_plans set status = 'cancelled', cancel_reason = left(v_reason, 500)
     where invoice_id = v_inv and kind = 'installments' and status in ('active', 'paused', 'completed');
    update public.invoices set due_date = v_first where id = v_inv;
  end if;

  if v_n >= 2 then
    select * into v from public.invoices where id = v_inv for update;
    -- The plan covers the whole amount due; received money settles the first instalments.
    select array_agg(s.due_on order by s.seq), array_agg(s.amount order by s.seq)
      into v_dates, v_amts
      from public.selection_arrangement_schedule(public.invoice_amount_due(v_inv), p_kind, p_monthly, v_first, v.currency) s;
    v_n := cardinality(v_dates);
    if v_n >= 2 then
      v_plan := public.plan_create_internal(v, v_dates, v_amts, 0, 'invoice', 'monthly');
    else
      update public.invoices set due_date = v_dates[1] where id = v_inv;
    end if;
  end if;
  perform public.refresh_invoice_overdue(v_inv);

  update public.program_applications
     set package_id = pkg.id, agreed_fee = v_fee, agreed_currency = v_cur, arrangement_kind = p_kind,
         monthly_amount = case when p_kind = 'monthly' then round(p_monthly, public.currency_exponent(v_cur)) end,
         first_due_on = v_first, arrangement_installments = v_n, installment_count = v_n,
         tournaments_covered_count = pkg.tournament_count, agreed_at = now(), agreed_by = auth.uid()
   where id = a.id;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (a.org_id, auth.uid(), 'selection.arrangement_set', 'program_applications', a.id, v_old,
          jsonb_build_object('package_id', pkg.id, 'agreed_fee', v_fee, 'currency', v_cur, 'arrangement_kind', p_kind,
                             'monthly_amount', p_monthly, 'first_due_on', v_first, 'installments', v_n,
                             'invoice_id', v_inv, 'plan_id', v_plan, 'reason', v_reason, 'had_payments', v_paid));
  return jsonb_build_object('application_id', a.id, 'invoice_id', v_inv, 'plan_id', v_plan, 'installments', v_n,
                            'agreed_fee', v_fee, 'currency', v_cur, 'reissued', not v_paid);
end $$;

create or replace function public.selection_save_enrollment(p_application uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a        public.program_applications;
  v_prog   uuid := nullif(p_payload->>'program_id', '')::uuid;
  v_div    uuid := nullif(p_payload->>'division_id', '')::uuid;
  v_pkg    uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_arr    jsonb := p_payload->'arrangement';
  v_tids   uuid[];
  v_kind   text;
  v_fee    numeric;
  v_mon    numeric;
  v_first  date;
  v_upd    jsonb := '{}'::jsonb;
  v_status text := nullif(p_payload->>'status', '');
  v_cur_fee numeric;
  v_cur_kind text;
  v_cur_first date;
  v_settled boolean;
begin
  select * into a from public.program_applications where id = p_application;
  if not found or a.org_id is distinct from public.current_org_id() or not public.selection_is_admin_of(a.org_id) then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if a.status = 'withdrawn' then raise exception 'ENROLLMENT_WITHDRAWN' using errcode = 'P0001'; end if;

  -- Season / programme.
  if v_prog is not null and v_prog <> a.program_id then
    perform public.selection_move_enrollment(a.id, v_prog, v_div, coalesce(v_pkg, a.package_id));
    select * into a from public.program_applications where id = p_application;
  end if;

  -- Tournaments no longer selected leave first (a division change may need it).
  if p_payload ? 'tournaments' then
    select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_tids
      from jsonb_array_elements_text(coalesce(p_payload->'tournaments', '[]'::jsonb)) x;
    delete from public.application_tournaments where application_id = a.id and status = 'covered' and not (tournament_id = any(v_tids));
  end if;

  -- Division, jersey, notes (status last).
  if v_div is not null and v_div is distinct from a.division_id then
    v_upd := v_upd || jsonb_build_object('division_id', v_div, 'age_confirmed', coalesce((p_payload->>'age_confirmed')::boolean, false));
  end if;
  if p_payload ? 'jersey_number' then v_upd := v_upd || jsonb_build_object('jersey_number', p_payload->'jersey_number'); end if;
  if p_payload ? 'staff_notes' then v_upd := v_upd || jsonb_build_object('staff_notes', p_payload->'staff_notes'); end if;
  if v_upd <> '{}'::jsonb then perform public.selection_update_enrollment(a.id, v_upd); end if;
  select * into a from public.program_applications where id = p_application;

  -- Fee arrangement, when it changes.
  if v_arr is not null and jsonb_typeof(v_arr) = 'object' and a.status in ('accepted', 'enrolled') then
    v_kind := coalesce(nullif(v_arr->>'kind', ''), a.arrangement_kind, 'full');
    v_fee := nullif(v_arr->>'fee', '')::numeric;
    v_mon := nullif(v_arr->>'monthly', '')::numeric;
    v_first := coalesce(nullif(v_arr->>'first_due_on', '')::date, a.first_due_on,
                        (select payment_starts_on from public.programs where id = a.program_id), current_date);
    v_cur_fee := coalesce(a.agreed_fee, (select total_chf from public.invoices where id = a.invoice_id));
    -- Older enrolments (imports) have no arrangement snapshot: derive it from the invoice,
    -- so an unchanged form does not look like a fee change.
    v_cur_kind := coalesce(a.arrangement_kind,
                           case when exists (select 1 from public.payment_plans pp where pp.invoice_id = a.invoice_id
                                               and pp.kind = 'installments' and pp.status in ('active', 'paused', 'completed'))
                                then 'monthly' else 'full' end);
    v_cur_first := coalesce(a.first_due_on, (select due_date from public.invoices where id = a.invoice_id));
    v_settled := a.invoice_id is not null
                 and (select status::text from public.invoices where id = a.invoice_id) = 'paid';
    if v_kind is distinct from v_cur_kind or coalesce(v_pkg, a.package_id) is distinct from a.package_id
       or (v_fee is not null and v_fee is distinct from v_cur_fee)
       or (v_kind = 'monthly' and v_mon is distinct from a.monthly_amount)
       -- A new first due date matters only while money is still owed.
       or (v_first is distinct from v_cur_first and not v_settled) then
      if v_fee is distinct from v_cur_fee and v_cur_fee is not null and not coalesce((p_payload->>'fee_confirmed')::boolean, false)
         and coalesce(v_fee, (select price from public.program_packages where id = coalesce(v_pkg, a.package_id))) is distinct from v_cur_fee then
        raise exception 'FEE_CONFIRMATION_REQUIRED' using errcode = 'P0001';
      end if;
      perform public.selection_apply_arrangement_internal(a.id, v_kind, coalesce(v_pkg, a.package_id), v_mon, v_first,
                                                          nullif(btrim(coalesce(v_arr->>'reason', '')), ''), v_fee);
    end if;
  end if;

  if p_payload ? 'tournaments' then
    perform public.selection_set_tournaments_internal(a.id, v_tids, p_payload->>'tournament_override_reason');
  end if;

  if v_status is not null and v_status <> a.status then
    if v_status = 'withdrawn' then raise exception 'USE_WITHDRAW' using errcode = 'P0001'; end if;
    perform public.selection_update_enrollment(a.id, jsonb_build_object('status', v_status));
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (a.org_id, auth.uid(), 'selection.enrollment_saved', 'program_applications', a.id, p_payload);
  return (select jsonb_build_object('application_id', x.id, 'program_id', x.program_id, 'status', x.status, 'invoice_id', x.invoice_id,
                                    'family_id', x.family_id)
            from public.program_applications x where x.id = a.id);
end $$;
