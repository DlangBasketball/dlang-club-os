-- ============================================================================
-- Club OS · Delete / archive / restore a programme (admin only)
--
--   1. programs.status_before_archive
--      The status a programme had when it was archived (draft / published),
--      recorded by a trigger whatever path archives it (these RPCs, the edit
--      form, legacy is_active writers) and used by restore. Unknown -> draft.
--   2. program_linked_records(program)                        internal
--      Everything that keeps a programme from being deleted, per category:
--        registrations  registrations (all statuses, camps included),
--                       selection applications, waitlist entries
--        bookings       training bookings in a session held at one of the
--                       programme's events
--        schedules      programme sessions, camp weeks (editions), camp time
--                       slots, events of the programme's sessions or teams,
--                       selection tournaments
--        attendance     legacy attendance sessions (and their marks), team
--                       attendance sheets of the programme's events
--        invoices       invoices of the programme, of its registrations and
--                       applications; payment plans of the programme
--        payments       payments on those invoices
--        other          documents, consent records, contracts, expenses,
--                       incident reports, message conversations, recurring
--                       fee templates
--      plus the next upcoming sessions and current enrolments (first 10 each,
--      with totals) for the confirmation dialog.
--   3. program_delete_impact(program)  -> jsonb               admin only
--   4. program_delete(program)         -> jsonb               admin only
--      Locks the programme row (FOR UPDATE: new registrations, sessions,
--      invoices … referencing it wait for the decision), re-counts in the
--      same transaction and deletes only when nothing is linked. Otherwise
--      nothing changes and it returns
--      { ok: false, code: 'PROGRAM_HAS_LINKED_RECORDS', impact: <fresh counts> }.
--      Never archives by itself: archiving is its own explicit call.
--   5. program_archive(program)        -> jsonb               admin only
--      status 'archived' (hidden from public registration, parent camp
--      pages, the basket, new registrations and active selectors). Nothing
--      is cancelled or removed: sessions, enrolments, attendance and
--      financial records stay as they are.
--   6. program_restore(program)        -> jsonb               admin only
--      Back to the status before archiving (draft when unknown).
--   7. New registrations / selection applications cannot be added to an
--      archived programme (or moved into one): PROGRAM_ARCHIVED.
--
--   Finance, coaches and parents are refused (NOT_AUTHORIZED); another
--   club's programme is PROGRAM_NOT_FOUND. Every change is audit-logged
--   (programme name, statuses and counts only; no personal data).
--   Additive and idempotent. Tests: tests/db/program_delete_archive.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Status before archiving
-- ---------------------------------------------------------------------------
alter table public.programs add column if not exists status_before_archive text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'programs_status_before_archive_chk') then
    alter table public.programs add constraint programs_status_before_archive_chk
      check (status_before_archive is null or status_before_archive in ('draft', 'published'));
  end if;
end $$;

comment on column public.programs.status_before_archive is
  'Status the programme had when it was archived; program_restore puts it back (draft when null).';

create or replace function public.programs_archive_memo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'archived' then
    if old.status is distinct from 'archived' then
      new.status_before_archive := case when old.status in ('draft', 'published') then old.status end;
    end if;
  else
    new.status_before_archive := null;
  end if;
  return new;
end $$;

-- Named to fire after trg_programs_status_sync (which can turn a legacy
-- is_active = false write into status 'archived').
drop trigger if exists trg_programs_zz_archive_memo on public.programs;
create trigger trg_programs_zz_archive_memo
  before update on public.programs
  for each row execute function public.programs_archive_memo();

-- ---------------------------------------------------------------------------
-- 2) Linked records (internal: callers check the role and the club first)
-- ---------------------------------------------------------------------------
create or replace function public.program_linked_records(p_program uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  p            record;
  v_sessions   uuid[];
  v_events     uuid[];
  v_regs       uuid[];
  v_editions   uuid[];
  v_invoices   uuid[];
  c            jsonb;
  v_cat        jsonb;
  v_total      int;
  v_upcoming   jsonb;
  n_upcoming   int;
  v_enrol      jsonb;
  n_enrol      int;
begin
  select id, org_id, name, kind, status, archived_at, status_before_archive
    into p from public.programs where id = p_program;
  if not found then return null; end if;

  select coalesce(array_agg(id), '{}') into v_sessions from public.program_sessions where program_id = p_program;
  select coalesce(array_agg(id), '{}') into v_editions from public.camp_editions where program_id = p_program;
  select coalesce(array_agg(e.id), '{}') into v_events
    from public.events e
   where e.org_id = p.org_id
     and (e.program_session_id = any(v_sessions)
          or e.team_id in (select t.id from public.teams t where t.program_id = p_program));
  select coalesce(array_agg(id), '{}') into v_regs from public.registrations where program_id = p_program;
  select coalesce(array_agg(distinct i.id), '{}') into v_invoices
    from public.invoices i
   where i.org_id = p.org_id
     and (i.program_id = p_program
          or i.registration_id = any(v_regs)
          or i.id in (select r.invoice_id from public.registrations r where r.program_id = p_program and r.invoice_id is not null)
          or i.id in (select a.invoice_id from public.program_applications a where a.program_id = p_program and a.invoice_id is not null));

  c := jsonb_build_object(
    'registrations',       cardinality(v_regs),
    'applications',        (select count(*) from public.program_applications where program_id = p_program),
    'waitlist',            (select count(*) from public.waitlist_entries where program_id = p_program or camp_edition_id = any(v_editions)),
    'bookings',            (select count(*) from public.training_bookings b
                             where b.session_id in (select s.id from public.training_sessions s where s.event_id = any(v_events)
                                                    union
                                                    select e.training_session_id from public.events e
                                                     where e.id = any(v_events) and e.training_session_id is not null)),
    'program_sessions',    cardinality(v_sessions),
    'camp_editions',       cardinality(v_editions),
    'camp_time_slots',     (select count(*) from public.camp_time_slots where program_id = p_program),
    'events',              cardinality(v_events),
    'tournaments',         (select count(*) from public.program_tournaments where program_id = p_program),
    'attendance_sessions', (select count(*) from public.attendance_sessions
                             where program_id = p_program or program_session_id = any(v_sessions)),
    'attendance_sheets',   (select count(*) from public.team_attendance_sheets where event_id = any(v_events)),
    'invoices',            cardinality(v_invoices),
    'payment_plans',       (select count(*) from public.payment_plans where program_id = p_program),
    'payments',            (select count(*) from public.payments where invoice_id = any(v_invoices)),
    'documents',           (select count(*) from public.documents where program_id = p_program),
    'consents',            (select count(*) from public.consent_acceptances where program_id = p_program),
    'contracts',           (select count(*) from public.contracts where program_id = p_program or registration_id = any(v_regs)),
    'expenses',            (select count(*) from public.expenses where program_id = p_program or camp_edition_id = any(v_editions)),
    'incidents',           (select count(*) from public.incident_reports where program_id = p_program),
    'conversations',       (select count(*) from public.msg_conversations where program_id = p_program or camp_edition_id = any(v_editions)),
    'fee_templates',       (select count(*) from public.recurring_fee_templates where program_id = p_program)
  );

  v_cat := jsonb_build_object(
    'registrations', (c->>'registrations')::int + (c->>'applications')::int + (c->>'waitlist')::int,
    'bookings',      (c->>'bookings')::int,
    'schedules',     (c->>'program_sessions')::int + (c->>'camp_editions')::int + (c->>'camp_time_slots')::int
                     + (c->>'events')::int + (c->>'tournaments')::int,
    'attendance',    (c->>'attendance_sessions')::int + (c->>'attendance_sheets')::int,
    'invoices',      (c->>'invoices')::int + (c->>'payment_plans')::int,
    'payments',      (c->>'payments')::int,
    'other',         (c->>'documents')::int + (c->>'consents')::int + (c->>'contracts')::int + (c->>'expenses')::int
                     + (c->>'incidents')::int + (c->>'conversations')::int + (c->>'fee_templates')::int
  );
  select coalesce(sum(value::int), 0) into v_total from jsonb_each_text(v_cat);

  -- Upcoming sessions (events of the programme, programme sessions without
  -- an event, camp weeks not over yet). Nothing is cancelled here.
  with up as (
    select e.id, 'event'::text as kind, nullif(btrim(e.title), '') as title, e.type::text as event_type,
           e.starts_at as sort_at, to_jsonb(e.starts_at) as starts_at, to_jsonb(e.ends_at) as ends_at,
           false as all_day, e.status::text as status
      from public.events e
     where e.id = any(v_events) and e.starts_at >= now() and e.status in ('scheduled', 'postponed')
    union all
    select s.id, 'program_session', null, null, s.starts_at, to_jsonb(s.starts_at), to_jsonb(s.ends_at), false, null
      from public.program_sessions s
     where s.program_id = p_program and s.starts_at >= now()
       and not exists (select 1 from public.events e where e.program_session_id = s.id)
    union all
    select ce.id, 'camp_edition', nullif(btrim(ce.name), ''), null, ce.starts_on::timestamp at time zone 'UTC',
           to_jsonb(ce.starts_on::text), to_jsonb(ce.ends_on::text), true, ce.status
      from public.camp_editions ce
     where ce.program_id = p_program and ce.ends_on >= current_date and ce.status not in ('cancelled', 'archived')
  )
  select (select count(*) from up),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'event_type', x.event_type,
                                                       'starts_at', x.starts_at, 'ends_at', x.ends_at, 'all_day', x.all_day,
                                                       'status', x.status) order by x.sort_at, x.id)
                     from (select * from up order by sort_at, id limit 10) x), '[]'::jsonb)
    into n_upcoming, v_upcoming;

  -- Current enrolments (child name + status), first 10 by name.
  with en as (
    select r.id, 'registration'::text as kind, a.first_name, a.last_name, r.status::text as status
      from public.registrations r left join public.athletes a on a.id = r.athlete_id
     where r.program_id = p_program and r.status::text in ('pending', 'confirmed', 'waitlist', 'pending_approval')
    union all
    select pa.id, 'application', a.first_name, a.last_name, pa.status
      from public.program_applications pa left join public.athletes a on a.id = pa.athlete_id
     where pa.program_id = p_program and pa.status in ('applied', 'under_review', 'accepted', 'waitlisted', 'enrolled')
  )
  select (select count(*) from en),
         coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind,
                                                       'child_name', btrim(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, '')),
                                                       'status', x.status) order by x.last_name, x.first_name, x.id)
                     from (select * from en order by last_name, first_name, id limit 10) x), '[]'::jsonb)
    into n_enrol, v_enrol;

  return jsonb_build_object(
    'program_id', p.id, 'name', p.name, 'kind', p.kind, 'status', p.status,
    'archived_at', p.archived_at, 'previous_status', p.status_before_archive,
    'counts', c, 'categories', v_cat, 'total', v_total, 'can_delete', v_total = 0,
    'upcoming_sessions', v_upcoming, 'upcoming_total', n_upcoming,
    'current_enrollments', v_enrol, 'current_enrollments_total', n_enrol);
end $$;

comment on function public.program_linked_records(uuid) is
  'Internal: records linked to a programme (per category), upcoming sessions and current enrolments. No caller check.';

-- Caller check: admin of the programme's club. Returns the club.
create or replace function public.program_admin_org(p_program uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select org_id into v_org from public.programs where id = p_program;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_org;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Preview
-- ---------------------------------------------------------------------------
create or replace function public.program_delete_impact(p_program uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.program_admin_org(p_program);
  return public.program_linked_records(p_program);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Permanent delete (refused while anything is linked)
-- ---------------------------------------------------------------------------
create or replace function public.program_delete(p_program uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  p        record;
  v_impact jsonb;
begin
  v_org := public.program_admin_org(p_program);
  select id, name, kind, status, slug into p from public.programs where id = p_program and org_id = v_org for update;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Re-count under the row lock: whatever was added since the preview counts.
  v_impact := public.program_linked_records(p_program);
  if not coalesce((v_impact->>'can_delete')::boolean, false) then
    return jsonb_build_object('ok', false, 'deleted', false, 'code', 'PROGRAM_HAS_LINKED_RECORDS',
                              'program_id', p_program, 'impact', v_impact);
  end if;

  delete from public.programs where id = p_program and org_id = v_org;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data)
  values (v_org, auth.uid(), 'program.delete', 'programs', p_program,
          jsonb_build_object('name', p.name, 'kind', p.kind, 'status', p.status, 'slug', p.slug));
  return jsonb_build_object('ok', true, 'deleted', true, 'program_id', p_program, 'name', p.name);
end $$;

-- ---------------------------------------------------------------------------
-- 5) Archive (explicit; keeps every linked record)
-- ---------------------------------------------------------------------------
create or replace function public.program_archive(p_program uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid;
  p        record;
  v_impact jsonb;
begin
  v_org := public.program_admin_org(p_program);
  select id, name, status into p from public.programs where id = p_program and org_id = v_org for update;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if p.status = 'archived' then raise exception 'PROGRAM_ALREADY_ARCHIVED' using errcode = 'P0001'; end if;

  update public.programs set status = 'archived' where id = p_program;
  v_impact := public.program_linked_records(p_program);

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, auth.uid(), 'program.archive', 'programs', p_program,
          jsonb_build_object('name', p.name, 'status', p.status),
          jsonb_build_object('status', 'archived', 'categories', v_impact->'categories'));
  return jsonb_build_object('ok', true, 'program_id', p_program, 'name', p.name,
                            'status', 'archived', 'previous_status', p.status);
end $$;

-- ---------------------------------------------------------------------------
-- 6) Restore
-- ---------------------------------------------------------------------------
create or replace function public.program_restore(p_program uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  p      record;
  v_next text;
begin
  v_org := public.program_admin_org(p_program);
  select id, name, status, status_before_archive into p from public.programs where id = p_program and org_id = v_org for update;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if p.status <> 'archived' then raise exception 'PROGRAM_NOT_ARCHIVED' using errcode = 'P0001'; end if;

  v_next := coalesce(p.status_before_archive, 'draft');
  update public.programs set status = v_next where id = p_program;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, auth.uid(), 'program.restore', 'programs', p_program,
          jsonb_build_object('name', p.name, 'status', 'archived'),
          jsonb_build_object('status', v_next));
  return jsonb_build_object('ok', true, 'program_id', p_program, 'name', p.name, 'status', v_next);
end $$;

-- ---------------------------------------------------------------------------
-- 7) No new enrolment in an archived programme
-- ---------------------------------------------------------------------------
create or replace function public.program_archived_enrolment_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.program_id is not distinct from old.program_id then return new; end if;
  if new.program_id is not null
     and exists (select 1 from public.programs where id = new.program_id and status = 'archived') then
    raise exception 'PROGRAM_ARCHIVED' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_registrations_program_archived on public.registrations;
create trigger trg_registrations_program_archived
  before insert or update of program_id on public.registrations
  for each row execute function public.program_archived_enrolment_guard();

drop trigger if exists trg_program_applications_program_archived on public.program_applications;
create trigger trg_program_applications_program_archived
  before insert or update of program_id on public.program_applications
  for each row execute function public.program_archived_enrolment_guard();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.program_linked_records(uuid)', 'public.program_admin_org(uuid)',
    'public.programs_archive_memo()', 'public.program_archived_enrolment_guard()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon, authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
  foreach f in array array[
    'public.program_delete_impact(uuid)', 'public.program_delete(uuid)',
    'public.program_archive(uuid)', 'public.program_restore(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
end $$;
