-- ============================================================================
-- Alumni & placements (additive, idempotent)
--
-- Former players the club helped place in a school, academy, college,
-- university, club or pro team: who they are, where they went (placement
-- timeline) and every contact with them (contact log + follow-ups). Nothing
-- here is club-, sport- or country-specific: institution types cover the
-- US pathway (high school, prep, JUCO, NCAA D1/D2/D3, NAIA), Canada
-- (U SPORTS), European clubs, pro clubs and national-team programmes.
--
-- 1. coaches.alumni_access          per-coach permission flag (admin sets it).
-- 2. alumni                         the person + contact details, guardian
--                                   contact (required while possibly a minor),
--                                   contact consent and public-showcase consent.
-- 3. alumni_placements              institution, type, level, years, scholarship,
--                                   status, current flag, roster link.
-- 4. alumni_contacts                contact log (email / call / WhatsApp /
--                                   meeting / note) with follow-up reminders.
-- 5. Access: admins of the club and coaches with alumni_access; finance,
--    parents and athletes have no access. Policies for every verb.
-- 6. Audit: alumni_audit() records ids, operation and the NAMES of changed
--    columns only (no personal data), so a permanent delete leaves an
--    anonymised trail.
-- 7. alumni_public_showcase(org)     the club website's "Our placements" block
--                                   (called server-side by the website layer):
--                                   only alumni with public-showcase consent,
--                                   adults (or guardian consent recorded), and
--                                   only when the club switched the
--                                   "placements" public section on.
-- 8. Feature key 'alumni_network' (Academy tier, add-on elsewhere).
--
-- Minor rule (alumni_is_minor): with a full birth date, under 18 on the day;
-- with a birth year only, a person counts as a possible minor until the year
-- they turn 19 (current year - birth year < 19), because the birthday is not
-- known. Without either, the age is unknown (not treated as a minor for the
-- contact rule; the public showcase then needs the guardian consent flag).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Coach permission flag
-- ---------------------------------------------------------------------------
alter table public.coaches add column if not exists alumni_access boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------
create or replace function public.alumni_is_minor(p_birth_year integer, p_birth_date date, p_on date default current_date)
returns boolean language sql stable set search_path = public as $$
  select case
    when p_birth_date is not null then p_birth_date > (p_on - interval '18 years')::date
    when p_birth_year is not null then extract(year from p_on)::int - p_birth_year < 19
    else false
  end;
$$;

-- Admin of the current club, or a coach of the current club with alumni_access.
create or replace function public.alumni_staff_can()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_org_id() is not null and (
    public.is_admin()
    or (public.has_role('coach') and exists (
          select 1 from public.coaches c
           where c.profile_id = auth.uid() and c.org_id = public.current_org_id()
             and c.is_active and c.alumni_access)));
$$;

-- ---------------------------------------------------------------------------
-- 3) Tables
-- ---------------------------------------------------------------------------
create table if not exists public.alumni (
  id                         uuid primary key default gen_random_uuid(),
  org_id                     uuid not null references public.organizations(id) on delete cascade,
  athlete_id                 uuid references public.athletes(id) on delete set null,
  first_name                 text not null,
  last_name                  text not null,
  birth_year                 integer,
  birth_date                 date,
  gender                     text,
  nationality                text,
  photo_path                 text,
  email                      text,
  phone                      text,
  whatsapp                   boolean not null default false,
  instagram                  text,
  x_handle                   text,
  linkedin_url               text,
  highlight_url              text,
  guardian_name              text,
  guardian_email             text,
  guardian_phone             text,
  contact_consent            boolean not null default false,
  contact_consent_on         date,
  contact_consent_source     text,
  showcase_consent           boolean not null default false,
  showcase_consent_on        date,
  showcase_guardian_consent  boolean not null default false,
  showcase_name_style        text not null default 'initial',
  notes                      text,
  tags                       text[] not null default '{}',
  status                     text not null default 'active',
  created_by                 uuid references public.profiles(id) on delete set null,
  updated_by                 uuid references public.profiles(id) on delete set null,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  constraint alumni_name_chk check (length(btrim(first_name)) between 1 and 80 and length(btrim(last_name)) between 1 and 80),
  constraint alumni_birth_chk check (
    (birth_year is null or birth_year between 1900 and 2100)
    and (birth_date is null or birth_year is null or extract(year from birth_date)::int = birth_year)),
  constraint alumni_gender_chk check (gender is null or gender in ('female', 'male', 'other')),
  constraint alumni_text_chk check (
    (nationality is null or length(nationality) <= 80)
    and (instagram is null or length(instagram) <= 100) and (x_handle is null or length(x_handle) <= 100)
    and (guardian_name is null or length(guardian_name) <= 160)
    and (contact_consent_source is null or length(contact_consent_source) <= 200)
    and (notes is null or length(notes) <= 4000)),
  constraint alumni_email_chk check (
    (email is null or (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
    and (guardian_email is null or (length(guardian_email) <= 254 and guardian_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'))),
  constraint alumni_phone_chk check (
    (phone is null or phone ~ '^\+?[0-9 ().-]{4,40}$')
    and (guardian_phone is null or guardian_phone ~ '^\+?[0-9 ().-]{4,40}$')),
  constraint alumni_url_chk check (
    (linkedin_url is null or (length(linkedin_url) <= 500 and linkedin_url ~* '^https?://'))
    and (highlight_url is null or (length(highlight_url) <= 500 and highlight_url ~* '^https?://'))),
  constraint alumni_photo_chk check (
    photo_path is null or (photo_path like (org_id::text || '/%') and position('..' in photo_path) = 0 and length(photo_path) <= 300)),
  constraint alumni_consent_chk check (
    (not contact_consent or contact_consent_on is not null)
    and (not showcase_consent or showcase_consent_on is not null)),
  constraint alumni_name_style_chk check (showcase_name_style in ('initial', 'full')),
  constraint alumni_status_chk check (status in ('active', 'lost_touch', 'do_not_contact')),
  constraint alumni_tags_chk check (coalesce(array_length(tags, 1), 0) <= 20)
);
create index if not exists idx_alumni_org on public.alumni(org_id);
create index if not exists idx_alumni_org_name on public.alumni(org_id, last_name, first_name);
create unique index if not exists uniq_alumni_athlete on public.alumni(org_id, athlete_id) where athlete_id is not null;

create table if not exists public.alumni_placements (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  alumni_id            uuid not null references public.alumni(id) on delete cascade,
  institution          text not null,
  institution_type     text not null default 'other',
  country              text,
  region               text,
  league               text,
  level                text,
  sport                text,
  position             text,
  start_date           date,
  end_year             integer,
  scholarship          text not null default 'unknown',
  status               text not null default 'committed',
  is_current           boolean not null default true,
  source_note          text,
  roster_url           text,
  placement_target_id  uuid references public.placement_targets(id) on delete set null,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint alumni_placements_institution_chk check (length(btrim(institution)) between 1 and 160),
  constraint alumni_placements_type_chk check (institution_type in (
    'high_school', 'prep_academy', 'junior_college', 'ncaa_d1', 'ncaa_d2', 'ncaa_d3', 'naia', 'u_sports',
    'club_amateur', 'pro_club', 'national_team', 'other')),
  constraint alumni_placements_scholarship_chk check (scholarship in ('full', 'partial', 'walk_on', 'none', 'unknown')),
  constraint alumni_placements_status_chk check (status in ('committed', 'signed', 'enrolled', 'transferred', 'graduated', 'turned_pro', 'left')),
  constraint alumni_placements_year_chk check (end_year is null or end_year between 1950 and 2100),
  constraint alumni_placements_text_chk check (
    (country is null or length(country) <= 80) and (region is null or length(region) <= 120)
    and (league is null or length(league) <= 120) and (level is null or length(level) <= 120)
    and (sport is null or length(sport) <= 60) and (position is null or length(position) <= 60)
    and (source_note is null or length(source_note) <= 1000)),
  constraint alumni_placements_url_chk check (roster_url is null or (length(roster_url) <= 500 and roster_url ~* '^https?://'))
);
create index if not exists idx_alumni_placements_org on public.alumni_placements(org_id);
create index if not exists idx_alumni_placements_alumni on public.alumni_placements(alumni_id);
create unique index if not exists uniq_alumni_placements_target on public.alumni_placements(placement_target_id) where placement_target_id is not null;

create table if not exists public.alumni_contacts (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  alumni_id              uuid not null references public.alumni(id) on delete cascade,
  kind                   text not null default 'note',
  direction              text not null default 'outbound',
  summary                text not null,
  happened_at            timestamptz not null default now(),
  by_user                uuid references public.profiles(id) on delete set null,
  follow_up_on           date,
  follow_up_done         boolean not null default false,
  follow_up_notified_at  timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint alumni_contacts_kind_chk check (kind in ('email', 'call', 'whatsapp', 'meeting', 'note')),
  constraint alumni_contacts_direction_chk check (direction in ('outbound', 'inbound', 'none')),
  constraint alumni_contacts_summary_chk check (length(btrim(summary)) between 1 and 4000)
);
create index if not exists idx_alumni_contacts_org on public.alumni_contacts(org_id);
create index if not exists idx_alumni_contacts_alumni on public.alumni_contacts(alumni_id, happened_at desc);
create index if not exists idx_alumni_contacts_follow_up on public.alumni_contacts(follow_up_on) where follow_up_on is not null and not follow_up_done;

-- ---------------------------------------------------------------------------
-- 4) Guards: same-org references, server-set authors, minor rule, do-not-contact
-- ---------------------------------------------------------------------------
create or replace function public.alumni_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.org_id <> old.org_id then
    raise exception 'ALUMNI_IMMUTABLE' using errcode = 'P0001';
  end if;
  new.first_name := btrim(new.first_name);
  new.last_name := btrim(new.last_name);
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  new.guardian_email := nullif(lower(btrim(coalesce(new.guardian_email, ''))), '');
  new.phone := nullif(btrim(coalesce(new.phone, '')), '');
  new.guardian_phone := nullif(btrim(coalesce(new.guardian_phone, '')), '');
  new.guardian_name := nullif(btrim(coalesce(new.guardian_name, '')), '');
  if new.birth_date is not null and new.birth_year is null then
    new.birth_year := extract(year from new.birth_date)::int;
  end if;
  new.tags := coalesce((select array_agg(distinct left(btrim(x), 40)) from unnest(new.tags) x where btrim(x) <> ''), '{}');
  if new.athlete_id is not null
     and not exists (select 1 from public.athletes a where a.id = new.athlete_id and a.org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: athlete_id' using errcode = 'P0001';
  end if;
  if public.alumni_is_minor(new.birth_year, new.birth_date)
     and (new.guardian_name is null or (new.guardian_email is null and new.guardian_phone is null)) then
    raise exception 'ALUMNI_GUARDIAN_REQUIRED' using errcode = 'P0001';
  end if;
  if auth.uid() is not null then
    if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists trg_alumni_guard on public.alumni;
create trigger trg_alumni_guard before insert or update on public.alumni
  for each row execute function public.alumni_guard();

create or replace function public.alumni_child_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if tg_op = 'UPDATE' and (new.org_id <> old.org_id or new.alumni_id <> old.alumni_id) then
    raise exception 'ALUMNI_IMMUTABLE' using errcode = 'P0001';
  end if;
  select a.status into v_status from public.alumni a where a.id = new.alumni_id and a.org_id = new.org_id;
  if not found then
    raise exception 'CROSS_ORG_REFERENCE: alumni_id' using errcode = 'P0001';
  end if;
  if tg_table_name = 'alumni_placements' then
    if new.placement_target_id is not null
       and not exists (select 1 from public.placement_targets t where t.id = new.placement_target_id and t.org_id = new.org_id) then
      raise exception 'CROSS_ORG_REFERENCE: placement_target_id' using errcode = 'P0001';
    end if;
    if tg_op = 'INSERT' and auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    -- contact log: the author is the signed-in user; outreach is blocked for "do not contact".
    if auth.uid() is not null and (tg_op = 'INSERT' or new.by_user is distinct from old.by_user) then
      new.by_user := case when tg_op = 'INSERT' then auth.uid() else old.by_user end;
    end if;
    if v_status = 'do_not_contact' and new.direction = 'outbound' and new.kind in ('email', 'call', 'whatsapp')
       and (tg_op = 'INSERT' or new.kind is distinct from old.kind or new.direction is distinct from old.direction) then
      raise exception 'ALUMNI_DO_NOT_CONTACT' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' and new.follow_up_on is distinct from old.follow_up_on then
      new.follow_up_notified_at := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_alumni_placements_guard on public.alumni_placements;
create trigger trg_alumni_placements_guard before insert or update on public.alumni_placements
  for each row execute function public.alumni_child_guard();
drop trigger if exists trg_alumni_contacts_guard on public.alumni_contacts;
create trigger trg_alumni_contacts_guard before insert or update on public.alumni_contacts
  for each row execute function public.alumni_child_guard();

-- Anonymised audit: ids, operation and changed column names (never values).
create or replace function public.alumni_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(to_jsonb(new)) k
     where k not in ('updated_at', 'updated_by') and (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k);
    if v_changed is null then return new; end if;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values ((v_row->>'org_id')::uuid, auth.uid(), 'alumni.' || lower(tg_op), tg_table_name, (v_row->>'id')::uuid, null,
          jsonb_build_object('alumni_id', coalesce(v_row->>'alumni_id', v_row->>'id'))
            || case when v_changed is not null then jsonb_build_object('changed', to_jsonb(v_changed)) else '{}'::jsonb end);
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare t text;
begin
  foreach t in array array['alumni', 'alumni_placements', 'alumni_contacts'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated', t);
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.alumni_audit()', 'trg_audit_' || t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    -- Policies for every verb: club admins + coaches with alumni_access.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id() and public.alumni_staff_can())', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (org_id = public.current_org_id() and public.alumni_staff_can())', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (org_id = public.current_org_id() and public.alumni_staff_can()) with check (org_id = public.current_org_id() and public.alumni_staff_can())', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete using (org_id = public.current_org_id() and public.alumni_staff_can())', t || '_delete', t);
  end loop;
end $$;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.alumni, public.alumni_placements, public.alumni_contacts to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.alumni, public.alumni_placements, public.alumni_contacts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.alumni, public.alumni_placements, public.alumni_contacts to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Public showcase ("Our placements" on the club website)
-- ---------------------------------------------------------------------------
create or replace function public.alumni_public_showcase(p_org uuid, p_limit integer default 24)
returns table (
  id uuid, display_name text, institution text, institution_type text, level text, league text,
  country text, sport text, start_year integer, end_year integer, status text
)
language sql stable security definer set search_path = public as $$
  select a.id,
         case when a.showcase_name_style = 'full' then a.first_name || ' ' || a.last_name
              else a.first_name || ' ' || left(a.last_name, 1) || '.' end,
         p.institution, p.institution_type, p.level, p.league, p.country, p.sport,
         extract(year from p.start_date)::int, p.end_year, p.status
    from public.alumni a
    join lateral (
      select pl.* from public.alumni_placements pl
       where pl.alumni_id = a.id and pl.org_id = a.org_id and pl.status <> 'left'
       order by pl.is_current desc, pl.start_date desc nulls last, pl.end_year desc nulls last, pl.created_at desc
       limit 1) p on true
   where a.org_id = p_org
     and a.showcase_consent
     and a.status <> 'do_not_contact'
     and (a.showcase_guardian_consent
          or ((a.birth_year is not null or a.birth_date is not null) and not public.alumni_is_minor(a.birth_year, a.birth_date)))
     and exists (select 1 from public.website_settings w
                  where w.org_id = p_org and coalesce((w.public_sections ->> 'placements')::boolean, false))
   order by coalesce(extract(year from p.start_date)::int, p.end_year) desc nulls last, a.first_name, a.last_name
   limit least(greatest(coalesce(p_limit, 24), 1), 100);
$$;

do $$
declare f text;
begin
  foreach f in array array['public.alumni_is_minor(integer, date, date)', 'public.alumni_staff_can()', 'public.alumni_public_showcase(uuid, integer)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
  -- The website reads the showcase server-side (service role); anonymous
  -- callers get nothing directly.
  foreach f in array array['public.alumni_guard()', 'public.alumni_child_guard()', 'public.alumni_audit()'] loop
    execute format('revoke all on function %s from public', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Feature key (Academy tier; add-on elsewhere)
-- ---------------------------------------------------------------------------
insert into public.platform_features (key, category, is_core, default_tier, requires, sort_order, label)
values
  ('alumni_network', 'training', false, 'academy', '{}'::text[], 335, 'Alumni & placements')
on conflict (key) do nothing;

insert into public.feature_addon_prices (feature_key, currency, amount)
values ('alumni_network', 'CHF', 29.00), ('alumni_network', 'EUR', 29.00), ('alumni_network', 'USD', 32.00)
on conflict (feature_key, currency) do nothing;

update public.plans set features = features || jsonb_build_object('alumni_network', code in ('academy', 'federation'))
 where code in ('starter', 'club', 'academy', 'federation') and not (features ? 'alumni_network');
