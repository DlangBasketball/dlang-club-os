-- ============================================================================
-- Club OS — Club approval of family requests + confirmed-only rosters
--
-- A family-initiated "Join the club" (membership) request, and a family's
-- request to enrol a child in a club programme (programs.requires_club_approval,
-- default on for recurring_team / clinic), is saved as a pending club approval
-- request. Nothing else is written while it is pending: no membership, no
-- registration, no invoice, no roster row. The pending state lives ONLY in
-- club_approval_requests, so a pending club application can never block a camp
-- or a training booking (no camp / booking rule reads this table).
--
--   club_request_submit(payload, request_id)   guardian of the family
--   club_request_decide(id, decision, message, request_id)
--        admin of the club (any request) or an assigned coach (programme
--        requests only). decision: approve | request_info | decline.
--        approve -> membership:  membership_create_core() — the EXISTING
--                                membership rules and invoice, unchanged;
--                   programme:   registration + programme invoice (price_chf),
--                                'pending' until paid in full, then confirmed
--                                (free = confirmed at once). A confirmed
--                                registration of an approved request joins the
--                                programme's active team(s) (team_memberships).
--   club_request_reply(id, message, request_id)  guardian: answers an info
--        request -> back to pending.
--   club_request_withdraw(id, request_id)        guardian.
--   club_request_queue(scope) / club_request_family_list() / club_request_counts()
--
-- Every write takes a request id: a retry / double click replays the first
-- result, never a second request, membership, invoice or roster row.
--
-- Confirmed-only rosters:
--   * session_roster(): registrations 'confirmed' / 'completed' only (was:
--     every status except cancelled, which listed pending, pending_approval
--     and waitlist children on attendance sheets).
--   * session_roster_unconfirmed(): names + reason of the participants who are
--     not yet confirmed (pending approval / awaiting payment), never markable.
--   * coach_can_access_athlete(): a programme registration grants a coach
--     access only once it is confirmed / completed. The reviewer of a pending
--     club request sees the minimal data of club_request_queue() only.
--
-- EYBL / selection programmes (program_applications), camp age approval
-- (20250420105100), staff-created memberships / registrations and the season
-- fee billing (membership_issue) are unchanged.
--
-- Additive and idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) programs.requires_club_approval
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'programs' and column_name = 'requires_club_approval') then
    alter table public.programs add column requires_club_approval boolean not null default false;
    -- Backfill once (re-running never overrides an admin's later choice).
    update public.programs set requires_club_approval = true where kind::text in ('recurring_team', 'clinic');
  end if;
end $$;
comment on column public.programs.requires_club_approval is
  'Family requests to enrol in this programme wait for a club decision (club_approval_requests). Default on for recurring_team / clinic.';

-- New club programmes start with the approval on (admins may switch it off).
create or replace function public.programs_club_approval_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind::text in ('recurring_team', 'clinic') then
    new.requires_club_approval := true;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_programs_club_approval_default on public.programs;
create trigger trg_programs_club_approval_default
  before insert on public.programs
  for each row execute function public.programs_club_approval_default();
revoke all on function public.programs_club_approval_default() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Tables
-- ---------------------------------------------------------------------------
create table if not exists public.club_approval_requests (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  subject_kind         text not null,
  membership_type_id   uuid references public.membership_types(id) on delete restrict,
  program_id           uuid references public.programs(id) on delete cascade,
  family_id            uuid not null references public.families(id) on delete cascade,
  athlete_id           uuid references public.athletes(id) on delete cascade,
  requested_by         uuid references public.profiles(id) on delete set null,
  assigned_coach_ids   uuid[] not null default '{}',
  status               text not null default 'pending',
  request_id           uuid not null,
  decided_by           uuid references public.profiles(id) on delete set null,
  decided_at           timestamptz,
  decision_request_id  uuid,
  membership_id        uuid references public.memberships(id) on delete set null,
  registration_id      uuid references public.registrations(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
do $$ begin
  alter table public.club_approval_requests add constraint club_approval_requests_chk check (
    subject_kind in ('membership', 'program_registration')
    and status in ('pending', 'info_requested', 'approved', 'declined', 'withdrawn')
    and ((subject_kind = 'membership' and membership_type_id is not null and program_id is null)
      or (subject_kind = 'program_registration' and program_id is not null and athlete_id is not null and membership_type_id is null))
    and cardinality(assigned_coach_ids) <= 20);
exception when duplicate_object then null; end $$;

create index if not exists idx_club_approval_requests_org on public.club_approval_requests(org_id, status, created_at);
create index if not exists idx_club_approval_requests_family on public.club_approval_requests(family_id);
create index if not exists idx_club_approval_requests_athlete on public.club_approval_requests(athlete_id);
create index if not exists idx_club_approval_requests_program on public.club_approval_requests(program_id);
create index if not exists idx_club_approval_requests_registration on public.club_approval_requests(registration_id);
create index if not exists idx_club_approval_requests_membership on public.club_approval_requests(membership_id);
create index if not exists idx_club_approval_requests_coaches on public.club_approval_requests using gin (assigned_coach_ids);
create unique index if not exists uq_club_approval_requests_request on public.club_approval_requests(org_id, request_id);
-- One open request per child (or household) and subject.
create unique index if not exists uq_club_approval_requests_open
  on public.club_approval_requests(org_id, subject_kind, coalesce(program_id, membership_type_id), coalesce(athlete_id, family_id))
  where status in ('pending', 'info_requested');

drop trigger if exists trg_club_approval_requests_updated on public.club_approval_requests;
create trigger trg_club_approval_requests_updated before update on public.club_approval_requests
  for each row execute function public.set_updated_at();
drop trigger if exists trg_club_approval_requests_same_org on public.club_approval_requests;
create trigger trg_club_approval_requests_same_org before insert or update on public.club_approval_requests
  for each row execute function public.ca_same_org_guard('family_id:families', 'athlete_id:athletes', 'program_id:programs',
                                                          'membership_type_id:membership_types', 'membership_id:memberships',
                                                          'registration_id:registrations');
drop trigger if exists trg_audit_club_approval_requests on public.club_approval_requests;
create trigger trg_audit_club_approval_requests after insert or update or delete on public.club_approval_requests
  for each row execute function public.audit_trigger();

create table if not exists public.club_approval_messages (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  approval_id        uuid not null references public.club_approval_requests(id) on delete cascade,
  author_id          uuid references public.profiles(id) on delete set null,
  author_side        text not null,
  kind               text not null,
  body               text,
  client_request_id  uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
do $$ begin
  alter table public.club_approval_messages add constraint club_approval_messages_chk check (
    author_side in ('family', 'club')
    and kind in ('note', 'info_request', 'reply', 'approved', 'declined', 'withdrawn')
    and coalesce(length(body), 0) <= 2000);
exception when duplicate_object then null; end $$;
create index if not exists idx_club_approval_messages_org on public.club_approval_messages(org_id);
create index if not exists idx_club_approval_messages_approval on public.club_approval_messages(approval_id, created_at);
create unique index if not exists uq_club_approval_messages_request
  on public.club_approval_messages(org_id, client_request_id) where client_request_id is not null;
drop trigger if exists trg_club_approval_messages_updated on public.club_approval_messages;
create trigger trg_club_approval_messages_updated before update on public.club_approval_messages
  for each row execute function public.set_updated_at();
drop trigger if exists trg_club_approval_messages_same_org on public.club_approval_messages;
create trigger trg_club_approval_messages_same_org before insert or update on public.club_approval_messages
  for each row execute function public.ca_same_org_guard('approval_id:club_approval_requests');
drop trigger if exists trg_audit_club_approval_messages on public.club_approval_messages;
create trigger trg_audit_club_approval_messages after insert or update or delete on public.club_approval_messages
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 3) Reviewers + RLS (every verb). Writes only through the RPCs below.
-- ---------------------------------------------------------------------------
-- Assigned reviewers of a programme: its head coach(es) (programme coaches
-- and the head coaches of its active teams); without a head, every coach of
-- the programme / its teams; none -> the club's admins decide.
create or replace function public.club_program_reviewer_coaches(p_program uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with p as (select id, org_id from public.programs where id = p_program),
  coaches_ as (
    select pc.coach_id, pc.role = 'head' as head
      from public.program_coaches pc join p on p.id = pc.program_id
     where pc.org_id = p.org_id
    union all
    select tc.coach_id, tc.role = 'head'
      from public.teams t join p on p.id = t.program_id
      join public.team_coaches tc on tc.team_id = t.id
     where t.org_id = p.org_id and t.is_active
  ),
  valid as (
    select c.coach_id, c.head from coaches_ c
      join public.coaches co on co.id = c.coach_id and co.org_id = (select org_id from p)
  )
  select coalesce(
    (select array_agg(distinct coach_id order by coach_id) from valid where head),
    (select array_agg(distinct coach_id order by coach_id) from valid),
    '{}'::uuid[]);
$$;

-- May the caller decide this request? Admin of its club, or an assigned
-- coach of a programme request.
create or replace function public.club_request_can_review(p_org uuid, p_kind text, p_coaches uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and p_org is not null and p_org = public.current_org_id()
     and (public.is_admin()
          or (p_kind = 'program_registration' and public.has_role('coach')
              and public.current_coach_id() is not null and public.current_coach_id() = any(p_coaches)));
$$;

-- Read access: admins, assigned coaches (programme requests) and the family's guardians.
create or replace function public.club_request_visible(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.club_approval_requests r
     where r.id = p_id and r.org_id = public.current_org_id()
       and (public.club_request_can_review(r.org_id, r.subject_kind, r.assigned_coach_ids)
            or public.is_guardian_of_family(r.family_id)));
$$;

alter table public.club_approval_requests enable row level security;
alter table public.club_approval_messages enable row level security;

drop policy if exists club_approval_requests_select on public.club_approval_requests;
create policy club_approval_requests_select on public.club_approval_requests for select
  using (org_id = public.current_org_id()
         and (public.club_request_can_review(org_id, subject_kind, assigned_coach_ids) or public.is_guardian_of_family(family_id)));
drop policy if exists club_approval_requests_insert on public.club_approval_requests;
create policy club_approval_requests_insert on public.club_approval_requests for insert
  with check (false);
drop policy if exists club_approval_requests_update on public.club_approval_requests;
create policy club_approval_requests_update on public.club_approval_requests for update
  using (false) with check (false);
drop policy if exists club_approval_requests_delete on public.club_approval_requests;
create policy club_approval_requests_delete on public.club_approval_requests for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists club_approval_messages_select on public.club_approval_messages;
create policy club_approval_messages_select on public.club_approval_messages for select
  using (org_id = public.current_org_id() and public.club_request_visible(approval_id));
drop policy if exists club_approval_messages_insert on public.club_approval_messages;
create policy club_approval_messages_insert on public.club_approval_messages for insert
  with check (false);
drop policy if exists club_approval_messages_update on public.club_approval_messages;
create policy club_approval_messages_update on public.club_approval_messages for update
  using (false) with check (false);
drop policy if exists club_approval_messages_delete on public.club_approval_messages;
create policy club_approval_messages_delete on public.club_approval_messages for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- ---------------------------------------------------------------------------
-- 4) Membership creation core (rules unchanged)
--
-- Body of membership_create() from 20250420102400_sponsored_players.sql,
-- without the caller check, so the approval RPC applies exactly the same
-- membership rules and invoice inside its own transaction. Not callable by
-- any API role; membership_create() keeps its service-role check and calls it.
-- ---------------------------------------------------------------------------
create or replace function public.membership_create_core(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := nullif(p_payload->>'org_id', '')::uuid;
  v_type     public.membership_types;
  v_prev     public.memberships;
  v_ath      public.athletes;
  v_family   uuid;
  v_athlete  uuid := nullif(p_payload->>'athlete_id', '')::uuid;
  v_dob      date;
  v_age      int;
  v_from     date;
  v_until    date;
  v_today    date;
  v_currency text;
  v_exp      int;
  v_list     numeric;
  v_price    numeric;
  v_spct     numeric := 0;
  v_spon     numeric := 0;
  v_free     boolean := coalesce((p_payload->>'free')::boolean, false);
  v_due      int := least(greatest(coalesce((p_payload->>'due_days')::int, 30), 0), 120);
  v_invoice  uuid;
  v_invnum   text;
  v_id       uuid;
  v_by       uuid := nullif(p_payload->>'created_by', '')::uuid;
  v_name     text;
begin
  if v_org is null then raise exception 'ORG_REQUIRED' using errcode = 'P0001'; end if;
  v_today := public.ca_org_today(v_org);

  if nullif(p_payload->>'renew_from_id', '') is not null then
    select * into v_prev from public.memberships
     where id = (p_payload->>'renew_from_id')::uuid and org_id = v_org for update;
    if not found then raise exception 'MEMBERSHIP_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_prev.status = 'cancelled' then raise exception 'MEMBERSHIP_CANCELLED' using errcode = 'P0001'; end if;
    if exists (select 1 from public.memberships where renewed_from_id = v_prev.id and status <> 'cancelled') then
      raise exception 'ALREADY_RENEWED' using errcode = 'P0001';
    end if;
    v_family := v_prev.family_id;
    v_athlete := v_prev.athlete_id;
    select * into v_type from public.membership_types
     where id = coalesce(nullif(p_payload->>'type_id', '')::uuid, v_prev.membership_type_id) and org_id = v_org;
    v_from := greatest(v_prev.valid_until + 1, (select period_start from public.membership_period(v_type.period, v_type.season_start_month, v_today)));
  else
    select * into v_type from public.membership_types where id = nullif(p_payload->>'type_id', '')::uuid and org_id = v_org;
    select id into v_family from public.families where id = nullif(p_payload->>'family_id', '')::uuid and org_id = v_org;
    v_from := coalesce(nullif(p_payload->>'valid_from', '')::date, v_today);
  end if;
  if v_type.id is null then raise exception 'TYPE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not v_type.is_active then raise exception 'TYPE_INACTIVE' using errcode = 'P0001'; end if;
  if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_type.scope = 'person' then
    if v_athlete is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
    select dob, btrim(first_name || ' ' || last_name) into v_dob, v_name
      from public.athletes where id = v_athlete and family_id = v_family and org_id = v_org;
    if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_age := extract(year from age(v_from, v_dob))::int;
    if (v_type.min_age is not null and v_age < v_type.min_age) or (v_type.max_age is not null and v_age > v_type.max_age) then
      raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
    end if;
    select * into v_ath from public.athletes where id = v_athlete;
  else
    v_athlete := null;
    select name into v_name from public.families where id = v_family;
  end if;

  select period_end into v_until from public.membership_period(v_type.period, v_type.season_start_month, v_from);

  if exists (select 1 from public.memberships m
              where m.org_id = v_org and m.family_id = v_family and m.membership_type_id = v_type.id
                and m.athlete_id is not distinct from v_athlete and m.status in ('active', 'pending_payment')
                and daterange(m.valid_from, m.valid_until, '[]') && daterange(v_from, v_until, '[]')) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;

  v_currency := upper(coalesce(v_type.currency, public.org_currency(v_org)));
  v_exp := public.currency_exponent(v_currency);
  v_list := case when v_free then 0 else round(v_type.price, v_exp) end;
  if v_list > 0 and v_ath.id is not null then
    v_spct := public.athlete_sponsorship_percent(v_ath, 'membership', v_from);
    v_spon := least(round(v_list * v_spct / 100, v_exp), v_list);
  end if;
  v_price := v_list - v_spon;

  insert into public.memberships (org_id, membership_type_id, family_id, athlete_id, valid_from, valid_until, status,
                                  price_amount, currency, renewed_from_id, created_by)
  values (v_org, v_type.id, v_family, v_athlete, v_from, v_until,
          case when v_price > 0 then 'pending_payment' else 'active' end,
          v_price, v_currency, v_prev.id, v_by)
  returning id into v_id;

  if v_price > 0 then
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, athlete_id, description, status, due_date, currency, total_chf, created_by)
    values (v_org, v_invnum, v_family, v_athlete, left(v_type.name, 500), 'sent', v_today + v_due, v_currency, v_price, v_by)
    returning id into v_invoice;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, left(v_type.name || ' — ' || coalesce(v_name, '') || ' — '
                                   || to_char(v_from, 'DD.MM.YYYY') || '–' || to_char(v_until, 'DD.MM.YYYY'), 500),
            1, v_list, v_list);
    if v_spon > 0 then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, public.sponsorship_label(v_org, null, v_ath.sponsor_name), 1, -v_spon, -v_spon);
    end if;
    update public.memberships set invoice_id = v_invoice where id = v_id;
  end if;

  if v_spon > 0 then
    insert into public.athlete_sponsorship_entries
      (org_id, athlete_id, family_id, invoice_id, membership_id, scope, method, sponsorship_kind, percent, sponsor_name,
       list_amount, amount, currency, service_date, created_by)
    values (v_org, v_ath.id, v_family, v_invoice, v_id, 'membership',
            case when v_invoice is null then 'waived' else 'invoice_line' end,
            v_ath.sponsorship_kind, v_spct, v_ath.sponsor_name, v_list, v_spon, v_currency, v_from, v_by);
  end if;

  perform public.ca_audit(v_org, case when v_prev.id is null then 'membership.join' else 'membership.renew' end,
                          'memberships', v_id, jsonb_build_object('type_id', v_type.id, 'invoice_id', v_invoice, 'by', v_by,
                                                                  'sponsored', v_spon));

  return jsonb_build_object('membership_id', v_id, 'invoice_id', v_invoice, 'invoice_number', v_invnum,
                            'amount', v_price, 'sponsored', v_spon, 'currency', v_currency, 'valid_from', v_from, 'valid_until', v_until,
                            'family_id', v_family, 'athlete_id', v_athlete);
end;
$$;
revoke all on function public.membership_create_core(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on function public.membership_create_core(jsonb) from service_role;
  end if;
end $$;

-- Same contract as before (service role only); the body is the core above.
create or replace function public.membership_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return public.membership_create_core(p_payload);
end;
$$;
revoke all on function public.membership_create(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Guards on registrations of club-approval programmes
--
-- A family (no staff role) cannot enrol a child in a programme that requires
-- club approval by inserting a registration, nor confirm one by editing it
-- (it may still cancel). Staff, the service role and the approval RPCs pass.
-- ---------------------------------------------------------------------------
create or replace function public.registrations_club_approval_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff boolean;
begin
  if coalesce(current_setting('app.club_approval', true), '') = 'on'
     or coalesce(current_setting('app.camp_approval', true), '') = 'on'
     or coalesce(current_setting('app.selection_enroll', true), '') = 'on'
     or public.is_service_caller() then
    return new;
  end if;
  if new.camp_edition_id is not null then return new; end if;
  if not exists (select 1 from public.programs p where p.id = new.program_id and p.requires_club_approval) then
    return new;
  end if;
  v_staff := public.current_org_id() is not distinct from new.org_id and (public.is_finance() or public.has_role('coach'));
  if v_staff then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'CLUB_APPROVAL_REQUIRED' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and new.status::text <> 'cancelled' then
    raise exception 'CLUB_APPROVAL_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_registrations_club_approval_guard on public.registrations;
create trigger trg_registrations_club_approval_guard
  before insert or update on public.registrations
  for each row execute function public.registrations_club_approval_guard();
revoke all on function public.registrations_club_approval_guard() from public, anon, authenticated;

-- Programme rules (body from 20250420105100_camp_age_approval.sql) plus: the
-- club approval decision (app.club_approval) passes — the window and the age
-- were checked when the family submitted the request, and the reviewer
-- (admin or assigned coach) decides on that request.
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
  if coalesce(current_setting('app.club_approval', true), '') = 'on' then
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

-- ---------------------------------------------------------------------------
-- 6) Result + recipients
-- ---------------------------------------------------------------------------
-- Profiles to notify of a new / answered request: the assigned coaches with a
-- login, else the club's admins.
create or replace function public.club_request_notify_ids(p_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with r as (select * from public.club_approval_requests where id = p_id),
  coaches_ as (
    select distinct c.profile_id from r join public.coaches c on c.id = any(r.assigned_coach_ids) and c.org_id = r.org_id
     where r.subject_kind = 'program_registration' and c.profile_id is not null
  ),
  admins as (
    select distinct sr.profile_id from r join public.staff_roles sr on sr.org_id = r.org_id and sr.role = 'admin'
  )
  select coalesce((select array_agg(profile_id order by profile_id) from coaches_),
                  (select array_agg(profile_id order by profile_id) from admins), '{}'::uuid[]);
$$;
revoke all on function public.club_request_notify_ids(uuid) from public, anon, authenticated;

create or replace function public.club_request_result(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id, 'request_id', r.request_id, 'status', r.status, 'subject_kind', r.subject_kind,
    'program_id', r.program_id, 'membership_type_id', r.membership_type_id, 'family_id', r.family_id, 'athlete_id', r.athlete_id,
    'membership_id', r.membership_id, 'registration_id', r.registration_id,
    'invoice_id', coalesce((select m.invoice_id from public.memberships m where m.id = r.membership_id),
                           (select g.invoice_id from public.registrations g where g.id = r.registration_id)),
    'invoice_number', (select i.number from public.invoices i
                        where i.id = coalesce((select m.invoice_id from public.memberships m where m.id = r.membership_id),
                                              (select g.invoice_id from public.registrations g where g.id = r.registration_id))),
    'registration_status', (select g.status::text from public.registrations g where g.id = r.registration_id),
    'membership_status', (select m.status from public.memberships m where m.id = r.membership_id),
    'assigned_coach_ids', to_jsonb(r.assigned_coach_ids),
    'notify_profile_ids', to_jsonb(public.club_request_notify_ids(r.id)))
  from public.club_approval_requests r where r.id = p_id;
$$;
revoke all on function public.club_request_result(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) club_request_submit(payload, request_id) — guardian of the family
--
-- payload = { kind: 'membership' | 'program_registration', family_id,
--             athlete_id?, membership_type_id? | program_id?, message? }
-- ---------------------------------------------------------------------------
create or replace function public.club_request_submit(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_org     uuid := public.current_org_id();
  v_kind    text := coalesce(p_payload->>'kind', '');
  v_family  uuid;
  v_athlete uuid;
  v_dob     date;
  v_age     int;
  v_ref     date;
  v_today   date;
  v_type    public.membership_types%rowtype;
  v_prog    public.programs%rowtype;
  v_msg     text := nullif(btrim(coalesce(p_payload->>'message', '')), '');
  v_prev    public.club_approval_requests%rowtype;
  v_coaches uuid[] := '{}';
  v_id      uuid;
begin
  if v_uid is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':club_request:' || p_request_id::text, 0));

  -- Replay: the request of this id comes back unchanged (same submitter only).
  select * into v_prev from public.club_approval_requests where org_id = v_org and request_id = p_request_id;
  if found then
    if v_prev.requested_by is distinct from v_uid then raise exception 'REQUEST_ID_CONFLICT' using errcode = 'P0001'; end if;
    return public.club_request_result(v_prev.id) || jsonb_build_object('replayed', true);
  end if;

  if v_kind not in ('membership', 'program_registration') then raise exception 'INVALID_KIND' using errcode = 'P0001'; end if;
  if v_msg is not null and length(v_msg) > 2000 then raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001'; end if;

  begin v_family := nullif(p_payload->>'family_id', '')::uuid; exception when others then v_family := null; end;
  begin v_athlete := nullif(p_payload->>'athlete_id', '')::uuid; exception when others then v_athlete := null; end;
  if v_family is null or not exists (select 1 from public.families where id = v_family and org_id = v_org) then
    raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_guardian_of_family(v_family) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_athlete is not null then
    select dob into v_dob from public.athletes
     where id = v_athlete and family_id = v_family and org_id = v_org and archived_at is null;
    if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  end if;
  v_today := public.ca_org_today(v_org);

  if v_kind = 'membership' then
    begin
      select * into v_type from public.membership_types
       where id = nullif(p_payload->>'membership_type_id', '')::uuid and org_id = v_org;
    exception when others then v_type := null; end;
    if v_type.id is null then raise exception 'TYPE_NOT_FOUND' using errcode = 'P0002'; end if;
    if not v_type.is_active then raise exception 'TYPE_INACTIVE' using errcode = 'P0001'; end if;
    if v_type.scope = 'person' then
      if v_athlete is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
      v_age := extract(year from age(v_today, v_dob))::int;
      if v_dob is not null and ((v_type.min_age is not null and v_age < v_type.min_age) or (v_type.max_age is not null and v_age > v_type.max_age)) then
        raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
      end if;
    else
      v_athlete := null;
    end if;
    if exists (select 1 from public.memberships m
                where m.org_id = v_org and m.family_id = v_family and m.membership_type_id = v_type.id
                  and m.athlete_id is not distinct from v_athlete and m.status in ('active', 'pending_payment')
                  and m.valid_until >= v_today) then
      raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
    end if;
  else
    begin
      select * into v_prog from public.programs where id = nullif(p_payload->>'program_id', '')::uuid and org_id = v_org;
    exception when others then v_prog := null; end;
    if v_prog.id is null then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_prog.kind::text not in ('recurring_team', 'clinic') or not v_prog.requires_club_approval then
      raise exception 'APPROVAL_NOT_REQUIRED' using errcode = 'P0001';
    end if;
    if v_prog.status <> 'published' then raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001'; end if;
    if (v_prog.registration_opens_at is not null and now() < v_prog.registration_opens_at)
       or (v_prog.registration_closes_at is not null and now() >= v_prog.registration_closes_at) then
      raise exception 'REGISTRATION_CLOSED' using errcode = 'P0001';
    end if;
    if v_athlete is null then raise exception 'ATHLETE_REQUIRED' using errcode = 'P0001'; end if;
    if v_dob is not null and (v_prog.min_age is not null or v_prog.max_age is not null) then
      v_ref := greatest(coalesce(v_prog.starts_on, current_date), current_date);
      v_age := extract(year from age(v_ref, v_dob))::int;
      if (v_prog.min_age is not null and v_age < v_prog.min_age) or (v_prog.max_age is not null and v_age > v_prog.max_age) then
        raise exception 'AGE_OUT_OF_RANGE' using errcode = 'P0001';
      end if;
    end if;
    if exists (select 1 from public.registrations g
                where g.athlete_id = v_athlete and g.program_id = v_prog.id and g.camp_edition_id is null
                  and g.status::text <> 'cancelled') then
      raise exception 'ALREADY_REGISTERED' using errcode = 'P0001';
    end if;
    v_coaches := public.club_program_reviewer_coaches(v_prog.id);
  end if;

  if exists (select 1 from public.club_approval_requests q
              where q.org_id = v_org and q.subject_kind = v_kind and q.status in ('pending', 'info_requested')
                and coalesce(q.program_id, q.membership_type_id) = coalesce(v_prog.id, v_type.id)
                and coalesce(q.athlete_id, q.family_id) = coalesce(v_athlete, v_family)) then
    raise exception 'ALREADY_REQUESTED' using errcode = 'P0001';
  end if;

  insert into public.club_approval_requests
    (org_id, subject_kind, membership_type_id, program_id, family_id, athlete_id, requested_by, assigned_coach_ids, status, request_id)
  values (v_org, v_kind, v_type.id, v_prog.id, v_family, v_athlete, v_uid, v_coaches, 'pending', p_request_id)
  returning id into v_id;
  if v_msg is not null then
    insert into public.club_approval_messages (org_id, approval_id, author_id, author_side, kind, body)
    values (v_org, v_id, v_uid, 'family', 'note', v_msg);
  end if;

  perform public.ca_audit(v_org, 'club_approval.submit', 'club_approval_requests', v_id,
                          jsonb_build_object('kind', v_kind, 'request_id', p_request_id, 'reviewers', cardinality(v_coaches)));
  return public.club_request_result(v_id) || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) club_request_decide(id, approve | request_info | decline, message, request_id)
-- ---------------------------------------------------------------------------
create or replace function public.club_request_decide(p_id uuid, p_decision text, p_message text default null, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_org      uuid := public.current_org_id();
  r          public.club_approval_requests%rowtype;
  v_msg      text := nullif(btrim(coalesce(p_message, '')), '');
  v_prog     public.programs%rowtype;
  v_out      jsonb;
  v_reg      uuid;
  v_existing public.registrations%rowtype;
  v_taken    int;
  v_currency text;
  v_exp      int;
  v_price    numeric;
  v_invoice  uuid;
  v_invnum   text;
  v_today    date;
  v_name     text;
  v_status   text;
begin
  if v_uid is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_decision is null or p_decision not in ('approve', 'request_info', 'decline') then
    raise exception 'INVALID_DECISION' using errcode = 'P0001';
  end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  if v_msg is not null and length(v_msg) > 2000 then raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001'; end if;

  select * into r from public.club_approval_requests where id = p_id and org_id = v_org for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.club_request_can_review(r.org_id, r.subject_kind, r.assigned_coach_ids) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- Replays: the same request id, or the decision that is already recorded.
  if r.decision_request_id = p_request_id
     or exists (select 1 from public.club_approval_messages m where m.approval_id = r.id and m.client_request_id = p_request_id) then
    return public.club_request_result(r.id) || jsonb_build_object('decided', true, 'replayed', true);
  end if;
  if r.status in ('approved', 'declined', 'withdrawn') then
    if (p_decision = 'approve' and r.status = 'approved') or (p_decision = 'decline' and r.status = 'declined') then
      return public.club_request_result(r.id) || jsonb_build_object('decided', true, 'replayed', true);
    end if;
    raise exception 'ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  if p_decision = 'request_info' then
    if r.status <> 'pending' then raise exception 'INFO_ALREADY_REQUESTED' using errcode = 'P0001'; end if;
    if v_msg is null then raise exception 'MESSAGE_REQUIRED' using errcode = 'P0001'; end if;
    update public.club_approval_requests set status = 'info_requested' where id = r.id;
    insert into public.club_approval_messages (org_id, approval_id, author_id, author_side, kind, body, client_request_id)
    values (v_org, r.id, v_uid, 'club', 'info_request', v_msg, p_request_id);
    perform public.ca_audit(v_org, 'club_approval.request_info', 'club_approval_requests', r.id, jsonb_build_object('request_id', p_request_id));
    return public.club_request_result(r.id) || jsonb_build_object('decided', true, 'replayed', false);
  end if;

  if p_decision = 'decline' then
    update public.club_approval_requests
       set status = 'declined', decided_by = v_uid, decided_at = now(), decision_request_id = p_request_id
     where id = r.id;
    insert into public.club_approval_messages (org_id, approval_id, author_id, author_side, kind, body, client_request_id)
    values (v_org, r.id, v_uid, 'club', 'declined', v_msg, p_request_id);
    perform public.ca_audit(v_org, 'club_approval.decline', 'club_approval_requests', r.id,
                            jsonb_build_object('request_id', p_request_id, 'with_message', v_msg is not null));
    return public.club_request_result(r.id) || jsonb_build_object('decided', true, 'replayed', false);
  end if;

  -- Approve -------------------------------------------------------------------
  if r.subject_kind = 'membership' then
    -- The existing membership rules + invoice (as a staff-created membership).
    v_out := public.membership_create_core(jsonb_build_object(
      'org_id', v_org, 'type_id', r.membership_type_id, 'family_id', r.family_id, 'athlete_id', r.athlete_id,
      'created_by', coalesce(r.requested_by, v_uid)));
    update public.club_approval_requests
       set status = 'approved', decided_by = v_uid, decided_at = now(), decision_request_id = p_request_id,
           membership_id = (v_out->>'membership_id')::uuid
     where id = r.id;
  else
    select * into v_prog from public.programs where id = r.program_id and org_id = v_org for update;
    if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_prog.status = 'archived' then raise exception 'PROGRAM_ARCHIVED' using errcode = 'P0001'; end if;
    -- Existing capacity rule (places held by pending + confirmed registrations).
    select count(*) into v_taken from public.registrations g
     where g.program_id = v_prog.id and g.camp_edition_id is null and g.status::text in ('pending', 'confirmed');
    if v_prog.capacity is not null and v_taken >= v_prog.capacity then
      perform public.ca_audit(v_org, 'club_approval.full', 'club_approval_requests', r.id,
                              jsonb_build_object('taken', v_taken, 'capacity', v_prog.capacity));
      return public.club_request_result(r.id)
             || jsonb_build_object('decided', false, 'replayed', false, 'reason', 'PROGRAM_FULL', 'taken', v_taken, 'capacity', v_prog.capacity);
    end if;
    select * into v_existing from public.registrations g
     where g.athlete_id = r.athlete_id and g.program_id = v_prog.id and g.camp_edition_id is null
     for update;
    if found and v_existing.status::text <> 'cancelled' then raise exception 'ALREADY_REGISTERED' using errcode = 'P0001'; end if;

    v_currency := upper(coalesce(v_prog.currency, public.org_currency(v_org)));
    v_exp := public.currency_exponent(v_currency);
    v_price := round(coalesce(v_prog.price_chf, 0), v_exp);
    v_today := public.ca_org_today(v_org);

    perform set_config('app.club_approval', 'on', true);
    perform set_config('app.camp_pricing', 'on', true);
    if v_existing.id is not null then
      -- A cancelled enrolment of this programme is reopened (one row per child + programme).
      update public.registrations
         set status = 'pending', cancelled_at = null, cancelled_by = null, cancellation_reason = null,
             registered_by = coalesce(r.requested_by, registered_by), invoice_id = null
       where id = v_existing.id;
      v_reg := v_existing.id;
    else
      insert into public.registrations (org_id, athlete_id, program_id, status, registered_by)
      values (v_org, r.athlete_id, v_prog.id, 'pending', r.requested_by)
      returning id into v_reg;
    end if;

    if v_price > 0 then
      -- Existing programme registration invoicing: one 'sent' invoice of the
      -- programme price, due in 14 days.
      select btrim(a.first_name || ' ' || a.last_name) into v_name from public.athletes a where a.id = r.athlete_id;
      v_invnum := public.next_invoice_number(v_org);
      insert into public.invoices (org_id, number, family_id, athlete_id, program_id, registration_id, description, status,
                                   due_date, currency, total_chf, created_by)
      values (v_org, v_invnum, r.family_id, r.athlete_id, v_prog.id, v_reg, left(v_prog.name, 500), 'sent',
              v_today + 14, v_currency, v_price, v_uid)
      returning id into v_invoice;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, left(v_prog.name || ' — ' || coalesce(v_name, ''), 500), 1, v_price, v_price);
      update public.registrations set invoice_id = v_invoice where id = v_reg;
      v_status := 'pending';
    else
      v_status := 'confirmed';
    end if;

    update public.club_approval_requests
       set status = 'approved', decided_by = v_uid, decided_at = now(), decision_request_id = p_request_id, registration_id = v_reg
     where id = r.id;
    if v_status = 'confirmed' then
      -- Free: confirmed at once (the confirmation trigger adds the team roster rows).
      update public.registrations set status = 'confirmed' where id = v_reg;
    end if;
    perform set_config('app.camp_pricing', 'off', true);
    perform set_config('app.club_approval', 'off', true);
  end if;

  insert into public.club_approval_messages (org_id, approval_id, author_id, author_side, kind, body, client_request_id)
  values (v_org, r.id, v_uid, 'club', 'approved', v_msg, p_request_id);
  perform public.ca_audit(v_org, 'club_approval.approve', 'club_approval_requests', r.id,
                          jsonb_build_object('request_id', p_request_id, 'membership_id', v_out->>'membership_id',
                                             'registration_id', v_reg, 'invoice_id', coalesce(v_invoice::text, v_out->>'invoice_id')));
  return public.club_request_result(r.id) || jsonb_build_object('decided', true, 'replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Family: reply to an information request, withdraw
-- ---------------------------------------------------------------------------
create or replace function public.club_request_reply(p_id uuid, p_message text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.current_org_id();
  r     public.club_approval_requests%rowtype;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if v_uid is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  select * into r from public.club_approval_requests where id = p_id and org_id = v_org for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_guardian_of_family(r.family_id) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if exists (select 1 from public.club_approval_messages m where m.approval_id = r.id and m.client_request_id = p_request_id) then
    return public.club_request_result(r.id) || jsonb_build_object('replayed', true);
  end if;
  if r.status <> 'info_requested' then raise exception 'NO_INFO_REQUESTED' using errcode = 'P0001'; end if;
  if v_msg is null then raise exception 'MESSAGE_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_msg) > 2000 then raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001'; end if;

  insert into public.club_approval_messages (org_id, approval_id, author_id, author_side, kind, body, client_request_id)
  values (v_org, r.id, v_uid, 'family', 'reply', v_msg, p_request_id);
  update public.club_approval_requests set status = 'pending' where id = r.id;
  perform public.ca_audit(v_org, 'club_approval.reply', 'club_approval_requests', r.id, jsonb_build_object('request_id', p_request_id));
  return public.club_request_result(r.id) || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.club_request_withdraw(p_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid := public.current_org_id();
  r     public.club_approval_requests%rowtype;
begin
  if v_uid is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  select * into r from public.club_approval_requests where id = p_id and org_id = v_org for update;
  if not found then raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if not public.is_guardian_of_family(r.family_id) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if r.status = 'withdrawn' then return public.club_request_result(r.id) || jsonb_build_object('replayed', true); end if;
  if r.status not in ('pending', 'info_requested') then raise exception 'ALREADY_DECIDED' using errcode = 'P0001'; end if;
  update public.club_approval_requests
     set status = 'withdrawn', decided_by = v_uid, decided_at = now(), decision_request_id = p_request_id
   where id = r.id;
  insert into public.club_approval_messages (org_id, approval_id, author_id, author_side, kind, client_request_id)
  values (v_org, r.id, v_uid, 'family', 'withdrawn', p_request_id);
  perform public.ca_audit(v_org, 'club_approval.withdraw', 'club_approval_requests', r.id, jsonb_build_object('request_id', p_request_id));
  return public.club_request_result(r.id) || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Paid in full -> confirmed; confirmed -> programme team roster
-- ---------------------------------------------------------------------------
create or replace function public.invoices_club_approval_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare g record;
begin
  for g in select reg.id, reg.org_id from public.registrations reg
             join public.club_approval_requests q on q.registration_id = reg.id and q.status = 'approved'
            where reg.invoice_id = new.id and reg.org_id = new.org_id and reg.status::text = 'pending'
  loop
    perform set_config('app.club_approval', 'on', true);
    update public.registrations set status = 'confirmed' where id = g.id;
    perform set_config('app.club_approval', 'off', true);
    perform public.ca_audit(g.org_id, 'club_approval.confirmed_on_payment', 'registrations', g.id, jsonb_build_object('invoice_id', new.id));
  end loop;
  return null;
end;
$$;
drop trigger if exists trg_invoices_club_approval_confirm on public.invoices;
create trigger trg_invoices_club_approval_confirm
  after update of status on public.invoices
  for each row
  when (new.status::text = 'paid' and old.status is distinct from new.status)
  execute function public.invoices_club_approval_confirm();
revoke all on function public.invoices_club_approval_confirm() from public, anon, authenticated;

-- A confirmed registration of an approved club request joins the active
-- team(s) of the programme (existing rows are left as they are).
create or replace function public.registrations_club_approval_roster()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text <> 'confirmed' or old.status::text = 'confirmed' then return null; end if;
  if not exists (select 1 from public.club_approval_requests q
                  where q.registration_id = new.id and q.org_id = new.org_id and q.status = 'approved') then
    return null;
  end if;
  insert into public.team_memberships (org_id, team_id, athlete_id, status, joined_on)
  select new.org_id, t.id, new.athlete_id, 'active', public.ca_org_today(new.org_id)
    from public.teams t
   where t.program_id = new.program_id and t.org_id = new.org_id and t.is_active
  on conflict (team_id, athlete_id) do nothing;
  return null;
end;
$$;
drop trigger if exists trg_registrations_club_approval_roster on public.registrations;
create trigger trg_registrations_club_approval_roster
  after update of status on public.registrations
  for each row execute function public.registrations_club_approval_roster();
revoke all on function public.registrations_club_approval_roster() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11) Lists
-- ---------------------------------------------------------------------------
-- Open amount of an invoice (0 once paid / cancelled / void).
create or replace function public.club_request_invoice_open(p_invoice uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when i.id is null then null
              when i.status::text in ('paid', 'cancelled', 'void', 'refunded', 'draft') then 0
              else greatest(public.invoice_amount_due(i.id)
                            - coalesce((select sum(p.amount_chf) from public.payments p
                                         where p.invoice_id = i.id and p.status::text = 'succeeded'), 0), 0) end
    from (select p_invoice as pid) x left join public.invoices i on i.id = x.pid;
$$;
revoke all on function public.club_request_invoice_open(uuid) from public, anon, authenticated;

-- One request as the reviewer / family sees it. p_staff adds the contact.
create or replace function public.club_request_row(p_id uuid, p_staff boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id, 'subject_kind', r.subject_kind, 'status', r.status, 'created_at', r.created_at, 'updated_at', r.updated_at,
    'decided_at', r.decided_at,
    'program', case when p.id is null then null else jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind::text,
                    'price', p.price_chf, 'currency', upper(coalesce(p.currency, public.org_currency(r.org_id))),
                    'capacity', p.capacity,
                    'taken', (select count(*) from public.registrations g where g.program_id = p.id and g.camp_edition_id is null
                               and g.status::text in ('pending', 'confirmed'))) end,
    'membership_type', case when mt.id is null then null else jsonb_build_object('id', mt.id, 'name', mt.name, 'scope', mt.scope,
                    'price', mt.price, 'currency', upper(coalesce(mt.currency, public.org_currency(r.org_id)))) end,
    'athlete', case when a.id is null then null else jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name,
                    'age', case when a.dob is null then null else extract(year from age(public.ca_org_today(r.org_id), a.dob))::int end) end,
    'family', jsonb_build_object('id', f.id, 'name', f.name,
                    'email', case when p_staff then f.contact_email::text end, 'phone', case when p_staff then f.phone end),
    'requested_by', jsonb_build_object('name', pr.full_name, 'email', case when p_staff then pr.email::text end),
    'assigned_coaches', coalesce((select jsonb_agg(c.display_name order by c.display_name) from public.coaches c
                                   where c.id = any(r.assigned_coach_ids) and c.org_id = r.org_id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('side', m.author_side, 'kind', m.kind, 'body', m.body, 'at', m.created_at)
                                           order by m.created_at, m.id)
                            from public.club_approval_messages m where m.approval_id = r.id), '[]'::jsonb),
    'registration', case when g.id is null then null else jsonb_build_object('id', g.id, 'status', g.status::text, 'invoice_id', g.invoice_id) end,
    'membership', case when ms.id is null then null else jsonb_build_object('id', ms.id, 'status', ms.status, 'invoice_id', ms.invoice_id,
                    'valid_from', ms.valid_from, 'valid_until', ms.valid_until) end,
    'invoice', case when i.id is null then null else jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status::text,
                    'currency', i.currency, 'open', public.club_request_invoice_open(i.id)) end)
  from public.club_approval_requests r
  join public.families f on f.id = r.family_id
  left join public.programs p on p.id = r.program_id
  left join public.membership_types mt on mt.id = r.membership_type_id
  left join public.athletes a on a.id = r.athlete_id
  left join public.profiles pr on pr.id = r.requested_by
  left join public.registrations g on g.id = r.registration_id
  left join public.memberships ms on ms.id = r.membership_id
  left join public.invoices i on i.id = coalesce(g.invoice_id, ms.invoice_id)
  where r.id = p_id;
$$;
revoke all on function public.club_request_row(uuid, boolean) from public, anon, authenticated;

-- Reviewer queue: admins see every request of the club, coaches the programme
-- requests assigned to them (minimal data: name, age, programme, messages).
-- p_scope: 'open' (pending + info requested) | 'decided' (last 100) | 'all'.
create or replace function public.club_request_queue(p_scope text default 'open')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_admin boolean := public.is_admin();
begin
  if auth.uid() is null or v_org is null or not (v_admin or public.has_role('coach')) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(public.club_request_row(x.id, v_admin) order by x.ord, x.created_at)
      from (
        select r.id, r.created_at, case when r.status in ('pending', 'info_requested') then 0 else 1 end as ord
          from public.club_approval_requests r
         where r.org_id = v_org
           and public.club_request_can_review(r.org_id, r.subject_kind, r.assigned_coach_ids)
           and (coalesce(p_scope, 'open') = 'all'
                or (coalesce(p_scope, 'open') = 'open' and r.status in ('pending', 'info_requested'))
                or (p_scope = 'decided' and r.status not in ('pending', 'info_requested')))
         order by r.created_at desc
         limit 200) x), '[]'::jsonb);
end;
$$;

-- Counts for the navigation / approvals hub.
create or replace function public.club_request_counts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'club_open', (select count(*) from public.club_approval_requests r
                   where r.org_id = v_org and r.status = 'pending'
                     and public.club_request_can_review(r.org_id, r.subject_kind, r.assigned_coach_ids)),
    'club_info_requested', (select count(*) from public.club_approval_requests r
                   where r.org_id = v_org and r.status = 'info_requested'
                     and public.club_request_can_review(r.org_id, r.subject_kind, r.assigned_coach_ids)),
    'camp_open', case when public.is_admin() then (select count(*) from public.registrations g
                   where g.org_id = v_org and g.status::text = 'pending_approval') else 0 end);
end;
$$;

-- Family: the requests of the caller's families (the derived state is read
-- from the source rows each time: request, registration / membership, invoice).
create or replace function public.club_request_family_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(public.club_request_row(r.id, false) order by r.created_at desc)
      from public.club_approval_requests r
     where r.org_id = v_org and public.is_guardian_of_family(r.family_id)), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) Confirmed-only attendance rosters
-- ---------------------------------------------------------------------------
-- Body from 20250420095200_tenant_rpc_hardening.sql; only confirmed (or
-- completed) registrations are on the sheet.
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
       and r.status::text in ('confirmed', 'completed')
     order by a.first_name, a.last_name;
end;
$$;

-- "Not yet confirmed" list of a session: names and the reason only (no
-- medical data, never markable). Reasons: pending_club_approval,
-- information_requested, pending_camp_approval, awaiting_payment, pending.
create or replace function public.session_roster_unconfirmed(p_attendance_session uuid)
returns table (athlete_id uuid, full_name text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions%rowtype;
begin
  select * into v_session from public.attendance_sessions where id = p_attendance_session;
  if not found or v_session.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_admin() or v_session.coach_id = public.current_coach_id()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  return query
    select x.aid, x.fname, x.reason from (
      select a.id as aid, a.first_name || ' ' || a.last_name as fname,
             case when r.status::text = 'pending_approval' then 'pending_camp_approval'
                  when coalesce(public.club_request_invoice_open(r.invoice_id), 0) > 0 then 'awaiting_payment'
                  else 'pending' end as reason
        from public.registrations r
        join public.athletes a on a.id = r.athlete_id and a.org_id = v_session.org_id
       where r.program_id = v_session.program_id and r.status::text in ('pending', 'pending_approval')
      union all
      select a.id, a.first_name || ' ' || a.last_name,
             case q.status when 'info_requested' then 'information_requested' else 'pending_club_approval' end
        from public.club_approval_requests q
        join public.athletes a on a.id = q.athlete_id and a.org_id = v_session.org_id
       where q.org_id = v_session.org_id and q.program_id = v_session.program_id and q.status in ('pending', 'info_requested')
    ) x
    order by x.fname;
end;
$$;

-- Coach access: a programme registration counts once confirmed / completed.
-- (Body from 20250420092000_teams_seasons_schedule.sql.)
create or replace function public.coach_can_access_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    join public.program_sessions ps on ps.program_id = r.program_id
    where r.athlete_id = p_athlete and ps.coach_id = public.current_coach_id()
      and r.status::text in ('confirmed', 'completed')
  )
  or exists (
    select 1 from public.training_bookings b
    where b.athlete_id = p_athlete and b.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.attendance_marks m
    join public.attendance_sessions s on s.id = m.attendance_session_id
    where m.athlete_id = p_athlete and s.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.team_memberships tm
    join public.team_coaches tc on tc.team_id = tm.team_id
    where tm.athlete_id = p_athlete and tc.coach_id = public.current_coach_id()
  );
$$;

-- ---------------------------------------------------------------------------
-- 13) Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.club_program_reviewer_coaches(uuid)',
    'public.club_request_can_review(uuid, text, uuid[])',
    'public.club_request_visible(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
  foreach f in array array[
    'public.club_request_submit(jsonb, uuid)',
    'public.club_request_decide(uuid, text, text, uuid)',
    'public.club_request_reply(uuid, text, uuid)',
    'public.club_request_withdraw(uuid, uuid)',
    'public.club_request_queue(text)',
    'public.club_request_counts()',
    'public.club_request_family_list()',
    'public.session_roster_unconfirmed(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.club_approval_requests, public.club_approval_messages to authenticated;
    grant delete on public.club_approval_requests, public.club_approval_messages to authenticated;
    grant all on public.club_approval_requests, public.club_approval_messages to service_role;
  end if;
end $$;
