-- Performance: the club time-zone helper validated the zone name against the
-- pg_timezone_names view on every call (it reads the time-zone database), and
-- attendance functions call it per event row. Saving a club training break over a
-- season of sessions timed out. Same result, cheap check: a zone name is valid when
-- "now() at time zone <name>" works. ta_break_events computes the zone once.
-- Idempotent: replaces two functions.

create or replace function public.staff_org_tz(p_org uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select nullif(btrim(s.timezone), '') into v from public.app_settings s where s.org_id = p_org;
  if v is not null then
    begin perform now() at time zone v; return v; exception when others then v := null; end;
  end if;
  select nullif(btrim(o.timezone), '') into v from public.organizations o where o.id = p_org;
  if v is not null then
    begin perform now() at time zone v; return v; exception when others then v := null; end;
  end if;
  return 'UTC';
end $$;

create or replace function public.ta_break_events(p_break uuid)
returns table (event_id uuid, status text, has_final_sheet boolean, cancel_reason text, starts_at timestamptz, team_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare b public.club_training_breaks; v_tz text;
begin
  select * into b from public.club_training_breaks where id = p_break;
  if not found then return; end if;
  v_tz := public.ta_tz(b.org_id);
  return query
  select e.id, e.status::text, exists (select 1 from public.team_attendance_sheets s where s.event_id = e.id and s.status = 'final'),
         e.cancel_reason, e.starts_at, e.team_id
    from public.events e
    left join public.teams t on t.id = e.team_id
   where e.org_id = b.org_id and e.type = 'training'
     and e.starts_at >= ((b.starts_on::timestamp) at time zone v_tz) - interval '1 day'
     and e.starts_at <  ((b.ends_on::timestamp + interval '1 day') at time zone v_tz) + interval '1 day'
     and (e.starts_at at time zone v_tz)::date between b.starts_on and b.ends_on
     and (b.season_id is null or coalesce(e.season_id, t.season_id) = b.season_id)
   order by e.starts_at;
end $$;
