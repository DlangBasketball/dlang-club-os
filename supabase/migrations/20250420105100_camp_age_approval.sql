-- ============================================================================
-- Club OS — Camp age approval band
--
-- A camp programme may accept children slightly younger than its minimum age
-- after an admin review ("approval band", default off):
--
--   * programs.approval_age_min / approval_age_max (both null = off). The band
--     sits below programs.min_age (approval_age_max < min_age).
--   * Age = the child's age in whole years on the edition's first day
--     (camp_editions.starts_on) from athletes.dob: camp_age_on_start(). The
--     classification is camp_age_band(): standard | approval | too_young |
--     too_old (TS mirror: src/lib/camps/age-approval.ts, same cases).
--   * A child in the band is submitted with camp_approval_submit() (service
--     role, the server action resolved family + child): one registration row,
--     status 'pending_approval', approval_status 'pending', price snapshot of
--     the chosen option, NO invoice, never counted in capacity (capacity counts
--     'pending' + 'confirmed' everywhere). request_id makes a retry return the
--     same row; one active request per child + edition (partial unique index).
--   * camp_approval_decide() — admins only. Decline: status 'cancelled',
--     approval_status 'declined', message kept. Approve: the edition row is
--     locked and the existing capacity rule re-checked (pending + confirmed);
--     full -> nothing changes and the reason is returned. Otherwise the SAME
--     row enters the existing camp workflow: a priced camp registration is
--     'pending' with an issued camp invoice (the reservation awaiting payment,
--     exactly what register_camp() creates; the invoice gets the camp number
--     series of the billing foundation); a free one is confirmed at once.
--     A retry / double click returns the first decision (replayed).
--   * When the invoice of an approved registration is paid in full, the
--     registration is confirmed (trigger; approved rows only — the regular
--     camp flow is unchanged).
--   * Guards: approval columns and the 'pending_approval' status change only
--     through the two RPCs (or the service role); a guardian may still cancel
--     (withdraw) a request. With a band configured, a direct camp registration
--     of a child in the band / below it is refused (APPROVAL_REQUIRED /
--     AGE_OUT_OF_RANGE) whatever the path (single week, basket, waitlist).
--
-- No new table: registrations / programs keep their RLS (every verb) and
-- audit triggers. Additive and idempotent. The new enum label is added first
-- and only used at run time (function bodies), never in this file's DDL.
-- ============================================================================

-- ADD VALUE commits on its own under psql; nothing below uses the label in DDL.
alter type public.registration_status add value if not exists 'pending_approval';

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
alter table public.programs
  add column if not exists approval_age_min smallint,
  add column if not exists approval_age_max smallint;

do $$ begin
  alter table public.programs add constraint programs_approval_age_chk
    check ((approval_age_min is null and approval_age_max is null)
        or (approval_age_min is not null and approval_age_max is not null
            and approval_age_min between 0 and 99 and approval_age_max between 0 and 99
            and approval_age_max >= approval_age_min
            and (min_age is null or approval_age_max < min_age)));
exception when duplicate_object then null; end $$;

alter table public.registrations
  add column if not exists approval_status        text,
  add column if not exists approval_request_id    uuid,
  add column if not exists approval_requested_at  timestamptz,
  add column if not exists approval_age           smallint,
  add column if not exists approval_decided_by    uuid references public.profiles(id) on delete set null,
  add column if not exists approval_decided_at    timestamptz,
  add column if not exists approval_note          text;

do $$ begin
  alter table public.registrations add constraint registrations_approval_status_chk
    check (approval_status is null or approval_status in ('pending', 'approved', 'declined', 'withdrawn'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.registrations add constraint registrations_approval_note_len_chk
    check (approval_note is null or length(approval_note) <= 1000);
exception when duplicate_object then null; end $$;

-- One active request per child and camp week; a retry with the same request id
-- finds its rows.
create unique index if not exists registrations_approval_active_uidx
  on public.registrations(athlete_id, camp_edition_id) where approval_status = 'pending';
create unique index if not exists registrations_approval_request_uidx
  on public.registrations(org_id, approval_request_id, athlete_id) where approval_request_id is not null;
create index if not exists idx_registrations_approval_queue
  on public.registrations(org_id, approval_requested_at) where approval_status = 'pending';

-- ---------------------------------------------------------------------------
-- 2) Age on the first day + classification (pure; mirrored in TS)
-- ---------------------------------------------------------------------------
create or replace function public.camp_age_on_start(p_dob date, p_starts_on date)
returns integer
language sql
immutable
set search_path = public
as $$
  select case when p_dob is null or p_starts_on is null then null
              else extract(year from age(p_starts_on::timestamp, p_dob::timestamp))::integer end;
$$;

-- standard: the existing flow (also when the age is unknown or no band applies)
-- approval: inside the band; too_young: below the band and min_age; too_old: above max_age.
create or replace function public.camp_age_band(p_age integer, p_min integer, p_max integer, p_band_min integer, p_band_max integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_age is null then 'standard'
    when p_max is not null and p_age > p_max then 'too_old'
    when p_min is null or p_age >= p_min then 'standard'
    when p_band_min is not null and p_band_max is not null and p_age between p_band_min and p_band_max then 'approval'
    else 'too_young'
  end;
$$;

revoke all on function public.camp_age_on_start(date, date) from public;
revoke all on function public.camp_age_band(integer, integer, integer, integer, integer) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.camp_age_on_start(date, date) to anon, authenticated, service_role;
    grant execute on function public.camp_age_band(integer, integer, integer, integer, integer) to anon, authenticated, service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Guards on registrations
-- ---------------------------------------------------------------------------
create or replace function public.registrations_camp_approval_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flag  boolean := coalesce(current_setting('app.camp_approval', true), '') = 'on';
  v_svc   boolean := public.is_service_caller();
  v_prog  record;
  v_start date;
  v_dob   date;
  v_band  text;
begin
  if tg_op = 'INSERT' then
    if (new.status::text = 'pending_approval' or new.approval_status is not null
        or new.approval_request_id is not null or new.approval_decided_at is not null) and not v_flag then
      raise exception 'USE_CAMP_APPROVAL' using errcode = 'P0001';
    end if;
    -- With a band configured, a camp place for a child in / below the band
    -- only comes through the approval workflow.
    if new.camp_edition_id is not null and new.status::text in ('pending', 'confirmed') and not v_flag then
      select p.min_age, p.max_age, p.approval_age_min, p.approval_age_max into v_prog
        from public.programs p where p.id = new.program_id;
      if v_prog.approval_age_min is not null then
        select e.starts_on into v_start from public.camp_editions e where e.id = new.camp_edition_id;
        select a.dob into v_dob from public.athletes a where a.id = new.athlete_id;
        v_band := public.camp_age_band(public.camp_age_on_start(v_dob, v_start),
                                       v_prog.min_age, v_prog.max_age, v_prog.approval_age_min, v_prog.approval_age_max);
        if v_band = 'approval' then
          raise exception 'APPROVAL_REQUIRED' using errcode = 'P0001';
        elsif v_band in ('too_young', 'too_old') then
          raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
        end if;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if v_flag then return new; end if;
  if (new.approval_status, new.approval_request_id, new.approval_requested_at, new.approval_age,
      new.approval_decided_by, new.approval_decided_at, new.approval_note)
     is distinct from
     (old.approval_status, old.approval_request_id, old.approval_requested_at, old.approval_age,
      old.approval_decided_by, old.approval_decided_at, old.approval_note)
     and not v_svc then
    raise exception 'APPROVAL_LOCKED' using errcode = 'P0001';
  end if;
  if old.status::text = 'pending_approval' and new.status is distinct from old.status then
    -- A request leaves the queue only by a decision, or is withdrawn (cancelled).
    if new.status::text <> 'cancelled' and not v_svc then
      raise exception 'USE_CAMP_APPROVAL' using errcode = 'P0001';
    end if;
    if new.status::text = 'cancelled' and new.approval_status = 'pending' then
      new.approval_status := 'withdrawn';
    end if;
  end if;
  if new.status::text = 'pending_approval' and old.status::text <> 'pending_approval' and not v_svc then
    raise exception 'USE_CAMP_APPROVAL' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Programme rules (body from 20250420102900_selection_roster.sql) plus:
--   * the approval RPCs (app.camp_approval) pass: they apply the band rules;
--   * a camp week of a programme WITH a band is age-checked by the guard
--     above on the week's first day (camp_age_on_start), so a child who turns
--     the minimum age on day 1 books the standard way. Without a band the
--     previous age rule is unchanged.
create or replace function public.registrations_program_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_p    public.programs%rowtype;
  v_dob  date;
  v_ref  date;
  v_age  int;
begin
  if coalesce(current_setting('app.selection_enroll', true), '') = 'on' then
    return new;
  end if;
  if coalesce(current_setting('app.camp_approval', true), '') = 'on' then
    return new;
  end if;
  if public.current_org_id() is not distinct from new.org_id and public.is_finance() then
    return new;
  end if;
  select * into v_p from public.programs where id = new.program_id;
  if not found then return new; end if; -- FK reports it

  if v_p.status <> 'published' then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if (v_p.registration_opens_at is not null and now() < v_p.registration_opens_at)
     or (v_p.registration_closes_at is not null and now() >= v_p.registration_closes_at) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;
  if (v_p.min_age is not null or v_p.max_age is not null)
     and not (new.camp_edition_id is not null and v_p.approval_age_min is not null) then
    select dob into v_dob from public.athletes where id = new.athlete_id;
    if v_dob is not null then
      v_ref := greatest(coalesce(v_p.starts_on, current_date), current_date);
      v_age := extract(year from age(v_ref, v_dob))::int;
      if (v_p.min_age is not null and v_age < v_p.min_age)
         or (v_p.max_age is not null and v_age > v_p.max_age) then
        raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registrations_camp_approval_guard on public.registrations;
create trigger trg_registrations_camp_approval_guard
  before insert or update on public.registrations
  for each row execute function public.registrations_camp_approval_guard();
revoke all on function public.registrations_camp_approval_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) camp_approval_submit(payload) — service role (parent app server action)
--
-- payload = { program_id, edition_id, family_id, registered_by, request_id,
--             children: [{ athlete_id, age_group_id, price_option_id, days:[date] }],
--             consents: [key], ip }
-- returns { registration_ids, athlete_ids, ages, replayed }
-- ---------------------------------------------------------------------------
create or replace function public.camp_approval_submit(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program  public.programs%rowtype;
  v_edition  public.camp_editions%rowtype;
  v_org      uuid;
  v_family   uuid;
  v_request  uuid;
  v_children jsonb := coalesce(p_payload->'children', '[]'::jsonb);
  v_child    jsonb;
  v_athlete  uuid;
  v_dob      date;
  v_age      int;
  v_grp      public.camp_age_groups%rowtype;
  v_opt      public.camp_price_options%rowtype;
  v_currency text;
  v_exp      int;
  v_list     numeric;
  v_days     date[];
  v_reg      uuid;
  v_reg_ids  uuid[] := '{}';
  v_ath_ids  uuid[] := '{}';
  v_ages     int[] := '{}';
  v_consent  text;
  v_form     record;
  v_ip       inet;
  v_by       uuid := nullif(p_payload->>'registered_by', '')::uuid;
begin
  if not public.is_service_caller() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  begin v_request := nullif(p_payload->>'request_id', '')::uuid;
  exception when others then v_request := null; end;
  if v_request is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_program from public.programs where id = nullif(p_payload->>'program_id', '')::uuid;
  if not found or v_program.kind <> 'camp' then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  v_org := v_program.org_id;

  -- Replay: the rows of this request (same org) come back unchanged.
  if exists (select 1 from public.registrations where org_id = v_org and approval_request_id = v_request) then
    return jsonb_build_object(
      'replayed', true,
      'registration_ids', (select coalesce(jsonb_agg(id order by created_at, id), '[]'::jsonb) from public.registrations
                            where org_id = v_org and approval_request_id = v_request),
      'athlete_ids', (select coalesce(jsonb_agg(athlete_id order by created_at, id), '[]'::jsonb) from public.registrations
                       where org_id = v_org and approval_request_id = v_request),
      'ages', (select coalesce(jsonb_agg(approval_age order by created_at, id), '[]'::jsonb) from public.registrations
                where org_id = v_org and approval_request_id = v_request));
  end if;

  if v_program.status <> 'published' then raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001'; end if;
  if v_program.approval_age_min is null then raise exception 'APPROVAL_NOT_ENABLED' using errcode = 'P0001'; end if;
  -- Programme window (registrations_program_rules applies it to every other path).
  if (v_program.registration_opens_at is not null and now() < v_program.registration_opens_at)
     or (v_program.registration_closes_at is not null and now() >= v_program.registration_closes_at) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  -- Same lock as register_camp: requests and bookings of a week serialise.
  select * into v_edition from public.camp_editions
   where id = nullif(p_payload->>'edition_id', '')::uuid and program_id = v_program.id and org_id = v_org
   for update;
  if not found then raise exception 'EDITION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_edition.status <> 'published' then raise exception 'EDITION_NOT_OPEN' using errcode = 'P0001'; end if;
  if (v_edition.registration_opens_at is not null and now() < v_edition.registration_opens_at)
     or (v_edition.registration_closes_at is not null and now() >= v_edition.registration_closes_at)
     or (v_edition.registration_closes_at is null and current_date > v_edition.starts_on) then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
  end if;

  select id into v_family from public.families
   where id = nullif(p_payload->>'family_id', '')::uuid and org_id = v_org;
  if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;

  if jsonb_typeof(v_children) <> 'array' or jsonb_array_length(v_children) < 1 then
    raise exception 'NO_CHILDREN' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_children) > 10 then raise exception 'TOO_MANY_CHILDREN' using errcode = 'P0001'; end if;

  v_currency := upper(coalesce(v_program.currency, public.org_currency(v_org)));
  v_exp := public.currency_exponent(v_currency);
  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  perform set_config('app.camp_pricing', 'on', true);
  perform set_config('app.camp_approval', 'on', true);

  for v_child in select * from jsonb_array_elements(v_children)
  loop
    select id, dob into v_athlete, v_dob from public.athletes
     where id = nullif(v_child->>'athlete_id', '')::uuid and org_id = v_org and family_id = v_family;
    if v_athlete is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_age := public.camp_age_on_start(v_dob, v_edition.starts_on);
    if public.camp_age_band(v_age, v_program.min_age, v_program.max_age, v_program.approval_age_min, v_program.approval_age_max) <> 'approval' then
      raise exception 'NOT_APPROVAL_AGE' using errcode = 'P0001';
    end if;

    if exists (select 1 from public.registrations
                where athlete_id = v_athlete and camp_edition_id = v_edition.id and approval_status = 'pending') then
      raise exception 'ALREADY_REQUESTED' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.registrations
                where athlete_id = v_athlete and camp_edition_id = v_edition.id and status <> 'cancelled') then
      raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
    end if;
    -- A cancelled / declined row of this week without an invoice makes way
    -- for the new request (one row per child and week).
    if exists (select 1 from public.registrations
                where athlete_id = v_athlete and camp_edition_id = v_edition.id and invoice_id is not null) then
      raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
    end if;
    delete from public.registrations
     where athlete_id = v_athlete and camp_edition_id = v_edition.id and status = 'cancelled' and invoice_id is null;

    -- Same choices as every camper (the age fit of the group is what the
    -- admin reviews, so it is not enforced here).
    select * into v_grp from public.camp_age_groups
     where id = nullif(v_child->>'age_group_id', '')::uuid and program_id = v_program.id and org_id = v_org and is_active;
    if not found then raise exception 'AGE_GROUP_NOT_FOUND' using errcode = 'P0002'; end if;
    select * into v_opt from public.camp_price_options
     where id = nullif(v_child->>'price_option_id', '')::uuid and program_id = v_program.id and org_id = v_org
       and is_active and (edition_id is null or edition_id = v_edition.id);
    if not found then raise exception 'PRICE_OPTION_NOT_FOUND' using errcode = 'P0002'; end if;
    if upper(coalesce(v_opt.currency, v_currency)) <> v_currency then
      raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
    end if;
    v_list := round(v_opt.price, v_exp);
    select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_days
      from jsonb_array_elements_text(coalesce(v_child->'days', '[]'::jsonb)) x;
    if coalesce(array_length(v_days, 1), 0) <> v_opt.days_count
       or jsonb_array_length(coalesce(v_child->'days', '[]'::jsonb)) <> v_opt.days_count
       or exists (select 1 from unnest(v_days) x where x < v_edition.starts_on or x > v_edition.ends_on) then
      raise exception 'INVALID_DAYS' using errcode = 'P0001';
    end if;

    insert into public.registrations
      (org_id, athlete_id, program_id, status, registered_by, camp_edition_id, camp_price_option_id, camp_age_group_id,
       camp_days, camp_includes_lunch, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot,
       approval_status, approval_request_id, approval_requested_at, approval_age)
    values
      (v_org, v_athlete, v_program.id, 'pending_approval', v_by, v_edition.id, v_opt.id, v_grp.id,
       v_days, v_opt.includes_lunch, v_list, 0, v_list, v_currency,
       jsonb_build_object(
         'program', v_program.name, 'edition_id', v_edition.id, 'edition_name', v_edition.name,
         'starts_on', v_edition.starts_on, 'ends_on', v_edition.ends_on,
         'option_id', v_opt.id, 'option_label', v_opt.label, 'days_count', v_opt.days_count,
         'includes_lunch', v_opt.includes_lunch, 'age_group', v_grp.label, 'days', to_jsonb(v_days),
         'currency', v_currency, 'list_amount', v_list, 'discount_amount', 0, 'amount', v_list,
         'discounts', '[]'::jsonb, 'source', 'age_approval', 'priced_at', now()),
       'pending', v_request, now(), v_age)
    returning id into v_reg;

    v_reg_ids := v_reg_ids || v_reg;
    v_ath_ids := v_ath_ids || v_athlete;
    v_ages := v_ages || v_age;
    perform public.ca_audit(v_org, 'camp.approval.submit', 'registrations', v_reg,
                            jsonb_build_object('edition_id', v_edition.id, 'age_on_start', v_age, 'request_id', v_request));
  end loop;

  perform set_config('app.camp_pricing', 'off', true);
  perform set_config('app.camp_approval', 'off', true);

  -- Consents (latest active version per key) x each child, as register_camp.
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents')
    loop
      select id, version into v_form from public.consent_forms
       where org_id = v_org and key = v_consent and is_active order by version desc limit 1;
      if found then
        for v_athlete in select unnest(v_ath_ids)
        loop
          insert into public.consent_acceptances
            (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address, accepted_by)
          values (v_org, v_athlete, v_form.id, v_form.version, 'accepted', v_program.id, v_ip, v_by);
        end loop;
      end if;
    end loop;
  end if;

  return jsonb_build_object('replayed', false, 'registration_ids', to_jsonb(v_reg_ids),
                            'athlete_ids', to_jsonb(v_ath_ids), 'ages', to_jsonb(v_ages));
end;
$$;

revoke all on function public.camp_approval_submit(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.camp_approval_submit(jsonb) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) camp_approval_decide(registration, 'approve' | 'decline', note, request_id)
--    Admins of the registration's club only (finance cannot decide).
--
-- returns { decided, status, approval_status, reason?, invoice_id?, invoice_number?,
--           amount, currency, replayed, taken?, capacity? }
-- ---------------------------------------------------------------------------
create or replace function public.camp_approval_decide(
  p_registration uuid, p_decision text, p_note text default null, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.registrations%rowtype;
  v_org      uuid := public.current_org_id();
  v_edition  public.camp_editions%rowtype;
  v_program  public.programs%rowtype;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_family   uuid;
  v_name     text;
  v_taken    int;
  v_invoice  uuid;
  v_invnum   text;
  v_amount   numeric;
  v_list     numeric;
  v_disc     numeric;
  v_status   text;
  v_today    date;
  v_desc     text;
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'decline') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  if v_note is not null and length(v_note) > 1000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;

  select * into r from public.registrations where id = p_registration and org_id = v_org for update;
  if not found or r.approval_status is null then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Already decided: the same decision replays, another one is refused.
  if r.approval_status <> 'pending' then
    if (p_decision = 'approve' and r.approval_status = 'approved') or (p_decision = 'decline' and r.approval_status = 'declined') then
      return jsonb_build_object('decided', true, 'replayed', true, 'status', r.status::text, 'approval_status', r.approval_status,
                                'invoice_id', r.invoice_id,
                                'invoice_number', (select number from public.invoices where id = r.invoice_id),
                                'amount', r.price_amount, 'currency', r.price_currency);
    end if;
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;
  if r.status::text <> 'pending_approval' then raise exception 'ALREADY_DECIDED' using errcode = 'P0001'; end if;

  perform set_config('app.camp_approval', 'on', true);

  if p_decision = 'decline' then
    update public.registrations
       set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           cancellation_reason = coalesce(v_note, cancellation_reason),
           approval_status = 'declined', approval_decided_by = auth.uid(), approval_decided_at = now(), approval_note = v_note
     where id = r.id;
    perform set_config('app.camp_approval', 'off', true);
    perform public.ca_audit(v_org, 'camp.approval.decline', 'registrations', r.id,
                            jsonb_build_object('request_id', p_request_id, 'with_message', v_note is not null));
    return jsonb_build_object('decided', true, 'replayed', false, 'status', 'cancelled', 'approval_status', 'declined',
                              'amount', r.price_amount, 'currency', r.price_currency);
  end if;

  -- Approve: the existing capacity rule under the edition lock.
  select * into v_edition from public.camp_editions where id = r.camp_edition_id and org_id = v_org for update;
  if not found then raise exception 'EDITION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_edition.status not in ('published', 'draft') then raise exception 'EDITION_NOT_OPEN' using errcode = 'P0001'; end if;
  select * into v_program from public.programs where id = r.program_id and org_id = v_org;
  select count(*) into v_taken from public.registrations
   where camp_edition_id = v_edition.id and status in ('pending', 'confirmed');
  if v_edition.capacity is not null and v_taken >= v_edition.capacity then
    perform set_config('app.camp_approval', 'off', true);
    perform public.ca_audit(v_org, 'camp.approval.full', 'registrations', r.id,
                            jsonb_build_object('taken', v_taken, 'capacity', v_edition.capacity));
    return jsonb_build_object('decided', false, 'replayed', false, 'reason', 'EDITION_FULL', 'status', r.status::text,
                              'approval_status', 'pending', 'taken', v_taken, 'capacity', v_edition.capacity);
  end if;

  v_list := coalesce(r.price_list_amount, 0);
  v_disc := coalesce(r.price_discount_amount, 0);
  v_amount := coalesce(r.price_amount, 0);
  select a.family_id, btrim(a.first_name || ' ' || a.last_name) into v_family, v_name from public.athletes a where a.id = r.athlete_id;
  v_today := public.ca_org_today(v_org);

  if v_amount > 0 then
    -- Existing reservation rule: a priced camp registration is 'pending' with
    -- an issued camp invoice until it is paid (as register_camp()).
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, athlete_id, program_id, registration_id, description, status,
                                 due_date, currency, total_chf)
    values (v_org, v_invnum, v_family, r.athlete_id, r.program_id, r.id, left(v_program.name, 500), 'sent',
            v_today + 14, r.price_currency, v_amount)
    returning id, number into v_invoice, v_invnum;
    v_desc := v_program.name || coalesce(' — ' || (r.price_snapshot->>'option_label'), '') || ' — ' || coalesce(v_name, '');
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, left(v_desc, 500), 1, v_list, v_list);
    if v_disc > 0 then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, left(coalesce(v_program.name, '') || ' — ' || coalesce(v_name, ''), 500), 1, -v_disc, -v_disc);
    end if;
    v_status := 'pending';
  else
    v_status := 'confirmed';
  end if;

  perform set_config('app.camp_pricing', 'on', true);
  update public.registrations
     set status = v_status::public.registration_status, invoice_id = coalesce(v_invoice, invoice_id),
         approval_status = 'approved', approval_decided_by = auth.uid(), approval_decided_at = now(), approval_note = v_note
   where id = r.id;
  perform set_config('app.camp_pricing', 'off', true);
  perform set_config('app.camp_approval', 'off', true);

  perform public.ca_audit(v_org, 'camp.approval.approve', 'registrations', r.id,
                          jsonb_build_object('request_id', p_request_id, 'invoice_id', v_invoice, 'status', v_status,
                                             'with_message', v_note is not null));
  return jsonb_build_object('decided', true, 'replayed', false, 'status', v_status, 'approval_status', 'approved',
                            'invoice_id', v_invoice,
                            'invoice_number', (select number from public.invoices where id = v_invoice),
                            'amount', v_amount, 'currency', r.price_currency);
end;
$$;

revoke all on function public.camp_approval_decide(uuid, text, text, uuid) from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.camp_approval_decide(uuid, text, text, uuid) to authenticated, service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Paid in full -> an approved registration is confirmed
-- ---------------------------------------------------------------------------
create or replace function public.invoices_camp_approval_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id, org_id from public.registrations
            where invoice_id = new.id and org_id = new.org_id and approval_status = 'approved' and status = 'pending'
  loop
    perform set_config('app.camp_approval', 'on', true);
    update public.registrations set status = 'confirmed' where id = r.id;
    perform set_config('app.camp_approval', 'off', true);
    perform public.ca_audit(r.org_id, 'camp.approval.confirmed_on_payment', 'registrations', r.id,
                            jsonb_build_object('invoice_id', new.id));
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_invoices_camp_approval_confirm on public.invoices;
create trigger trg_invoices_camp_approval_confirm
  after update of status on public.invoices
  for each row
  when (new.status::text = 'paid' and old.status is distinct from new.status)
  execute function public.invoices_camp_approval_confirm();
revoke all on function public.invoices_camp_approval_confirm() from public, anon, authenticated;
