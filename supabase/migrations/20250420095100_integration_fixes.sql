-- ============================================================================
-- Integration fixes after merging the tenancy, platform, payments and i18n
-- tracks. Additive and idempotent.
--
-- 1) Locale vocabulary. organizations.default_locale / supported_locales hold
--    BCP-47 tags ("fr-CH", "en-US"); the i18n migration constrains
--    app_settings.default_locale / enabled_locales to the five UI languages
--    ("fr", "en", ...). Writers that pass a full tag (the branding settings
--    page, provision_tenant(), seeds) would violate that check. A BEFORE
--    trigger reduces app_settings values to the base language, so both sides
--    keep their own vocabulary and every writer stays valid.
--
-- 2) Platform application fee by SaaS plan. The payments track keyed fees on
--    organizations.payment_settings.plan_code ('founding','starter','club',
--    'pro'), the platform track sells 'starter','club','academy','federation'
--    via public.subscriptions. resolve_application_fee() now falls back to
--    the org's subscription plan when payment_settings has no plan_code, and
--    fee rows exist for every sold plan code.
--    Fee levels for 'academy' and 'federation' follow the business model's
--    0.5% application fee (docs/company/01_BUSINESS_MODEL.md). The existing
--    starter/club/default rows (1.5% / 1.0% / 1.0%) are NOT changed here:
--    pricing changes need founder approval.
-- ============================================================================

-- 1) app_settings locale normalisation --------------------------------------
create or replace function public.app_settings_normalize_locales()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_langs text[];
begin
  if new.default_locale is not null then
    new.default_locale := split_part(replace(lower(btrim(new.default_locale)), '_', '-'), '-', 1);
    if new.default_locale not in ('en', 'de', 'fr', 'it', 'es') then
      new.default_locale := 'en';
    end if;
  end if;

  if new.enabled_locales is not null then
    select coalesce(array_agg(distinct l order by l), '{}')
      into v_langs
      from (
        select split_part(replace(lower(btrim(x)), '_', '-'), '-', 1) as l
          from unnest(new.enabled_locales) as x
      ) s
     where l in ('en', 'de', 'fr', 'it', 'es');
    if cardinality(v_langs) = 0 then
      v_langs := array[coalesce(new.default_locale, 'en')];
    end if;
    new.enabled_locales := v_langs;
  end if;
  return new;
end;
$$;

do $$ begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'app_settings'
                and column_name = 'enabled_locales') then
    execute 'drop trigger if exists trg_app_settings_normalize_locales on public.app_settings';
    execute 'create trigger trg_app_settings_normalize_locales
               before insert or update of default_locale, enabled_locales on public.app_settings
               for each row execute function public.app_settings_normalize_locales()';
  end if;
end $$;

-- 2) Application fee per sold SaaS plan --------------------------------------
insert into public.platform_fee_schedules (plan_code, application_fee_bps, application_fee_fixed_minor, description) values
  ('academy',    50, 0, 'Academy plan — 0.5% platform fee'),
  ('federation', 50, 0, 'Multi-site & Federation — 0.5% platform fee (negotiable per contract)')
on conflict (plan_code) do nothing;

create or replace function public.resolve_application_fee(p_org uuid, p_amount_minor bigint)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ps    jsonb;
  v_plan  text;
  v_bps   integer;
  v_fixed integer := 0;
begin
  select payment_settings into v_ps from public.organizations where id = p_org;
  if v_ps is null or p_amount_minor is null or p_amount_minor <= 0 then return 0; end if;

  -- payment_settings.plan_code (e.g. the founding-club deal) wins; otherwise
  -- the org's SaaS subscription plan; otherwise 'default'.
  v_plan := nullif(v_ps->>'plan_code', '');
  if v_plan is null and to_regclass('public.subscriptions') is not null then
    execute 'select plan_code from public.subscriptions where org_id = $1' into v_plan using p_org;
  end if;

  select application_fee_bps, application_fee_fixed_minor into v_bps, v_fixed
    from public.platform_fee_schedules
   where plan_code = coalesce(v_plan, 'default');
  if not found then
    select application_fee_bps, application_fee_fixed_minor into v_bps, v_fixed
      from public.platform_fee_schedules where plan_code = 'default';
  end if;
  if v_ps ? 'application_fee_bps' then v_bps := (v_ps->>'application_fee_bps')::integer; end if;

  return least(p_amount_minor, floor(p_amount_minor * coalesce(v_bps, 0) / 10000.0)::bigint + coalesce(v_fixed, 0));
end;
$$;

revoke all on function public.resolve_application_fee(uuid, bigint) from public, anon, authenticated;
grant execute on function public.resolve_application_fee(uuid, bigint) to service_role;

-- 3) Cross-tenant hardening (findings from tests/db/tenant_isolation.sql) ----
-- 3a. Role helpers are scoped to the caller's current org. Before, a role row
--     in ANY org satisfied has_role()/is_admin()/is_finance().
create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_roles
     where profile_id = auth.uid()
       and role = p_role
       and org_id = public.current_org_id()
  );
$$;

create or replace function public.current_coach_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.coaches
   where profile_id = auth.uid() and org_id = public.current_org_id()
   limit 1;
$$;

-- 3b. staff_roles: admins see role rows of their own org only.
drop policy if exists staff_roles_select on public.staff_roles;
create policy staff_roles_select on public.staff_roles for select
  using (profile_id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));

-- 3c. profiles: a signed-in user may edit their own profile but never move it
--     into another org ("tenant hop"). Re-homing happens only inside
--     SECURITY DEFINER functions (provision_tenant, invitation acceptance),
--     which run as the function owner, or with the service role.
create or replace function public.profiles_block_org_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.org_id is distinct from old.org_id
     and current_user in ('authenticated', 'anon') then
    raise exception 'ORG_CHANGE_NOT_ALLOWED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_block_org_change on public.profiles;
create trigger trg_profiles_block_org_change
  before update of org_id on public.profiles
  for each row execute function public.profiles_block_org_change();

-- 4) Invoice numbers past 9999 -----------------------------------------------
-- lpad(x, 4) truncates longer strings ('10000' -> '1000'), which produced
-- duplicate invoice numbers. Pad only when shorter.
create or replace function public.next_invoice_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pattern text;
  v_counter integer;
  v_num     text;
  v_digits  text;
begin
  update public.app_settings
     set invoice_counter = invoice_counter + 1
   where org_id = p_org
   returning invoice_pattern, invoice_counter into v_pattern, v_counter;

  if v_pattern is null then
    raise exception 'No app_settings row for org %', p_org;
  end if;

  v_digits := v_counter::text;
  if length(v_digits) < 4 then
    v_digits := lpad(v_digits, 4, '0');
  end if;

  v_num := v_pattern;
  v_num := replace(v_num, '{YYYY}', to_char(now(), 'YYYY'));
  v_num := replace(v_num, '{YY}',   to_char(now(), 'YY'));
  v_num := replace(v_num, '{MM}',   to_char(now(), 'MM'));
  v_num := replace(v_num, '{####}', v_digits);
  return v_num;
end;
$$;

-- 5) Compliance records: no table privileges for anon ------------------------
-- Supabase grants anon ALL on new public tables by default; RLS already
-- returns no rows, but these registers hold children's and incident data, so
-- anon loses the privilege entirely (defence in depth).
do $$
declare t text;
begin
  foreach t in array array['compliance_settings', 'data_retention_policies', 'processing_activities',
                           'subprocessors', 'parental_consents', 'education_record_disclosures',
                           'breach_incidents', 'dsar_requests', 'dsar_overdue'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
end $$;

-- 6) Tenant isolation + suspension guards for tables added after 0917 ---------
-- 20250420091700_platform_saas.sql applied RESTRICTIVE platform_tenant_isolation
-- and platform_suspension_guard policies to every org_id table that existed
-- then, and asked later migrations to do the same. The payments, compliance
-- and sports-operations tables (0918-0920) were written in parallel and did
-- not, so they are added here. Same exclusions as 0917, plus subprocessors
-- (platform-wide rows have org_id null and are shared read-only).
do $$
declare
  r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public'
       and c.column_name = 'org_id'
       and t.table_type = 'BASE TABLE'
       and c.table_name not in (
         'profiles', 'staff_roles', 'invitations',
         'subscriptions', 'usage_snapshots', 'tenant_domains',
         'billing_events', 'platform_audit_log', 'subprocessors'
       )
  loop
    if not exists (select 1 from pg_policies
                    where schemaname = 'public' and tablename = r.table_name
                      and policyname = 'platform_tenant_isolation') then
      execute format(
        'create policy platform_tenant_isolation on public.%I as restrictive for all
           using (org_id = (select public.current_org_id()))
           with check (org_id = (select public.current_org_id()))',
        r.table_name);
    end if;
    if r.table_name <> 'app_settings'
       and not exists (select 1 from pg_policies
                        where schemaname = 'public' and tablename = r.table_name
                          and policyname = 'platform_suspension_guard') then
      execute format(
        'create policy platform_suspension_guard on public.%I as restrictive for all
           using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
           with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))',
        r.table_name);
    end if;
  end loop;
end $$;
