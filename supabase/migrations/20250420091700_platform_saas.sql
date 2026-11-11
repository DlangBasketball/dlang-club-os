-- ============================================================================
-- Club OS — white-label SaaS
-- Migration 18 · Platform operator layer: plans, subscriptions, usage,
--                tenant domains, self-serve tenant provisioning
--
-- WHAT THIS ADDS
--   * platform_admins     — super-admins of the SaaS (NOT tied to an org)
--   * plans / plan_prices — sellable plans, per-currency monthly/yearly prices,
--                           limits (athletes, staff) and a features jsonb
--   * subscriptions       — one row per org: plan, Stripe ids, status, trial
--   * usage_snapshots     — daily per-org usage (athletes, staff, ...)
--   * tenant_domains      — custom domains + DNS verification status
--   * billing_events      — Stripe Billing webhook idempotency ledger
--   * platform_audit_log  — every operator action (suspend, plan change, ...)
--   * provision_tenant()  — SECURITY DEFINER self-signup RPC (validated)
--   * org_has_feature() / org_within_limit() — DB-side feature gating
--   * suspension          — a RESTRICTIVE policy on every tenant table hides a
--                           suspended org's data from its own users
--
-- SECURITY MODEL
--   * Platform tables are readable ONLY by platform admins (is_platform_admin()).
--   * An org's members can read their OWN subscription; its admins can read
--     their own domains. Writes to billing state happen only through the
--     service role (Stripe webhook) or SECURITY DEFINER platform_* RPCs that
--     re-check is_platform_admin().
--   * Active, public plans are readable by anyone (pricing page / signup).
-- Idempotent where practical (re-runnable).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Organization columns used by the SaaS layer (additive)
-- ---------------------------------------------------------------------------
alter table public.organizations add column if not exists sport            text;
alter table public.organizations add column if not exists suspended_at     timestamptz;
alter table public.organizations add column if not exists suspended_reason text;

-- ---------------------------------------------------------------------------
-- 1. Platform admins
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.platform_admins where profile_id = auth.uid());
$$;

comment on function public.is_platform_admin is
  'True when the caller is a SaaS operator (row in platform_admins). Not org-scoped.';

-- ---------------------------------------------------------------------------
-- 2. Plans & prices
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  code          text primary key check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name          text not null,
  tagline       text,
  description   text,
  audience      text,                         -- e.g. 'clubs', 'schools & federations'
  sort_order    integer not null default 0,
  is_public     boolean not null default true, -- shown on pricing / signup
  is_active     boolean not null default true, -- can be sold / assigned
  is_custom     boolean not null default false, -- "contact sales" pricing
  trial_days    integer not null default 14 check (trial_days between 0 and 90),
  max_athletes  integer check (max_athletes is null or max_athletes >= 0), -- null = unlimited
  max_staff     integer check (max_staff is null or max_staff >= 0),       -- null = unlimited
  features      jsonb not null default '{}'::jsonb check (jsonb_typeof(features) = 'object'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
drop trigger if exists trg_plans_updated on public.plans;
create trigger trg_plans_updated before update on public.plans
  for each row execute function public.set_updated_at();

create table if not exists public.plan_prices (
  plan_code        text not null references public.plans(code) on update cascade on delete cascade,
  currency         text not null check (currency in ('CHF', 'EUR', 'USD')),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  amount           numeric(10,2) not null check (amount >= 0),
  stripe_price_id  text,      -- optional: a pre-created Stripe Price; else price_data is used
  updated_at       timestamptz not null default now(),
  primary key (plan_code, currency, billing_interval)
);
drop trigger if exists trg_plan_prices_updated on public.plan_prices;
create trigger trg_plan_prices_updated before update on public.plan_prices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Subscriptions (one per org)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null unique references public.organizations(id) on delete cascade,
  plan_code               text not null references public.plans(code) on update cascade,
  status                  text not null default 'trialing'
                            check (status in ('trialing','active','past_due','unpaid','canceled',
                                              'incomplete','incomplete_expired','paused')),
  currency                text not null default 'CHF' check (currency in ('CHF','EUR','USD')),
  billing_interval        text not null default 'month' check (billing_interval in ('month','year')),
  stripe_customer_id      text unique,
  stripe_subscription_id  text unique,
  stripe_price_id         text,
  trial_ends_at           timestamptz,
  current_period_end      timestamptz,
  cancel_at_period_end    boolean not null default false,
  canceled_at             timestamptz,
  feature_overrides       jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_overrides) = 'object'),
  limit_overrides         jsonb not null default '{}'::jsonb check (jsonb_typeof(limit_overrides) = 'object'),
  custom_amount           numeric(10,2) check (custom_amount is null or custom_amount >= 0), -- Enterprise deals (per interval)
  last_stripe_event_at    timestamptz,   -- guards against out-of-order webhooks
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_subscriptions_status on public.subscriptions(status);
create index if not exists idx_subscriptions_plan on public.subscriptions(plan_code);
drop trigger if exists trg_subscriptions_updated on public.subscriptions;
create trigger trg_subscriptions_updated before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Usage snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.usage_snapshots (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  captured_on      date not null default current_date,
  athletes         integer not null default 0,
  staff            integer not null default 0,
  families         integer not null default 0,
  programs         integer not null default 0,
  registrations_30d integer not null default 0,
  invoices_30d     integer not null default 0,
  invoiced_30d     numeric(12,2) not null default 0,
  created_at       timestamptz not null default now(),
  unique (org_id, captured_on)
);
create index if not exists idx_usage_snapshots_org on public.usage_snapshots(org_id, captured_on desc);

-- ---------------------------------------------------------------------------
-- 5. Tenant custom domains
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_domains (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  domain              citext not null unique
                        check (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'),
  status              text not null default 'pending'
                        check (status in ('pending','verified','failed','disabled')),
  verification_token  text not null default encode(gen_random_bytes(16), 'hex'),
  is_primary          boolean not null default false,
  verified_at         timestamptz,
  last_checked_at     timestamptz,
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_tenant_domains_org on public.tenant_domains(org_id);
create unique index if not exists uniq_tenant_domains_primary
  on public.tenant_domains(org_id) where is_primary;
drop trigger if exists trg_tenant_domains_updated on public.tenant_domains;
create trigger trg_tenant_domains_updated before update on public.tenant_domains
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Billing webhook ledger (idempotency) & platform audit log
-- ---------------------------------------------------------------------------
create table if not exists public.billing_events (
  id            text primary key,          -- Stripe event id (evt_...)
  type          text not null,
  org_id        uuid references public.organizations(id) on delete set null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  attempts      integer not null default 1,
  error         text,
  payload       jsonb
);
create index if not exists idx_billing_events_org on public.billing_events(org_id, received_at desc);

create table if not exists public.platform_audit_log (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  org_id      uuid references public.organizations(id) on delete set null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_platform_audit_org on public.platform_audit_log(org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Seed plans (prices identical across CHF / EUR / USD; yearly = 10 months)
-- ---------------------------------------------------------------------------
insert into public.plans (code, name, tagline, audience, sort_order, is_public, is_custom, max_athletes, max_staff, features)
values
  ('starter', 'Starter', 'Everything a small club needs to get organised', 'small clubs & teams', 10, true, false, 100, 5,
   '{"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"attendance":true,"messaging":true,
     "documents_consent":true,"bookings":false,"ai_assistant":false,"custom_branding":true,"custom_domain":false,
     "white_label":false,"multi_location":false,"reports_advanced":false,"api_access":false,"sso":false,
     "federation_rollup":false,"priority_support":false}'::jsonb),
  ('club', 'Club', 'The full club operating system', 'growing clubs & academies', 20, true, false, 400, 20,
   '{"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"attendance":true,"messaging":true,
     "documents_consent":true,"bookings":true,"ai_assistant":true,"custom_branding":true,"custom_domain":false,
     "white_label":false,"multi_location":true,"reports_advanced":true,"api_access":false,"sso":false,
     "federation_rollup":false,"priority_support":false}'::jsonb),
  ('pro', 'Pro', 'For large multi-team organisations', 'large clubs & multi-sport organisations', 30, true, false, 1500, 75,
   '{"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"attendance":true,"messaging":true,
     "documents_consent":true,"bookings":true,"ai_assistant":true,"custom_branding":true,"custom_domain":true,
     "white_label":true,"multi_location":true,"reports_advanced":true,"api_access":true,"sso":false,
     "federation_rollup":false,"priority_support":true}'::jsonb),
  ('enterprise', 'Enterprise', 'Schools, federations & leagues — custom terms', 'schools, federations & leagues', 40, true, true, null, null,
   '{"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"attendance":true,"messaging":true,
     "documents_consent":true,"bookings":true,"ai_assistant":true,"custom_branding":true,"custom_domain":true,
     "white_label":true,"multi_location":true,"reports_advanced":true,"api_access":true,"sso":true,
     "federation_rollup":true,"priority_support":true}'::jsonb)
on conflict (code) do nothing;

insert into public.plan_prices (plan_code, currency, billing_interval, amount)
select p.code, c.currency, i.billing_interval,
       case i.billing_interval when 'month' then p.monthly else p.monthly * 10 end
from (values ('starter', 49.00), ('club', 149.00), ('pro', 349.00)) as p(code, monthly)
cross join (values ('CHF'), ('EUR'), ('USD')) as c(currency)
cross join (values ('month'), ('year')) as i(billing_interval)
on conflict (plan_code, currency, billing_interval) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Feature gating & limits (DB side; mirrored in src/lib/platform/features.ts)
-- ---------------------------------------------------------------------------
-- An org's subscription grants access while trialing (until trial end),
-- active, or past_due (dunning grace). Suspended orgs never have access.
create or replace function public.org_subscription_is_live(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.subscriptions s
    join public.organizations o on o.id = s.org_id
    where s.org_id = p_org
      and o.suspended_at is null
      and (
        s.status in ('active', 'past_due')
        or (s.status = 'trialing' and (s.trial_ends_at is null or s.trial_ends_at > now()))
      )
  );
$$;

create or replace function public.org_has_feature(p_org uuid, p_feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when s.feature_overrides ? p_feature then (s.feature_overrides->>p_feature)::boolean
             else coalesce((p.features->>p_feature)::boolean, false)
           end
    from public.subscriptions s
    join public.plans p on p.code = s.plan_code
    where s.org_id = p_org
  ), false)
  and public.org_subscription_is_live(p_org);
$$;

-- p_resource: 'athletes' | 'staff'. Returns true when adding p_adding more
-- items keeps the org within its plan (or override) limit. null limit = unlimited.
create or replace function public.org_within_limit(p_org uuid, p_resource text, p_adding integer default 1)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_limit integer;
  v_used  integer;
begin
  if p_resource not in ('athletes', 'staff') then
    raise exception 'INVALID_RESOURCE';
  end if;

  select coalesce((s.limit_overrides->>p_resource)::integer,
                  case p_resource when 'athletes' then p.max_athletes else p.max_staff end)
    into v_limit
  from public.subscriptions s
  join public.plans p on p.code = s.plan_code
  where s.org_id = p_org;

  if not found then return false; end if;      -- no subscription -> nothing allowed
  if v_limit is null then return true; end if;  -- unlimited

  if p_resource = 'athletes' then
    select count(*) into v_used from public.athletes where org_id = p_org and status <> 'archived';
  else
    select count(distinct profile_id) into v_used from public.staff_roles where org_id = p_org;
  end if;

  return v_used + greatest(p_adding, 0) <= v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Tenant isolation + suspension guards (RESTRICTIVE policies)
-- ---------------------------------------------------------------------------
-- WHY: several original policies (e.g. athletes_select -> is_finance()) check
-- the caller's ROLE but not the caller's ORG. With a single club that was
-- harmless; with self-serve signup ANY new tenant admin would satisfy
-- is_finance() and could read another club's rows. These RESTRICTIVE policies
-- are AND-ed with every existing permissive policy, so they can only ever
-- narrow access:
--   platform_tenant_isolation : row.org_id must equal the caller's org
--   platform_suspension_guard : row.org_id must not belong to a suspended org
-- service_role and SECURITY DEFINER functions owned by the table owner bypass
-- RLS (public registration, Stripe webhooks keep working). Identity tables are
-- left alone (sign-in must work; staff_roles/invitations are already scoped).
-- Tables created by LATER migrations must add the same two policies.
create or replace function public.suspended_org_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}'::uuid[]) from public.organizations where suspended_at is not null;
$$;

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
        'billing_events', 'platform_audit_log'
      )
  loop
    execute format('drop policy if exists platform_tenant_isolation on public.%I', r.table_name);
    execute format(
      'create policy platform_tenant_isolation on public.%I as restrictive for all
         using (org_id = (select public.current_org_id()))
         with check (org_id = (select public.current_org_id()))',
      r.table_name);

    if r.table_name <> 'app_settings' then  -- a suspended org can still read its settings
      execute format('drop policy if exists platform_suspension_guard on public.%I', r.table_name);
      execute format(
        'create policy platform_suspension_guard on public.%I as restrictive for all
           using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
           with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))',
        r.table_name);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. RLS on platform tables
-- ---------------------------------------------------------------------------
alter table public.platform_admins     enable row level security;
alter table public.plans               enable row level security;
alter table public.plan_prices         enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.usage_snapshots     enable row level security;
alter table public.tenant_domains      enable row level security;
alter table public.billing_events      enable row level security;
alter table public.platform_audit_log  enable row level security;

alter table public.platform_admins     force row level security;
alter table public.subscriptions       force row level security;
alter table public.billing_events      force row level security;
alter table public.platform_audit_log  force row level security;

-- platform_admins: only platform admins can see the list. No client writes.
-- Bootstrap the first operator once, as the database owner (SQL editor):
--   insert into public.platform_admins (profile_id, note)
--   select id, 'founding operator' from public.profiles where email = 'you@company.com';
drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins for select
  using (public.is_platform_admin());

-- plans / prices: public catalogue readable by anyone; full catalogue + writes
-- for platform admins.
drop policy if exists plans_public_select on public.plans;
create policy plans_public_select on public.plans for select
  using ((is_public and is_active) or public.is_platform_admin());
drop policy if exists plans_platform_write on public.plans;
create policy plans_platform_write on public.plans for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists plan_prices_public_select on public.plan_prices;
create policy plan_prices_public_select on public.plan_prices for select
  using (
    public.is_platform_admin()
    or exists (select 1 from public.plans p where p.code = plan_code and p.is_public and p.is_active)
  );
drop policy if exists plan_prices_platform_write on public.plan_prices;
create policy plan_prices_platform_write on public.plan_prices for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- subscriptions: members read their own org's row; platform admins read all.
-- Writes: service role (webhook) and platform_* RPCs only.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions for select
  using (org_id = public.current_org_id() or public.is_platform_admin());

-- usage snapshots: platform admins; the org's admins may read their own.
drop policy if exists usage_snapshots_select on public.usage_snapshots;
create policy usage_snapshots_select on public.usage_snapshots for select
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.is_admin()));

-- tenant domains: platform admins manage; org admins read theirs.
drop policy if exists tenant_domains_select on public.tenant_domains;
create policy tenant_domains_select on public.tenant_domains for select
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.is_admin()));
drop policy if exists tenant_domains_platform_write on public.tenant_domains;
create policy tenant_domains_platform_write on public.tenant_domains for all
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists billing_events_select on public.billing_events;
create policy billing_events_select on public.billing_events for select
  using (public.is_platform_admin());

drop policy if exists platform_audit_select on public.platform_audit_log;
create policy platform_audit_select on public.platform_audit_log for select
  using (public.is_platform_admin());

-- organizations: platform admins can read every tenant (support view).
drop policy if exists org_platform_select on public.organizations;
create policy org_platform_select on public.organizations for select
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 11. Self-signup: provision_tenant()
-- ---------------------------------------------------------------------------
create or replace function public.is_reserved_slug(p_slug text)
returns boolean language sql immutable as $$
  select lower(p_slug) = any (array[
    'admin','administrator','api','app','apps','auth','billing','blog','coach','dashboard',
    'docs','help','login','logout','mail','new','onboarding','parent','platform','pricing',
    'register','root','settings','signup','signin','static','status','support','system',
    'www','assets','cdn','club','clubs','console','demo','test','staging','dev'
  ]);
$$;

create or replace function public.is_slug_available(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
     and p_slug !~ '--'
     and not public.is_reserved_slug(p_slug)
     and not exists (select 1 from public.organizations where lower(slug) = lower(p_slug));
$$;

create or replace function public.provision_tenant(
  p_name       text,
  p_slug       text,
  p_sport      text,
  p_country    text,
  p_currency   text,
  p_locale     text default 'en',
  p_full_name  text default null,
  p_plan       text default 'club'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text := btrim(coalesce(p_name, ''));
  v_slug     text := lower(btrim(coalesce(p_slug, '')));
  v_sport    text := lower(btrim(coalesce(p_sport, '')));
  v_country  text := upper(btrim(coalesce(p_country, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_locale   text := lower(btrim(coalesce(p_locale, 'en')));
  v_full     text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_plan     public.plans%rowtype;
  v_org      uuid;
  v_trial    timestamptz;
begin
  -- --- Caller ---------------------------------------------------------------
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'PROFILE_MISSING';
  end if;
  -- A person who already belongs to a club (any staff role, guardian link or
  -- coach record) cannot spin up a tenant with the same login. This also caps
  -- self-signup at one tenant per account.
  if exists (select 1 from public.staff_roles where profile_id = v_uid)
     or exists (select 1 from public.family_members where profile_id = v_uid)
     or exists (select 1 from public.coaches where profile_id = v_uid) then
    raise exception 'ALREADY_MEMBER';
  end if;

  -- --- Input validation ---------------------------------------------------
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'INVALID_NAME';
  end if;
  if v_name ~ '[<>{}\\]' then
    raise exception 'INVALID_NAME';
  end if;
  if v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$' or v_slug ~ '--' then
    raise exception 'INVALID_SLUG';
  end if;
  if public.is_reserved_slug(v_slug) then
    raise exception 'SLUG_RESERVED';
  end if;
  if v_sport !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'INVALID_SPORT';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'INVALID_COUNTRY';
  end if;
  if v_currency not in ('CHF', 'EUR', 'USD') then
    raise exception 'INVALID_CURRENCY';
  end if;
  if v_locale !~ '^[a-z]{2}(-[a-z]{2})?$' then
    raise exception 'INVALID_LOCALE';
  end if;
  if v_full is not null and char_length(v_full) > 120 then
    raise exception 'INVALID_FULL_NAME';
  end if;

  select * into v_plan from public.plans
   where code = coalesce(nullif(btrim(p_plan), ''), 'club')
     and is_active and is_public and not is_custom;
  if not found then
    raise exception 'INVALID_PLAN';
  end if;

  -- Serialise concurrent signups racing for the same slug.
  perform pg_advisory_xact_lock(hashtext('provision_tenant:' || v_slug));
  if exists (select 1 from public.organizations where lower(slug) = v_slug) then
    raise exception 'SLUG_TAKEN';
  end if;

  -- --- Create the tenant --------------------------------------------------
  insert into public.organizations (name, slug, country, currency, sport)
  values (v_name, v_slug, v_country, v_currency, v_sport)
  returning id into v_org;

  insert into public.app_settings (org_id, currency, default_locale)
  values (v_org, v_currency, v_locale)
  on conflict (org_id) do nothing;

  -- Re-home the signing-up profile into the new org and make it the admin.
  update public.profiles
     set org_id = v_org,
         full_name = coalesce(v_full, full_name),
         locale = v_locale,
         onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = v_uid;

  insert into public.staff_roles (org_id, profile_id, role)
  values (v_org, v_uid, 'admin')
  on conflict (org_id, profile_id, role) do nothing;

  v_trial := now() + make_interval(days => v_plan.trial_days);
  insert into public.subscriptions (org_id, plan_code, status, currency, billing_interval, trial_ends_at)
  values (v_org, v_plan.code, 'trialing', v_currency, 'month', v_trial);

  insert into public.platform_audit_log (actor_id, action, org_id, details)
  values (v_uid, 'tenant.provisioned', v_org,
          jsonb_build_object('slug', v_slug, 'sport', v_sport, 'country', v_country,
                             'currency', v_currency, 'plan', v_plan.code));

  return jsonb_build_object(
    'org_id', v_org,
    'slug', v_slug,
    'plan', v_plan.code,
    'trial_ends_at', v_trial
  );
end;
$$;

comment on function public.provision_tenant is
  'Self-signup: creates an organization, makes the caller its admin, starts a trial. Validates every input.';

-- ---------------------------------------------------------------------------
-- 12. Usage capture
-- ---------------------------------------------------------------------------
create or replace function public.capture_usage_snapshot(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.usage_snapshots
    (org_id, captured_on, athletes, staff, families, programs, registrations_30d, invoices_30d, invoiced_30d)
  select
    p_org, current_date,
    (select count(*) from public.athletes a where a.org_id = p_org and a.status <> 'archived'),
    (select count(distinct sr.profile_id) from public.staff_roles sr where sr.org_id = p_org),
    (select count(*) from public.families f where f.org_id = p_org),
    (select count(*) from public.programs pr where pr.org_id = p_org),
    (select count(*) from public.registrations r where r.org_id = p_org and r.created_at > now() - interval '30 days'),
    (select count(*) from public.invoices i where i.org_id = p_org and i.created_at > now() - interval '30 days'),
    (select coalesce(sum(i.total_chf), 0) from public.invoices i where i.org_id = p_org and i.created_at > now() - interval '30 days')
  on conflict (org_id, captured_on) do update set
    athletes = excluded.athletes, staff = excluded.staff, families = excluded.families,
    programs = excluded.programs, registrations_30d = excluded.registrations_30d,
    invoices_30d = excluded.invoices_30d, invoiced_30d = excluded.invoiced_30d,
    created_at = now();
end;
$$;

create or replace function public.capture_all_usage_snapshots()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
begin
  if auth.uid() is not null and not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;
  for r in select id from public.organizations loop
    perform public.capture_usage_snapshot(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. Platform console RPCs (each re-checks is_platform_admin())
-- ---------------------------------------------------------------------------
create or replace function public.platform_tenant_overview()
returns table (
  org_id              uuid,
  name                text,
  slug                text,
  sport               text,
  country             text,
  currency            text,
  created_at          timestamptz,
  suspended_at        timestamptz,
  plan_code           text,
  plan_name           text,
  status              text,
  billing_interval    text,
  trial_ends_at       timestamptz,
  current_period_end  timestamptz,
  stripe_customer_id  text,
  athletes            bigint,
  staff               bigint,
  max_athletes        integer,
  max_staff           integer,
  mrr                 numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;
  return query
  select
    o.id, o.name, o.slug, o.sport, o.country, o.currency, o.created_at, o.suspended_at,
    s.plan_code, p.name, s.status, s.billing_interval, s.trial_ends_at, s.current_period_end,
    s.stripe_customer_id,
    (select count(*) from public.athletes a where a.org_id = o.id and a.status <> 'archived'),
    (select count(distinct sr.profile_id) from public.staff_roles sr where sr.org_id = o.id),
    coalesce((s.limit_overrides->>'athletes')::integer, p.max_athletes),
    coalesce((s.limit_overrides->>'staff')::integer, p.max_staff),
    case
      when s.status in ('active', 'past_due') and o.suspended_at is null then
        round(coalesce(s.custom_amount, pp.amount, 0) / case s.billing_interval when 'year' then 12 else 1 end, 2)
      else 0
    end
  from public.organizations o
  left join public.subscriptions s on s.org_id = o.id
  left join public.plans p on p.code = s.plan_code
  left join public.plan_prices pp
    on pp.plan_code = s.plan_code and pp.currency = s.currency and pp.billing_interval = s.billing_interval
  order by o.created_at desc;
end;
$$;

create or replace function public.platform_set_org_suspended(p_org uuid, p_suspended boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if p_suspended and char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;
  update public.organizations
     set suspended_at = case when p_suspended then coalesce(suspended_at, now()) else null end,
         suspended_reason = case when p_suspended then left(btrim(p_reason), 500) else null end
   where id = p_org;
  if not found then raise exception 'NOT_FOUND'; end if;
  insert into public.platform_audit_log (actor_id, action, org_id, details)
  values (auth.uid(), case when p_suspended then 'tenant.suspended' else 'tenant.reactivated' end, p_org,
          jsonb_build_object('reason', p_reason));
  return jsonb_build_object('org_id', p_org, 'suspended', p_suspended);
end;
$$;

create or replace function public.platform_change_plan(
  p_org uuid,
  p_plan text,
  p_status text default null,
  p_trial_ends_at timestamptz default null,
  p_custom_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.plans where code = p_plan and is_active) then
    raise exception 'INVALID_PLAN';
  end if;
  if p_status is not null and p_status not in ('trialing','active','past_due','unpaid','canceled','paused') then
    raise exception 'INVALID_STATUS';
  end if;
  if p_custom_amount is not null and p_custom_amount < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select plan_code into v_old from public.subscriptions where org_id = p_org;
  if not found then
    if not exists (select 1 from public.organizations where id = p_org) then
      raise exception 'NOT_FOUND';
    end if;
    insert into public.subscriptions (org_id, plan_code, status, trial_ends_at, custom_amount, currency)
    select p_org, p_plan, coalesce(p_status, 'trialing'),
           coalesce(p_trial_ends_at, now() + interval '14 days'), p_custom_amount,
           case when o.currency in ('CHF','EUR','USD') then o.currency else 'CHF' end
    from public.organizations o where o.id = p_org;
  else
    update public.subscriptions
       set plan_code = p_plan,
           status = coalesce(p_status, status),
           trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
           custom_amount = coalesce(p_custom_amount, custom_amount)
     where org_id = p_org;
  end if;

  insert into public.platform_audit_log (actor_id, action, org_id, details)
  values (auth.uid(), 'tenant.plan_changed', p_org,
          jsonb_build_object('from', v_old, 'to', p_plan, 'status', p_status,
                             'trial_ends_at', p_trial_ends_at, 'custom_amount', p_custom_amount));
  return jsonb_build_object('org_id', p_org, 'plan', p_plan);
end;
$$;

create or replace function public.platform_upsert_plan(p_plan jsonb, p_prices jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text := lower(btrim(p_plan->>'code'));
  r jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'FORBIDDEN';
  end if;
  if v_code is null or v_code !~ '^[a-z][a-z0-9_]{1,31}$' then
    raise exception 'INVALID_CODE';
  end if;
  if char_length(btrim(coalesce(p_plan->>'name', ''))) < 2 then
    raise exception 'INVALID_NAME';
  end if;
  if jsonb_typeof(coalesce(p_plan->'features', '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_FEATURES';
  end if;
  if jsonb_typeof(p_prices) <> 'array' then
    raise exception 'INVALID_PRICES';
  end if;

  insert into public.plans as pl (code, name, tagline, description, audience, sort_order, is_public, is_active,
                                  is_custom, trial_days, max_athletes, max_staff, features)
  values (
    v_code,
    btrim(p_plan->>'name'),
    nullif(p_plan->>'tagline', ''),
    nullif(p_plan->>'description', ''),
    nullif(p_plan->>'audience', ''),
    coalesce((p_plan->>'sort_order')::integer, 0),
    coalesce((p_plan->>'is_public')::boolean, true),
    coalesce((p_plan->>'is_active')::boolean, true),
    coalesce((p_plan->>'is_custom')::boolean, false),
    coalesce((p_plan->>'trial_days')::integer, 14),
    nullif(p_plan->>'max_athletes', '')::integer,
    nullif(p_plan->>'max_staff', '')::integer,
    coalesce(p_plan->'features', '{}'::jsonb)
  )
  on conflict (code) do update set
    name = excluded.name, tagline = excluded.tagline, description = excluded.description,
    audience = excluded.audience, sort_order = excluded.sort_order, is_public = excluded.is_public,
    is_active = excluded.is_active, is_custom = excluded.is_custom, trial_days = excluded.trial_days,
    max_athletes = excluded.max_athletes, max_staff = excluded.max_staff, features = excluded.features;

  for r in select * from jsonb_array_elements(p_prices) loop
    if (r->>'amount') is null or (r->>'amount') = '' then
      delete from public.plan_prices
       where plan_code = v_code and currency = r->>'currency' and billing_interval = r->>'billing_interval';
    else
      insert into public.plan_prices (plan_code, currency, billing_interval, amount, stripe_price_id)
      values (v_code, r->>'currency', r->>'billing_interval', (r->>'amount')::numeric,
              nullif(r->>'stripe_price_id', ''))
      on conflict (plan_code, currency, billing_interval) do update set
        amount = excluded.amount, stripe_price_id = excluded.stripe_price_id;
    end if;
  end loop;

  insert into public.platform_audit_log (actor_id, action, details)
  values (auth.uid(), 'plan.upserted', jsonb_build_object('plan', p_plan, 'prices', p_prices));
  return jsonb_build_object('code', v_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Grants: who may call what (Supabase roles)
-- ---------------------------------------------------------------------------
revoke all on function public.provision_tenant(text, text, text, text, text, text, text, text) from public;
revoke all on function public.capture_usage_snapshot(uuid) from public;
revoke all on function public.capture_all_usage_snapshots() from public;
revoke all on function public.platform_tenant_overview() from public;
revoke all on function public.platform_set_org_suspended(uuid, boolean, text) from public;
revoke all on function public.platform_change_plan(uuid, text, text, timestamptz, numeric) from public;
revoke all on function public.platform_upsert_plan(jsonb, jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.provision_tenant(text, text, text, text, text, text, text, text) to authenticated;
    grant execute on function public.capture_usage_snapshot(uuid) to authenticated;
    grant execute on function public.capture_all_usage_snapshots() to authenticated;
    grant execute on function public.platform_tenant_overview() to authenticated;
    grant execute on function public.platform_set_org_suspended(uuid, boolean, text) to authenticated;
    grant execute on function public.platform_change_plan(uuid, text, text, timestamptz, numeric) to authenticated;
    grant execute on function public.platform_upsert_plan(jsonb, jsonb) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.capture_usage_snapshot(uuid) to service_role;
    grant execute on function public.capture_all_usage_snapshots() to service_role;
  end if;
end $$;
