-- ============================================================================
-- Prospect demo sandboxes (sales demo on staging)
--
-- One prospect = one sandbox = one fictional club (its own organizations row)
-- plus five demo logins (club admin, finance, coach, parent, athlete). Every
-- existing tenant rule therefore isolates prospects from each other and from
-- real clubs: RLS, current_org_id(), role helpers, RPC checks. Nothing in this
-- file adds a per-tenant code path.
--
--   demo_sandboxes            service role only (RLS forced, deny policies)
--   organizations.demo_sandbox_id   marks a club as a demo club (outbound
--                             e-mail / push suppression reads it)
--   demo_sandbox_create(...)  seed a club + link the five fresh demo logins
--   demo_sandbox_reset(id)    seed a fresh club for the same logins; the
--                             previous club is detached (no member can reach it)
--
-- The scenario (all fictional, e-mails on the reserved demo.example.com):
--   U14 Falcons (Coach Taylor), U12 Comets (Coach Rivera)
--   Jamie Morgan, guardian of Alex (no request, no roster place) and Sam
--   (active U12 Comets member)
--   one U14 Falcons practice today, more practices this week
--   Skills camp (published edition), 5-session training package
--   Sam: paid season invoice (sandbox TWINT), open package invoice
--   Casey Brooks (external camp customer): camp registration, paid by sandbox card
--
-- Additive and idempotent. Functions are security definer, set search_path
-- and accept only the service role (public.is_service_caller()).
-- ============================================================================

-- ---------------------------------------------------------------- tables

create table if not exists public.demo_sandboxes (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  token_hash         text not null,
  admin_profile_id   uuid references public.profiles(id) on delete set null,
  finance_profile_id uuid references public.profiles(id) on delete set null,
  coach_profile_id   uuid references public.profiles(id) on delete set null,
  parent_profile_id  uuid references public.profiles(id) on delete set null,
  player_profile_id  uuid references public.profiles(id) on delete set null,
  status             text not null default 'active',
  reset_count        integer not null default 0,
  previous_org_ids   uuid[] not null default '{}',
  expires_at         timestamptz not null default (now() + interval '24 hours'),
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'demo_sandboxes_token_hash_key') then
    alter table public.demo_sandboxes add constraint demo_sandboxes_token_hash_key unique (token_hash);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demo_sandboxes_token_hash_format') then
    alter table public.demo_sandboxes add constraint demo_sandboxes_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'demo_sandboxes_status_check') then
    alter table public.demo_sandboxes add constraint demo_sandboxes_status_check check (status in ('active', 'expired'));
  end if;
end $$;

create index if not exists idx_demo_sandboxes_org on public.demo_sandboxes (org_id);
create index if not exists idx_demo_sandboxes_created on public.demo_sandboxes (created_at);

alter table public.demo_sandboxes enable row level security;
alter table public.demo_sandboxes force row level security;
revoke all on public.demo_sandboxes from anon, authenticated;
grant all on public.demo_sandboxes to service_role;

-- Every verb denied to API users; only the service role (bypassrls) reads it.
drop policy if exists demo_sandboxes_select on public.demo_sandboxes;
create policy demo_sandboxes_select on public.demo_sandboxes for select to authenticated using (false);
drop policy if exists demo_sandboxes_insert on public.demo_sandboxes;
create policy demo_sandboxes_insert on public.demo_sandboxes for insert to authenticated with check (false);
drop policy if exists demo_sandboxes_update on public.demo_sandboxes;
create policy demo_sandboxes_update on public.demo_sandboxes for update to authenticated using (false) with check (false);
drop policy if exists demo_sandboxes_delete on public.demo_sandboxes;
create policy demo_sandboxes_delete on public.demo_sandboxes for delete to authenticated using (false);

drop trigger if exists trg_demo_sandboxes_updated on public.demo_sandboxes;
create trigger trg_demo_sandboxes_updated before update on public.demo_sandboxes
  for each row execute function public.set_updated_at();

alter table public.organizations add column if not exists demo_sandbox_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_demo_sandbox_fkey') then
    alter table public.organizations add constraint organizations_demo_sandbox_fkey
      foreign key (demo_sandbox_id) references public.demo_sandboxes(id) on delete set null;
  end if;
end $$;
create index if not exists idx_organizations_demo_sandbox on public.organizations (demo_sandbox_id)
  where demo_sandbox_id is not null;

-- The prospect demo page (/demo) is an app route: a club website page can no
-- longer claim that path (same list as RESERVED_SEGMENTS in src/lib/site/paths.ts).
create or replace function public.site_path_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select split_part(ltrim(coalesce(p, ''), '/'), '/', 1) in (
    'admin', 'coach', 'parent', 'player', 'platform', 'login', 'auth', 'register', 'book', 'shop', 'club', 'embed',
    'embed.js', 'api', 'board', 'scout', 'waitlist', 'onboarding', 'signup', 'legal', 'offline', 'pwa',
    'sw.js', 'manifest.webmanifest', '_next', 'favicon.ico', 'sitemap.xml', 'robots.txt', 'icon',
    'apple-icon', 'opengraph-image', 'monitoring', 'join', 'consent', 'link-invite',
    'demo');
$$;

-- ---------------------------------------------------------------- helpers

-- True when the club is a demo club (server-side checks; service role only).
create or replace function public.org_is_demo(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.organizations where id = p_org and demo_sandbox_id is not null);
$$;
revoke all on function public.org_is_demo(uuid) from public, anon, authenticated;
grant execute on function public.org_is_demo(uuid) to service_role;

create or replace function public.demo_sandbox_guard()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_service_caller() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
end $$;
revoke all on function public.demo_sandbox_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- seed one club

create or replace function public.demo_sandbox_seed_org(p_sandbox uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz      constant text := 'Europe/Zurich';
  v_today   date := (now() at time zone 'Europe/Zurich')::date;
  v_year    int;
  v_org     uuid;
  v_season  uuid;
  v_venue   uuid;
  v_taylor  uuid;
  v_rivera  uuid;
  v_p_u14   uuid;
  v_p_u12   uuid;
  v_t_u14   uuid;
  v_t_u12   uuid;
  v_camp    uuid;
  v_slot    uuid;
  v_group   uuid;
  v_opt5    uuid;
  v_opt3    uuid;
  v_ed      uuid;
  v_ed_start date;
  v_svc     uuid;
  v_pkg     uuid;
  v_fam_m   uuid;
  v_fam_b   uuid;
  v_alex    uuid;
  v_sam     uuid;
  v_riley   uuid;
  v_fam     uuid;
  v_ath     uuid;
  v_inv     uuid;
  v_ref     text;
  v_num     text;
  v_res     jsonb;
  r         record;
  i         int := 0;
begin
  perform public.demo_sandbox_guard();
  v_year := extract(year from v_today)::int;
  if extract(month from v_today) < 8 then v_year := v_year - 1; end if;

  insert into public.organizations (name, slug, country, currency, default_locale, supported_locales, timezone,
                                    sport, plan, status, data_region, branding, terminology, demo_sandbox_id)
  values ('DLang Demo Club', 'demo-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
          'CH', 'CHF', 'en', '{en,fr-CH,de-CH}', v_tz, 'basketball', 'pro', 'trial', 'ch',
          jsonb_build_object('app_name', 'DLang Sports OS', 'logo_url', null, 'favicon_url', null, 'dark_mode', true,
            'colors', jsonb_build_object('primary', '#DA2627', 'primaryDark', '#961F1F', 'accent', '#C19A45',
                                         'background', '#0A0A0A', 'surface', '#1A1A1A', 'text', '#F1F1F1'),
            'fonts', jsonb_build_object('display', 'Fraunces', 'ui', 'Geist', 'mono', 'Geist Mono')),
          '{}'::jsonb, p_sandbox)
  returning id into v_org;

  insert into public.app_settings (org_id, invoice_pattern, invoice_counter, currency, default_locale, enabled_locales,
                                   timezone, payment_methods, settings)
  values (v_org, 'DEMO-{YYYY}-{####}', 100, 'CHF', 'en', '{en,fr,de}', v_tz, '{twint,qr_bill,bank_transfer,card,manual}',
          jsonb_build_object('payments', jsonb_build_object(
            'creditor_name', 'DLang Demo Club (sandbox)', 'creditor_street', 'Avenue de l''Exemple', 'creditor_building', '1',
            'creditor_zip', '1000', 'creditor_city', 'Lausanne', 'creditor_country', 'CH',
            -- Published SIX sample QR-IBAN: no real account behind it.
            'qr_iban', 'CH4431999123000889012', 'iban', '', 'twint_number', '', 'reference_type', 'QRR', 'reference_prefix', '21')))
  on conflict (org_id) do update set
    invoice_pattern = excluded.invoice_pattern, invoice_counter = excluded.invoice_counter, currency = excluded.currency,
    default_locale = excluded.default_locale, enabled_locales = excluded.enabled_locales, timezone = excluded.timezone,
    payment_methods = excluded.payment_methods, settings = public.app_settings.settings || excluded.settings;

  insert into public.subscriptions (org_id, plan_code, status, currency, billing_interval, trial_ends_at, custom_amount, notes)
  select v_org, 'academy', 'trialing', 'CHF', 'month', now() + interval '24 hours', 0, 'Prospect demo sandbox (no billing)'
  where not exists (select 1 from public.subscriptions where org_id = v_org);

  insert into public.org_feature_grants (org_id, feature_key, kind, status, starts_at, note)
  values (v_org, '*', 'complimentary_all', 'active', now(), 'Prospect demo sandbox');

  insert into public.venues (org_id, name, address, city, postal_code, country, capacity)
  values (v_org, 'Demo Arena', 'Chemin de l''Exemple 5', 'Lausanne', '1000', 'CH', 300)
  returning id into v_venue;

  insert into public.seasons (org_id, name, starts_on, ends_on, is_current)
  values (v_org, 'Season ' || v_year || '-' || right((v_year + 1)::text, 2), make_date(v_year, 8, 1), make_date(v_year + 1, 6, 30), true)
  returning id into v_season;

  insert into public.coaches (org_id, display_name, role_title, serves, bio)
  values (v_org, 'Coach Taylor', 'Head Coach · U14 Falcons', '{group}', 'Fictional demo coach.')
  returning id into v_taylor;
  insert into public.coaches (org_id, display_name, role_title, serves, bio)
  values (v_org, 'Coach Rivera', 'Head Coach · U12 Comets', '{group}', 'Fictional demo coach.')
  returning id into v_rivera;

  -- Club programmes: free here (the season fee is invoiced separately), so an
  -- approved request is confirmed at once and joins the team roster.
  insert into public.programs (org_id, slug, name, kind, description, price_chf, currency, capacity, starts_on, ends_on,
                               location, is_public, is_active, status, requires_club_approval)
  values (v_org, 'u14-falcons', 'U14 Falcons', 'recurring_team', 'Competitive U14 team. Twice-weekly practice.', 0, 'CHF', 18,
          make_date(v_year, 8, 1), make_date(v_year + 1, 6, 30), 'Demo Arena, Lausanne', false, true, 'published', true)
  returning id into v_p_u14;
  insert into public.programs (org_id, slug, name, kind, description, price_chf, currency, capacity, starts_on, ends_on,
                               location, is_public, is_active, status, requires_club_approval)
  values (v_org, 'u12-comets', 'U12 Comets', 'recurring_team', 'Development team for under-12 players.', 0, 'CHF', 18,
          make_date(v_year, 8, 1), make_date(v_year + 1, 6, 30), 'Demo Arena, Lausanne', false, true, 'published', true)
  returning id into v_p_u12;

  insert into public.program_coaches (org_id, program_id, coach_id, role) values
    (v_org, v_p_u14, v_taylor, 'head'), (v_org, v_p_u12, v_rivera, 'head');

  insert into public.teams (org_id, season_id, program_id, name, sport, age_group, gender, level, color)
  values (v_org, v_season, v_p_u14, 'U14 Falcons', 'basketball', 'U14', 'mixed', 'Regional', '#DA2627')
  returning id into v_t_u14;
  insert into public.teams (org_id, season_id, program_id, name, sport, age_group, gender, level, color)
  values (v_org, v_season, v_p_u12, 'U12 Comets', 'basketball', 'U12', 'mixed', 'Development', '#C19A45')
  returning id into v_t_u12;
  insert into public.team_coaches (team_id, coach_id, org_id, role) values
    (v_t_u14, v_taylor, v_org, 'head'), (v_t_u12, v_rivera, v_org, 'head');

  -- The Morgan family (Jamie's login is linked by demo_sandbox_link).
  insert into public.families (org_id, name, address, phone, contact_name, contact_email)
  values (v_org, 'Morgan family', 'Avenue Exemple 10, 1000 Lausanne', '+41 00 000 00 00', 'Jamie Morgan', 'jamie.morgan@demo.example.com')
  returning id into v_fam_m;
  insert into public.athletes (org_id, family_id, first_name, last_name, dob, status)
  values (v_org, v_fam_m, 'Alex', 'Morgan', make_date(v_year - 13, 5, 14), 'active') returning id into v_alex;
  insert into public.athletes (org_id, family_id, first_name, last_name, dob, status)
  values (v_org, v_fam_m, 'Sam', 'Morgan', make_date(v_year - 11, 9, 3), 'active') returning id into v_sam;

  -- Sam: active U12 Comets member (staff enrolment path: confirmed + roster).
  insert into public.registrations (org_id, athlete_id, program_id, status)
  values (v_org, v_sam, v_p_u12, 'confirmed');
  insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, position, status, joined_on)
  values (v_org, v_t_u12, v_sam, 8, 'Guard', 'active', make_date(v_year, 8, 1));

  -- Team-mates (fictional, no logins) so the rosters are not empty.
  for r in select * from (values
      ('Lee',    'Novak',   'U14', 4,  'Guard'),
      ('Robin',  'Keller',  'U14', 7,  'Forward'),
      ('Noa',    'Fischer', 'U14', 11, 'Center'),
      ('Charlie','Dubois',  'U14', 15, 'Wing'),
      ('Max',    'Weber',   'U12', 3,  'Guard'),
      ('Mika',   'Rossi',   'U12', 6,  'Forward'),
      ('Eli',    'Bernard', 'U12', 12, 'Center')) as t(fn, ln, grp, jersey, pos)
  loop
    i := i + 1;
    insert into public.families (org_id, name, contact_name, contact_email)
    values (v_org, r.ln || ' family', 'Guardian ' || r.ln, lower(r.ln) || '.family@demo.example.com')
    returning id into v_fam;
    insert into public.athletes (org_id, family_id, first_name, last_name, dob, status)
    values (v_org, v_fam, r.fn, r.ln,
            case when r.grp = 'U14' then make_date(v_year - 13, 1 + (i % 12), 10) else make_date(v_year - 11, 1 + (i % 12), 20) end,
            'active')
    returning id into v_ath;
    insert into public.registrations (org_id, athlete_id, program_id, status)
    values (v_org, v_ath, case when r.grp = 'U14' then v_p_u14 else v_p_u12 end, 'confirmed');
    insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, position, status, joined_on)
    values (v_org, case when r.grp = 'U14' then v_t_u14 else v_t_u12 end, v_ath, r.jersey, r.pos, 'active', make_date(v_year, 8, 1));
  end loop;

  -- Schedule: the U14 Falcons practice today (the one Coach Taylor marks),
  -- the next U14 practice and two U12 practices.
  insert into public.events (org_id, team_id, season_id, type, title, venue_id, starts_at, ends_at, status) values
    (v_org, v_t_u14, v_season, 'training', 'Team practice', v_venue,
     (v_today + time '17:30') at time zone v_tz, (v_today + time '19:00') at time zone v_tz, 'scheduled'),
    (v_org, v_t_u14, v_season, 'training', 'Team practice', v_venue,
     (v_today + 2 + time '17:30') at time zone v_tz, (v_today + 2 + time '19:00') at time zone v_tz, 'scheduled'),
    (v_org, v_t_u12, v_season, 'training', 'Team practice', v_venue,
     (v_today + 1 + time '17:00') at time zone v_tz, (v_today + 1 + time '18:15') at time zone v_tz, 'scheduled'),
    (v_org, v_t_u12, v_season, 'training', 'Team practice', v_venue,
     (v_today + 3 + time '17:00') at time zone v_tz, (v_today + 3 + time '18:15') at time zone v_tz, 'scheduled');

  -- Skills camp: one published edition (Monday-Friday, about eight weeks out).
  insert into public.programs (org_id, slug, name, kind, description, price_chf, currency, min_age, max_age,
                               location, is_public, is_active, status)
  values (v_org, 'skills-camp', 'Skills Camp', 'camp', 'Five-day skills camp for ages 8-15. Lunch included.', 390, 'CHF', 8, 15,
          'Demo Arena, Lausanne', true, true, 'published')
  returning id into v_camp;
  insert into public.camp_time_slots (org_id, program_id, label, starts_at, ends_at, sort)
  values (v_org, v_camp, 'Full day', '09:00', '16:00', 1) returning id into v_slot;
  insert into public.camp_age_groups (org_id, program_id, label, min_age, max_age, time_slot_id, sort)
  values (v_org, v_camp, '8-15', 8, 15, v_slot, 1) returning id into v_group;
  insert into public.camp_price_options (org_id, program_id, label, days_count, includes_lunch, price, currency, sort)
  values (v_org, v_camp, '5 days - with lunch', 5, true, 390, 'CHF', 1) returning id into v_opt5;
  insert into public.camp_price_options (org_id, program_id, label, days_count, includes_lunch, price, currency, sort)
  values (v_org, v_camp, '3 days - with lunch', 3, true, 250, 'CHF', 2) returning id into v_opt3;
  v_ed_start := v_today + 56;
  v_ed_start := v_ed_start + ((8 - extract(isodow from v_ed_start)::int) % 7);
  insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, venue_id, city, capacity, status)
  values (v_org, v_camp, 'Skills Camp · Week 1', v_ed_start, v_ed_start + 4, v_venue, 'Lausanne', 40, 'published')
  returning id into v_ed;

  -- Five-session training package.
  insert into public.training_services (org_id, slug, name, tagline, duration_min, price_chf, currency, credit_category, kind)
  values (v_org, 'skills-training', 'Skills Training', 'Small-group skills session', 60, 70, 'CHF', 'personal', 'group')
  returning id into v_svc;
  insert into public.credit_packages (org_id, service_id, name, credits, price_chf, validity_days, description, is_active)
  values (v_org, v_svc, '5-session package', 5, 300, 120, 'Five Skills Training sessions.', true)
  returning id into v_pkg;

  -- Sam: season fee invoice paid with a sandbox TWINT payment.
  v_num := 'DEMO-' || v_year || '-0001';
  insert into public.invoices (org_id, number, family_id, athlete_id, program_id, description, currency, total_chf,
                               subtotal_amount, tax_rate, tax_amount, tax_inclusive, reverse_charge, status, due_date, issued_at)
  values (v_org, v_num, v_fam_m, v_sam, v_p_u12, 'U12 Comets · season fee', 'CHF', 450, 450, 0, 0, false, false, 'sent',
          v_today - 16, now() - interval '30 days')
  returning id, payment_reference into v_inv, v_ref;
  insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
  values (v_org, v_inv, 'U12 Comets · season fee', 1, 450, 450);
  insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, paid_at, qr_reference, notes)
  values (v_org, v_inv, 450, 'CHF', 'twint', 'succeeded', now() - interval '20 days', v_ref,
          'Sandbox payment ' || v_num || ' · no money moved');
  perform public.recompute_invoice(v_inv);

  -- Sam: the 5-session package, invoiced and still open.
  v_res := to_jsonb(public.training_create_purchase(v_org, v_sam, v_svc, v_pkg, 'invoice', 'Demo booking'));

  -- Casey Brooks: external camp customer (guest family), paid by sandbox card.
  insert into public.families (org_id, name, phone, contact_name, contact_email, membership_status)
  values (v_org, 'Brooks family', '+41 00 000 00 01', 'Casey Brooks', 'casey.brooks@demo.example.com', 'guest')
  returning id into v_fam_b;
  insert into public.athletes (org_id, family_id, first_name, last_name, dob, status)
  values (v_org, v_fam_b, 'Riley', 'Brooks', make_date(v_year - 11, 3, 2), 'active') returning id into v_riley;
  v_res := public.register_camp(jsonb_build_object(
    'mode', 'parent', 'program_id', v_camp, 'edition_id', v_ed, 'family_id', v_fam_b,
    'children', jsonb_build_array(jsonb_build_object('athlete_id', v_riley, 'age_group_id', v_group,
                                                      'price_option_id', v_opt5, 'list_amount', 390, 'discounts', '[]'::jsonb,
                                                      'days', (select jsonb_agg(v_ed_start + d) from generate_series(0, 4) d))),
    'consents', '[]'::jsonb));
  v_inv := (v_res->>'invoice_id')::uuid;
  if v_inv is not null then
    select payment_reference, number into v_ref, v_num from public.invoices where id = v_inv;
    update public.invoices set payer_name = 'Casey Brooks', payer_email = 'casey.brooks@demo.example.com' where id = v_inv;
    insert into public.payments (org_id, invoice_id, amount_chf, currency, method, status, paid_at, qr_reference, notes)
    values (v_org, v_inv, 390, 'CHF', 'card', 'succeeded', now() - interval '2 days', v_ref,
            'Sandbox card payment ' || v_num || ' · no money moved');
    perform public.recompute_invoice(v_inv);
  end if;

  insert into public.notifications (org_id, recipient_id, type, title, body) values
    (v_org, null, 'system', 'Welcome to the DLang demo club', 'Fictional club for product demos. Nothing here is real.');

  return v_org;
end $$;
revoke all on function public.demo_sandbox_seed_org(uuid) from public, anon, authenticated;

-- Link the five demo logins to a club (internal).
create or replace function public.demo_sandbox_link(p_sandbox uuid, p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.demo_sandboxes%rowtype;
  v_fam   uuid;
  v_alex  uuid;
begin
  perform public.demo_sandbox_guard();
  select * into s from public.demo_sandboxes where id = p_sandbox;
  if not found then raise exception 'SANDBOX_NOT_FOUND' using errcode = 'P0002'; end if;

  update public.profiles p set
    org_id = p_org, full_name = v.full_name, locale = 'en',
    onboarding_completed_at = coalesce(p.onboarding_completed_at, now())
  from (values
    (s.admin_profile_id,   'Club Admin (demo)'),
    (s.finance_profile_id, 'Finance (demo)'),
    (s.coach_profile_id,   'Coach Taylor'),
    (s.parent_profile_id,  'Jamie Morgan'),
    (s.player_profile_id,  'Alex Morgan')
  ) as v(id, full_name)
  where p.id = v.id;

  insert into public.staff_roles (org_id, profile_id, role) values
    (p_org, s.admin_profile_id, 'admin'),
    (p_org, s.finance_profile_id, 'finance'),
    (p_org, s.coach_profile_id, 'coach')
  on conflict (org_id, profile_id, role) do nothing;

  update public.coaches set profile_id = s.coach_profile_id
   where org_id = p_org and display_name = 'Coach Taylor';

  select id into v_fam from public.families where org_id = p_org and name = 'Morgan family';
  insert into public.family_members (family_id, profile_id, relation, is_primary)
  values (v_fam, s.parent_profile_id, 'parent', true)
  on conflict do nothing;
  update public.families set primary_contact_id = s.parent_profile_id where id = v_fam;

  select id into v_alex from public.athletes where org_id = p_org and family_id = v_fam and first_name = 'Alex';
  update public.athletes set player_profile_id = s.player_profile_id, player_linked_at = now() where id = v_alex;
end $$;
revoke all on function public.demo_sandbox_link(uuid, uuid) from public, anon, authenticated;

-- Detach the five logins from a club they are leaving (internal).
create or replace function public.demo_sandbox_unlink(p_sandbox uuid, p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.demo_sandboxes%rowtype;
  v_ids uuid[];
begin
  perform public.demo_sandbox_guard();
  select * into s from public.demo_sandboxes where id = p_sandbox;
  v_ids := array_remove(array[s.admin_profile_id, s.finance_profile_id, s.coach_profile_id, s.parent_profile_id, s.player_profile_id], null);
  delete from public.staff_roles where org_id = p_org and profile_id = any (v_ids);
  delete from public.family_members fm using public.families f
   where f.id = fm.family_id and f.org_id = p_org and fm.profile_id = any (v_ids);
  update public.families set primary_contact_id = null where org_id = p_org and primary_contact_id = any (v_ids);
  update public.coaches set profile_id = null where org_id = p_org and profile_id = any (v_ids);
  update public.athletes set player_profile_id = null, player_linked_at = null
   where org_id = p_org and player_profile_id = any (v_ids);
end $$;
revoke all on function public.demo_sandbox_unlink(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- public (service role) API

-- Creates a sandbox for five freshly created demo logins. Each login must be on
-- the reserved demo.example.com domain and belong to no club yet, so a real
-- account can never be pulled into a demo club.
create or replace function public.demo_sandbox_create(
  p_token_hash text, p_admin uuid, p_finance uuid, p_coach uuid, p_parent uuid, p_player uuid,
  p_ttl_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[] := array[p_admin, p_finance, p_coach, p_parent, p_player];
  v_id  uuid;
  v_org uuid;
begin
  perform public.demo_sandbox_guard();
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_TOKEN' using errcode = 'P0001'; end if;
  if array_position(v_ids, null) is not null or (select count(distinct x) from unnest(v_ids) x) <> 5 then
    raise exception 'INVALID_PROFILES' using errcode = 'P0001';
  end if;
  if (select count(*) from public.profiles p
       where p.id = any (v_ids) and p.org_id is null and lower(p.email::text) like '%@demo.example.com') <> 5 then
    raise exception 'INVALID_PROFILES' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.staff_roles where profile_id = any (v_ids))
     or exists (select 1 from public.family_members where profile_id = any (v_ids)) then
    raise exception 'INVALID_PROFILES' using errcode = 'P0001';
  end if;

  -- Placeholder org first (demo_sandboxes.org_id is not null), replaced below.
  insert into public.demo_sandboxes (org_id, token_hash, admin_profile_id, finance_profile_id, coach_profile_id,
                                     parent_profile_id, player_profile_id, expires_at)
  select o.id, p_token_hash, p_admin, p_finance, p_coach, p_parent, p_player,
         now() + make_interval(hours => greatest(1, least(coalesce(p_ttl_hours, 24), 168)))
    from (select id from public.organizations order by created_at limit 1) o
  returning id into v_id;
  if v_id is null then raise exception 'NO_ORGANIZATION' using errcode = 'P0001'; end if;

  v_org := public.demo_sandbox_seed_org(v_id);
  update public.demo_sandboxes set org_id = v_org where id = v_id;
  perform public.demo_sandbox_link(v_id, v_org);
  return jsonb_build_object('sandbox_id', v_id, 'org_id', v_org);
end $$;
revoke all on function public.demo_sandbox_create(text, uuid, uuid, uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.demo_sandbox_create(text, uuid, uuid, uuid, uuid, uuid, integer) to service_role;

-- Restores the starting scenario for one sandbox only: a fresh club is seeded
-- and the same five logins move to it. The previous club keeps no member.
create or replace function public.demo_sandbox_reset(p_sandbox uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s       public.demo_sandboxes%rowtype;
  v_org   uuid;
begin
  perform public.demo_sandbox_guard();
  select * into s from public.demo_sandboxes where id = p_sandbox for update;
  if not found then raise exception 'SANDBOX_NOT_FOUND' using errcode = 'P0002'; end if;
  if s.status <> 'active' or s.expires_at <= now() then raise exception 'SANDBOX_EXPIRED' using errcode = 'P0001'; end if;

  perform public.demo_sandbox_unlink(s.id, s.org_id);
  v_org := public.demo_sandbox_seed_org(s.id);
  update public.demo_sandboxes
     set org_id = v_org, previous_org_ids = previous_org_ids || s.org_id, reset_count = reset_count + 1,
         last_seen_at = now()
   where id = s.id;
  perform public.demo_sandbox_link(s.id, v_org);
  return jsonb_build_object('sandbox_id', s.id, 'org_id', v_org, 'previous_org_id', s.org_id, 'reset_count', s.reset_count + 1);
end $$;
revoke all on function public.demo_sandbox_reset(uuid) from public, anon, authenticated;
grant execute on function public.demo_sandbox_reset(uuid) to service_role;

-- Marks sandboxes past their expiry and detaches their logins. Returns the
-- profile ids the caller may delete from auth (all on demo.example.com).
create or replace function public.demo_sandbox_expire()
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  s     public.demo_sandboxes%rowtype;
  v_out uuid[] := '{}';
begin
  perform public.demo_sandbox_guard();
  for s in select * from public.demo_sandboxes where status = 'active' and expires_at <= now() for update skip locked loop
    perform public.demo_sandbox_unlink(s.id, s.org_id);
    update public.demo_sandboxes set status = 'expired' where id = s.id;
    v_out := v_out || array_remove(array[s.admin_profile_id, s.finance_profile_id, s.coach_profile_id,
                                         s.parent_profile_id, s.player_profile_id], null);
  end loop;
  return v_out;
end $$;
revoke all on function public.demo_sandbox_expire() from public, anon, authenticated;
grant execute on function public.demo_sandbox_expire() to service_role;
