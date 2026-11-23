-- ============================================================================
-- Family attendance UI (parent + player portals) and no-show alert recipients
-- Builds on 20250420104000_team_attendance.sql. Additive and idempotent.
--
--  1. events.rescheduled_from: the original start of a session whose start
--     moved (set by a trigger), so portals can show "moved from ...".
--  2. No-show alert recipients:
--       a. guardians with an active login (family_members), as before;
--       b. when the family has NO guardian login: the family's contact_email
--          as an e-mail-only recipient (recipient_family_id), never an
--          address that belongs to the player's own login;
--       c. neither: one 'no_contact' row for staff follow-up (as before).
--     Every alert row has a stable recipient_key ('g:<profile>' |
--     'f:<family>' | 'none'); the unique indexes now use it, so idempotency
--     holds for e-mail-only recipients too.
--  3. attendance_alerts_claim also hands out e-mail-only recipients (null
--     guardian, the family address in guardian_email); the new
--     attendance_alert_email_failed() records an asynchronous provider
--     failure (bounce / complaint) as failed, at the attempt cap, so it shows
--     in the staff follow-up list (attendance_alerts_followup, unchanged).
--  4. Portal reads: ta_athlete_overview adds cancel reason, reschedule,
--     season and location; guardian_attendance_record(event, athlete) is the
--     record page behind alert links (/parent/attendance/team/<event>).
--     Guardians only ever see finalized values of their own children; no
--     staff notes, correction reasons, other players or coach data.
-- ============================================================================

-- ===========================================================================
-- 1. Rescheduled sessions
-- ===========================================================================
alter table public.events add column if not exists rescheduled_from timestamptz;

create or replace function public.events_track_reschedule()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.starts_at is distinct from old.starts_at and old.starts_at is not null then
    new.rescheduled_from := coalesce(old.rescheduled_from, old.starts_at);
    if new.rescheduled_from = new.starts_at then new.rescheduled_from := null; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_events_track_reschedule on public.events;
create trigger trg_events_track_reschedule before update of starts_at on public.events
  for each row execute function public.events_track_reschedule();

-- ===========================================================================
-- 2. Alert recipients
-- ===========================================================================
alter table public.attendance_no_show_alerts
  add column if not exists recipient_family_id uuid references public.families(id) on delete cascade;
alter table public.attendance_no_show_alerts
  add column if not exists recipient_key text generated always as (
    case when guardian_profile_id is not null then 'g:' || guardian_profile_id::text
         when recipient_family_id is not null then 'f:' || recipient_family_id::text
         else 'none' end) stored;
do $$ begin
  alter table public.attendance_no_show_alerts add constraint attendance_no_show_alerts_one_recipient_chk
    check (guardian_profile_id is null or recipient_family_id is null);
exception when duplicate_object then null; end $$;
create index if not exists idx_attendance_no_show_alerts_family
  on public.attendance_no_show_alerts(recipient_family_id) where recipient_family_id is not null;

-- Recipient-keyed uniqueness (replaces the guardian-keyed indexes).
create unique index if not exists attendance_no_show_alerts_initial_rcpt_uidx
  on public.attendance_no_show_alerts(event_id, athlete_id, recipient_key) where kind = 'initial';
create unique index if not exists attendance_no_show_alerts_correction_rcpt_uidx
  on public.attendance_no_show_alerts(history_id, recipient_key) where kind = 'correction';
drop index if exists public.attendance_no_show_alerts_initial_uidx;
drop index if exists public.attendance_no_show_alerts_correction_uidx;

-- A plausible e-mail address (the same shape the app validates).
create or replace function public.ta_plausible_email(p text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(btrim(p) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$', false);
$$;

-- E-mail-only fallback: the family's contact e-mail, only when the family
-- has no guardian login that can receive alerts, and never the address of a
-- player login of that family (minors are never e-mailed directly).
create or replace function public.ta_alert_family_email(p_athlete uuid)
returns table (family_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select f.id, lower(btrim(f.contact_email))
    from public.athletes a
    join public.families f on f.id = a.family_id and f.org_id = a.org_id
   where a.id = p_athlete
     and coalesce(f.status, 'active') = 'active'
     and public.ta_plausible_email(f.contact_email)
     and not exists (select 1 from public.ta_alert_recipients(p_athlete))
     and not exists (select 1 from public.athletes a2 join public.profiles pp on pp.id = a2.player_profile_id
                      where a2.family_id = f.id and lower(btrim(pp.email::text)) = lower(btrim(f.contact_email)));
$$;

-- Alerts of one finalized mark (replaces the 20250420104000 version; same
-- lifecycle, recipient-keyed).
create or replace function public.ta_sync_mark_alerts(p_mark uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  m       public.team_attendance_marks%rowtype;
  s       public.team_attendance_sheets%rowtype;
  v_ev    public.events%rowtype;
  v_n     integer := 0;
  v_k     integer;
  v_last  text;
  v_hist  uuid;
  v_rcpt  uuid[];
  v_fam   uuid;
  v_keys  text[];
  g       uuid;
begin
  select * into m from public.team_attendance_marks where id = p_mark;
  if not found then return 0; end if;
  select * into s from public.team_attendance_sheets where id = m.sheet_id;
  select * into v_ev from public.events where id = m.event_id;
  if s.status <> 'final' or v_ev.status = 'cancelled' or v_ev.ends_at >= now() or m.finalized_status is null then
    return 0;
  end if;
  select coalesce(array_agg(r.profile_id), '{}') into v_rcpt from public.ta_alert_recipients(m.athlete_id) r;
  if cardinality(v_rcpt) = 0 then
    select fe.family_id into v_fam from public.ta_alert_family_email(m.athlete_id) fe limit 1;
  end if;
  v_keys := case when cardinality(v_rcpt) > 0 then (select array_agg('g:' || x::text) from unnest(v_rcpt) x)
                 when v_fam is not null then array['f:' || v_fam::text]
                 else array['none'] end;

  select a.mark_status into v_last from public.attendance_no_show_alerts a
   where a.event_id = m.event_id and a.athlete_id = m.athlete_id and a.sent_at is not null
   order by a.sent_at desc, a.created_at desc limit 1;

  if v_last is null then
    if m.finalized_status = 'unexcused' then
      foreach g in array v_rcpt loop
        insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, guardian_profile_id, kind, mark_status, status, next_attempt_at)
        values (m.org_id, m.event_id, m.athlete_id, m.id, g, 'initial', 'unexcused', 'pending', now())
        on conflict (event_id, athlete_id, recipient_key) where kind = 'initial'
        do update set status = 'pending', mark_id = excluded.mark_id, next_attempt_at = now(), attempts = 0, last_error = null
         where public.attendance_no_show_alerts.status in ('superseded', 'suppressed') and public.attendance_no_show_alerts.sent_at is null;
        get diagnostics v_k = row_count; v_n := v_n + v_k;
      end loop;
      if v_fam is not null then
        insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, recipient_family_id, kind, mark_status, status, next_attempt_at)
        values (m.org_id, m.event_id, m.athlete_id, m.id, v_fam, 'initial', 'unexcused', 'pending', now())
        on conflict (event_id, athlete_id, recipient_key) where kind = 'initial'
        do update set status = 'pending', mark_id = excluded.mark_id, next_attempt_at = now(), attempts = 0, last_error = null
         where public.attendance_no_show_alerts.status in ('superseded', 'suppressed') and public.attendance_no_show_alerts.sent_at is null;
        get diagnostics v_k = row_count; v_n := v_n + v_k;
      elsif cardinality(v_rcpt) = 0 then
        insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, guardian_profile_id, kind, mark_status, status)
        values (m.org_id, m.event_id, m.athlete_id, m.id, null, 'initial', 'unexcused', 'no_contact')
        on conflict (event_id, athlete_id, recipient_key) where kind = 'initial'
        do update set status = 'no_contact', mark_id = excluded.mark_id
         where public.attendance_no_show_alerts.status in ('superseded', 'suppressed') and public.attendance_no_show_alerts.sent_at is null;
        get diagnostics v_k = row_count; v_n := v_n + v_k;
      end if;
      -- Recipients that no longer apply (e.g. the family got a guardian login).
      update public.attendance_no_show_alerts set status = 'superseded'
       where event_id = m.event_id and athlete_id = m.athlete_id and kind = 'initial' and sent_at is null
         and status in ('pending', 'failed', 'no_contact') and not (recipient_key = any(v_keys));
    else
      update public.attendance_no_show_alerts set status = 'superseded'
       where event_id = m.event_id and athlete_id = m.athlete_id and sent_at is null
         and status in ('pending', 'failed', 'no_contact');
    end if;
    return v_n;
  end if;

  if v_last = m.finalized_status then
    update public.attendance_no_show_alerts set status = 'superseded'
     where event_id = m.event_id and athlete_id = m.athlete_id and sent_at is null and status in ('pending', 'failed', 'no_contact');
    return 0;
  end if;

  select h.id into v_hist from public.team_attendance_mark_history h
   where h.mark_id = m.id order by h.changed_at desc, h.created_at desc limit 1;
  if v_hist is null then return 0; end if;
  if exists (select 1 from public.attendance_no_show_alerts where history_id = v_hist and kind = 'correction') then
    return 0; -- this correction is already being communicated
  end if;
  update public.attendance_no_show_alerts set status = 'superseded'
   where event_id = m.event_id and athlete_id = m.athlete_id and status in ('sent', 'pending', 'failed', 'no_contact');
  foreach g in array v_rcpt loop
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, history_id, guardian_profile_id, kind, mark_status, status, next_attempt_at)
    values (m.org_id, m.event_id, m.athlete_id, m.id, v_hist, g, 'correction', m.finalized_status, 'pending', now())
    on conflict (history_id, recipient_key) where kind = 'correction'
    do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end loop;
  if v_fam is not null then
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, history_id, recipient_family_id, kind, mark_status, status, next_attempt_at)
    values (m.org_id, m.event_id, m.athlete_id, m.id, v_hist, v_fam, 'correction', m.finalized_status, 'pending', now())
    on conflict (history_id, recipient_key) where kind = 'correction'
    do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  elsif cardinality(v_rcpt) = 0 then
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, mark_id, history_id, guardian_profile_id, kind, mark_status, status)
    values (m.org_id, m.event_id, m.athlete_id, m.id, v_hist, null, 'correction', m.finalized_status, 'no_contact')
    on conflict (history_id, recipient_key) where kind = 'correction'
    do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  return v_n;
end;
$$;

-- ===========================================================================
-- 3. Dispatcher: claim (recipient kind + e-mail-only address), provider failures
-- ===========================================================================
-- Same result columns as before (an e-mail-only recipient has a null
-- guardian_profile_id and its address in guardian_email), so the earlier
-- migration stays re-runnable.
create or replace function public.attendance_alerts_claim(p_limit integer default 50, p_org uuid default null)
returns table (alert_id uuid, org_id uuid, kind text, mark_status text, attempts integer, channel_results jsonb,
               notification_id uuid, guardian_profile_id uuid, guardian_email text, guardian_name text,
               guardian_locale text, receives_emails boolean, event_id uuid, athlete_id uuid,
               athlete_first_name text, athlete_last_name text, team_name text, event_type text,
               starts_at timestamptz, ends_at timestamptz, timezone text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  return query
  with c as (
    select a.id from public.attendance_no_show_alerts a
      join public.events e on e.id = a.event_id
      join public.team_attendance_sheets s on s.event_id = a.event_id
     where a.status in ('pending', 'failed') and (a.guardian_profile_id is not null or a.recipient_family_id is not null)
       and a.attempts < public.ta_alert_max_attempts()
       and coalesce(a.next_attempt_at, a.created_at) <= now()
       and (a.claimed_at is null or a.claimed_at < now() - interval '10 minutes')
       and e.ends_at < now() and e.status <> 'cancelled' and s.status = 'final'
       and (p_org is null or a.org_id = p_org)
     order by a.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     for update of a skip locked
  ), u as (
    update public.attendance_no_show_alerts a set claimed_at = now(), attempts = a.attempts + 1
      from c where a.id = c.id
    returning a.*
  )
  select u.id, u.org_id, u.kind, u.mark_status, u.attempts, u.channel_results, u.notification_id, u.guardian_profile_id,
         case when u.guardian_profile_id is not null then pf.email::text
              else (select fe.email from public.ta_alert_family_email(u.athlete_id) fe where fe.family_id = u.recipient_family_id) end,
         pf.full_name,
         case when pf.locale_set_at is not null then pf.locale end,
         case when u.guardian_profile_id is null then true
              else coalesce((select bool_or(fm.receives_emails) from public.family_members fm join public.athletes a2 on a2.family_id = fm.family_id
                              where a2.id = u.athlete_id and fm.profile_id = u.guardian_profile_id), false) end,
         u.event_id, u.athlete_id, ath.first_name, ath.last_name, t.name, e.type::text, e.starts_at, e.ends_at,
         public.ta_tz(u.org_id)
    from u
    join public.events e on e.id = u.event_id
    join public.athletes ath on ath.id = u.athlete_id
    left join public.teams t on t.id = e.team_id
    left join public.profiles pf on pf.id = u.guardian_profile_id;
end;
$$;

-- A provider reported an e-mail of an alert as not delivered (bounce,
-- complaint): the alert becomes 'failed' with the error and goes straight to
-- the staff follow-up list (a bounce is permanent, so it is not retried).
-- Superseded / suppressed alerts keep their status. Returns the rows changed.
create or replace function public.attendance_alert_email_failed(p_provider_id text, p_error text)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_provider_id), '') = '' then return 0; end if;
  update public.attendance_no_show_alerts a
     set channel_results = jsonb_set(a.channel_results, '{email}',
           coalesce(a.channel_results->'email', '{}'::jsonb)
             || jsonb_build_object('ok', false, 'error', left(coalesce(p_error, 'bounced'), 200), 'failed_at', now())),
         status = case when a.status in ('sent', 'pending', 'failed') then 'failed' else a.status end,
         last_error = left(coalesce(p_error, 'bounced'), 500),
         attempts = greatest(a.attempts, public.ta_alert_max_attempts()),
         next_attempt_at = null,
         claimed_at = null
   where a.channel_results->'email'->>'provider_id' = p_provider_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- attendance_alerts_followup is unchanged: an e-mail-only recipient shows
-- with a null guardian ('failed' = the family e-mail could not be reached;
-- 'no_contact' = nobody to contact).

-- ===========================================================================
-- 4. Portal reads
-- ===========================================================================
-- Overview of one athlete (replaces the 20250420104000 version): adds the
-- cancel reason, the original start of a moved session, season and location.
create or replace function public.ta_athlete_overview(p_athlete uuid, p_from date, p_to date, p_viewer uuid, p_guardian boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_org  uuid;
  v_tz   text;
  v_from date;
  v_to   date;
  v_teams uuid[];
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  v_tz := public.ta_tz(v_org);
  v_to := coalesce(p_to, public.ta_today(v_org));
  v_from := coalesce(p_from, v_to - 120);
  select array_agg(distinct x.team_id) into v_teams from (
    select tm.team_id from public.team_memberships tm where tm.athlete_id = p_athlete
    union select p.team_id from public.team_membership_periods p where p.athlete_id = p_athlete
    union select s.team_id from public.team_attendance_marks m join public.team_attendance_sheets s on s.id = m.sheet_id
           where m.athlete_id = p_athlete) x;

  return jsonb_build_object(
    'athlete', (select jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name)
                  from public.athletes a where a.id = p_athlete),
    'timezone', v_tz,
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', t.name, 'type', e.type, 'title', e.title,
               'starts_at', e.starts_at, 'ends_at', e.ends_at, 'status', e.status,
               'cancel_reason', case when e.status = 'cancelled' then e.cancel_reason end,
               'rescheduled_from', e.rescheduled_from,
               'location', coalesce((select v.name from public.venues v where v.id = e.venue_id), e.location_name, e.location_text),
               'can_report', e.status in ('scheduled', 'postponed') and e.starts_at > now(),
               'report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason', r.reason,
                                                    'reason_category', r.reason_category, 'needs_review', r.needs_review,
                                                    'created_at', r.created_at)
                            from public.team_absence_reports r
                           where r.event_id = e.id and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged') limit 1))
             order by e.starts_at)
        from public.events e join public.teams t on t.id = e.team_id
       where e.team_id = any(coalesce(v_teams, '{}')) and e.starts_at >= now() and e.starts_at < now() + interval '30 days'
         and e.type::text = any(public.ta_sheet_types())
         and exists (select 1 from public.ta_roster_on(e.team_id, (e.starts_at at time zone v_tz)::date) ro where ro.athlete_id = p_athlete)
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', e.id, 'team_id', e.team_id, 'team_name', t.name, 'type', e.type, 'starts_at', e.starts_at,
               'season_id', coalesce(e.season_id, t.season_id), 'season_name', sn.name,
               'status', m.finalized_status, 'is_guest', m.is_guest, 'can_request_correction', p_guardian,
               'open_request', exists (select 1 from public.attendance_correction_requests q where q.mark_id = m.id and q.status = 'open'),
               'alert', case when p_guardian then (
                  select jsonb_build_object('alert_id', al.id, 'kind', al.kind, 'status', al.status, 'mark_status', al.mark_status,
                                            'sent_at', al.sent_at)
                    from public.attendance_no_show_alerts al
                   where al.event_id = e.id and al.athlete_id = p_athlete and al.guardian_profile_id = p_viewer
                   order by al.created_at desc limit 1) end)
             order by e.starts_at desc)
        from public.team_attendance_marks m
        join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
        join public.events e on e.id = m.event_id
        join public.teams t on t.id = e.team_id
        left join public.seasons sn on sn.id = coalesce(e.season_id, t.season_id)
       where m.athlete_id = p_athlete and m.finalized_status is not null and e.status <> 'cancelled'
         and s.roster_date between v_from and v_to
    ), '[]'::jsonb),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object('report_id', r.id, 'event_id', r.event_id, 'starts_at', e.starts_at, 'team_name', t.name,
                                          'status', r.status, 'reason', r.reason, 'reason_category', r.reason_category,
                                          'needs_review', r.needs_review, 'reporter_kind', r.reporter_kind,
                                          'mine', r.reported_by = p_viewer, 'created_at', r.created_at)
             order by r.created_at desc)
        from public.team_absence_reports r join public.events e on e.id = r.event_id left join public.teams t on t.id = e.team_id
       where r.athlete_id = p_athlete and r.created_at >= now() - interval '180 days'
    ), '[]'::jsonb),
    'correction_requests', case when p_guardian then coalesce((
      select jsonb_agg(jsonb_build_object('request_id', q.id, 'event_id', q.event_id, 'status', q.status, 'message', q.message,
                                          'current_status', q.current_status, 'requested_status', q.requested_status,
                                          'resolution_note', q.resolution_note, 'resolved_at', q.resolved_at, 'created_at', q.created_at)
             order by q.created_at desc)
        from public.attendance_correction_requests q where q.athlete_id = p_athlete
    ), '[]'::jsonb) else '[]'::jsonb end,
    'stats', (select jsonb_build_object('sessions', count(*),
                                        'present', count(*) filter (where m.finalized_status = 'present'),
                                        'late', count(*) filter (where m.finalized_status = 'late'),
                                        'excused', count(*) filter (where m.finalized_status = 'excused'),
                                        'unexcused', count(*) filter (where m.finalized_status = 'unexcused'))
                from public.team_attendance_marks m
                join public.team_attendance_sheets s on s.id = m.sheet_id and s.finalize_count > 0
                join public.events e on e.id = m.event_id
               where m.athlete_id = p_athlete and m.finalized_status is not null and e.status <> 'cancelled'
                 and s.roster_date between v_from and v_to));
end;
$$;

-- One session of one child, for the guardian (record page behind the alert
-- links). Finalized value only; a draft shows as "not final yet". No staff
-- notes, correction reasons, other players or coach data.
create or replace function public.guardian_attendance_record(p_event uuid, p_athlete uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ev   public.events%rowtype;
  v_ath  public.athletes%rowtype;
  v_tz   text;
  s      public.team_attendance_sheets%rowtype;
  m      public.team_attendance_marks%rowtype;
  v_has_sheet boolean;
  v_has_mark  boolean;
  v_final     boolean;
begin
  select * into v_ath from public.athletes where id = p_athlete;
  if not found or v_ath.org_id is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (public.is_guardian_of_athlete(p_athlete) or public.is_admin()) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  select * into v_ev from public.events where id = p_event;
  if not found or v_ev.org_id is distinct from v_ath.org_id or v_ev.team_id is null then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_tz := public.ta_tz(v_ev.org_id);
  select * into s from public.team_attendance_sheets where event_id = p_event;
  v_has_sheet := found;
  if v_has_sheet then
    select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = p_athlete;
    v_has_mark := found;
  else
    v_has_mark := false;
  end if;
  -- The child must belong to this session (mark, or roster on the day).
  if not v_has_mark and not exists (
       select 1 from public.ta_roster_on(v_ev.team_id, (v_ev.starts_at at time zone v_tz)::date) r where r.athlete_id = p_athlete) then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_final := v_has_mark and s.finalize_count > 0 and m.finalized_status is not null;

  return jsonb_build_object(
    'athlete', jsonb_build_object('id', v_ath.id, 'first_name', v_ath.first_name, 'last_name', v_ath.last_name),
    'timezone', v_tz,
    'event', jsonb_build_object(
      'id', v_ev.id, 'team_id', v_ev.team_id, 'team_name', (select name from public.teams where id = v_ev.team_id),
      'type', v_ev.type, 'title', v_ev.title, 'starts_at', v_ev.starts_at, 'ends_at', v_ev.ends_at, 'status', v_ev.status,
      'cancel_reason', case when v_ev.status = 'cancelled' then v_ev.cancel_reason end,
      'rescheduled_from', v_ev.rescheduled_from,
      'location', coalesce((select v.name from public.venues v where v.id = v_ev.venue_id), v_ev.location_name, v_ev.location_text),
      'ended', v_ev.ends_at < now()),
    'attendance', case when v_final then jsonb_build_object(
        'status', m.finalized_status, 'is_guest', m.is_guest,
        'finalized_at', coalesce(s.finalized_at, s.first_finalized_at),
        'corrected', exists (select 1 from public.team_attendance_mark_history h where h.mark_id = m.id and h.phase = 'correction'))
      end,
    'final', v_final,
    'can_request_correction', v_final and public.is_guardian_of_athlete(p_athlete) and v_ev.status <> 'cancelled'
                              and not exists (select 1 from public.attendance_correction_requests q where q.mark_id = m.id and q.status = 'open'),
    'can_report', v_ev.status in ('scheduled', 'postponed') and v_ev.starts_at > now() and public.is_guardian_of_athlete(p_athlete),
    'report', (select jsonb_build_object('report_id', r.id, 'status', r.status, 'reason', r.reason, 'reason_category', r.reason_category,
                                         'needs_review', r.needs_review, 'reporter_kind', r.reporter_kind,
                                         'mine', r.reported_by = auth.uid(), 'created_at', r.created_at)
                 from public.team_absence_reports r
                where r.event_id = p_event and r.athlete_id = p_athlete and r.status in ('reported', 'acknowledged')
                order by r.created_at desc limit 1),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('request_id', q.id, 'status', q.status, 'message', q.message,
                                          'current_status', q.current_status, 'requested_status', q.requested_status,
                                          'resolution_note', q.resolution_note, 'resolved_at', q.resolved_at,
                                          'created_at', q.created_at, 'mine', q.requested_by = auth.uid())
             order by q.created_at desc)
        from public.attendance_correction_requests q where q.event_id = p_event and q.athlete_id = p_athlete), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('kind', al.kind, 'status', al.status, 'mark_status', al.mark_status, 'sent_at', al.sent_at)
             order by al.created_at desc)
        from public.attendance_no_show_alerts al
       where al.event_id = p_event and al.athlete_id = p_athlete and al.guardian_profile_id = auth.uid()
         and al.status in ('sent', 'superseded') and al.sent_at is not null), '[]'::jsonb));
end;
$$;

-- ===========================================================================
-- Grants
-- ===========================================================================
do $$
declare f text;
begin
  foreach f in array array['public.ta_alert_family_email(uuid)', 'public.events_track_reschedule()',
                           'public.attendance_alerts_claim(integer, uuid)', 'public.attendance_alert_email_failed(text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array['public.ta_plausible_email(text)', 'public.guardian_attendance_record(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
