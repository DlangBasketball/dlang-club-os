-- ============================================================================
-- Supabase compatibility stub for PLAIN PostgreSQL (CI / local test DBs).
--
-- Supabase provides these objects out of the box; vanilla Postgres does not.
-- This file recreates the minimum the migrations, seeds and SQL test suites
-- rely on, with the same semantics where it matters for RLS:
--   * roles anon / authenticated / service_role (+ authenticator)
--   * auth schema: auth.users, auth.uid(), auth.role(), auth.jwt(), auth.email()
--     — identity is read from the GUC `request.jwt.claim.sub` (legacy, what our
--       suites set) or `request.jwt.claims` (JSON, what PostgREST sets today)
--   * storage schema: storage.buckets, storage.objects (RLS on), storage.foldername()
--   * Supabase's default privileges on schema public
--
-- NEVER run this against a real Supabase project — it is for throwaway DBs only.
-- If a new migration needs another Supabase-only object, extend THIS file;
-- do not change the migration.
-- ============================================================================
\set ON_ERROR_STOP on

-- ---- Roles (cluster-wide, so guard against re-creation) --------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator nologin noinherit;
  end if;
  -- As on Supabase, the service role bypasses RLS (roles may pre-exist).
  alter role service_role bypassrls;
  -- authenticator can switch to the API roles. (The test runner connects as a
  -- superuser, which may `set role` to any of them without a grant.)
  if not pg_has_role('authenticator', 'anon', 'member') then
    grant anon, authenticated, service_role to authenticator;
  end if;
end $$;

-- ---- Extensions schema (Supabase installs extensions here) ---------------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---- auth schema -----------------------------------------------------------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id              uuid,
  id                       uuid primary key,
  aud                      varchar(255),
  role                     varchar(255),
  email                    varchar(255),
  encrypted_password       varchar(255),
  email_confirmed_at       timestamptz,
  invited_at               timestamptz,
  confirmation_token       varchar(255),
  confirmation_sent_at     timestamptz,
  recovery_token           varchar(255),
  recovery_sent_at         timestamptz,
  email_change_token_new   varchar(255),
  email_change             varchar(255),
  email_change_sent_at     timestamptz,
  last_sign_in_at          timestamptz,
  raw_app_meta_data        jsonb,
  raw_user_meta_data       jsonb,
  is_super_admin           boolean,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  phone                    text,
  phone_confirmed_at       timestamptz,
  banned_until             timestamptz,
  deleted_at               timestamptz,
  is_anonymous             boolean not null default false
);
grant select on auth.users to service_role;

-- JWT claims as JSON: prefer `request.jwt.claims`, fall back to the legacy
-- per-claim GUCs (`request.jwt.claim.sub`, `request.jwt.claim.role`, ...).
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_strip_nulls(jsonb_build_object(
      'sub',   nullif(current_setting('request.jwt.claim.sub', true), ''),
      'role',  nullif(current_setting('request.jwt.claim.role', true), ''),
      'email', nullif(current_setting('request.jwt.claim.email', true), '')
    ))
  )
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
  )
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- ---- storage schema --------------------------------------------------------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
  id          text primary key,
  name        text not null unique,
  owner       uuid,
  public      boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
create or replace function storage.filename(name text) returns text
language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)]
$$;

-- ---- Supabase default privileges on public ---------------------------------
-- Supabase grants table/function/sequence privileges to the API roles by
-- default and relies on RLS for row access. Mirror that so RLS — not missing
-- grants — is what the suites exercise.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
