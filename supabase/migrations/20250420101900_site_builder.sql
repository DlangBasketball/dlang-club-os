-- ============================================================================
-- Club OS — Built-in club website ("Site"): pages, news, redirects, forms.
--
-- A club can run its whole public website inside the app: block-based pages
-- served on the club's own host at clean paths (the same paths as its old
-- website, so links and search rankings survive), with live blocks that read
-- app data (camps, programmes, schedule, shop, ...) through the public data
-- layer. White-label: nothing here is specific to one club.
--
-- Additive and idempotent. Every new table carries org_id, an org index (or
-- org_id primary key), RLS with a policy per verb, created_at / updated_at.
--
-- 1. site_settings          per club: enabled, template, nav / footer, social,
--                           logo / favicon (library paths), fonts + palette
--                           overrides, languages, SEO defaults, consent-gated
--                           analytics, contact email. Admin only.
-- 2. site_pages             path unique per club (reserved app paths refused),
--                           tree (parent, position), status draft / published /
--                           scheduled, working copy (content) and the
--                           published snapshot (published_content). Admin only;
--                           the public reads published pages through
--                           site_public_* RPCs (never the working copy).
-- 3. site_page_versions     history snapshots (restore). Admin only, no update.
-- 4. site_posts             news / blog: slug, cover, author name, tags,
--                           translations. Admin only (+ public RPCs).
-- 5. site_redirects         from path -> internal path or https URL, 301/302.
-- 6. site_form_submissions  contact / join / coach + athlete application.
--                           anon + members may INSERT only (site enabled,
--                           rate limited per hashed IP and per club); admins
--                           read / handle / delete. Audit-logged (personal data).
-- 7. site_import_map        idempotent importer map (WordPress page / post /
--                           media -> site row). Admin only.
-- 8. media_path_usage()     now also counts images used by the site, so a
--                           library image on a page cannot be deleted.
-- 9. Public RPCs            site_public_settings / page / pages / posts / post /
--                           redirect: published content of an ENABLED site of
--                           exactly the given club, nothing else.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------
-- Site languages: any BCP 47 language tag (language [-Script] [-REGION]),
-- canonical case, e.g. en, fr, de-CH, pt-BR, zh-Hant, ar (mirrors
-- isLanguageTag() in src/lib/site/languages.ts). Not limited to the app's
-- own UI catalogs: a club may publish its site in any language.
create or replace function public.site_language_tag_valid(p text)
returns boolean language sql immutable set search_path = public as $$
  select p is not null and length(p) <= 20
     and p ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$';
$$;

create or replace function public.site_languages_valid(p text[])
returns boolean language sql immutable set search_path = public as $$
  select coalesce(cardinality(p), 0) between 1 and 20
     and not exists (select 1 from unnest(p) l where not public.site_language_tag_valid(l))
     and (select count(distinct lower(l)) from unnest(p) l) = cardinality(p);
$$;

-- Paths the app itself serves always win over site pages (mirrors
-- RESERVED_SEGMENTS in src/lib/site/paths.ts; the routing test proves every
-- top-level app route is listed). Language prefixes (/fr/, /de-ch/) are
-- checked per club against its enabled languages (site_pages_lang_guard).
create or replace function public.site_path_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select split_part(ltrim(coalesce(p, ''), '/'), '/', 1) in (
    'admin', 'coach', 'parent', 'platform', 'login', 'auth', 'register', 'book', 'shop', 'club', 'embed',
    'embed.js', 'api', 'board', 'scout', 'waitlist', 'onboarding', 'signup', 'legal', 'offline', 'pwa',
    'sw.js', 'manifest.webmanifest', '_next', 'favicon.ico', 'sitemap.xml', 'robots.txt', 'icon',
    'apple-icon', 'opengraph-image', 'monitoring');
$$;

-- "/" or 1-4 lower-case segments of [a-z0-9_%-] (percent-encoded slugs of an
-- imported website keep their exact URL).
create or replace function public.site_path_valid(p text)
returns boolean language sql immutable set search_path = public as $$
  select p is not null
     and length(p) <= 300
     and (p = '/' or (p ~ '^(/[a-z0-9][a-z0-9_%-]{0,119}){1,4}$' and not public.site_path_reserved(p)));
$$;

-- Library image path of this club (or null).
create or replace function public.site_media_ok(p_org uuid, p_path text)
returns boolean language sql immutable set search_path = public as $$
  select p_path is null or public.media_is_library_path(p_org, p_path);
$$;

-- ---------------------------------------------------------------------------
-- 1) site_settings
-- ---------------------------------------------------------------------------
create table if not exists public.site_settings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  enabled           boolean not null default false,
  template          text not null default 'arena' check (template in ('arena', 'court', 'classic')),
  home_page_id      uuid,
  header_nav        jsonb not null default '[]'::jsonb check (jsonb_typeof(header_nav) = 'array' and jsonb_array_length(header_nav) <= 12),
  footer_columns    jsonb not null default '[]'::jsonb check (jsonb_typeof(footer_columns) = 'array' and jsonb_array_length(footer_columns) <= 6),
  social_links      jsonb not null default '{}'::jsonb check (jsonb_typeof(social_links) = 'object'),
  logo_path         text,
  favicon_path      text,
  fonts             jsonb not null default '{}'::jsonb check (jsonb_typeof(fonts) = 'object'),
  palette           jsonb not null default '{}'::jsonb check (jsonb_typeof(palette) = 'object'),
  default_language  text not null default 'en' check (public.site_language_tag_valid(default_language)),
  languages         text[] not null default '{en}',
  seo               jsonb not null default '{}'::jsonb check (jsonb_typeof(seo) = 'object'),
  analytics         jsonb not null default '{}'::jsonb check (jsonb_typeof(analytics) = 'object'),
  contact_email     text check (contact_email is null or (length(contact_email) <= 254 and contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  launched_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint site_settings_languages_chk check (public.site_languages_valid(languages) and default_language = any (languages)),
  constraint site_settings_media_chk check (public.site_media_ok(org_id, logo_path) and public.site_media_ok(org_id, favicon_path))
);
drop trigger if exists trg_site_settings_updated on public.site_settings;
create trigger trg_site_settings_updated before update on public.site_settings
  for each row execute function public.set_updated_at();

-- Is the club's site switched on? (security definer: usable from anon policies)
create or replace function public.site_is_live(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.site_settings s where s.org_id = p_org and s.enabled);
$$;

-- ---------------------------------------------------------------------------
-- 2) site_pages
-- ---------------------------------------------------------------------------
create table if not exists public.site_pages (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  path               text not null,
  parent_id          uuid references public.site_pages(id) on delete set null,
  position           integer not null default 0 check (position between 0 and 100000),
  status             text not null default 'draft' check (status in ('draft', 'published', 'scheduled')),
  published_at       timestamptz,
  template           text not null default 'default' check (template in ('default', 'landing', 'narrow')),
  show_in_nav        boolean not null default false,
  content            jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  published_content  jsonb check (published_content is null or jsonb_typeof(published_content) = 'object'),
  created_by         uuid references public.profiles(id) on delete set null,
  updated_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint site_pages_path_chk check (public.site_path_valid(path)),
  constraint site_pages_parent_chk check (parent_id is null or parent_id <> id),
  constraint site_pages_size_chk check (pg_column_size(content) <= 1000000 and coalesce(pg_column_size(published_content), 0) <= 1000000),
  constraint site_pages_publish_chk check (status = 'draft' or (published_at is not null and published_content is not null)),
  unique (org_id, path)
);
create index if not exists idx_site_pages_org on public.site_pages(org_id, parent_id, position);
drop trigger if exists trg_site_pages_updated on public.site_pages;
create trigger trg_site_pages_updated before update on public.site_pages
  for each row execute function public.set_updated_at();

-- Parent and home page must belong to the same club.
create or replace function public.site_pages_same_org_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null
     and not exists (select 1 from public.site_pages p where p.id = new.parent_id and p.org_id = new.org_id) then
    raise exception 'SITE_PARENT_OTHER_ORG' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_pages_same_org on public.site_pages;
create trigger trg_site_pages_same_org before insert or update on public.site_pages
  for each row execute function public.site_pages_same_org_guard();

-- A page path must not start with one of the club's language prefixes
-- (/fr/... is the French version of every page), and a language cannot be
-- enabled while a page path starts with it.
create or replace function public.site_pages_lang_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.site_settings s, unnest(s.languages) l
              where s.org_id = new.org_id and lower(l) = split_part(ltrim(new.path, '/'), '/', 1)) then
    raise exception 'SITE_PATH_IS_LANGUAGE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_pages_lang on public.site_pages;
create trigger trg_site_pages_lang before insert or update of path on public.site_pages
  for each row execute function public.site_pages_lang_guard();

create or replace function public.site_settings_lang_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.site_pages p, unnest(new.languages) l
              where p.org_id = new.org_id and lower(l) = split_part(ltrim(p.path, '/'), '/', 1)) then
    raise exception 'SITE_PATH_IS_LANGUAGE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_settings_lang on public.site_settings;
create trigger trg_site_settings_lang before insert or update of languages on public.site_settings
  for each row execute function public.site_settings_lang_guard();

do $$ begin
  alter table public.site_settings add constraint site_settings_home_fk
    foreign key (home_page_id) references public.site_pages(id) on delete set null;
exception when duplicate_object then null; end $$;

create or replace function public.site_settings_home_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.home_page_id is not null
     and not exists (select 1 from public.site_pages p where p.id = new.home_page_id and p.org_id = new.org_id) then
    raise exception 'SITE_HOME_OTHER_ORG' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_settings_home on public.site_settings;
create trigger trg_site_settings_home before insert or update on public.site_settings
  for each row execute function public.site_settings_home_guard();

-- ---------------------------------------------------------------------------
-- 3) site_page_versions
-- ---------------------------------------------------------------------------
create table if not exists public.site_page_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  page_id     uuid not null references public.site_pages(id) on delete cascade,
  content     jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 1000000),
  note        text check (note is null or length(note) <= 120),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_site_page_versions_org on public.site_page_versions(org_id, page_id, created_at desc);

create or replace function public.site_versions_same_org_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.site_pages p where p.id = new.page_id and p.org_id = new.org_id) then
    raise exception 'SITE_PAGE_OTHER_ORG' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_page_versions_same_org on public.site_page_versions;
create trigger trg_site_page_versions_same_org before insert on public.site_page_versions
  for each row execute function public.site_versions_same_org_guard();

-- ---------------------------------------------------------------------------
-- 4) site_posts
-- ---------------------------------------------------------------------------
create table if not exists public.site_posts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  slug          text not null check (slug ~ '^[a-z0-9][a-z0-9_%-]{0,159}$'),
  status        text not null default 'draft' check (status in ('draft', 'published', 'scheduled')),
  published_at  timestamptz,
  cover_path    text,
  cover_focal_x smallint not null default 50 check (cover_focal_x between 0 and 100),
  cover_focal_y smallint not null default 50 check (cover_focal_y between 0 and 100),
  author_name   text check (author_name is null or length(author_name) <= 120),
  tags          text[] not null default '{}' check (cardinality(tags) <= 12),
  content       jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 500000),
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint site_posts_cover_chk check (public.site_media_ok(org_id, cover_path)),
  constraint site_posts_publish_chk check (status = 'draft' or published_at is not null),
  unique (org_id, slug)
);
create index if not exists idx_site_posts_org on public.site_posts(org_id, published_at desc);
drop trigger if exists trg_site_posts_updated on public.site_posts;
create trigger trg_site_posts_updated before update on public.site_posts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) site_redirects
-- ---------------------------------------------------------------------------
create table if not exists public.site_redirects (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  from_path    text not null check (from_path ~ '^(/[^/\s?#]{1,160}){1,6}$' and length(from_path) <= 400 and not public.site_path_reserved(from_path)),
  to_path      text not null check (length(to_path) <= 500 and (to_path ~ '^/[^\s]*$' or to_path ~* '^https://[^\s/?#]+') and to_path !~ '^//'),
  status_code  smallint not null default 301 check (status_code in (301, 302)),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint site_redirects_loop_chk check (from_path <> to_path),
  unique (org_id, from_path)
);
create index if not exists idx_site_redirects_org on public.site_redirects(org_id);
drop trigger if exists trg_site_redirects_updated on public.site_redirects;
create trigger trg_site_redirects_updated before update on public.site_redirects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) site_form_submissions
-- ---------------------------------------------------------------------------
create table if not exists public.site_form_submissions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        text not null check (kind in ('contact', 'join', 'coach_application', 'athlete_application')),
  name        text not null check (length(btrim(name)) between 1 and 120),
  email       text not null check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text check (phone is null or length(phone) <= 40),
  message     text not null check (length(btrim(message)) between 1 and 3000),
  locale      text check (locale is null or public.site_language_tag_valid(locale)),
  page_path   text check (page_path is null or length(page_path) <= 300),
  consent     boolean not null check (consent),
  ip_hash     text check (ip_hash is null or length(ip_hash) <= 128),
  lead_id     uuid references public.contact_leads(id) on delete set null,
  status      text not null default 'new' check (status in ('new', 'handled', 'spam')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_site_form_submissions_org on public.site_form_submissions(org_id, created_at desc);
create index if not exists idx_site_form_submissions_ip on public.site_form_submissions(org_id, ip_hash, created_at desc);
drop trigger if exists trg_site_form_submissions_updated on public.site_form_submissions;
create trigger trg_site_form_submissions_updated before update on public.site_form_submissions
  for each row execute function public.set_updated_at();

-- Rate limits (mirrored in src/lib/site/forms.ts).
create or replace function public.site_form_limits()
returns jsonb language sql immutable as $$
  select jsonb_build_object('per_ip_10min', 5, 'per_ip_day', 20, 'per_org_hour', 200);
$$;

create or replace function public.site_form_rate_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_limits jsonb := public.site_form_limits();
begin
  if new.ip_hash is not null then
    if (select count(*) from public.site_form_submissions
         where org_id = new.org_id and ip_hash = new.ip_hash and created_at > now() - interval '10 minutes')
         >= (v_limits->>'per_ip_10min')::int
       or (select count(*) from public.site_form_submissions
         where org_id = new.org_id and ip_hash = new.ip_hash and created_at > now() - interval '1 day')
         >= (v_limits->>'per_ip_day')::int then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.site_form_submissions where org_id = new.org_id and created_at > now() - interval '1 hour')
       >= (v_limits->>'per_org_hour')::int then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_site_form_rate on public.site_form_submissions;
create trigger trg_site_form_rate before insert on public.site_form_submissions
  for each row execute function public.site_form_rate_guard();

drop trigger if exists trg_audit_site_form_submissions on public.site_form_submissions;
create trigger trg_audit_site_form_submissions after insert or update or delete on public.site_form_submissions
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 7) site_import_map
-- ---------------------------------------------------------------------------
create table if not exists public.site_import_map (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  source           text not null check (source in ('wp_page', 'wp_post', 'wp_media')),
  source_id        text not null check (length(source_id) between 1 and 128),
  source_url       text check (source_url is null or length(source_url) <= 1000),
  target_table     text not null check (target_table in ('site_pages', 'site_posts', 'media_assets')),
  target_id        uuid not null,
  last_imported_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, source, source_id)
);
create index if not exists idx_site_import_map_org on public.site_import_map(org_id);
drop trigger if exists trg_site_import_map_updated on public.site_import_map;
create trigger trg_site_import_map_updated before update on public.site_import_map
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.site_settings enable row level security;
alter table public.site_settings force row level security;
alter table public.site_pages enable row level security;
alter table public.site_pages force row level security;
alter table public.site_page_versions enable row level security;
alter table public.site_page_versions force row level security;
alter table public.site_posts enable row level security;
alter table public.site_posts force row level security;
alter table public.site_redirects enable row level security;
alter table public.site_redirects force row level security;
alter table public.site_form_submissions enable row level security;
alter table public.site_form_submissions force row level security;
alter table public.site_import_map enable row level security;
alter table public.site_import_map force row level security;

-- Admin of the org: every verb.
do $$
declare t text;
begin
  foreach t in array array['site_settings', 'site_pages', 'site_posts', 'site_redirects', 'site_import_map'] loop
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

-- Versions: history is append-only (no update).
drop policy if exists site_page_versions_select on public.site_page_versions;
create policy site_page_versions_select on public.site_page_versions for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists site_page_versions_insert on public.site_page_versions;
create policy site_page_versions_insert on public.site_page_versions for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists site_page_versions_update on public.site_page_versions;
create policy site_page_versions_update on public.site_page_versions for update using (false) with check (false);
drop policy if exists site_page_versions_delete on public.site_page_versions;
create policy site_page_versions_delete on public.site_page_versions for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Form submissions: anyone may submit to a club whose site is enabled (new,
-- unlinked rows only); admins of the club read, handle and delete.
drop policy if exists site_form_submissions_select on public.site_form_submissions;
create policy site_form_submissions_select on public.site_form_submissions for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists site_form_submissions_insert on public.site_form_submissions;
create policy site_form_submissions_insert on public.site_form_submissions for insert
  with check (status = 'new' and lead_id is null and public.site_is_live(org_id));
drop policy if exists site_form_submissions_update on public.site_form_submissions;
create policy site_form_submissions_update on public.site_form_submissions for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists site_form_submissions_delete on public.site_form_submissions;
create policy site_form_submissions_delete on public.site_form_submissions for delete
  using (org_id = public.current_org_id() and public.is_admin());

revoke all on public.site_settings, public.site_pages, public.site_page_versions, public.site_posts,
  public.site_redirects, public.site_import_map, public.site_form_submissions from anon;
grant insert on public.site_form_submissions to anon;
grant select, insert, update, delete on public.site_settings, public.site_pages, public.site_page_versions,
  public.site_posts, public.site_redirects, public.site_import_map, public.site_form_submissions to authenticated;
grant all on public.site_settings, public.site_pages, public.site_page_versions, public.site_posts,
  public.site_redirects, public.site_import_map, public.site_form_submissions to service_role;

-- ---------------------------------------------------------------------------
-- 8) Library images used by the site cannot be deleted
-- ---------------------------------------------------------------------------
create or replace function public.media_path_usage(p_org uuid, p_path text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_n     integer;
  t       text;
begin
  if p_path is null or p_org is null then return 0; end if;
  select count(*) into v_n from public.organizations where id = p_org and cover_path = p_path;
  v_total := v_total + v_n;
  foreach t in array array['teams', 'athletes', 'programs', 'camp_editions'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t and column_name = 'cover_path')
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'org_id') then
      execute format('select count(*) from public.%I where org_id = $1 and cover_path = $2', t)
        into v_n using p_org, p_path;
      v_total := v_total + v_n;
    end if;
  end loop;
  -- Site: logo / favicon, page blocks (working copy or published), post covers / bodies.
  if to_regclass('public.site_settings') is not null then
    select count(*) into v_n from public.site_settings
     where org_id = p_org and (logo_path = p_path or favicon_path = p_path or strpos(seo::text, p_path) > 0);
    v_total := v_total + v_n;
    select count(*) into v_n from public.site_pages
     where org_id = p_org and (strpos(content::text, p_path) > 0 or strpos(coalesce(published_content::text, ''), p_path) > 0);
    v_total := v_total + v_n;
    select count(*) into v_n from public.site_posts
     where org_id = p_org and (cover_path = p_path or strpos(content::text, p_path) > 0);
    v_total := v_total + v_n;
  end if;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 9) Public RPCs (published content of an enabled site, one club only)
-- ---------------------------------------------------------------------------

-- Public settings (no internal fields).
create or replace function public.site_public_settings(p_org uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'template', s.template, 'home_page_id', s.home_page_id, 'header_nav', s.header_nav,
           'footer_columns', s.footer_columns, 'social_links', s.social_links, 'logo_path', s.logo_path,
           'favicon_path', s.favicon_path, 'fonts', s.fonts, 'palette', s.palette,
           'default_language', s.default_language, 'languages', to_jsonb(s.languages), 'seo', s.seo,
           'analytics', s.analytics, 'contact_email', s.contact_email, 'updated_at', s.updated_at)
    from public.site_settings s
   where s.org_id = p_org and s.enabled;
$$;

-- One published page by path ("/" = the home page).
create or replace function public.site_public_page(p_org uuid, p_path text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'path', p.path, 'parent_id', p.parent_id, 'template', p.template,
                            'published_at', p.published_at, 'updated_at', p.updated_at, 'content', p.published_content)
    from public.site_pages p
    join public.site_settings s on s.org_id = p.org_id and s.enabled
   where p.org_id = p_org
     and p.status in ('published', 'scheduled') and p.published_at <= now() and p.published_content is not null
     and (case when p_path = '/' and s.home_page_id is not null then p.id = s.home_page_id else p.path = p_path end)
   limit 1;
$$;

-- Published page list (navigation, sitemap): titles per language only.
create or replace function public.site_public_pages(p_org uuid)
returns table (id uuid, path text, parent_id uuid, "position" integer, show_in_nav boolean, titles jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.path, p.parent_id, p.position, p.show_in_nav,
         coalesce((select jsonb_object_agg(k, v->'title') from jsonb_each(p.published_content) as e(k, v)
                    where jsonb_typeof(v) = 'object'), '{}'::jsonb),
         p.updated_at
    from public.site_pages p
   where p.org_id = p_org and public.site_is_live(p_org)
     and p.status in ('published', 'scheduled') and p.published_at <= now() and p.published_content is not null
   order by p.position, p.path;
$$;

create or replace function public.site_public_posts(p_org uuid, p_limit integer default 12, p_offset integer default 0, p_tag text default null)
returns table (id uuid, slug text, published_at timestamptz, updated_at timestamptz, cover_path text, cover_focal_x smallint,
               cover_focal_y smallint, author_name text, tags text[], content jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.slug, p.published_at, p.updated_at, p.cover_path, p.cover_focal_x, p.cover_focal_y, p.author_name, p.tags, p.content
    from public.site_posts p
   where p.org_id = p_org and public.site_is_live(p_org)
     and p.status in ('published', 'scheduled') and p.published_at <= now()
     and (p_tag is null or p_tag = any (p.tags))
   order by p.published_at desc
   limit least(greatest(coalesce(p_limit, 12), 1), 500) offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.site_public_post(p_org uuid, p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select p.id, p.slug, p.published_at, p.updated_at, p.cover_path, p.cover_focal_x, p.cover_focal_y, p.author_name, p.tags, p.content
      from public.site_posts p
     where p.org_id = p_org and p.slug = p_slug and public.site_is_live(p_org)
       and p.status in ('published', 'scheduled') and p.published_at <= now()
     limit 1) x;
$$;

create or replace function public.site_public_redirect(p_org uuid, p_path text)
returns table (to_path text, status_code smallint)
language sql stable security definer set search_path = public as $$
  select r.to_path, r.status_code
    from public.site_redirects r
   where r.org_id = p_org and public.site_is_live(p_org) and (r.from_path = p_path or r.from_path = rtrim(p_path, '/'))
   limit 1;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.site_is_live(uuid)', 'public.site_public_settings(uuid)', 'public.site_public_page(uuid, text)',
    'public.site_public_pages(uuid)', 'public.site_public_posts(uuid, integer, integer, text)',
    'public.site_public_post(uuid, text)', 'public.site_public_redirect(uuid, text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
