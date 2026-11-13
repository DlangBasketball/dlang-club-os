-- ============================================================================
-- Tenant-isolation hardening for SECURITY DEFINER RPCs, signup and invitations.
-- Additive and idempotent. Findings from the tenant-isolation review:
--
-- 1) EXECUTE grants. Supabase's default privileges grant EXECUTE on every new
--    public function directly to anon and authenticated; `revoke ... from
--    public` does not remove those grants. So the service-role-only payment
--    RPCs (set_stripe_connect_account, apply_stripe_payment, ...) and the
--    internal helpers that take an org id without checking the caller
--    (flag_overdue_invoices, next_invoice_number, ...) were callable by
--    signed-out users. This migration:
--      * revokes EXECUTE from anon on every SECURITY DEFINER function in
--        public except an explicit allowlist (public pages + RLS helpers that
--        only describe the caller),
--      * revokes EXECUTE from anon AND authenticated on service-role-only and
--        internal-only functions,
--      * adds public.is_service_caller(). Inside a SECURITY DEFINER function
--        current_user is the function owner, so the earlier
--        `current_user in ('service_role','postgres',...)` checks were always
--        true (get_org_payment_profile, installments_due,
--        run_recurring_billing). is_service_caller() reads the session role
--        (the `role` setting PostgREST sets per request), which a SECURITY
--        DEFINER call does not change.
--      * capture_usage_snapshot / capture_all_usage_snapshots fail closed:
--        service role or platform admin only (anon used to pass).
--
-- 2) Target-org checks. has_role() is org-scoped, so is_admin()/is_finance()
--    mean "staff of MY club", but SECURITY DEFINER RPCs that take a target id
--    never checked that the target belongs to my club. Each one below now
--    loads the target's org_id and treats a row of another org as not found.
--
-- 3) Uninvited signups. handle_new_user() put every uninvited signup into the
--    oldest organization (the founding club), which made them members of it.
--    profiles.org_id is now nullable and stays null until an invitation or
--    provision_tenant() assigns a club; current_org_id() is then null and
--    every tenant policy denies.
--
-- 4) Invitations. family_id / coach_id on an invitation must belong to the
--    invitation's org (trigger), and handle_new_user() re-checks before
--    linking.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True for the service role (PostgREST `role` = service_role) and for direct
-- database sessions (migrations, cron, psql as the owner) that carry no end-
-- user identity. False for anon / authenticated API requests.
create or replace function public.is_service_caller()
returns boolean
language sql
stable
set search_path = public
as $$
  select case coalesce(nullif(current_setting('role', true), ''), 'none')
           when 'service_role'   then true
           when 'postgres'       then true
           when 'supabase_admin' then true
           when 'none' then auth.uid() is null
                            and session_user::text not in ('authenticator', 'anon', 'authenticated')
           else false
         end;
$$;

-- Admin / finance of the given org (the caller's own club only).
create or replace function public.is_finance_of(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_org is not null and p_org = public.current_org_id() and public.is_finance();
$$;

-- ---------------------------------------------------------------------------
-- 1) Service / platform functions with broken or open caller checks
-- ---------------------------------------------------------------------------
create or replace function public.capture_usage_snapshot(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_service_caller() or public.is_platform_admin()) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.usage_snapshots
    (org_id, captured_on, athletes, staff, families, programs, registrations_30d, invoices_30d, invoiced_30d)
  select
    p_org, current_date,
    (select count(*) from public.athletes a where a.org_id = p_org and a.status <> 'archived'),
    (select count(distinct sr.profile_id) from public.staff_roles sr where sr.org_id = p_org),
    (select count(*) from public.families f where f.org_id = p_org),
    (select count(*) from public.programs pr where pr.org_id = p_org),
    (select count(*) from public.registrations r where r.org_id = p_org and r.created_at > now() - interval '30 days'),
    (select count(*) from public.invoices i where i.org_id = p_org and i.created_at > now() - interval '30 days'),
    (select coalesce(sum(i.total_chf), 0) from public.invoices i where i.org_id = p_org and i.created_at > now() - interval '30 days')
  on conflict (org_id, captured_on) do update set
    athletes = excluded.athletes, staff = excluded.staff, families = excluded.families,
    programs = excluded.programs, registrations_30d = excluded.registrations_30d,
    invoices_30d = excluded.invoices_30d, invoiced_30d = excluded.invoiced_30d,
    created_at = now();
end;
$$;

create or replace function public.capture_all_usage_snapshots()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  if not (public.is_service_caller() or public.is_platform_admin()) then
    raise exception 'FORBIDDEN';
  end if;
  for r in select id from public.organizations loop
    perform public.capture_usage_snapshot(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.get_org_payment_profile(p_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'org_id',   o.id,
           'name',     o.name,
           'country',  upper(coalesce(o.country, 'CH')),
           'currency', public.org_currency(o.id),
           'settings', o.payment_settings - 'application_fee_bps',
           'stripe_connected', coalesce((o.payment_settings->'stripe'->>'charges_enabled')::boolean, false)
         )
    from public.organizations o
   where o.id = p_org
     and (o.id = public.current_org_id() or public.is_service_caller());
$$;

create or replace function public.installments_due(p_org uuid, p_as_of date default current_date)
returns table (installment_id uuid, plan_id uuid, invoice_id uuid, family_id uuid,
               seq integer, due_date date, amount numeric, currency text)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.plan_id, i.invoice_id, p.family_id, i.seq, i.due_date, i.amount, i.currency
    from public.payment_plan_installments i
    join public.payment_plans p on p.id = i.plan_id
   where i.org_id = p_org
     and (public.is_finance_of(p_org) or public.is_service_caller())
     and i.status in ('scheduled', 'invoiced')
     and i.due_date <= p_as_of
   order by i.due_date, i.seq;
$$;

create or replace function public.run_recurring_billing(p_org uuid, p_as_of date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.payment_plans%rowtype;
  v_count   int := 0;
  v_seq     int;
  v_period  date;
  v_number  text;
  v_invoice uuid;
  v_loops   int;
begin
  if not (public.is_service_caller() or public.is_finance_of(p_org)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  for v_plan in
    select * from public.payment_plans
     where org_id = p_org and kind = 'recurring' and status = 'active'
       and next_run_date is not null and next_run_date <= p_as_of
     for update skip locked
  loop
    v_loops := 0;
    v_period := v_plan.next_run_date;
    while v_period <= p_as_of and (v_plan.end_date is null or v_period <= v_plan.end_date) and v_loops < 12 loop
      select coalesce(max(seq), 0) + 1 into v_seq from public.payment_plan_installments where plan_id = v_plan.id;

      v_number := public.next_invoice_number(p_org);
      insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date, currency)
      values (p_org, v_number, v_plan.family_id, v_plan.athlete_id, v_plan.program_id,
              coalesce(v_plan.description, 'Membership fee') || ' — ' || to_char(v_period, 'YYYY-MM-DD'),
              'sent', v_period + v_plan.due_days, v_plan.currency)
      returning id into v_invoice;

      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (p_org, v_invoice, coalesce(v_plan.description, 'Membership fee'), 1, v_plan.amount_per_period, v_plan.amount_per_period);
      update public.invoices set total_chf = v_plan.amount_per_period where id = v_invoice;

      insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, invoice_id, status)
      values (p_org, v_plan.id, v_seq, v_period + v_plan.due_days,
              (select total_chf from public.invoices where id = v_invoice), v_plan.currency, v_invoice, 'invoiced');

      v_count  := v_count + 1;
      v_loops  := v_loops + 1;
      v_period := (v_period + public.plan_interval(v_plan.frequency, v_plan.interval_count))::date;
    end loop;

    update public.payment_plans
       set next_run_date = v_period,
           status = case when v_plan.end_date is not null and v_period > v_plan.end_date then 'completed' else status end
     where id = v_plan.id;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) RPCs that take a target id: the target must be in the caller's org
-- ---------------------------------------------------------------------------
create or replace function public.anonymise_family(p_family uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid; v_athletes integer; v_profiles integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND';
  end if;

  update public.families
    set name = '[deleted]', address = null, phone = null, contact_name = null, contact_email = null
    where id = p_family;

  update public.athletes
    set first_name = 'Redacted', last_name = 'Athlete', dob = '1900-01-01', nationality = null,
        school = null, notes = null, status = 'inactive'
    where family_id = p_family;
  get diagnostics v_athletes = row_count;

  update public.athlete_medical am
    set allergies = null, conditions = null, medications = null, insurance = null,
        emergency_contact_name = null, emergency_contact_phone = null, notes = null
    where am.athlete_id in (select id from public.athletes where family_id = p_family);

  -- Only guardians who belong to the same club are anonymised.
  update public.profiles p
    set full_name = '[deleted]', email = 'deleted-' || p.id || '@deleted.invalid',
        phone = null, is_active = false
    where p.id in (select profile_id from public.family_members where family_id = p_family)
      and p.org_id = v_org;
  get diagnostics v_profiles = row_count;

  return jsonb_build_object('family_id', p_family, 'athletes_anonymised', v_athletes, 'profiles_anonymised', v_profiles);
end $$;

create or replace function public.athlete_attendance_summary(p_athlete uuid)
returns table (session_date timestamptz, program_name text, status public.attendance_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_visible boolean;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then return; end if;

  if public.is_admin() or public.is_finance() then
    null; -- staff of this club: always allowed, no gate
  elsif public.is_guardian_of_athlete(p_athlete) then
    select coalesce((settings->>'parent_attendance_visible')::boolean, false) into v_visible
      from public.app_settings where org_id = v_org;
    if not coalesce(v_visible, false) then return; end if; -- disabled -> empty
  else
    return; -- coaches/others don't use this summary
  end if;

  return query
    select s.session_date, p.name, m.status
      from public.attendance_marks m
      join public.attendance_sessions s on s.id = m.attendance_session_id
      left join public.programs p on p.id = s.program_id
     where m.athlete_id = p_athlete
       and s.status in ('submitted', 'locked')
     order by s.session_date desc;
end;
$$;

create or replace function public.athlete_safety(p_athlete uuid)
returns table (allergies text, conditions text, emergency_contact_name text, emergency_contact_phone text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.athletes a
                  where a.id = p_athlete and a.org_id = public.current_org_id()) then
    return; -- unknown athlete or another club's athlete
  end if;
  if not (
    public.is_admin()
    or public.is_guardian_of_athlete(p_athlete)
    or public.coach_can_access_athlete(p_athlete)
  ) then
    return; -- no rows for unauthorized callers
  end if;

  return query
    select m.allergies, m.conditions, m.emergency_contact_name, m.emergency_contact_phone
    from public.athlete_medical m
    where m.athlete_id = p_athlete;
end;
$$;

create or replace function public.book_training_session(p_athlete uuid, p_service uuid, p_slot uuid, p_pay_with text default 'invoice')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_enabled boolean;
  v_slot    public.coach_availability%rowtype;
  v_svc     public.training_services%rowtype;
  v_family  uuid;
  v_booking uuid;
  v_invoice uuid;
  v_invnum  text;
  v_balance integer;
  v_coach_profile uuid;
  v_athlete_name  text;
begin
  select org_id, family_id, first_name || ' ' || last_name
    into v_org, v_family, v_athlete_name from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
    from public.app_settings where org_id = v_org;
  if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;

  select * into v_svc from public.training_services where id = p_service and org_id = v_org and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Lock the slot to prevent a double-booking race
  select * into v_slot from public.coach_availability where id = p_slot and org_id = v_org for update;
  if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;

  if p_pay_with = 'credits' then
    if v_svc.credits_required <= 0 then raise exception 'SERVICE_NOT_CREDIT_ELIGIBLE' using errcode = 'P0001'; end if;
    select (total_credits - used_credits) into v_balance from public.training_credits
      where athlete_id = p_athlete and credit_category = v_svc.credit_category;
    if coalesce(v_balance, 0) < v_svc.credits_required then
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;
    update public.training_credits set used_credits = used_credits + v_svc.credits_required, updated_at = now()
      where athlete_id = p_athlete and credit_category = v_svc.credit_category;

    insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, credits_used, price_chf, created_by)
    values (v_org, p_athlete, p_service, v_slot.coach_id, v_slot.starts_at, v_slot.ends_at, 'booked', v_svc.credits_required, 0, auth.uid())
    returning id into v_booking;

  else  -- invoice path
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, description, status, due_date)
    values (v_org, v_invnum, v_family,
            v_svc.name || ' — ' || v_athlete_name, 'sent', (now() + interval '7 days')::date)
    returning id into v_invoice;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, v_svc.name || ' — ' || v_athlete_name, 1, v_svc.price_chf, v_svc.price_chf);
    update public.invoices set total_chf = v_svc.price_chf where id = v_invoice;

    insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, invoice_id, created_by)
    values (v_org, p_athlete, p_service, v_slot.coach_id, v_slot.starts_at, v_slot.ends_at, 'booked', v_svc.price_chf, v_invoice, auth.uid())
    returning id into v_booking;
  end if;

  update public.coach_availability set is_booked = true where id = p_slot;

  -- Notify the coach (in-app); the action also sends emails.
  select profile_id into v_coach_profile from public.coaches where id = v_slot.coach_id;
  if v_coach_profile is not null then
    insert into public.notifications (org_id, recipient_id, type, title, body, link)
    values (v_org, v_coach_profile, 'training', 'New booking',
            v_athlete_name || ' booked ' || v_svc.name, '/coach/schedule');
  end if;

  return jsonb_build_object('booking_id', v_booking, 'invoice_id', v_invoice,
                            'credits_used', case when p_pay_with = 'credits' then v_svc.credits_required else 0 end,
                            'price_chf', case when p_pay_with = 'credits' then 0 else v_svc.price_chf end,
                            'pay_with', p_pay_with);
end;
$$;

create or replace function public.book_training_slot(p_athlete uuid, p_service uuid, p_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_enabled boolean;
  v_slot    public.coach_availability%rowtype;
  v_svc     public.training_services%rowtype;
  v_booking uuid;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
    from public.app_settings where org_id = v_org;
  if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;

  select * into v_slot from public.coach_availability where id = p_slot and org_id = v_org for update;
  if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;

  select * into v_svc from public.training_services where id = p_service and org_id = v_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;

  insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, created_by)
  values (v_org, p_athlete, p_service, v_slot.coach_id, v_slot.starts_at, v_slot.ends_at, 'booked', v_svc.price_chf, auth.uid())
  returning id into v_booking;

  update public.coach_availability set is_booked = true where id = p_slot;
  return jsonb_build_object('booking_id', v_booking, 'price_chf', v_svc.price_chf, 'starts_at', v_slot.starts_at);
end;
$$;

create or replace function public.cancel_training_booking(p_booking uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b        public.training_bookings%rowtype;
  v_hours    numeric;
  v_min      numeric;
  v_refund   boolean;
  v_category public.credit_category;
  v_within   boolean;
  v_staff    boolean;
  v_did_refund boolean := false;
begin
  select * into v_b from public.training_bookings where id = p_booking;
  if not found or v_b.org_id is distinct from public.current_org_id() then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_staff := public.is_finance();
  if not (public.is_guardian_of_athlete(v_b.athlete_id) or v_staff) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_b.status <> 'booked' then raise exception 'NOT_CANCELLABLE' using errcode = 'P0001'; end if;

  select coalesce((settings->'booking'->>'cancellation_hours')::numeric, 24),
         coalesce((settings->'booking'->>'refund_credits_on_cancel')::boolean, true)
    into v_min, v_refund
    from public.app_settings where org_id = v_b.org_id;

  v_hours  := extract(epoch from (v_b.slot_start - now())) / 3600.0;
  v_within := v_hours >= coalesce(v_min, 24);

  update public.training_bookings set status = 'cancelled', updated_at = now() where id = p_booking;
  update public.coach_availability set is_booked = false
    where coach_id = v_b.coach_id and starts_at = v_b.slot_start and org_id = v_b.org_id;

  -- Refund credits when within policy (or staff override)
  if v_b.credits_used > 0 and coalesce(v_refund, true) and (v_within or v_staff) then
    select credit_category into v_category from public.training_services where id = v_b.service_id;
    update public.training_credits set used_credits = greatest(0, used_credits - v_b.credits_used), updated_at = now()
      where athlete_id = v_b.athlete_id and credit_category = v_category;
    v_did_refund := true;
  end if;

  -- Void an unpaid invoice when within policy (or staff override)
  if v_b.invoice_id is not null and (v_within or v_staff) then
    update public.invoices set status = 'cancelled'
      where id = v_b.invoice_id and org_id = v_b.org_id and status in ('draft', 'sent', 'pending', 'overdue');
  end if;

  return jsonb_build_object('booking_id', p_booking, 'status', 'cancelled',
                            'within_policy', v_within, 'credits_refunded', v_did_refund);
end;
$$;

create or replace function public.reschedule_booking(p_booking uuid, p_new_slot uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b    public.training_bookings%rowtype;
  v_slot public.coach_availability%rowtype;
begin
  select * into v_b from public.training_bookings where id = p_booking;
  if not found or v_b.org_id is distinct from public.current_org_id() then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_guardian_of_athlete(v_b.athlete_id) or public.is_finance()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_b.status <> 'booked' then raise exception 'NOT_RESCHEDULABLE' using errcode = 'P0001'; end if;

  select * into v_slot from public.coach_availability where id = p_new_slot and org_id = v_b.org_id for update;
  if not found then raise exception 'SLOT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;

  -- free the old slot, take the new one
  update public.coach_availability set is_booked = false
   where coach_id = v_b.coach_id and starts_at = v_b.slot_start and org_id = v_b.org_id;
  update public.coach_availability set is_booked = true  where id = p_new_slot;
  update public.training_bookings
     set coach_id = v_slot.coach_id, slot_start = v_slot.starts_at, slot_end = v_slot.ends_at, updated_at = now()
   where id = p_booking;

  return jsonb_build_object('booking_id', p_booking, 'slot_start', v_slot.starts_at);
end;
$$;

create or replace function public.grant_training_credits(p_athlete uuid, p_category text, p_credits integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_credits = 0 then raise exception 'INVALID_CREDITS' using errcode = 'P0001'; end if;
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.training_credits (org_id, athlete_id, credit_category, total_credits)
  values (v_org, p_athlete, p_category::public.credit_category, greatest(0, p_credits))
  on conflict (athlete_id, credit_category) do update
    set total_credits = public.training_credits.total_credits + p_credits, updated_at = now();

  return (select jsonb_build_object('athlete_id', p_athlete, 'category', p_category,
                 'total', total_credits, 'used', used_credits, 'balance', total_credits - used_credits)
          from public.training_credits where athlete_id = p_athlete and credit_category = p_category::public.credit_category);
end;
$$;

create or replace function public.open_attendance_session(p_program_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coach    uuid := public.current_coach_id();
  v_ps       public.program_sessions%rowtype;
  v_existing uuid;
begin
  select * into v_ps from public.program_sessions where id = p_program_session;
  if not found or v_ps.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or v_ps.coach_id = v_coach) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  select id into v_existing from public.attendance_sessions where program_session_id = p_program_session limit 1;
  if v_existing is not null then
    return jsonb_build_object('attendance_session_id', v_existing, 'created', false);
  end if;

  insert into public.attendance_sessions (org_id, program_id, program_session_id, coach_id, session_date, status)
  values (v_ps.org_id, v_ps.program_id, p_program_session, coalesce(v_ps.coach_id, v_coach), v_ps.starts_at, 'open')
  returning id into v_existing;
  return jsonb_build_object('attendance_session_id', v_existing, 'created', true);
end;
$$;

create or replace function public.save_attendance(p_session uuid, p_marks jsonb, p_submit boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions%rowtype;
  v_coach   uuid := public.current_coach_id();
  v_m       jsonb;
begin
  select * into v_session from public.attendance_sessions where id = p_session;
  if not found or v_session.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or v_session.coach_id = v_coach) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_session.status = 'locked' then raise exception 'SESSION_LOCKED' using errcode = 'P0001'; end if;

  -- Every marked athlete must belong to the session's club.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) e
     where not exists (select 1 from public.athletes a
                        where a.id = (e->>'athlete_id')::uuid and a.org_id = v_session.org_id)
  ) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;

  for v_m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    insert into public.attendance_marks (org_id, attendance_session_id, athlete_id, status, notes, injury_flag, marked_by, marked_at)
    values (v_session.org_id, p_session, (v_m->>'athlete_id')::uuid, (v_m->>'status')::public.attendance_status,
            nullif(v_m->>'notes', ''), coalesce((v_m->>'injury_flag')::boolean, false), v_coach, now())
    on conflict (attendance_session_id, athlete_id) do update
      set status = excluded.status, notes = excluded.notes,
          injury_flag = excluded.injury_flag, marked_by = excluded.marked_by, marked_at = now();
  end loop;

  if p_submit then
    update public.attendance_sessions
       set status = 'submitted', submitted_at = now(),
           roster_size = (select count(*) from public.attendance_marks where attendance_session_id = p_session)
     where id = p_session;
  else
    update public.attendance_sessions set updated_at = now() where id = p_session;
  end if;

  return (
    select jsonb_build_object(
      'present',   count(*) filter (where status = 'present'),
      'late',      count(*) filter (where status = 'late'),
      'absent',    count(*) filter (where status = 'absent'),
      'excused',   count(*) filter (where status = 'excused'),
      'injuries',  count(*) filter (where injury_flag),
      'total',     count(*),
      'submitted', p_submit
    )
    from public.attendance_marks where attendance_session_id = p_session
  );
end;
$$;

create or replace function public.session_roster(p_attendance_session uuid)
returns table (athlete_id uuid, full_name text, status public.attendance_status, notes text, injury_flag boolean,
               allergies text, conditions text, emergency_contact_name text, emergency_contact_phone text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions%rowtype;
  v_coach   uuid := public.current_coach_id();
begin
  select * into v_session from public.attendance_sessions where id = p_attendance_session;
  if not found or v_session.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or v_session.coach_id = v_coach) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  return query
    select a.id,
           a.first_name || ' ' || a.last_name,
           m.status, m.notes, coalesce(m.injury_flag, false),
           med.allergies, med.conditions, med.emergency_contact_name, med.emergency_contact_phone
      from public.registrations r
      join public.athletes a on a.id = r.athlete_id and a.org_id = v_session.org_id
      left join public.attendance_marks m
             on m.attendance_session_id = p_attendance_session and m.athlete_id = a.id
      left join public.athlete_medical med on med.athlete_id = a.id
     where r.program_id = v_session.program_id
       and r.status <> 'cancelled'
     order by a.first_name, a.last_name;
end;
$$;

create or replace function public.withdraw_consent(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_ath uuid; v_org uuid;
begin
  select athlete_id, org_id into v_ath, v_org from public.consent_acceptances where id = p_id;
  if v_ath is null or v_org is distinct from public.current_org_id() then raise exception 'NOT_FOUND'; end if;
  if not (public.is_admin() or public.is_guardian_of_athlete(v_ath)) then raise exception 'FORBIDDEN'; end if;
  update public.consent_acceptances set status = 'withdrawn', withdrawn_at = now() where id = p_id and status = 'accepted';
  return jsonb_build_object('id', p_id, 'status', 'withdrawn');
end $$;

create or replace function public.record_manual_payment(p_invoice uuid, p_amount numeric, p_method text,
                                                        p_reference text default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  v_status public.invoice_status;
  v_pay    uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT' using errcode = 'P0001'; end if;
  if p_method not in ('bank_transfer','twint','manual','card','qr_bill') then
    raise exception 'INVALID_METHOD' using errcode = 'P0001';
  end if;

  select org_id, status into v_org, v_status from public.invoices where id = p_invoice;
  if not found or v_org is distinct from public.current_org_id() then
    raise exception 'INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_status = 'cancelled' then raise exception 'INVOICE_CANCELLED' using errcode = 'P0001'; end if;

  insert into public.payments (org_id, invoice_id, amount_chf, method, status, qr_reference, recorded_by, paid_at, notes)
  values (v_org, p_invoice, p_amount, p_method::public.payment_method, 'succeeded', p_reference, auth.uid(), now(), p_note)
  returning id into v_pay;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'PAYMENT_RECORDED', 'payments', null,
          jsonb_build_object('invoice_id', p_invoice, 'payment_id', v_pay, 'amount_chf', p_amount, 'method', p_method));

  perform public.recompute_invoice(p_invoice);

  select status into v_status from public.invoices where id = p_invoice;
  return jsonb_build_object('payment_id', v_pay, 'invoice_id', p_invoice, 'status', v_status);
end;
$$;

create or replace function public.create_manual_invoice(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_invoice uuid;
  v_number  text;
  v_item    jsonb;
  v_total   numeric := 0;
  v_amount  numeric;
  v_disc    numeric;
  v_family  uuid := (p_payload->>'family_id')::uuid;
  v_athlete uuid := nullif(p_payload->>'athlete_id','')::uuid;
  v_program uuid := nullif(p_payload->>'program_id','')::uuid;
begin
  if not public.is_finance() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  v_org := public.current_org_id();
  if v_org is null then raise exception 'NO_ORG' using errcode = 'P0001'; end if;

  -- Linked records must belong to this club.
  if v_family is not null and not exists (select 1 from public.families where id = v_family and org_id = v_org) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_athlete is not null and not exists (select 1 from public.athletes where id = v_athlete and org_id = v_org) then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_program is not null and not exists (select 1 from public.programs where id = v_program and org_id = v_org) then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_number := public.next_invoice_number(v_org);

  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, status, due_date)
  values (
    v_org, v_number, v_family, v_athlete, v_program,
    nullif(p_payload->>'description',''),
    'draft',
    nullif(p_payload->>'due_date','')::date
  ) returning id into v_invoice;

  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb))
  loop
    v_amount := round((coalesce((v_item->>'quantity')::numeric,1)) * (coalesce((v_item->>'unit_price_chf')::numeric,0)), 2);
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, coalesce(v_item->>'description','Item'),
            coalesce((v_item->>'quantity')::numeric,1), coalesce((v_item->>'unit_price_chf')::numeric,0), v_amount);
    v_total := v_total + v_amount;
  end loop;

  v_disc := coalesce((p_payload->>'discount_chf')::numeric, 0);
  if v_disc > 0 then
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, coalesce(p_payload->>'discount_label','Discount'), 1, -v_disc, -v_disc);
    v_total := v_total - v_disc;
  end if;

  update public.invoices set total_chf = v_total where id = v_invoice;
  return jsonb_build_object('invoice_id', v_invoice, 'number', v_number, 'total_chf', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Uninvited signups get no club
-- ---------------------------------------------------------------------------
alter table public.profiles alter column org_id drop not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations%rowtype;
begin
  -- Most recent still-valid invitation for this email, if any.
  select * into v_inv
  from public.invitations
  where email = new.email
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1;

  -- 1) Always create the profile. Without an invitation the user belongs to
  --    no club (org_id null) until provision_tenant() or an invitation
  --    assigns one; every tenant policy denies while org_id is null.
  insert into public.profiles (id, org_id, email, full_name, locale)
  values (
    new.id,
    v_inv.org_id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;

  -- 2) Consume the invitation, if present.
  if v_inv.id is not null then
    if v_inv.role <> 'parent' then
      insert into public.staff_roles (org_id, profile_id, role)
      values (v_inv.org_id, new.id, v_inv.role)
      on conflict (org_id, profile_id, role) do nothing;
    end if;

    -- Link a guardian to their family (same club only).
    if v_inv.family_id is not null
       and exists (select 1 from public.families where id = v_inv.family_id and org_id = v_inv.org_id) then
      insert into public.family_members (family_id, profile_id, relation, is_primary)
      values (
        v_inv.family_id,
        new.id,
        coalesce(v_inv.relation, 'guardian'),
        not exists (select 1 from public.family_members where family_id = v_inv.family_id)
      )
      on conflict (family_id, profile_id) do nothing;
    end if;

    -- Link a coach record to this login (same club only).
    if v_inv.coach_id is not null then
      update public.coaches set profile_id = new.id
       where id = v_inv.coach_id and org_id = v_inv.org_id;
    end if;

    update public.invitations
      set status = 'accepted', accepted_at = now(), accepted_by = new.id
      where id = v_inv.id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Invitations may only reference the inviting club's family / coach
-- ---------------------------------------------------------------------------
create or replace function public.invitations_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.family_id is not null
     and not exists (select 1 from public.families where id = new.family_id and org_id = new.org_id) then
    raise exception 'INVITATION_FAMILY_OTHER_ORG' using errcode = '42501';
  end if;
  if new.coach_id is not null
     and not exists (select 1 from public.coaches where id = new.coach_id and org_id = new.org_id) then
    raise exception 'INVITATION_COACH_OTHER_ORG' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invitations_same_org on public.invitations;
create trigger trg_invitations_same_org
  before insert or update of org_id, family_id, coach_id on public.invitations
  for each row execute function public.invitations_same_org_guard();

-- ---------------------------------------------------------------------------
-- 5) EXECUTE privileges
-- ---------------------------------------------------------------------------
-- Signed-out users: no SECURITY DEFINER function except the public-page RPCs
-- and the RLS helpers (which only describe the caller and return
-- false/null for anon). Keep this list in sync with
-- tests/db/rpc_tenant_isolation.sql.
do $$
declare
  r record;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then return; end if;
  for r in
    select p.oid::regprocedure as sig,
           has_function_privilege('authenticated', p.oid, 'execute') as auth_ok,
           has_function_privilege('service_role', p.oid, 'execute') as svc_ok
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
       and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('anon', p.oid, 'execute')
       and p.proname not in (
         -- public pages / signup
         'get_public_tenant', 'is_slug_available', 'register_public',
         -- RLS policy helpers
         'current_org_id', 'current_user_email', 'current_coach_id', 'has_role',
         'is_admin', 'is_finance', 'is_any_guardian', 'is_platform_admin', 'is_org_admin',
         'is_guardian_of_athlete', 'is_guardian_of_family', 'coach_can_access_athlete',
         'coach_coaches_program', 'coach_coaches_team', 'coach_leads_attendance_session',
         'guardian_has_athlete_in_program', 'guardian_has_athlete_on_team',
         'can_manage_event', 'can_read_event', 'event_team', 'sportsops_same_org',
         'suspended_org_ids'
       )
  loop
    -- anon may hold EXECUTE directly (Supabase default privileges) or through
    -- PUBLIC; drop both and keep whatever the other API roles had.
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.auth_ok then execute format('grant execute on function %s to authenticated', r.sig); end if;
    if r.svc_ok  then execute format('grant execute on function %s to service_role', r.sig); end if;
  end loop;
end $$;

-- Service-role-only (webhooks, Stripe Connect, cron) and internal helpers that
-- take an org/invoice id without checking the caller: no API role but
-- service_role may call them. SECURITY DEFINER callers still can (they run as
-- the owner).
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_stripe_connect_account(uuid, text, text, boolean, boolean, boolean)',
    'public.apply_stripe_payment(uuid, numeric, text, text, text, text, text, numeric, text)',
    'public.apply_stripe_refund(text, text, numeric, text, text)',
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
    if to_regprocedure(f) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', f);
      if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute format('grant execute on function %s to service_role', f);
      end if;
    end if;
  end loop;
end $$;

-- Explicit grants for the new helpers.
revoke all on function public.is_finance_of(uuid) from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.is_finance_of(uuid) to authenticated, service_role;
    grant execute on function public.is_service_caller() to anon, authenticated, service_role;
  end if;
end $$;
