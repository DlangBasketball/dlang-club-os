-- ============================================================================
-- Club OS - Role switcher: one login, several roles, one ACTIVE mode at a time.
--
-- A person can hold several roles in a club (staff_roles admin / finance /
-- coach, and parent through family_members). Until now every role applied on
-- every screen. The founder works as admin, coach and parent from one login and
-- asked for an explicit mode: Admin, Coach or Parent.
--
--   * user_active_modes: the selected mode per person and club (remembered
--     across sessions). Written only through set_active_mode().
--   * available_modes(): the modes the signed-in person may use, from their
--     real role assignments (admin|finance -> 'admin', coach -> 'coach',
--     guardian of a family in the club -> 'parent').
--   * current_active_mode(): the stored mode while it is still available,
--     else null (a revoked role never stays active).
--   * has_role() now also asks mode_allows_role(): in Coach mode admin /
--     finance powers are off, in Parent mode all staff powers are off. Every
--     policy and RPC goes through has_role / is_admin / is_finance, so direct
--     API calls respect the mode, not only the screens. No stored mode (every
--     single-role user, and multi-role users before their first switch) =
--     unchanged behaviour.
--   * audit_logs.acting_mode: the mode in which a change was made (trigger:
--     the actor's active mode, so every audit path records it).
-- Additive and idempotent. Existing roles, profiles and records unchanged.
-- ============================================================================

create table if not exists public.user_active_modes (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  org_id      uuid not null references public.organizations(id) on delete cascade,
  mode        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, org_id),
  constraint user_active_modes_mode_chk check (mode in ('admin', 'coach', 'parent'))
);
create index if not exists idx_user_active_modes_org on public.user_active_modes(org_id);
alter table public.user_active_modes enable row level security;
drop policy if exists user_active_modes_select on public.user_active_modes;
create policy user_active_modes_select on public.user_active_modes
  for select to authenticated using (profile_id = auth.uid());
drop policy if exists user_active_modes_no_insert on public.user_active_modes;
create policy user_active_modes_no_insert on public.user_active_modes
  for insert to authenticated with check (false);
drop policy if exists user_active_modes_no_update on public.user_active_modes;
create policy user_active_modes_no_update on public.user_active_modes
  for update to authenticated using (false) with check (false);
drop policy if exists user_active_modes_no_delete on public.user_active_modes;
create policy user_active_modes_no_delete on public.user_active_modes
  for delete to authenticated using (false);
revoke all on public.user_active_modes from anon;

-- Modes the signed-in person may use in their current club (from real assignments, never from the stored mode).
create or replace function public.available_modes()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_remove(array[
    case when exists (select 1 from public.staff_roles r where r.profile_id = auth.uid() and r.org_id = public.current_org_id()
                       and r.role in ('admin', 'finance')) then 'admin' end,
    case when exists (select 1 from public.staff_roles r where r.profile_id = auth.uid() and r.org_id = public.current_org_id()
                       and r.role = 'coach') then 'coach' end,
    case when exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                       where fm.profile_id = auth.uid() and f.org_id = public.current_org_id()) then 'parent' end
  ], null), '{}'::text[]);
$$;

-- The stored mode while still available; null without a stored mode or when the role behind it is gone.
-- (Cheap: one primary-key lookup, and only the stored mode is re-checked. Runs inside has_role.)
create or replace function public.current_active_mode()
returns text language sql stable security definer set search_path = public as $$
  select m.mode from public.user_active_modes m
   where m.profile_id = auth.uid() and m.org_id = public.current_org_id()
     and case m.mode
           when 'admin'  then exists (select 1 from public.staff_roles r where r.profile_id = m.profile_id and r.org_id = m.org_id and r.role in ('admin', 'finance'))
           when 'coach'  then exists (select 1 from public.staff_roles r where r.profile_id = m.profile_id and r.org_id = m.org_id and r.role = 'coach')
           when 'parent' then exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                                       where fm.profile_id = m.profile_id and f.org_id = m.org_id)
           else false end;
$$;

-- Which staff roles count in the active mode (no mode = all of them, the previous behaviour).
create or replace function public.mode_allows_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select case public.current_active_mode()
           when 'admin'  then p_role in ('admin', 'finance', 'coach')
           when 'coach'  then p_role = 'coach'
           when 'parent' then p_role = 'parent'
           else true end;
$$;

create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_roles
     where profile_id = auth.uid()
       and role = p_role
       and org_id = public.current_org_id()
  ) and public.mode_allows_role(p_role);
$$;

-- Switch (or initialise) the active mode. Only a mode the person really holds; every switch is audited.
create or replace function public.set_active_mode(p_mode text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org   uuid := public.current_org_id();
  v_avail text[] := public.available_modes();
  v_prev  text;
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  if p_mode is null or not (p_mode = any(v_avail)) then raise exception 'MODE_NOT_AVAILABLE' using errcode = 'P0001'; end if;
  select mode into v_prev from public.user_active_modes where profile_id = auth.uid() and org_id = v_org;
  insert into public.user_active_modes (profile_id, org_id, mode) values (auth.uid(), v_org, p_mode)
  on conflict (profile_id, org_id) do update set mode = excluded.mode, updated_at = now();
  if v_prev is distinct from p_mode then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (v_org, auth.uid(), 'role.mode.switch', 'user_active_modes', auth.uid(),
            case when v_prev is null then null else jsonb_build_object('mode', v_prev) end, jsonb_build_object('mode', p_mode));
  end if;
  return jsonb_build_object('mode', p_mode, 'previous', v_prev, 'available', to_jsonb(v_avail));
end $$;

-- What the app needs on every request: available modes and the active one. A multi-mode person
-- without a valid stored mode gets one (p_default when available, else the first) so the
-- database enforces the same mode the screens show.
create or replace function public.active_mode_state(p_default text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_avail text[] := public.available_modes();
  v_mode  text := public.current_active_mode();
begin
  if auth.uid() is null then return jsonb_build_object('available', '[]'::jsonb, 'mode', null); end if;
  if v_mode is null and cardinality(v_avail) > 1 then
    v_mode := case when p_default = any(v_avail) then p_default else v_avail[1] end;
    perform public.set_active_mode(v_mode);
  end if;
  return jsonb_build_object('available', to_jsonb(v_avail), 'mode', v_mode);
end $$;

revoke all on function public.available_modes() from public, anon;
revoke all on function public.set_active_mode(text) from public, anon;
revoke all on function public.active_mode_state(text) from public, anon;
grant execute on function public.available_modes() to authenticated;
-- current_active_mode / mode_allows_role sit inside has_role and the audit_logs default, which also run for
-- anon (RLS) and system inserts: both return "no mode" without a signed-in user.
grant execute on function public.current_active_mode() to authenticated, anon, service_role;
grant execute on function public.set_active_mode(text) to authenticated;
grant execute on function public.active_mode_state(text) to authenticated;
grant execute on function public.mode_allows_role(public.app_role) to authenticated, anon, service_role;

-- Audit: the mode in which each change was made (null = no mode / system). Filled from the actor's
-- active mode in that club, so audit rows written by triggers, by RPCs and by the server (service
-- role, explicit actor_id) all record it.
alter table public.audit_logs add column if not exists acting_mode text;
create or replace function public.audit_logs_acting_mode()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.acting_mode is null and new.actor_id is not null then
    new.acting_mode := (select m.mode from public.user_active_modes m
                         where m.profile_id = new.actor_id
                           and m.org_id = coalesce(new.org_id, (select p.org_id from public.profiles p where p.id = new.actor_id)));
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_logs_acting_mode on public.audit_logs;
create trigger trg_audit_logs_acting_mode before insert on public.audit_logs
  for each row execute function public.audit_logs_acting_mode();

-- The new top-level page /switch-mode is an app route: club website pages may not use it.
create or replace function public.site_path_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select split_part(ltrim(coalesce(p, ''), '/'), '/', 1) in (
    'admin', 'coach', 'parent', 'player', 'platform', 'login', 'auth', 'register', 'book', 'shop', 'club', 'embed',
    'embed.js', 'api', 'board', 'scout', 'waitlist', 'onboarding', 'signup', 'legal', 'offline', 'pwa',
    'sw.js', 'manifest.webmanifest', '_next', 'favicon.ico', 'sitemap.xml', 'robots.txt', 'icon',
    'apple-icon', 'opengraph-image', 'monitoring', 'join', 'consent', 'link-invite', 'switch-mode');
$$;
