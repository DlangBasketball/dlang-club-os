-- ============================================================================
-- Migration · AI assistant opt-in per club + per-club app display name
--
-- Founder decisions of 12 Nov 2026:
--   A. The AI assistant is an OPT-IN per club. The platform still needs its
--      own server configuration (API key + model, app side); on top of that a
--      club must be ENTITLED (plan feature "ai_assistant", or a founding club)
--      and an ADMIN of the club must switch it on. Default: off.
--      The switch lives in the existing app_settings.settings jsonb
--      (key "ai_assistant_enabled"), which RLS already limits to the club's
--      own members (read) and admins (write). Every change is audit-logged.
--   B. Each club can show the app under its own name ("DLang OS"). Stored in
--      the existing public-safe organizations.branding jsonb as "app_name"
--      (returned by get_public_tenant, so the login page can use it before
--      sign-in). Empty / missing = fall back to the organization name.
--
-- Additive and idempotent: create or replace, guarded constraints, no
-- destructive changes. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Plans: the Club tier and above include the AI assistant (prices unchanged)
-- ---------------------------------------------------------------------------
update public.plans
   set features = features || '{"ai_assistant": true}'::jsonb
 where code in ('club', 'academy', 'federation')
   and coalesce((features->>'ai_assistant')::boolean, false) is distinct from true;

-- ---------------------------------------------------------------------------
-- 2) Branding validation: add the optional "app_name" (plain text, <= 60 chars)
--    Same rules as before for colors / fonts / URLs / dark_mode.
-- ---------------------------------------------------------------------------
create or replace function public.validate_tenant_branding(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  -- colors: every value must be a #RGB / #RRGGBB hex string (prevents CSS
  -- injection through the variables the app writes into the page).
  if p ? 'colors' then
    if jsonb_typeof(p->'colors') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(p->'colors') loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' then
        return false;
      end if;
    end loop;
  end if;

  -- fonts: family names only (letters, digits, spaces).
  if p ? 'fonts' then
    if jsonb_typeof(p->'fonts') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(p->'fonts') loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[A-Za-z0-9 ]{1,60}$' then
        return false;
      end if;
    end loop;
  end if;

  -- logo / favicon: https URLs or app-relative paths, no quotes/brackets.
  foreach k in array array['logo_url', 'favicon_url'] loop
    if p ? k and jsonb_typeof(p->k) <> 'null' then
      if jsonb_typeof(p->k) <> 'string' then return false; end if;
      if (p->>k) <> '' and (p->>k) !~ '^(https://[^\s"''<>()]+|/[^\s"''<>()]*)$' then
        return false;
      end if;
    end if;
  end loop;

  if p ? 'dark_mode' and jsonb_typeof(p->'dark_mode') not in ('boolean', 'null') then
    return false;
  end if;

  -- app_name: the club's own product name ("DLang OS"). Plain text only: no
  -- markup / template characters, no control characters, at most 60 chars.
  if p ? 'app_name' and jsonb_typeof(p->'app_name') <> 'null' then
    if jsonb_typeof(p->'app_name') <> 'string' then return false; end if;
    if char_length(p->>'app_name') > 60
       or (p->>'app_name') ~ '[<>{}"`\\]'
       or (p->>'app_name') ~ '[[:cntrl:]]' then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on column public.organizations.branding is
  'White-label theme: {app_name, logo_url, favicon_url, colors:{primary,primaryDark,accent,background,surface,text}, fonts:{display,ui,mono}, dark_mode}. app_name = product name shown to the club (falls back to organizations.name).';

-- ---------------------------------------------------------------------------
-- 3) app_settings.settings.ai_assistant_enabled must be a boolean when present
-- ---------------------------------------------------------------------------
-- Normalise any legacy non-boolean value to "off" (the new default) first.
update public.app_settings
   set settings = settings - 'ai_assistant_enabled'
 where settings ? 'ai_assistant_enabled'
   and jsonb_typeof(settings->'ai_assistant_enabled') <> 'boolean';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_ai_assistant_flag_boolean') then
    alter table public.app_settings
      add constraint app_settings_ai_assistant_flag_boolean
      check (not (settings ? 'ai_assistant_enabled')
             or jsonb_typeof(settings->'ai_assistant_enabled') = 'boolean');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Entitlement + effective state (mirrored in src/lib/ai/access.ts)
-- ---------------------------------------------------------------------------
-- Entitled = not suspended AND (live subscription whose plan/overrides grant
-- "ai_assistant" OR a founding club whose subscription, if any, is live).
-- Callers: the club's own members, the service role or a platform admin.
-- Anyone else gets false (never another tenant's answer).
create or replace function public.org_ai_assistant_entitled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_org is null then false
    when not (p_org = public.current_org_id() or public.is_service_caller() or public.is_platform_admin()) then false
    else exists (
      select 1
        from public.organizations o
       where o.id = p_org
         and o.suspended_at is null
         and (
           public.org_has_feature(p_org, 'ai_assistant')
           or (o.plan = 'founding'
               and (not exists (select 1 from public.subscriptions s where s.org_id = p_org)
                    or public.org_subscription_is_live(p_org)))
         )
    )
  end;
$$;

-- Effective club switch: entitled AND an admin turned it on.
create or replace function public.org_ai_assistant_enabled(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.org_ai_assistant_entitled(p_org)
     and coalesce((
           select (s.settings->>'ai_assistant_enabled')::boolean
             from public.app_settings s
            where s.org_id = p_org
         ), false);
$$;

-- ---------------------------------------------------------------------------
-- 5) Admin RPC to switch the assistant on/off for the CALLER'S OWN club.
--    The org is never taken from the client: it is current_org_id().
-- ---------------------------------------------------------------------------
create or replace function public.set_org_ai_assistant(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if p_enabled and not public.org_ai_assistant_entitled(v_org) then
    raise exception 'AI_ASSISTANT_NOT_IN_PLAN' using errcode = '42501';
  end if;

  insert into public.app_settings (org_id, settings)
  values (v_org, jsonb_build_object('ai_assistant_enabled', p_enabled))
  on conflict (org_id) do update
    set settings   = public.app_settings.settings || jsonb_build_object('ai_assistant_enabled', p_enabled),
        updated_at = now();

  return p_enabled;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Audit every change of the switch (whatever path wrote it)
-- ---------------------------------------------------------------------------
create or replace function public.audit_ai_assistant_setting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old boolean := false;
  v_new boolean := coalesce((new.settings->>'ai_assistant_enabled')::boolean, false);
begin
  if tg_op = 'UPDATE' then
    v_old := coalesce((old.settings->>'ai_assistant_enabled')::boolean, false);
  end if;
  if v_new is distinct from v_old then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (new.org_id, auth.uid(),
            case when v_new then 'settings.ai_assistant.enabled' else 'settings.ai_assistant.disabled' end,
            'app_settings', new.org_id,
            jsonb_build_object('ai_assistant_enabled', v_old),
            jsonb_build_object('ai_assistant_enabled', v_new));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_ai_assistant_setting on public.app_settings;
create trigger trg_audit_ai_assistant_setting
  after insert or update of settings on public.app_settings
  for each row execute function public.audit_ai_assistant_setting();

-- ---------------------------------------------------------------------------
-- 7) Grants: no anon access; members/admins via authenticated; service role.
-- ---------------------------------------------------------------------------
revoke all on function public.org_ai_assistant_entitled(uuid) from public, anon;
revoke all on function public.org_ai_assistant_enabled(uuid) from public, anon;
revoke all on function public.set_org_ai_assistant(boolean) from public, anon;
revoke all on function public.audit_ai_assistant_setting() from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.org_ai_assistant_entitled(uuid) to authenticated, service_role;
    grant execute on function public.org_ai_assistant_enabled(uuid) to authenticated, service_role;
    grant execute on function public.set_org_ai_assistant(boolean) to authenticated;
  end if;
end $$;

comment on function public.org_ai_assistant_entitled(uuid) is
  'True when the club''s plan (or founding status) includes the AI assistant. Own club, service role or platform admin only.';
comment on function public.org_ai_assistant_enabled(uuid) is
  'True when the club is entitled AND an admin switched the AI assistant on (app_settings.settings.ai_assistant_enabled).';
comment on function public.set_org_ai_assistant(boolean) is
  'Admin-only: switch the AI assistant on/off for the caller''s own club. Audit-logged by trigger.';
