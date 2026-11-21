-- ============================================================================
-- Migration · Feature packaging & upgrades (purchasable add-ons per club)
--
-- WHAT THIS ADDS
--   * platform_features      — the feature catalog mirrored in SQL (key,
--                              category, core flag, default tier, dependencies)
--                              = src/lib/upgrades/catalog.ts
--   * feature_addon_prices   — monthly add-on price per feature and currency
--                              (platform-editable; [Est.] seed values)
--   * org_feature_grants     — per-club entitlements on top of the plan:
--                                addon             paid add-on (Stripe item or
--                                                  'pending' request)
--                                trial             free trial with an end date
--                                complimentary     free of charge (one feature)
--                                founding          founding-club override
--                                complimentary_all every feature free (feature '*')
--                                block             explicit platform block
--   * plans.features         — the plan <-> feature matrix, seeded with the
--                              proposed packaging (only once: existing edits by
--                              platform admins are never overwritten)
--   * subscriptions.pending_plan_* — a requested / scheduled plan change
--   * org_feature_enabled()  — DB mirror of src/lib/upgrades/resolve.ts
--   * platform_* RPCs        — grant / trial / block / remove, plan matrix,
--                              add-on prices (platform admins only)
--   * audit                  — every grant change is written to the club's
--                              audit_logs and the platform_audit_log; plan
--                              matrix and price changes to platform_audit_log
--
-- SECURITY MODEL
--   * Club admins and finance READ their own club's grants; nobody else in the
--     club and no other club reads them. Nobody in a club WRITES them: writes
--     come from the service role (server actions after an admin check, the
--     Stripe Billing webhook) or platform admins (RLS + SECURITY DEFINER RPCs
--     that re-check is_platform_admin()).
--   * The catalog and prices are readable by any signed-in user (pricing);
--     written only by platform admins.
--   * Customer zero (DLang) gets 'complimentary_all' as DATA below, guarded by
--     its organization id; there is no code path that names a club.
--
-- Additive and idempotent: if not exists, create or replace, drop policy if
-- exists + create, guarded inserts. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Catalog
-- ---------------------------------------------------------------------------
create table if not exists public.platform_features (
  key               text primary key check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  category          text not null,
  is_core           boolean not null default false,
  default_tier      text check (default_tier is null or default_tier in ('starter', 'club', 'academy', 'federation')),
  requires          text[] not null default '{}',
  sort_order        integer not null default 0,
  label             text not null,
  is_active         boolean not null default true,
  -- Stripe Billing product used for the add-on line (created lazily, test mode).
  stripe_product_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
drop trigger if exists trg_platform_features_updated on public.platform_features;
create trigger trg_platform_features_updated before update on public.platform_features
  for each row execute function public.set_updated_at();

insert into public.platform_features (key, category, is_core, default_tier, requires, sort_order, label)
values
  ('programs', 'core', true, 'starter', '{}'::text[], 10, 'Programs & schedule'),
  ('registration', 'core', true, 'starter', '{}'::text[], 20, 'Online registration'),
  ('invoicing', 'core', true, 'starter', '{}'::text[], 30, 'Invoicing'),
  ('qr_bill', 'core', true, 'starter', '{}'::text[], 40, 'Swiss QR-bill'),
  ('online_payments', 'core', true, 'starter', '{}'::text[], 50, 'Card & TWINT payments'),
  ('roster', 'core', true, 'starter', '{}'::text[], 60, 'Roster: families, athletes, coaches'),
  ('attendance', 'core', true, 'starter', '{}'::text[], 70, 'Attendance'),
  ('messaging', 'core', true, 'starter', '{}'::text[], 80, 'Messaging & notifications'),
  ('documents_consent', 'core', true, 'starter', '{}'::text[], 90, 'Documents & consents'),
  ('parent_app', 'core', true, 'starter', '{}'::text[], 100, 'Parent web app'),
  ('custom_branding', 'core', true, 'starter', '{}'::text[], 110, 'Club branding'),
  ('web_push', 'core', true, 'starter', '{}'::text[], 120, 'Web push notifications'),
  ('multi_club', 'core', true, 'starter', '{}'::text[], 130, 'One login for several clubs'),
  ('camps', 'programs', false, 'starter', '{}'::text[], 140, 'Camps'),
  ('camp_basket', 'programs', false, 'club', array['camps']::text[], 150, 'Camp seasons & multi-week basket'),
  ('multi_team', 'programs', false, 'club', '{}'::text[], 160, 'Multiple teams'),
  ('multi_location', 'programs', false, 'academy', array['multi_team']::text[], 170, 'Multiple locations'),
  ('calendar_ics', 'programs', false, 'club', '{}'::text[], 180, 'Club calendar & ICS feeds'),
  ('waitlists', 'programs', false, 'club', '{}'::text[], 190, 'Waiting lists with auto-promotion'),
  ('shop', 'programs', false, 'club', '{}'::text[], 200, 'Club shop'),
  ('alerts_leads', 'communication', false, 'club', '{}'::text[], 210, 'Scheduled alerts & new contacts'),
  ('media_library', 'communication', false, 'club', '{}'::text[], 220, 'Media library'),
  ('sms', 'communication', false, null, '{}'::text[], 230, 'SMS packs'),
  ('reminders', 'finance', false, 'club', '{}'::text[], 240, 'Automatic payment reminders'),
  ('discounts', 'finance', false, 'club', '{}'::text[], 250, 'Discounts & promo codes'),
  ('payment_plans', 'finance', false, 'club', '{}'::text[], 260, 'Payment plans, instalments & autopay'),
  ('recurring_fees', 'finance', false, 'club', '{}'::text[], 270, 'Recurring fees'),
  ('finance', 'finance', false, 'club', '{}'::text[], 280, 'Finance: expenses, payouts, budgets'),
  ('reports_advanced', 'finance', false, 'club', '{}'::text[], 290, 'Reports'),
  ('accounting', 'finance', false, 'academy', array['finance']::text[], 300, 'Accounting: bank import, exports, period locks, dunning, refunds'),
  ('bookings', 'training', false, 'academy', '{}'::text[], 310, 'Training bookings & packages'),
  ('player_development', 'training', false, 'academy', '{}'::text[], 320, 'Player development: assessments, plans, nutrition, rankings, wellness'),
  ('player_journey', 'training', false, 'academy', array['player_development']::text[], 330, 'Player journey & scout profile'),
  ('lesson_plans', 'training', false, 'club', array['coach_app']::text[], 340, 'Lesson plans'),
  ('coach_app', 'people', false, 'club', '{}'::text[], 350, 'Coach app'),
  ('csv_import', 'people', false, 'club', '{}'::text[], 360, 'CSV / Excel import'),
  ('memberships', 'people', false, 'club', '{}'::text[], 370, 'Memberships'),
  ('member_cards', 'people', false, 'academy', array['memberships']::text[], 380, 'NFC / QR member cards'),
  ('forms', 'people', false, 'club', '{}'::text[], 390, 'Custom forms'),
  ('contracts', 'people', false, 'academy', '{}'::text[], 400, 'Contracts & e-signature'),
  ('staff_time', 'people', false, 'academy', array['coach_app']::text[], 410, 'Staff clock-in, schedules & timesheets'),
  ('advanced_roles', 'people', false, 'academy', '{}'::text[], 420, 'Advanced roles (finance role, delegated access)'),
  ('staff_compliance', 'safety', false, 'club', '{}'::text[], 430, 'Staff compliance & certificates'),
  ('injury_log', 'safety', false, 'club', '{}'::text[], 440, 'Injury & incident log'),
  ('js_export', 'safety', false, 'club', '{}'::text[], 450, 'J+S export (Switzerland)'),
  ('ops_equipment', 'operations', false, 'academy', '{}'::text[], 460, 'Equipment & kit'),
  ('ops_facilities', 'operations', false, 'academy', '{}'::text[], 470, 'Facilities & closures'),
  ('ops_board', 'operations', false, 'academy', '{}'::text[], 480, 'Board & committees'),
  ('ops_sponsors', 'operations', false, 'academy', '{}'::text[], 490, 'Sponsors & donations'),
  ('split_billing', 'family', false, 'club', '{}'::text[], 500, 'Second guardian split billing'),
  ('carpooling', 'family', false, 'club', '{}'::text[], 510, 'Carpooling'),
  ('website_connect', 'website', false, 'club', '{}'::text[], 520, 'Website connection: public API, embeds, WordPress plugin'),
  ('site_builder', 'website', false, 'academy', array['website_connect']::text[], 530, 'Built-in club website'),
  ('custom_domain', 'website', false, 'academy', '{}'::text[], 540, 'Custom domain & branded email sender'),
  ('extra_languages', 'website', false, 'academy', '{}'::text[], 550, 'More than two languages'),
  ('white_label', 'website', false, 'academy', '{}'::text[], 560, 'Full white-label'),
  ('ai_assistant', 'ai', false, null, '{}'::text[], 570, 'AI assistant'),
  ('api_access', 'enterprise', false, 'academy', '{}'::text[], 580, 'Admin API access'),
  ('priority_support', 'enterprise', false, 'academy', '{}'::text[], 590, 'Priority support'),
  ('sso', 'enterprise', false, 'federation', '{}'::text[], 600, 'Single sign-on'),
  ('federation_rollup', 'enterprise', false, 'federation', '{}'::text[], 610, 'Group / federation roll-up')
on conflict (key) do update set
  category = excluded.category, is_core = excluded.is_core, default_tier = excluded.default_tier,
  requires = excluded.requires, sort_order = excluded.sort_order, label = excluded.label;

create table if not exists public.feature_addon_prices (
  feature_key      text not null references public.platform_features(key) on update cascade on delete cascade,
  currency         text not null check (currency in ('CHF', 'EUR', 'USD')),
  amount           numeric(10,2) not null check (amount >= 0),     -- per month
  stripe_price_id  text,                                           -- optional pre-made Stripe price
  is_active        boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (feature_key, currency)
);
drop trigger if exists trg_feature_addon_prices_updated on public.feature_addon_prices;
create trigger trg_feature_addon_prices_updated before update on public.feature_addon_prices
  for each row execute function public.set_updated_at();

-- [Est.] proposed prices (docs/company/15_FEATURE_PACKAGING_PROPOSAL.md). Never
-- overwrites a price a platform admin already changed.
insert into public.feature_addon_prices (feature_key, currency, amount)
values
  ('camp_basket', 'CHF', 29.00),
  ('camp_basket', 'EUR', 29.00),
  ('camp_basket', 'USD', 32.00),
  ('multi_team', 'CHF', 29.00),
  ('multi_team', 'EUR', 29.00),
  ('multi_team', 'USD', 32.00),
  ('multi_location', 'CHF', 49.00),
  ('multi_location', 'EUR', 49.00),
  ('multi_location', 'USD', 54.00),
  ('calendar_ics', 'CHF', 9.00),
  ('calendar_ics', 'EUR', 9.00),
  ('calendar_ics', 'USD', 10.00),
  ('waitlists', 'CHF', 19.00),
  ('waitlists', 'EUR', 19.00),
  ('waitlists', 'USD', 21.00),
  ('shop', 'CHF', 39.00),
  ('shop', 'EUR', 39.00),
  ('shop', 'USD', 43.00),
  ('alerts_leads', 'CHF', 19.00),
  ('alerts_leads', 'EUR', 19.00),
  ('alerts_leads', 'USD', 21.00),
  ('media_library', 'CHF', 15.00),
  ('media_library', 'EUR', 15.00),
  ('media_library', 'USD', 17.00),
  ('sms', 'CHF', 25.00),
  ('sms', 'EUR', 25.00),
  ('sms', 'USD', 29.00),
  ('reminders', 'CHF', 19.00),
  ('reminders', 'EUR', 19.00),
  ('reminders', 'USD', 21.00),
  ('discounts', 'CHF', 15.00),
  ('discounts', 'EUR', 15.00),
  ('discounts', 'USD', 17.00),
  ('payment_plans', 'CHF', 39.00),
  ('payment_plans', 'EUR', 39.00),
  ('payment_plans', 'USD', 43.00),
  ('recurring_fees', 'CHF', 25.00),
  ('recurring_fees', 'EUR', 25.00),
  ('recurring_fees', 'USD', 28.00),
  ('finance', 'CHF', 29.00),
  ('finance', 'EUR', 29.00),
  ('finance', 'USD', 32.00),
  ('reports_advanced', 'CHF', 29.00),
  ('reports_advanced', 'EUR', 29.00),
  ('reports_advanced', 'USD', 32.00),
  ('accounting', 'CHF', 49.00),
  ('accounting', 'EUR', 49.00),
  ('accounting', 'USD', 54.00),
  ('bookings', 'CHF', 79.00),
  ('bookings', 'EUR', 79.00),
  ('bookings', 'USD', 87.00),
  ('player_development', 'CHF', 69.00),
  ('player_development', 'EUR', 69.00),
  ('player_development', 'USD', 76.00),
  ('player_journey', 'CHF', 39.00),
  ('player_journey', 'EUR', 39.00),
  ('player_journey', 'USD', 43.00),
  ('lesson_plans', 'CHF', 15.00),
  ('lesson_plans', 'EUR', 15.00),
  ('lesson_plans', 'USD', 17.00),
  ('coach_app', 'CHF', 39.00),
  ('coach_app', 'EUR', 39.00),
  ('coach_app', 'USD', 43.00),
  ('csv_import', 'CHF', 19.00),
  ('csv_import', 'EUR', 19.00),
  ('csv_import', 'USD', 21.00),
  ('memberships', 'CHF', 25.00),
  ('memberships', 'EUR', 25.00),
  ('memberships', 'USD', 28.00),
  ('member_cards', 'CHF', 19.00),
  ('member_cards', 'EUR', 19.00),
  ('member_cards', 'USD', 21.00),
  ('forms', 'CHF', 19.00),
  ('forms', 'EUR', 19.00),
  ('forms', 'USD', 21.00),
  ('contracts', 'CHF', 29.00),
  ('contracts', 'EUR', 29.00),
  ('contracts', 'USD', 32.00),
  ('staff_time', 'CHF', 39.00),
  ('staff_time', 'EUR', 39.00),
  ('staff_time', 'USD', 43.00),
  ('advanced_roles', 'CHF', 29.00),
  ('advanced_roles', 'EUR', 29.00),
  ('advanced_roles', 'USD', 32.00),
  ('staff_compliance', 'CHF', 19.00),
  ('staff_compliance', 'EUR', 19.00),
  ('staff_compliance', 'USD', 21.00),
  ('injury_log', 'CHF', 15.00),
  ('injury_log', 'EUR', 15.00),
  ('injury_log', 'USD', 17.00),
  ('js_export', 'CHF', 15.00),
  ('ops_equipment', 'CHF', 19.00),
  ('ops_equipment', 'EUR', 19.00),
  ('ops_equipment', 'USD', 21.00),
  ('ops_facilities', 'CHF', 19.00),
  ('ops_facilities', 'EUR', 19.00),
  ('ops_facilities', 'USD', 21.00),
  ('ops_board', 'CHF', 15.00),
  ('ops_board', 'EUR', 15.00),
  ('ops_board', 'USD', 17.00),
  ('ops_sponsors', 'CHF', 25.00),
  ('ops_sponsors', 'EUR', 25.00),
  ('ops_sponsors', 'USD', 28.00),
  ('split_billing', 'CHF', 19.00),
  ('split_billing', 'EUR', 19.00),
  ('split_billing', 'USD', 21.00),
  ('carpooling', 'CHF', 9.00),
  ('carpooling', 'EUR', 9.00),
  ('carpooling', 'USD', 10.00),
  ('website_connect', 'CHF', 29.00),
  ('website_connect', 'EUR', 29.00),
  ('website_connect', 'USD', 32.00),
  ('site_builder', 'CHF', 39.00),
  ('site_builder', 'EUR', 39.00),
  ('site_builder', 'USD', 43.00),
  ('custom_domain', 'CHF', 29.00),
  ('custom_domain', 'EUR', 29.00),
  ('custom_domain', 'USD', 32.00),
  ('extra_languages', 'CHF', 19.00),
  ('extra_languages', 'EUR', 19.00),
  ('extra_languages', 'USD', 21.00),
  ('ai_assistant', 'CHF', 69.00),
  ('ai_assistant', 'EUR', 69.00),
  ('ai_assistant', 'USD', 79.00),
  ('priority_support', 'CHF', 49.00),
  ('priority_support', 'EUR', 49.00),
  ('priority_support', 'USD', 54.00)
on conflict (feature_key, currency) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Plan <-> feature matrix (plans.features). Seeded ONCE with the proposal:
--    a plan that already carries the new catalog ('coach_app' key) is left as
--    the platform admins edited it.
-- ---------------------------------------------------------------------------
update public.plans set features = (features - array(select key from public.platform_features)) ||
  '{"programs":true,"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"roster":true,"attendance":true,"messaging":true,"documents_consent":true,"parent_app":true,"custom_branding":true,"web_push":true,"multi_club":true,"camps":true,"camp_basket":false,"multi_team":false,"multi_location":false,"calendar_ics":false,"waitlists":false,"shop":false,"alerts_leads":false,"media_library":false,"sms":false,"reminders":false,"discounts":false,"payment_plans":false,"recurring_fees":false,"finance":false,"reports_advanced":false,"accounting":false,"bookings":false,"player_development":false,"player_journey":false,"lesson_plans":false,"coach_app":false,"csv_import":false,"memberships":false,"member_cards":false,"forms":false,"contracts":false,"staff_time":false,"advanced_roles":false,"staff_compliance":false,"injury_log":false,"js_export":false,"ops_equipment":false,"ops_facilities":false,"ops_board":false,"ops_sponsors":false,"split_billing":false,"carpooling":false,"website_connect":false,"site_builder":false,"custom_domain":false,"extra_languages":false,"white_label":false,"ai_assistant":false,"api_access":false,"priority_support":false,"sso":false,"federation_rollup":false}'::jsonb
 where code = 'starter' and not (features ? 'coach_app');
update public.plans set features = (features - array(select key from public.platform_features)) ||
  '{"programs":true,"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"roster":true,"attendance":true,"messaging":true,"documents_consent":true,"parent_app":true,"custom_branding":true,"web_push":true,"multi_club":true,"camps":true,"camp_basket":true,"multi_team":true,"multi_location":false,"calendar_ics":true,"waitlists":true,"shop":true,"alerts_leads":true,"media_library":true,"sms":false,"reminders":true,"discounts":true,"payment_plans":true,"recurring_fees":true,"finance":true,"reports_advanced":true,"accounting":false,"bookings":false,"player_development":false,"player_journey":false,"lesson_plans":true,"coach_app":true,"csv_import":true,"memberships":true,"member_cards":false,"forms":true,"contracts":false,"staff_time":false,"advanced_roles":false,"staff_compliance":true,"injury_log":true,"js_export":true,"ops_equipment":false,"ops_facilities":false,"ops_board":false,"ops_sponsors":false,"split_billing":true,"carpooling":true,"website_connect":true,"site_builder":false,"custom_domain":false,"extra_languages":false,"white_label":false,"ai_assistant":false,"api_access":false,"priority_support":false,"sso":false,"federation_rollup":false}'::jsonb
 where code = 'club' and not (features ? 'coach_app');
update public.plans set features = (features - array(select key from public.platform_features)) ||
  '{"programs":true,"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"roster":true,"attendance":true,"messaging":true,"documents_consent":true,"parent_app":true,"custom_branding":true,"web_push":true,"multi_club":true,"camps":true,"camp_basket":true,"multi_team":true,"multi_location":true,"calendar_ics":true,"waitlists":true,"shop":true,"alerts_leads":true,"media_library":true,"sms":false,"reminders":true,"discounts":true,"payment_plans":true,"recurring_fees":true,"finance":true,"reports_advanced":true,"accounting":true,"bookings":true,"player_development":true,"player_journey":true,"lesson_plans":true,"coach_app":true,"csv_import":true,"memberships":true,"member_cards":true,"forms":true,"contracts":true,"staff_time":true,"advanced_roles":true,"staff_compliance":true,"injury_log":true,"js_export":true,"ops_equipment":true,"ops_facilities":true,"ops_board":true,"ops_sponsors":true,"split_billing":true,"carpooling":true,"website_connect":true,"site_builder":true,"custom_domain":true,"extra_languages":true,"white_label":true,"ai_assistant":false,"api_access":true,"priority_support":true,"sso":false,"federation_rollup":false}'::jsonb
 where code = 'academy' and not (features ? 'coach_app');
update public.plans set features = (features - array(select key from public.platform_features)) ||
  '{"programs":true,"registration":true,"invoicing":true,"qr_bill":true,"online_payments":true,"roster":true,"attendance":true,"messaging":true,"documents_consent":true,"parent_app":true,"custom_branding":true,"web_push":true,"multi_club":true,"camps":true,"camp_basket":true,"multi_team":true,"multi_location":true,"calendar_ics":true,"waitlists":true,"shop":true,"alerts_leads":true,"media_library":true,"sms":false,"reminders":true,"discounts":true,"payment_plans":true,"recurring_fees":true,"finance":true,"reports_advanced":true,"accounting":true,"bookings":true,"player_development":true,"player_journey":true,"lesson_plans":true,"coach_app":true,"csv_import":true,"memberships":true,"member_cards":true,"forms":true,"contracts":true,"staff_time":true,"advanced_roles":true,"staff_compliance":true,"injury_log":true,"js_export":true,"ops_equipment":true,"ops_facilities":true,"ops_board":true,"ops_sponsors":true,"split_billing":true,"carpooling":true,"website_connect":true,"site_builder":true,"custom_domain":true,"extra_languages":true,"white_label":true,"ai_assistant":false,"api_access":true,"priority_support":true,"sso":true,"federation_rollup":true}'::jsonb
 where code = 'federation' and not (features ? 'coach_app');

-- Plan copy follows the packaging (only while it still has the original text).
update public.plans
   set description = 'Up to 180 active athletes. Everything in Starter plus multiple teams, the coach app, reminders, reports and CSV import.'
 where code = 'club' and description like 'Up to 180 active athletes. Everything in Starter plus bookings%';
update public.plans
   set description = 'Up to 400 active athletes. Everything in Club plus multiple locations, bookings, player development, advanced roles and a custom domain.'
 where code = 'academy' and description like 'Up to 400 active athletes. Everything in Club plus custom domain%';

-- ---------------------------------------------------------------------------
-- 3) Per-club grants
-- ---------------------------------------------------------------------------
create table if not exists public.org_feature_grants (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null references public.organizations(id) on delete cascade,
  feature_key                 text not null,
  kind                        text not null check (kind in ('addon', 'trial', 'complimentary', 'founding', 'complimentary_all', 'block')),
  status                      text not null default 'active' check (status in ('pending', 'active', 'canceling', 'canceled', 'expired')),
  starts_at                   timestamptz not null default now(),
  ends_at                     timestamptz,
  currency                    text check (currency is null or currency in ('CHF', 'EUR', 'USD')),
  amount                      numeric(10,2) check (amount is null or amount >= 0),
  stripe_subscription_item_id text unique,
  requested_by                uuid references public.profiles(id) on delete set null,
  granted_by                  uuid references public.profiles(id) on delete set null,
  -- Commercial context only; never personal data.
  note                        text check (note is null or char_length(note) <= 500),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint org_feature_grants_all_key check ((kind = 'complimentary_all') = (feature_key = '*')),
  constraint org_feature_grants_trial_end check (kind <> 'trial' or ends_at is not null),
  constraint org_feature_grants_period check (ends_at is null or ends_at > starts_at)
);
create index if not exists idx_org_feature_grants_org on public.org_feature_grants(org_id);
create index if not exists idx_org_feature_grants_open on public.org_feature_grants(status, ends_at)
  where status in ('pending', 'active', 'canceling');
-- One open grant per club, feature and kind.
create unique index if not exists uq_org_feature_grants_open
  on public.org_feature_grants(org_id, feature_key, kind)
  where status in ('pending', 'active', 'canceling');
-- One free trial per club and feature, ever.
create unique index if not exists uq_org_feature_grants_trial
  on public.org_feature_grants(org_id, feature_key) where kind = 'trial';

drop trigger if exists trg_org_feature_grants_updated on public.org_feature_grants;
create trigger trg_org_feature_grants_updated before update on public.org_feature_grants
  for each row execute function public.set_updated_at();

-- Feature keys must exist in the catalog; core features are never granted or blocked.
create or replace function public.org_feature_grants_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.feature_key <> '*' then
    if not exists (select 1 from public.platform_features f where f.key = new.feature_key) then
      raise exception 'UNKNOWN_FEATURE' using errcode = '23503';
    end if;
    if exists (select 1 from public.platform_features f where f.key = new.feature_key and f.is_core) then
      raise exception 'CORE_FEATURE' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_org_feature_grants_check on public.org_feature_grants;
create trigger trg_org_feature_grants_check
  before insert or update of feature_key on public.org_feature_grants
  for each row execute function public.org_feature_grants_check();

-- Audit every grant / change / removal (club trail + platform trail).
create or replace function public.audit_org_feature_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.org_feature_grants;
  v_action text;
  v_old    jsonb;
  v_new    jsonb;
  v_actor  uuid;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_action := 'feature.grant.removed';
  else
    v_row := new;
    v_action := case when tg_op = 'INSERT' then 'feature.grant.created' else 'feature.grant.updated' end;
    v_new := jsonb_build_object('feature', new.feature_key, 'kind', new.kind, 'status', new.status,
                                'starts_at', new.starts_at, 'ends_at', new.ends_at,
                                'amount', new.amount, 'currency', new.currency);
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := jsonb_build_object('feature', old.feature_key, 'kind', old.kind, 'status', old.status,
                                'starts_at', old.starts_at, 'ends_at', old.ends_at,
                                'amount', old.amount, 'currency', old.currency);
    if tg_op = 'UPDATE' and v_old = v_new then
      return new; -- only the note / Stripe ids / timestamps changed
    end if;
  end if;
  v_actor := coalesce(auth.uid(), v_row.granted_by, v_row.requested_by);

  if exists (select 1 from public.organizations o where o.id = v_row.org_id) then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
    values (v_row.org_id, v_actor, v_action, 'org_feature_grants', v_row.id, v_old, v_new);
    insert into public.platform_audit_log (actor_id, action, org_id, details)
    values (v_actor, v_action, v_row.org_id, jsonb_build_object('grant_id', v_row.id, 'old', v_old, 'new', v_new));
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_audit_org_feature_grant on public.org_feature_grants;
create trigger trg_audit_org_feature_grant
  after insert or update or delete on public.org_feature_grants
  for each row execute function public.audit_org_feature_grant();

comment on table public.org_feature_grants is
  'Per-club feature entitlements on top of the plan (add-on, trial, complimentary, founding, complimentary_all, block). Platform-written only; club admins/finance read their own club. Audit-logged.';

-- ---------------------------------------------------------------------------
-- 4) Plan change requests on the subscription (additive columns)
-- ---------------------------------------------------------------------------
alter table public.subscriptions add column if not exists pending_plan_code text references public.plans(code) on update cascade;
-- null = waiting for the platform team (no Stripe); else applied at this time (period end).
alter table public.subscriptions add column if not exists pending_plan_effective_at timestamptz;
alter table public.subscriptions add column if not exists pending_plan_requested_at timestamptz;
alter table public.subscriptions add column if not exists pending_plan_requested_by uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
alter table public.platform_features    enable row level security;
alter table public.feature_addon_prices enable row level security;
alter table public.org_feature_grants   enable row level security;
alter table public.org_feature_grants   force row level security;

drop policy if exists platform_features_select on public.platform_features;
create policy platform_features_select on public.platform_features for select
  using (is_active or public.is_platform_admin());
drop policy if exists platform_features_insert on public.platform_features;
create policy platform_features_insert on public.platform_features for insert
  with check (public.is_platform_admin());
drop policy if exists platform_features_update on public.platform_features;
create policy platform_features_update on public.platform_features for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists platform_features_delete on public.platform_features;
create policy platform_features_delete on public.platform_features for delete
  using (public.is_platform_admin());

drop policy if exists feature_addon_prices_select on public.feature_addon_prices;
create policy feature_addon_prices_select on public.feature_addon_prices for select
  using (is_active or public.is_platform_admin());
drop policy if exists feature_addon_prices_insert on public.feature_addon_prices;
create policy feature_addon_prices_insert on public.feature_addon_prices for insert
  with check (public.is_platform_admin());
drop policy if exists feature_addon_prices_update on public.feature_addon_prices;
create policy feature_addon_prices_update on public.feature_addon_prices for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists feature_addon_prices_delete on public.feature_addon_prices;
create policy feature_addon_prices_delete on public.feature_addon_prices for delete
  using (public.is_platform_admin());

-- Grants: platform admins read all; a club's admins and finance read their own.
drop policy if exists org_feature_grants_select on public.org_feature_grants;
create policy org_feature_grants_select on public.org_feature_grants for select
  using (public.is_platform_admin() or (org_id = public.current_org_id() and public.is_finance()));
drop policy if exists org_feature_grants_insert on public.org_feature_grants;
create policy org_feature_grants_insert on public.org_feature_grants for insert
  with check (public.is_platform_admin());
drop policy if exists org_feature_grants_update on public.org_feature_grants;
create policy org_feature_grants_update on public.org_feature_grants for update
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists org_feature_grants_delete on public.org_feature_grants;
create policy org_feature_grants_delete on public.org_feature_grants for delete
  using (public.is_platform_admin());

revoke all on public.org_feature_grants from public, anon;
revoke insert, update, delete on public.platform_features, public.feature_addon_prices from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on public.platform_features, public.feature_addon_prices to anon, authenticated;
    grant insert, update, delete on public.platform_features, public.feature_addon_prices to authenticated;
    grant select, insert, update, delete on public.org_feature_grants to authenticated;
    grant all on public.platform_features, public.feature_addon_prices, public.org_feature_grants to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Resolution (mirror of src/lib/upgrades/resolve.ts)
-- ---------------------------------------------------------------------------
-- Internal: no caller check. Not executable by API roles; used by the
-- SECURITY DEFINER wrappers below and by org_has_feature().
create or replace function public._org_feature_enabled(p_org uuid, p_key text, p_depth integer default 0)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_feat   public.platform_features;
  v_live   boolean;
  v_plan   jsonb;
  v_over   jsonb;
  v_ok     boolean := false;
  v_req    text;
begin
  if p_org is null or p_key is null or p_depth > 8 then return false; end if;
  select * into v_feat from public.platform_features where key = p_key;
  if not found then return false; end if;
  if v_feat.is_core then return true; end if;
  if exists (select 1 from public.organizations o where o.id = p_org and o.suspended_at is not null) then
    return false;
  end if;

  select p.features, s.feature_overrides into v_plan, v_over
    from public.subscriptions s join public.plans p on p.code = s.plan_code
   where s.org_id = p_org;
  v_over := coalesce(v_over, '{}'::jsonb);

  -- explicit block wins
  if (v_over ? p_key and (v_over->>p_key) = 'false')
     or exists (select 1 from public.org_feature_grants g
                 where g.org_id = p_org and g.feature_key = p_key and g.kind = 'block'
                   and g.status in ('active', 'canceling') and g.starts_at <= now()
                   and (g.ends_at is null or g.ends_at > now())) then
    return false;
  end if;

  v_live := public.org_subscription_is_live(p_org);

  v_ok := exists (select 1 from public.org_feature_grants g
                   where g.org_id = p_org
                     and ((g.feature_key = p_key and g.kind in ('complimentary', 'founding'))
                          or g.kind = 'complimentary_all')
                     and g.status in ('active', 'canceling') and g.starts_at <= now()
                     and (g.ends_at is null or g.ends_at > now()))
       or (p_key = 'ai_assistant' and exists (
             select 1 from public.ai_assistant_addons a
              where a.org_id = p_org and a.scope = 'org' and a.status = 'active'
                and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
                and (a.source = 'complimentary' or v_live)))
       or (v_live and (
             coalesce((v_plan->>p_key)::boolean, false)
             or (v_over ? p_key and (v_over->>p_key) = 'true')
             or exists (select 1 from public.org_feature_grants g
                         where g.org_id = p_org and g.feature_key = p_key and g.kind in ('addon', 'trial')
                           and g.status in ('active', 'canceling') and g.starts_at <= now()
                           and (g.ends_at is null or g.ends_at > now()))));
  if not v_ok then return false; end if;

  foreach v_req in array v_feat.requires loop
    if not public._org_feature_enabled(p_org, v_req, p_depth + 1) then return false; end if;
  end loop;
  return true;
end;
$$;

-- Public wrapper: the caller's own club, the service role or a platform admin.
-- Anyone else gets false (never another tenant's answer).
create or replace function public.org_feature_enabled(p_org uuid, p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_org is null then false
    when not (p_org = public.current_org_id() or public.is_service_caller() or public.is_platform_admin()) then false
    else public._org_feature_enabled(p_org, p_key)
  end;
$$;

-- The legacy plan-only check now follows the same rules (grants, blocks, deps).
create or replace function public.org_has_feature(p_org uuid, p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public._org_feature_enabled(p_org, p_feature);
$$;

revoke all on function public._org_feature_enabled(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.org_feature_enabled(uuid, text) from public, anon;
revoke all on function public.org_feature_grants_check() from public, anon, authenticated;
revoke all on function public.audit_org_feature_grant() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.org_feature_enabled(uuid, text) to authenticated, service_role;
    grant execute on function public._org_feature_enabled(uuid, text, integer) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Platform admin RPCs (re-check is_platform_admin(); audit-logged)
-- ---------------------------------------------------------------------------
-- Grant / trial / block a feature for a club (p_key '*' with kind
-- 'complimentary_all'). Replaces an open grant of the same kind.
create or replace function public.platform_set_feature_grant(
  p_org uuid, p_key text, p_kind text, p_ends_at timestamptz default null, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_kind not in ('trial', 'complimentary', 'founding', 'complimentary_all', 'block', 'addon') then
    raise exception 'INVALID_KIND' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_kind = 'trial' and (p_ends_at is null or p_ends_at <= now()) then
    raise exception 'INVALID_END' using errcode = '22023';
  end if;

  update public.org_feature_grants
     set status = 'canceled', ends_at = greatest(starts_at + interval '1 second', least(coalesce(ends_at, now()), now())), note = coalesce(note, 'replaced by platform')
   where org_id = p_org and feature_key = p_key and kind = p_kind
     and status in ('pending', 'active', 'canceling');

  -- A platform trial is allowed even if the club already used its self-serve trial.
  if p_kind = 'trial' then
    delete from public.org_feature_grants where org_id = p_org and feature_key = p_key and kind = 'trial';
  end if;

  insert into public.org_feature_grants (org_id, feature_key, kind, status, starts_at, ends_at, granted_by, note)
  values (p_org, p_key, p_kind, 'active', now(), p_ends_at, auth.uid(), nullif(left(coalesce(p_note, ''), 500), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Activate a pending add-on request, or end any grant now.
create or replace function public.platform_update_feature_grant(p_grant uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status not in ('active', 'canceled') then raise exception 'INVALID_STATUS' using errcode = '22023'; end if;
  update public.org_feature_grants
     set status = p_status,
         starts_at = case when p_status = 'active' and status = 'pending' then now() else starts_at end,
         ends_at = case when p_status = 'canceled' then greatest(starts_at + interval '1 second', now()) else ends_at end,
         granted_by = coalesce(granted_by, auth.uid())
   where id = p_grant;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

-- Plan matrix: include / exclude one feature in one plan. Core features are
-- always on; add-on-only features (default_tier null, e.g. the AI assistant)
-- are never part of a plan.
create or replace function public.platform_set_plan_feature(p_plan text, p_key text, p_included boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if not exists (select 1 from public.platform_features where key = p_key and not is_core) then
    raise exception 'UNKNOWN_FEATURE' using errcode = '22023';
  end if;
  if coalesce(p_included, false)
     and exists (select 1 from public.platform_features where key = p_key and default_tier is null) then
    raise exception 'ADDON_ONLY' using errcode = '22023';
  end if;
  update public.plans set features = features || jsonb_build_object(p_key, coalesce(p_included, false))
   where code = p_plan;
  if not found then raise exception 'INVALID_PLAN' using errcode = '22023'; end if;
  insert into public.platform_audit_log (actor_id, action, details)
  values (auth.uid(), 'plan.feature.set', jsonb_build_object('plan', p_plan, 'feature', p_key, 'included', p_included));
end;
$$;

-- Add-on price per feature and currency (null amount = not sold in that currency).
create or replace function public.platform_set_addon_price(p_key text, p_currency text, p_amount numeric, p_stripe_price_id text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric;
begin
  if not public.is_platform_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_currency not in ('CHF', 'EUR', 'USD') then raise exception 'INVALID_CURRENCY' using errcode = '22023'; end if;
  if not exists (select 1 from public.platform_features where key = p_key and not is_core) then
    raise exception 'UNKNOWN_FEATURE' using errcode = '22023';
  end if;
  select amount into v_old from public.feature_addon_prices where feature_key = p_key and currency = p_currency;
  if p_amount is null then
    delete from public.feature_addon_prices where feature_key = p_key and currency = p_currency;
  else
    if p_amount < 0 or p_amount > 100000 then raise exception 'INVALID_AMOUNT' using errcode = '22023'; end if;
    insert into public.feature_addon_prices (feature_key, currency, amount, stripe_price_id)
    values (p_key, p_currency, round(p_amount, 2), nullif(p_stripe_price_id, ''))
    on conflict (feature_key, currency) do update
      set amount = excluded.amount, stripe_price_id = excluded.stripe_price_id, is_active = true;
  end if;
  insert into public.platform_audit_log (actor_id, action, details)
  values (auth.uid(), 'addon.price.set',
          jsonb_build_object('feature', p_key, 'currency', p_currency, 'old', v_old, 'new', p_amount));
end;
$$;

revoke all on function public.platform_set_feature_grant(uuid, text, text, timestamptz, text) from public, anon;
revoke all on function public.platform_update_feature_grant(uuid, text) from public, anon;
revoke all on function public.platform_set_plan_feature(text, text, boolean) from public, anon;
revoke all on function public.platform_set_addon_price(text, text, numeric, text) from public, anon;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.platform_set_feature_grant(uuid, text, text, timestamptz, text) to authenticated;
    grant execute on function public.platform_update_feature_grant(uuid, text) to authenticated;
    grant execute on function public.platform_set_plan_feature(text, text, boolean) to authenticated;
    grant execute on function public.platform_set_addon_price(text, text, numeric, text) to authenticated;
  end if;
end $$;

comment on function public.platform_set_feature_grant(uuid, text, text, timestamptz, text) is
  'Platform admins: grant (complimentary / founding / complimentary_all with key *), trial (with end date) or block a feature for a club. Audit-logged.';

-- ---------------------------------------------------------------------------
-- 8) Customer zero keeps everything: 'complimentary_all' as DATA, guarded by
--    the organization id (no code path names a club). Runs only where that
--    organization exists; a no-op everywhere else. The same grant can be set
--    on any club by a platform admin with platform_set_feature_grant(org,
--    '*', 'complimentary_all') (/platform/tenants/<id> -> Entitlements).
-- ---------------------------------------------------------------------------
insert into public.org_feature_grants (org_id, feature_key, kind, status, note)
select o.id, '*', 'complimentary_all', 'active', 'Customer zero: every module complimentary (founder decision)'
  from public.organizations o
 where o.id = '00000000-0000-0000-0000-000000000001'
   and not exists (select 1 from public.org_feature_grants g
                    where g.org_id = o.id and g.kind = 'complimentary_all'
                      and g.status in ('pending', 'active', 'canceling'));
