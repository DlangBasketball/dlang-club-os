-- ============================================================================
-- Club OS — Website connection ("DLang OS Connect" / any club website).
--
-- The club's existing website (e.g. WordPress) shows the app's data through
-- the public read API (/api/public/v1/*), embeds (/embed/*) and a signed
-- "content.updated" webhook. Data is entered once, in the app.
--
-- Additive and idempotent. Every new table carries org_id, an org index (or
-- org_id primary key), RLS with a policy per verb, created_at/updated_at.
--
-- 1. website_settings          per-club connection: enabled, website URL,
--                              allowed origins (exact https origins), public
--                              sections, roster switch (off), embed theme,
--                              webhook URL, website nav links. Admin only.
-- 2. website_secrets           webhook signing secret (encrypted by the app
--                              when WEBSITE_SECRET_KEY is set). NO access for
--                              anon / authenticated: service role only.
-- 3. website_webhook_deliveries queued + attempted webhook POSTs (retries with
--                              backoff). Admins read; only the server writes.
-- 4. website_import_map        idempotent importer map (source, source_id ->
--                              target row). Admin only.
-- 5. website_news              public news items (written in the app or
--                              imported from the website, linking back).
-- 6. Public flags, additive    teams (slug, league, is_public, roster_public,
--                              cover_public), coaches (is_public, photo_public),
--                              events (is_public: null = follow the team),
--                              club_events / club_alerts (is_public).
--                              Everything defaults to NOT public.
-- 7. RPCs                      website_embed_origins() (anon: CSP
--                              frame-ancestors for /embed), website_public_roster()
--                              (service role: first name + initial, only with
--                              recorded media consent).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------
-- Exact https origins only: scheme + host [+ port], no path, no wildcard.
create or replace function public.website_origins_valid(p text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(cardinality(p), 0) <= 20
     and not exists (
       select 1 from unnest(coalesce(p, '{}'::text[])) o
        where o is null
           or length(o) > 255
           or o !~ '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$');
$$;

-- ---------------------------------------------------------------------------
-- 1) website_settings
-- ---------------------------------------------------------------------------
create table if not exists public.website_settings (
  org_id               uuid primary key references public.organizations(id) on delete cascade,
  enabled              boolean not null default false,
  website_url          text check (website_url is null or (length(website_url) <= 300 and website_url ~* '^https://[^\s/?#]+')),
  allowed_origins      text[] not null default '{}',
  public_sections      jsonb not null default '{"programs": true, "camps": true, "events": true, "results": true, "teams": true, "coaches": false, "training": true, "shop": true, "campaigns": true, "news": true, "contact": true}'::jsonb,
  roster_public        boolean not null default false,
  embed_theme          text not null default 'club' check (embed_theme in ('club', 'light', 'dark')),
  webhook_url          text check (webhook_url is null or (length(webhook_url) <= 500 and webhook_url ~* '^https://[^\s/?#]+')),
  secret_hint          text check (secret_hint is null or length(secret_hint) <= 8),
  secret_set_at        timestamptz,
  tagline              text check (tagline is null or length(tagline) <= 200),
  nav_links            jsonb not null default '[]'::jsonb check (jsonb_typeof(nav_links) = 'array' and jsonb_array_length(nav_links) <= 12),
  social_links         jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object'),
  last_delivery_at     timestamptz,
  last_delivery_status text check (last_delivery_status is null or last_delivery_status in ('sent', 'failed', 'pending')),
  last_delivery_code   integer,
  last_delivery_error  text check (last_delivery_error is null or length(last_delivery_error) <= 300),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint website_settings_origins_chk check (public.website_origins_valid(allowed_origins)),
  constraint website_settings_sections_chk check (jsonb_typeof(public_sections) = 'object')
);
drop trigger if exists trg_website_settings_updated on public.website_settings;
create trigger trg_website_settings_updated before update on public.website_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) website_secrets (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.website_secrets (
  org_id      uuid primary key references public.organizations(id) on delete cascade,
  secret_enc  text not null check (length(secret_enc) between 16 and 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_website_secrets_updated on public.website_secrets;
create trigger trg_website_secrets_updated before update on public.website_secrets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) website_webhook_deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.website_webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  resource         text not null check (resource in ('club', 'programs', 'camps', 'events', 'results', 'teams', 'coaches', 'training', 'shop', 'campaigns', 'news')),
  status           text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts         smallint not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  last_attempt_at  timestamptz,
  response_code    integer,
  last_error       text check (last_error is null or length(last_error) <= 300),
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_website_webhook_deliveries_org on public.website_webhook_deliveries(org_id, created_at desc);
create index if not exists idx_website_webhook_deliveries_due on public.website_webhook_deliveries(status, next_attempt_at) where status = 'pending';
-- At most one pending delivery per club and resource (changes coalesce).
create unique index if not exists uq_website_webhook_pending on public.website_webhook_deliveries(org_id, resource) where status = 'pending';
drop trigger if exists trg_website_webhook_deliveries_updated on public.website_webhook_deliveries;
create trigger trg_website_webhook_deliveries_updated before update on public.website_webhook_deliveries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) website_import_map
-- ---------------------------------------------------------------------------
create table if not exists public.website_import_map (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  source           text not null check (source in ('sportspress_team', 'sportspress_event', 'woo_product', 'wp_post')),
  source_id        text not null check (length(source_id) between 1 and 64),
  source_url       text check (source_url is null or length(source_url) <= 500),
  target_table     text not null check (target_table in ('teams', 'events', 'shop_products', 'website_news')),
  target_id        uuid not null,
  last_imported_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, source, source_id)
);
create index if not exists idx_website_import_map_org on public.website_import_map(org_id);
drop trigger if exists trg_website_import_map_updated on public.website_import_map;
create trigger trg_website_import_map_updated before update on public.website_import_map
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) website_news
-- ---------------------------------------------------------------------------
create table if not exists public.website_news (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  excerpt       text check (excerpt is null or length(excerpt) <= 1000),
  body_html     text check (body_html is null or length(body_html) <= 20000),
  link_url      text check (link_url is null or (length(link_url) <= 500 and link_url ~* '^https://')),
  source        text not null default 'app' check (source in ('app', 'wordpress')),
  is_public     boolean not null default false,
  published_at  timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_website_news_org on public.website_news(org_id, published_at desc);
drop trigger if exists trg_website_news_updated on public.website_news;
create trigger trg_website_news_updated before update on public.website_news
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Public flags (additive; everything defaults to not public)
-- ---------------------------------------------------------------------------
alter table public.teams
  add column if not exists slug          text,
  add column if not exists league        text,
  add column if not exists is_public     boolean not null default false,
  add column if not exists roster_public boolean not null default false,
  add column if not exists cover_public  boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_slug_chk') then
    alter table public.teams add constraint teams_slug_chk
      check (slug is null or slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_league_chk') then
    alter table public.teams add constraint teams_league_chk check (league is null or length(league) <= 120);
  end if;
end $$;
create unique index if not exists uq_teams_org_slug on public.teams(org_id, slug) where slug is not null;

alter table public.coaches
  add column if not exists is_public    boolean not null default false,
  add column if not exists photo_public boolean not null default false;

-- null = follow the team's is_public (club-wide events need an explicit true).
alter table public.events add column if not exists is_public boolean;
alter table public.club_events add column if not exists is_public boolean not null default false;
alter table public.club_alerts add column if not exists is_public boolean not null default false;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.website_settings enable row level security;
alter table public.website_settings force row level security;
alter table public.website_secrets enable row level security;
alter table public.website_secrets force row level security;
alter table public.website_webhook_deliveries enable row level security;
alter table public.website_webhook_deliveries force row level security;
alter table public.website_import_map enable row level security;
alter table public.website_import_map force row level security;
alter table public.website_news enable row level security;
alter table public.website_news force row level security;

-- Admin of the org: every verb (settings, import map, news).
do $$
declare t text;
begin
  foreach t in array array['website_settings', 'website_import_map', 'website_news'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($p$create policy %1$s_select on public.%1$I for select
      using (org_id = public.current_org_id() and public.is_admin())$p$, t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert
      with check (org_id = public.current_org_id() and public.is_admin())$p$, t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($p$create policy %1$s_update on public.%1$I for update
      using (org_id = public.current_org_id() and public.is_admin())
      with check (org_id = public.current_org_id() and public.is_admin())$p$, t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete
      using (org_id = public.current_org_id() and public.is_admin())$p$, t);
  end loop;
end $$;

-- Secrets: nobody but the service role (which bypasses RLS).
drop policy if exists website_secrets_select on public.website_secrets;
create policy website_secrets_select on public.website_secrets for select using (false);
drop policy if exists website_secrets_insert on public.website_secrets;
create policy website_secrets_insert on public.website_secrets for insert with check (false);
drop policy if exists website_secrets_update on public.website_secrets;
create policy website_secrets_update on public.website_secrets for update using (false) with check (false);
drop policy if exists website_secrets_delete on public.website_secrets;
create policy website_secrets_delete on public.website_secrets for delete using (false);

-- Deliveries: admins read and clear their log; only the server queues / updates.
drop policy if exists website_webhook_deliveries_select on public.website_webhook_deliveries;
create policy website_webhook_deliveries_select on public.website_webhook_deliveries for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists website_webhook_deliveries_insert on public.website_webhook_deliveries;
create policy website_webhook_deliveries_insert on public.website_webhook_deliveries for insert with check (false);
drop policy if exists website_webhook_deliveries_update on public.website_webhook_deliveries;
create policy website_webhook_deliveries_update on public.website_webhook_deliveries for update using (false) with check (false);
drop policy if exists website_webhook_deliveries_delete on public.website_webhook_deliveries;
create policy website_webhook_deliveries_delete on public.website_webhook_deliveries for delete
  using (org_id = public.current_org_id() and public.is_admin());

revoke all on public.website_secrets from public, anon, authenticated;
revoke all on public.website_settings, public.website_webhook_deliveries, public.website_import_map, public.website_news from anon;
grant select, insert, update, delete on public.website_settings, public.website_import_map, public.website_news to authenticated;
grant select, delete on public.website_webhook_deliveries to authenticated;
grant all on public.website_settings, public.website_secrets, public.website_webhook_deliveries,
  public.website_import_map, public.website_news to service_role;

-- ---------------------------------------------------------------------------
-- 7) RPCs
-- ---------------------------------------------------------------------------
-- Allowed embedding origins of a club whose website connection is enabled
-- (used for the /embed CSP frame-ancestors). Origins are public by nature
-- (they are sent in the CSP header); nothing else is returned.
create or replace function public.website_embed_origins(p_slug text default null, p_host text default null)
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((
    select ws.allowed_origins
      from public.organizations o
      join public.website_settings ws on ws.org_id = o.id and ws.enabled
     where (nullif(lower(btrim(coalesce(p_host, ''))), '') is not null and o.custom_domain = lower(btrim(p_host)))
        or (nullif(lower(btrim(coalesce(p_slug, ''))), '') is not null and lower(o.slug) = lower(btrim(p_slug)))
     order by (o.custom_domain = lower(btrim(coalesce(p_host, '')))) desc nulls last
     limit 1), '{}'::text[]);
$$;
revoke all on function public.website_embed_origins(text, text) from public;
grant execute on function public.website_embed_origins(text, text) to anon, authenticated, service_role;

-- Media consent of an athlete: the latest privacy self-service decision
-- (family_consent_events, kind media) wins; without one, an accepted (not
-- withdrawn / expired) acceptance of the club's "media" consent form.
create or replace function public.athlete_has_media_consent(p_org uuid, p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.granted from public.family_consent_events e
      where e.org_id = p_org and e.athlete_id = p_athlete and e.kind = 'media'
      order by e.created_at desc limit 1),
    exists (select 1 from public.consent_acceptances ca
              join public.consent_forms cf on cf.id = ca.consent_form_id and cf.org_id = ca.org_id
             where ca.org_id = p_org and ca.athlete_id = p_athlete and cf.key = 'media' and ca.status = 'accepted'),
    false);
$$;
revoke all on function public.athlete_has_media_consent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.athlete_has_media_consent(uuid, uuid) to service_role;

-- Public roster of a team: first name + last initial and jersey number, only
-- when the club enabled rosters, the team is public with a public roster and
-- the athlete has media consent. Service role only (the public API).
create or replace function public.website_public_roster(p_org uuid, p_team uuid)
returns table (display_name text, jersey_number smallint)
language sql stable security definer set search_path = public as $$
  select btrim(a.first_name) || case when length(btrim(a.last_name)) > 0
                                     then ' ' || upper(left(btrim(a.last_name), 1)) || '.' else '' end,
         tm.jersey_number
    from public.team_memberships tm
    join public.teams t on t.id = tm.team_id and t.org_id = p_org
    join public.athletes a on a.id = tm.athlete_id and a.org_id = p_org
    join public.website_settings ws on ws.org_id = p_org and ws.enabled and ws.roster_public
   where tm.org_id = p_org and tm.team_id = p_team and tm.status = 'active'
     and t.is_public and t.roster_public
     and public.athlete_has_media_consent(p_org, a.id)
   order by tm.jersey_number nulls last, a.first_name;
$$;
revoke all on function public.website_public_roster(uuid, uuid) from public, anon, authenticated;
grant execute on function public.website_public_roster(uuid, uuid) to service_role;

comment on table public.website_settings is 'Website connection per club (public API, embeds, webhook). Admin only; secret lives in website_secrets.';
comment on table public.website_secrets is 'Webhook signing secret per club. Service role only (never readable by any app user).';
