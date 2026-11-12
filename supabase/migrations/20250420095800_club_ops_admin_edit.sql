-- ============================================================================
-- Club OS — Club operations: admin edit everywhere (track B)
--
-- Lets admins (and, where noted, the session's coach) correct club-operations
-- data after the fact, with an audit trail:
--
--   1) programs     status draft/published/archived, currency override, age
--                   range, registration window; archive-not-delete when
--                   registrations exist; public read only for published rows;
--                   registration window / age / status enforced for
--                   non-staff registrations
--   2) events       recurring series (series_id), cancellation reason
--   3) attendance   post-submission corrections (correct_attendance), reopen
--                   (reopen_attendance_session), audit rows that never copy
--                   the private coach note text
--   4) bookings     admin edit (time, coach, service, status, notes) and
--                   cancel with reason; cancellation timestamps on every path
--   5) audit        generic audit trigger on programs, events, teams,
--                   training_services, training_bookings, coach_availability,
--                   attendance_sessions
--
-- Additive and idempotent. Tenant scope: every RPC resolves the org from the
-- caller (current_org_id()) and never from an argument.
-- ============================================================================

-- ===========================================================================
-- 1) PROGRAMS
-- ===========================================================================
alter table public.programs
  add column if not exists status                 text not null default 'published',
  add column if not exists currency               text,
  add column if not exists min_age                smallint,
  add column if not exists max_age                smallint,
  add column if not exists registration_opens_at  timestamptz,
  add column if not exists registration_closes_at timestamptz,
  add column if not exists archived_at            timestamptz;

-- Existing inactive programmes become archived (is_active is now derived).
update public.programs set status = 'archived', archived_at = coalesce(archived_at, updated_at)
 where not is_active and status = 'published';

do $$ begin
  alter table public.programs add constraint programs_status_chk
    check (status in ('draft', 'published', 'archived'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.programs add constraint programs_currency_iso
    check (currency is null or currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.programs add constraint programs_age_chk
    check ((min_age is null or min_age between 0 and 99)
       and (max_age is null or max_age between 0 and 99)
       and (min_age is null or max_age is null or max_age >= min_age));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.programs add constraint programs_reg_window_chk
    check (registration_opens_at is null or registration_closes_at is null
           or registration_closes_at > registration_opens_at);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.programs add constraint programs_price_nonneg
    check (price_chf >= 0) not valid;
exception when duplicate_object then null; end $$;

create index if not exists idx_programs_org_status on public.programs(org_id, status);

-- status is the source of truth; is_active (read by register_public and older
-- code) follows it. Legacy writers that only flip is_active still work.
create or replace function public.programs_status_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.is_active is distinct from old.is_active then
    new.status := case when new.is_active then 'published' else 'archived' end;
  elsif tg_op = 'INSERT' and not coalesce(new.is_active, true) and new.status = 'published' then
    new.status := 'archived';
  end if;
  new.is_active := (new.status = 'published');
  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' then new.archived_at := now(); end if;
  else
    new.archived_at := null;
  end if;
  new.currency := upper(nullif(btrim(new.currency), ''));
  return new;
end;
$$;

drop trigger if exists trg_programs_status_sync on public.programs;
create trigger trg_programs_status_sync
  before insert or update on public.programs
  for each row execute function public.programs_status_sync();

-- A programme with registrations is archived, never hard-deleted (the
-- registrations FK cascades). Deleting the whole organisation still works:
-- by the time the cascade reaches programs the org row is gone.
create or replace function public.programs_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.organizations where id = old.org_id)
     and exists (select 1 from public.registrations where program_id = old.id) then
    raise exception 'PROGRAM_HAS_REGISTRATIONS' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_programs_delete_guard on public.programs;
create trigger trg_programs_delete_guard
  before delete on public.programs
  for each row execute function public.programs_delete_guard();

-- Other clubs and anonymous visitors only ever see PUBLISHED public rows.
drop policy if exists programs_select on public.programs;
create policy programs_select on public.programs for select
  using ((is_public and status = 'published') or org_id = public.current_org_id());

-- Registrations by anyone but the club's own staff (public form, parent app)
-- must respect the programme's status, registration window and age range.
-- Staff can still enrol manually (late entries, exceptions).
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
  if v_p.min_age is not null or v_p.max_age is not null then
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

drop trigger if exists trg_registrations_program_rules on public.registrations;
create trigger trg_registrations_program_rules
  before insert on public.registrations
  for each row execute function public.registrations_program_rules();

-- Invoices raised for a programme with its own currency use that currency
-- (fires before trg_invoices_currency_tax, which defaults to the org's).
create or replace function public.invoices_program_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_cur text;
begin
  if nullif(new.currency, '') is null and new.program_id is not null then
    select currency into v_cur from public.programs where id = new.program_id and org_id = new.org_id;
    if v_cur is not null then new.currency := v_cur; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_a_program_currency on public.invoices;
create trigger trg_invoices_a_program_currency
  before insert on public.invoices
  for each row execute function public.invoices_program_currency();

-- ===========================================================================
-- 2) EVENTS: recurring series + cancellation reason
-- ===========================================================================
alter table public.events
  add column if not exists series_id     uuid,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.events add constraint events_cancel_reason_len
    check (cancel_reason is null or length(cancel_reason) <= 500);
exception when duplicate_object then null; end $$;

create index if not exists idx_events_series on public.events(series_id, starts_at) where series_id is not null;

create or replace function public.events_cancel_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled' then
    if tg_op = 'INSERT' or old.status is distinct from 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
      new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
    end if;
  else
    new.cancel_reason := null;
    new.cancelled_at  := null;
    new.cancelled_by  := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_events_cancel_stamp on public.events;
create trigger trg_events_cancel_stamp
  before insert or update on public.events
  for each row execute function public.events_cancel_stamp();

-- ===========================================================================
-- 3) ATTENDANCE: corrections after submission, reopen, audit
-- ===========================================================================
alter table public.attendance_marks
  add column if not exists corrected_by uuid references public.profiles(id) on delete set null,
  add column if not exists corrected_at timestamptz;

alter table public.attendance_sessions
  add column if not exists reopened_at      timestamptz,
  add column if not exists reopened_by      uuid references public.profiles(id) on delete set null,
  add column if not exists correction_count integer not null default 0;

-- Applies one mark change and, when p_audit, writes an audit row. The private
-- note text is never copied into audit_logs (it can hold health details):
-- only whether it changed. Internal: not executable by clients.
create or replace function public.attendance_apply_mark(
  p_session public.attendance_sessions, p_mark jsonb, p_audit boolean, p_reason text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete uuid := (p_mark->>'athlete_id')::uuid;
  v_status  text := nullif(p_mark->>'status', '');
  v_notes   text := nullif(btrim(coalesce(p_mark->>'notes', '')), '');
  v_injury  boolean := coalesce((p_mark->>'injury_flag')::boolean, false);
  v_old     public.attendance_marks%rowtype;
  v_id      uuid;
begin
  select * into v_old from public.attendance_marks
   where attendance_session_id = p_session.id and athlete_id = v_athlete;

  if v_status is null then
    if v_old.id is null then return false; end if;
    delete from public.attendance_marks where id = v_old.id;
    if p_audit then
      insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
      values (p_session.org_id, auth.uid(), 'attendance.mark_removed', 'attendance_marks', v_old.id,
              jsonb_build_object('session_id', p_session.id, 'athlete_id', v_athlete, 'status', v_old.status,
                                 'injury_flag', v_old.injury_flag),
              jsonb_build_object('session_id', p_session.id, 'athlete_id', v_athlete, 'reason', p_reason));
    end if;
    return true;
  end if;

  if v_old.id is not null
     and v_old.status::text = v_status
     and v_old.notes is not distinct from v_notes
     and v_old.injury_flag = v_injury then
    return false; -- no-op
  end if;

  insert into public.attendance_marks (org_id, attendance_session_id, athlete_id, status, notes, injury_flag,
                                       marked_by, marked_at, corrected_by, corrected_at)
  values (p_session.org_id, p_session.id, v_athlete, v_status::public.attendance_status, v_notes, v_injury,
          public.current_coach_id(), now(),
          case when p_audit then auth.uid() end, case when p_audit then now() end)
  on conflict (attendance_session_id, athlete_id) do update
    set status = excluded.status, notes = excluded.notes, injury_flag = excluded.injury_flag,
        marked_by = coalesce(excluded.marked_by, public.attendance_marks.marked_by),
        marked_at = now(),
        corrected_by = case when p_audit then auth.uid() else public.attendance_marks.corrected_by end,
        corrected_at = case when p_audit then now() else public.attendance_marks.corrected_at end
  returning id into v_id;

  if p_audit then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (p_session.org_id, auth.uid(),
            case when v_old.id is null then 'attendance.mark_added' else 'attendance.correct' end,
            'attendance_marks', v_id,
            case when v_old.id is not null then
              jsonb_build_object('session_id', p_session.id, 'athlete_id', v_athlete,
                                 'status', v_old.status, 'injury_flag', v_old.injury_flag) end,
            jsonb_build_object('session_id', p_session.id, 'athlete_id', v_athlete, 'status', v_status,
                               'injury_flag', v_injury,
                               'note_changed', v_old.notes is distinct from v_notes,
                               'reason', p_reason));
  end if;
  return true;
end;
$$;
revoke all on function public.attendance_apply_mark(public.attendance_sessions, jsonb, boolean, text) from public, anon, authenticated;

-- Shared validation for a batch of marks (same club, valid status, coach scope).
create or replace function public.attendance_check_marks(p_session public.attendance_sessions, p_marks jsonb, p_allow_clear boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_m jsonb; v_ath uuid;
begin
  if jsonb_typeof(coalesce(p_marks, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_MARKS' using errcode = 'P0001';
  end if;
  for v_m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    begin
      v_ath := (v_m->>'athlete_id')::uuid;
    exception when others then
      raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
    end;
    if v_ath is null or not exists (select 1 from public.athletes a where a.id = v_ath and a.org_id = p_session.org_id) then
      raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if nullif(v_m->>'status', '') is null then
      if not p_allow_clear then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
    elsif (v_m->>'status') not in ('present', 'late', 'absent', 'excused') then
      raise exception 'INVALID_STATUS' using errcode = 'P0001';
    end if;
    if length(coalesce(v_m->>'notes', '')) > 1000 then
      raise exception 'NOTE_TOO_LONG' using errcode = 'P0001';
    end if;
  end loop;
end;
$$;
revoke all on function public.attendance_check_marks(public.attendance_sessions, jsonb, boolean) from public, anon, authenticated;

-- save_attendance (coach roster): unchanged contract; once a session has been
-- submitted, every further change is audited as a correction.
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
  v_audit   boolean;
  v_changed int := 0;
begin
  select * into v_session from public.attendance_sessions where id = p_session;
  if not found or v_session.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- coalesce: a caller without a coach row (v_coach null) must be refused.
  if not (public.is_admin() or coalesce(v_session.coach_id = v_coach, false)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_session.status = 'locked' then raise exception 'SESSION_LOCKED' using errcode = 'P0001'; end if;

  perform public.attendance_check_marks(v_session, p_marks, false);
  v_audit := v_session.status <> 'open';

  for v_m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    if public.attendance_apply_mark(v_session, v_m, v_audit, null) then v_changed := v_changed + 1; end if;
  end loop;

  if p_submit then
    update public.attendance_sessions
       set status = 'submitted', submitted_at = coalesce(case when v_audit then submitted_at end, now()),
           roster_size = (select count(*) from public.attendance_marks where attendance_session_id = p_session),
           correction_count = correction_count + case when v_audit then v_changed else 0 end
     where id = p_session;
  else
    update public.attendance_sessions
       set updated_at = now(),
           correction_count = correction_count + case when v_audit then v_changed else 0 end
     where id = p_session;
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

-- Corrections after the fact: admin (any status) or the session's coach
-- (not once an admin has locked it). Athletes not on the roster can be added
-- (late arrivals, drop-ins); a coach only for athletes they may access.
-- A null status removes the mark. Every change is audited.
create or replace function public.correct_attendance(p_session uuid, p_marks jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions%rowtype;
  v_admin   boolean := public.is_admin();
  v_m       jsonb;
  v_changed int := 0;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_session from public.attendance_sessions where id = p_session for update;
  if not found or v_session.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_admin or coalesce(v_session.coach_id = public.current_coach_id(), false)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_session.status = 'locked' and not v_admin then
    raise exception 'SESSION_LOCKED' using errcode = 'P0001';
  end if;
  if length(coalesce(v_reason, '')) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  perform public.attendance_check_marks(v_session, p_marks, true);

  if not v_admin and exists (
    select 1 from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) e
     where not exists (select 1 from public.attendance_marks m
                        where m.attendance_session_id = p_session and m.athlete_id = (e->>'athlete_id')::uuid)
       and not exists (select 1 from public.registrations r
                        where r.program_id = v_session.program_id and r.athlete_id = (e->>'athlete_id')::uuid
                          and r.status <> 'cancelled')
       and not public.coach_can_access_athlete((e->>'athlete_id')::uuid)
  ) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  for v_m in select * from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb))
  loop
    if public.attendance_apply_mark(v_session, v_m, true, v_reason) then v_changed := v_changed + 1; end if;
  end loop;

  update public.attendance_sessions
     set correction_count = correction_count + v_changed,
         roster_size = case when status <> 'open'
                            then (select count(*) from public.attendance_marks where attendance_session_id = p_session)
                            else roster_size end,
         updated_at = now()
   where id = p_session;

  return jsonb_build_object('changed', v_changed);
end;
$$;

-- Reopen a submitted (coach or admin) or locked (admin only) session.
create or replace function public.reopen_attendance_session(p_session uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions%rowtype;
  v_admin   boolean := public.is_admin();
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_session from public.attendance_sessions where id = p_session for update;
  if not found or v_session.org_id is distinct from public.current_org_id() then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_admin or coalesce(v_session.coach_id = public.current_coach_id(), false)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_session.status = 'open' then raise exception 'ALREADY_OPEN' using errcode = 'P0001'; end if;
  if v_session.status = 'locked' and not v_admin then raise exception 'SESSION_LOCKED' using errcode = 'P0001'; end if;
  if length(coalesce(v_reason, '')) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  update public.attendance_sessions
     set status = 'open', reopened_at = now(), reopened_by = auth.uid(), updated_at = now()
   where id = p_session;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_session.org_id, auth.uid(), 'attendance.reopen', 'attendance_sessions', p_session,
          jsonb_build_object('session_id', p_session, 'status', v_session.status),
          jsonb_build_object('session_id', p_session, 'status', 'open', 'reason', v_reason));

  return jsonb_build_object('attendance_session_id', p_session, 'status', 'open');
end;
$$;

revoke all on function public.correct_attendance(uuid, jsonb, text)      from public, anon;
revoke all on function public.reopen_attendance_session(uuid, text)      from public, anon;
grant execute on function public.save_attendance(uuid, jsonb, boolean)    to authenticated, service_role;
grant execute on function public.correct_attendance(uuid, jsonb, text)    to authenticated, service_role;
grant execute on function public.reopen_attendance_session(uuid, text)    to authenticated, service_role;

-- ===========================================================================
-- 4) BOOKINGS: admin edit + cancel with reason
-- ===========================================================================
alter table public.training_bookings
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at  timestamptz,
  add column if not exists cancelled_by  uuid references public.profiles(id) on delete set null;

do $$ begin
  alter table public.training_bookings add constraint training_bookings_cancel_reason_len
    check (cancel_reason is null or length(cancel_reason) <= 500);
exception when duplicate_object then null; end $$;

create or replace function public.training_bookings_cancel_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_training_bookings_cancel_stamp on public.training_bookings;
create trigger trg_training_bookings_cancel_stamp
  before update on public.training_bookings
  for each row execute function public.training_bookings_cancel_stamp();

-- Admin edit: service, coach, time, status (booked/completed/no_show) and
-- notes. Payment (credits/invoice) is not changed here. Slot bookkeeping:
-- the old slot is freed; a free availability slot at the new start is taken.
create or replace function public.admin_update_booking(
  p_booking uuid, p_service uuid, p_coach uuid, p_start timestamptz, p_end timestamptz,
  p_status text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b    public.training_bookings%rowtype;
  v_svc  public.training_services%rowtype;
  v_end  timestamptz;
  v_slot public.coach_availability%rowtype;
  v_moved boolean;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into v_b from public.training_bookings where id = p_booking for update;
  if not found or v_b.org_id is distinct from public.current_org_id() then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_b.status = 'cancelled' then raise exception 'NOT_EDITABLE' using errcode = 'P0001'; end if;
  if p_status not in ('booked', 'completed', 'no_show') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;

  select * into v_svc from public.training_services where id = p_service and org_id = v_b.org_id;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.coaches where id = p_coach and org_id = v_b.org_id) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_start is null then raise exception 'INVALID_TIME' using errcode = 'P0001'; end if;
  v_end := coalesce(p_end, p_start + make_interval(mins => coalesce(v_svc.duration_min, 60)));
  if v_end <= p_start or v_end - p_start > interval '12 hours' then
    raise exception 'INVALID_TIME' using errcode = 'P0001';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;

  v_moved := p_coach is distinct from v_b.coach_id or p_start is distinct from v_b.slot_start;

  if v_moved and p_status in ('booked', 'completed') and exists (
    select 1 from public.training_bookings o
     where o.coach_id = p_coach and o.id <> p_booking and o.status in ('booked', 'completed')
       and tstzrange(o.slot_start, coalesce(o.slot_end, o.slot_start + interval '1 hour'), '[)')
           && tstzrange(p_start, v_end, '[)')
  ) then
    raise exception 'COACH_BUSY' using errcode = 'P0001';
  end if;

  if v_moved then
    update public.coach_availability set is_booked = false
     where org_id = v_b.org_id and coach_id = v_b.coach_id and starts_at = v_b.slot_start;
    select * into v_slot from public.coach_availability
     where org_id = v_b.org_id and coach_id = p_coach and starts_at = p_start for update;
    if found then
      if v_slot.is_booked then raise exception 'SLOT_TAKEN' using errcode = 'P0001'; end if;
      update public.coach_availability set is_booked = true where id = v_slot.id;
    end if;
  end if;

  update public.training_bookings
     set service_id = p_service, coach_id = p_coach, slot_start = p_start, slot_end = v_end,
         status = p_status::public.booking_status, notes = nullif(btrim(coalesce(p_notes, '')), ''),
         updated_at = now()
   where id = p_booking;

  return jsonb_build_object('booking_id', p_booking, 'slot_start', p_start, 'slot_end', v_end, 'status', p_status);
end;
$$;

-- Cancel with reason (admin): the existing cancellation (refund credits, void
-- an unpaid invoice, free the slot) plus the reason, in one transaction.
create or replace function public.admin_cancel_booking(p_booking uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res    jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  v_res := public.cancel_training_booking(p_booking); -- org + status checks live there
  update public.training_bookings set cancel_reason = v_reason, cancelled_by = auth.uid() where id = p_booking;
  return v_res || jsonb_build_object('reason', v_reason);
end;
$$;

revoke all on function public.admin_update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.admin_cancel_booking(uuid, text) from public, anon;
grant execute on function public.admin_update_booking(uuid, uuid, uuid, timestamptz, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.admin_cancel_booking(uuid, text) to authenticated, service_role;

-- ===========================================================================
-- 5) AUDIT TRIGGERS (who changed what) on club-operations tables
-- ===========================================================================
drop trigger if exists trg_audit_programs on public.programs;
create trigger trg_audit_programs after insert or update or delete on public.programs
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_events on public.events;
create trigger trg_audit_events after insert or update or delete on public.events
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_teams on public.teams;
create trigger trg_audit_teams after insert or update or delete on public.teams
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_training_services on public.training_services;
create trigger trg_audit_training_services after insert or update or delete on public.training_services
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_training_bookings on public.training_bookings;
create trigger trg_audit_training_bookings after insert or update or delete on public.training_bookings
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_coach_availability on public.coach_availability;
create trigger trg_audit_coach_availability after insert or update or delete on public.coach_availability
  for each row execute function public.audit_trigger();
drop trigger if exists trg_audit_attendance_sessions on public.attendance_sessions;
create trigger trg_audit_attendance_sessions after update on public.attendance_sessions
  for each row when (old.status is distinct from new.status or old.coach_id is distinct from new.coach_id)
  execute function public.audit_trigger();
