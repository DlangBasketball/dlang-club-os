-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 09 · Coach attendance module
--
-- attendance_sessions / attendance_marks / the attendance_status enum already
-- exist, and RLS already enforces coach-ownership (coach_leads_attendance_session)
-- and parent-of-program scoping. This migration adds:
--   • private per-athlete coach notes + an injury flag on marks
--   • a one-session-per-program_session guard
--   • coach RPCs (open / roster / save+submit) that enforce ownership server-side
--   • a PARENT-SAFE attendance summary (status only, no notes), gated by an org
--     setting — and removes guardians' direct read of marks so notes never leak.
-- ============================================================================

-- 1) Private coach fields on marks --------------------------------------------
alter table public.attendance_marks add column if not exists notes       text;
alter table public.attendance_marks add column if not exists injury_flag boolean not null default false;

-- 2) One attendance_session per program_session -------------------------------
create unique index if not exists attendance_sessions_ps_uniq
  on public.attendance_sessions (program_session_id)
  where program_session_id is not null;

-- 3) Org toggle: are approved attendance summaries visible to parents? ---------
update public.app_settings
   set settings = settings || jsonb_build_object('parent_attendance_visible', true)
 where org_id = '00000000-0000-0000-0000-000000000001'
   and not (settings ? 'parent_attendance_visible');

-- 4) Tighten mark visibility: parents NO LONGER read marks directly -----------
-- (private notes/injury must never reach a parent; they use the summary fn below)
drop policy if exists att_marks_select on public.attendance_marks;
create policy att_marks_select on public.attendance_marks for select
  using (
    public.is_admin()
    or public.coach_leads_attendance_session(attendance_session_id)
  );

-- 5) Open (or fetch) the attendance session for a program session --------------
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
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
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

-- 6) Roster for a session (leading coach / admin) — includes safety subset ----
create or replace function public.session_roster(p_attendance_session uuid)
returns table (
  athlete_id uuid,
  full_name  text,
  status     public.attendance_status,
  notes      text,
  injury_flag boolean,
  allergies  text,
  conditions text,
  emergency_contact_name  text,
  emergency_contact_phone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.attendance_sessions%rowtype;
  v_coach   uuid := public.current_coach_id();
begin
  select * into v_session from public.attendance_sessions where id = p_attendance_session;
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or v_session.coach_id = v_coach) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;

  return query
    select a.id,
           a.first_name || ' ' || a.last_name,
           m.status, m.notes, coalesce(m.injury_flag, false),
           med.allergies, med.conditions, med.emergency_contact_name, med.emergency_contact_phone
      from public.registrations r
      join public.athletes a on a.id = r.athlete_id
      left join public.attendance_marks m
             on m.attendance_session_id = p_attendance_session and m.athlete_id = a.id
      left join public.athlete_medical med on med.athlete_id = a.id
     where r.program_id = v_session.program_id
       and r.status <> 'cancelled'
     order by a.first_name, a.last_name;
end;
$$;

-- 7) Save (and optionally submit) attendance — leading coach / admin ----------
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
  if not found then raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or v_session.coach_id = v_coach) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if v_session.status = 'locked' then raise exception 'SESSION_LOCKED' using errcode = 'P0001'; end if;

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

-- 8) Parent-safe attendance summary (status only; gated by org setting) -------
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
  if v_org is null then return; end if;

  if public.is_admin() or public.is_finance() then
    null; -- staff: always allowed, no gate
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

-- 9) Grants --------------------------------------------------------------------
grant execute on function public.open_attendance_session(uuid)              to authenticated, service_role;
grant execute on function public.session_roster(uuid)                       to authenticated, service_role;
grant execute on function public.save_attendance(uuid, jsonb, boolean)      to authenticated, service_role;
grant execute on function public.athlete_attendance_summary(uuid)           to authenticated, service_role;
