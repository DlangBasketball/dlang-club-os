-- ============================================================================
-- Migration · AI assistant becomes a PAID ADD-ON (founder decision, 12 Nov 2026)
--
--   1. The AI assistant is NOT included in any plan price (Starter, Club,
--      Academy, Federation). It is sold to clubs as a separate add-on. The
--      "ai_assistant" plan feature is removed; prices are unchanged.
--      Founding clubs are no longer entitled automatically.
--   2. Entitlement lives in a new table, public.ai_assistant_addons: one row
--      per club (scope 'org') with a status and a source:
--        'paid_addon'    — sold to the club (needs a live platform subscription)
--        'complimentary' — granted free of charge by the platform
--      Rows are written ONLY by the platform (service role or a platform
--      admin). Club members can read their own club's row; nobody can read
--      another club's row. Every change is audit-logged.
--   3. The founding club (DLang) receives a 'complimentary' row, as DATA,
--      guarded so it only runs when that organization exists. There is no
--      code path that branches on an org id or slug.
--   4. The club admin opt-in switch (app_settings.settings.ai_assistant_enabled)
--      stays: entitled AND switched on = usable.
--   5. A future per-family add-on (parents paying for the assistant) is NOT
--      built. The table already carries scope ('org' | 'family') + family_id
--      so it can be added later without a schema rewrite; only scope 'org'
--      grants anything today.
--
-- Additive and idempotent: create ... if not exists, create or replace,
-- drop policy/trigger if exists + create, guarded inserts. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Plans: remove the assistant from every plan (prices unchanged)
-- ---------------------------------------------------------------------------
update public.plans
   set features = features - 'ai_assistant'
 where features ? 'ai_assistant';

-- Per-tenant overrides cannot grant it either (entitlement is the add-on table).
update public.subscriptions
   set feature_overrides = feature_overrides - 'ai_assistant'
 where feature_overrides ? 'ai_assistant';

-- Public plan copy: the Club tier no longer advertises the assistant.
update public.plans
   set description = replace(description, 'bookings, AI assistant, multiple teams', 'bookings, multiple teams')
 where code = 'club'
   and description like '%bookings, AI assistant, multiple teams%';

-- ---------------------------------------------------------------------------
-- 2) Add-on entitlement table
-- ---------------------------------------------------------------------------
create table if not exists public.ai_assistant_addons (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  -- 'org': the club's staff assistant (the only scope that grants access today).
  -- 'family': reserved for a future parent add-on; grants nothing yet.
  scope       text not null default 'org' check (scope in ('org', 'family')),
  family_id   uuid references public.families(id) on delete cascade,
  source      text not null check (source in ('paid_addon', 'complimentary')),
  status      text not null default 'active' check (status in ('active', 'paused', 'canceled')),
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  -- Operator note (commercial context only; never personal data).
  note        text check (note is null or char_length(note) <= 500),
  granted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ai_assistant_addons_scope_family
    check ((scope = 'org' and family_id is null) or (scope = 'family' and family_id is not null)),
  constraint ai_assistant_addons_period
    check (ends_at is null or ends_at > starts_at)
);

create index if not exists idx_ai_assistant_addons_org on public.ai_assistant_addons(org_id);
create unique index if not exists uq_ai_assistant_addons_org_scope
  on public.ai_assistant_addons(org_id) where scope = 'org';
create unique index if not exists uq_ai_assistant_addons_family_scope
  on public.ai_assistant_addons(org_id, family_id) where scope = 'family';

drop trigger if exists trg_ai_assistant_addons_updated on public.ai_assistant_addons;
create trigger trg_ai_assistant_addons_updated before update on public.ai_assistant_addons
  for each row execute function public.set_updated_at();

comment on table public.ai_assistant_addons is
  'AI assistant add-on entitlement per club (scope org) — paid_addon or complimentary. Platform-written only (service role / platform admin); club members read their own club''s row. scope family is reserved for a future parent add-on and grants nothing yet.';

-- A family-scope row must point at a family of the same club.
create or replace function public.ai_assistant_addons_check_family()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.scope = 'family'
     and not exists (select 1 from public.families f where f.id = new.family_id and f.org_id = new.org_id) then
    raise exception 'AI_ADDON_FAMILY_ORG_MISMATCH' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ai_assistant_addons_family on public.ai_assistant_addons;
create trigger trg_ai_assistant_addons_family
  before insert or update of scope, family_id, org_id on public.ai_assistant_addons
  for each row execute function public.ai_assistant_addons_check_family();

-- ---------------------------------------------------------------------------
-- 3) RLS: read own club, write platform only
-- ---------------------------------------------------------------------------
alter table public.ai_assistant_addons enable row level security;
alter table public.ai_assistant_addons force row level security;

drop policy if exists ai_assistant_addons_select on public.ai_assistant_addons;
create policy ai_assistant_addons_select on public.ai_assistant_addons for select
  using (
    public.is_platform_admin()
    or (
      org_id = public.current_org_id()
      and (
        scope = 'org'
        or public.is_admin()
        or (scope = 'family' and public.is_guardian_of_family(family_id))
      )
    )
  );

-- Writes: platform admins only (the service role bypasses RLS). Club admins,
-- finance, coaches and parents get no write policy and are denied.
drop policy if exists ai_assistant_addons_insert on public.ai_assistant_addons;
create policy ai_assistant_addons_insert on public.ai_assistant_addons for insert
  with check (public.is_platform_admin());

drop policy if exists ai_assistant_addons_update on public.ai_assistant_addons;
create policy ai_assistant_addons_update on public.ai_assistant_addons for update
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists ai_assistant_addons_delete on public.ai_assistant_addons;
create policy ai_assistant_addons_delete on public.ai_assistant_addons for delete
  using (public.is_platform_admin());

revoke all on public.ai_assistant_addons from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.ai_assistant_addons to authenticated;
    grant all on public.ai_assistant_addons to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Audit every grant / change / removal (club trail + platform trail)
-- ---------------------------------------------------------------------------
create or replace function public.audit_ai_assistant_addon()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.ai_assistant_addons;
  v_action text;
  v_old    jsonb;
  v_new    jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'addon.ai_assistant.removed';
    v_old := jsonb_build_object('scope', old.scope, 'family_id', old.family_id, 'source', old.source,
                                'status', old.status, 'starts_at', old.starts_at, 'ends_at', old.ends_at);
  else
    v_row := new;
    v_action := case when tg_op = 'INSERT' then 'addon.ai_assistant.granted' else 'addon.ai_assistant.updated' end;
    v_new := jsonb_build_object('scope', new.scope, 'family_id', new.family_id, 'source', new.source,
                                'status', new.status, 'starts_at', new.starts_at, 'ends_at', new.ends_at);
    if tg_op = 'UPDATE' then
      v_old := jsonb_build_object('scope', old.scope, 'family_id', old.family_id, 'source', old.source,
                                  'status', old.status, 'starts_at', old.starts_at, 'ends_at', old.ends_at);
      if v_old = v_new then
        return new; -- only the note / timestamps changed
      end if;
    end if;
  end if;

  -- Skip when the club itself is being deleted (cascade): nothing to attach to.
  if exists (select 1 from public.organizations o where o.id = v_row.org_id) then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (v_row.org_id, auth.uid(), v_action, 'ai_assistant_addons', v_row.id, v_old, v_new);
    insert into public.platform_audit_log (actor_id, action, org_id, details)
    values (auth.uid(), v_action, v_row.org_id,
            jsonb_build_object('addon_id', v_row.id, 'old', v_old, 'new', v_new));
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_ai_assistant_addon on public.ai_assistant_addons;
create trigger trg_audit_ai_assistant_addon
  after insert or update or delete on public.ai_assistant_addons
  for each row execute function public.audit_ai_assistant_addon();

-- ---------------------------------------------------------------------------
-- 5) Entitlement (mirrored in src/lib/ai/access.ts → addonEntitlesAssistant)
-- ---------------------------------------------------------------------------
-- Entitled = club not suspended AND an ACTIVE scope-'org' add-on row whose
-- period covers now() AND (complimentary OR the club's subscription is live).
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
        join public.ai_assistant_addons a on a.org_id = o.id
       where o.id = p_org
         and o.suspended_at is null
         and a.scope = 'org'
         and a.status = 'active'
         and a.starts_at <= now()
         and (a.ends_at is null or a.ends_at > now())
         and (a.source = 'complimentary' or public.org_subscription_is_live(p_org))
    )
  end;
$$;

-- Same body as before; re-created so the error code says "not entitled".
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
    raise exception 'AI_ASSISTANT_NOT_ENTITLED' using errcode = '42501';
  end if;

  insert into public.app_settings (org_id, settings)
  values (v_org, jsonb_build_object('ai_assistant_enabled', p_enabled))
  on conflict (org_id) do update
    set settings   = public.app_settings.settings || jsonb_build_object('ai_assistant_enabled', p_enabled),
        updated_at = now();

  return p_enabled;
end;
$$;

revoke all on function public.org_ai_assistant_entitled(uuid) from public, anon;
revoke all on function public.set_org_ai_assistant(boolean) from public, anon;
revoke all on function public.audit_ai_assistant_addon() from public, anon, authenticated;
revoke all on function public.ai_assistant_addons_check_family() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.org_ai_assistant_entitled(uuid) to authenticated, service_role;
    grant execute on function public.set_org_ai_assistant(boolean) to authenticated;
  end if;
end $$;

comment on function public.org_ai_assistant_entitled(uuid) is
  'True when the club holds an active AI assistant add-on (complimentary, or paid with a live subscription). Own club, service role or platform admin only.';
comment on function public.set_org_ai_assistant(boolean) is
  'Admin-only: switch the AI assistant on/off for the caller''s own club (needs the add-on to switch on). Audit-logged by trigger.';

-- ---------------------------------------------------------------------------
-- 6) Founding club: complimentary add-on (data, guarded; no code branching)
-- ---------------------------------------------------------------------------
insert into public.ai_assistant_addons (org_id, scope, source, status, note)
select o.id, 'org', 'complimentary', 'active', 'Founding club: AI assistant free of charge (founder decision 12 Nov 2026)'
  from public.organizations o
 where o.slug = 'dlang'
on conflict do nothing;
