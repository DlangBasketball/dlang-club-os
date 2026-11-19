-- ============================================================================
-- Media library + cover images (club hub hero, team banners, player profiles)
--
-- Additive and idempotent.
--
--   1) Cover columns (cover_path, cover_focal_x, cover_focal_y) on
--      organizations, teams and athletes. Programmes and camp editions get the
--      same three columns in the camps migration (20250420101200_); every
--      function below discovers them at runtime, so nothing here depends on
--      that migration having run.
--   2) media_assets: the club's image library (covers, banners, gallery) in
--      the PUBLIC bucket "club-media" at <org_id>/<covers|banners|gallery>/<file>.
--      Admins write; staff read. A library image used anywhere cannot be
--      deleted (media_assets_delete_guard). Using an image on a PUBLIC surface
--      (club hub, programme / camp pages) records who confirmed that the
--      people shown consented / no identifiable minors (CLAUDE.md section 8).
--   3) club-media: admins may now also write under covers/, banners/,
--      gallery/ (products/ and venues/ unchanged); limit raised to 5 MB.
--   4) athlete-covers: a PRIVATE bucket for player-profile banners at
--      <org_id>/<athlete_id>/<file>. Same access as athlete photos
--      (athlete_photo_access): admin of the org and the athlete's guardians
--      read/write; coaches who may access the athlete read; finance nothing.
--      Served through short-lived signed URLs only, never public.
--   5) set_cover(): the single write path for covers. Role check per target
--      (admin for org/team/program/camp_edition; admin or guardian for an
--      athlete), tenant check, path check, focal point clamp, consent check
--      for public surfaces, audit row. media_cover_targets() lists the
--      targets the current schema supports.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Cover columns
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['organizations', 'teams', 'athletes'] loop
    execute format('alter table public.%I add column if not exists cover_path text', t);
    execute format('alter table public.%I add column if not exists cover_focal_x smallint not null default 50', t);
    execute format('alter table public.%I add column if not exists cover_focal_y smallint not null default 50', t);
    begin
      execute format('alter table public.%I add constraint %I check (cover_focal_x between 0 and 100 and cover_focal_y between 0 and 100)',
                     t, t || '_cover_focal_chk');
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Library paths: <org_id>/<covers|banners|gallery>/<file> (no sub folders, no "..").
create or replace function public.media_is_library_path(p_org uuid, p_path text)
returns boolean
language sql
immutable
as $$
  select p_path is not null
     and p_org is not null
     and p_path ~ ('^' || p_org::text || '/(covers|banners|gallery)/[A-Za-z0-9._-]{1,120}$')
     and p_path !~ '\.\.';
$$;

-- Private athlete cover: <org_id>/<athlete_id>/<file>.
create or replace function public.media_is_athlete_cover_path(p_org uuid, p_athlete uuid, p_path text)
returns boolean
language sql
immutable
as $$
  select p_path is not null
     and p_org is not null and p_athlete is not null
     and p_path ~ ('^' || p_org::text || '/' || p_athlete::text || '/[A-Za-z0-9._-]{1,120}$')
     and p_path !~ '\.\.';
$$;

do $$ begin
  alter table public.organizations add constraint organizations_cover_path_chk
    check (cover_path is null or public.media_is_library_path(id, cover_path));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.teams add constraint teams_cover_path_chk
    check (cover_path is null or public.media_is_library_path(org_id, cover_path));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.athletes add constraint athletes_cover_path_chk
    check (cover_path is null
           or public.media_is_athlete_cover_path(org_id, id, cover_path)
           or public.media_is_library_path(org_id, cover_path));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2) media_assets
-- ---------------------------------------------------------------------------
create table if not exists public.media_assets (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references public.organizations(id) on delete cascade,
  path                     text not null,
  kind                     text not null default 'cover',
  width                    integer,
  height                   integer,
  size_bytes               integer,
  mime_type                text,
  alt_text                 text,
  consent_note             text,
  public_use_confirmed_at  timestamptz,
  public_use_confirmed_by  uuid references public.profiles(id) on delete set null,
  uploaded_by              uuid references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists media_assets_path_uniq on public.media_assets(path);
create index if not exists idx_media_assets_org on public.media_assets(org_id, created_at desc);

do $$ begin
  alter table public.media_assets add constraint media_assets_chk
    check (kind in ('cover', 'banner', 'gallery')
       and public.media_is_library_path(org_id, path)
       and (width is null or width between 1 and 10000)
       and (height is null or height between 1 and 10000)
       and (size_bytes is null or size_bytes between 1 and 5242880)
       and (mime_type is null or mime_type in ('image/jpeg', 'image/webp', 'image/png'))
       and coalesce(length(alt_text), 0) <= 300
       and coalesce(length(consent_note), 0) <= 500);
exception when duplicate_object then null; end $$;

drop trigger if exists trg_media_assets_updated on public.media_assets;
create trigger trg_media_assets_updated before update on public.media_assets
  for each row execute function public.set_updated_at();

-- Where is a library path used? Counts every cover column that exists (the
-- programmes / camp editions columns come from the camps migration).
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
  return v_total;
end $$;

-- A used library image cannot be deleted (the UI also hides the button).
create or replace function public.media_assets_delete_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.media_path_usage(old.org_id, old.path) > 0 then
    raise exception 'MEDIA_IN_USE' using errcode = 'P0001';
  end if;
  return old;
end $$;
drop trigger if exists trg_media_assets_delete_guard on public.media_assets;
create trigger trg_media_assets_delete_guard before delete on public.media_assets
  for each row execute function public.media_assets_delete_guard();

-- Usage counts for the admin library page (own org only).
create or replace function public.media_asset_usage(p_ids uuid[])
returns table (asset_id uuid, uses integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, public.media_path_usage(m.org_id, m.path)
    from public.media_assets m
   where m.id = any (coalesce(p_ids, '{}'::uuid[]))
     and m.org_id = public.current_org_id()
     and auth.uid() is not null
     and (public.is_finance() or public.has_role('coach'));
$$;

alter table public.media_assets enable row level security;

drop policy if exists media_assets_select on public.media_assets;
create policy media_assets_select on public.media_assets for select
  using (org_id = public.current_org_id() and (public.is_finance() or public.has_role('coach')));
drop policy if exists media_assets_insert on public.media_assets;
create policy media_assets_insert on public.media_assets for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists media_assets_update on public.media_assets;
create policy media_assets_update on public.media_assets for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists media_assets_delete on public.media_assets;
create policy media_assets_delete on public.media_assets for delete
  using (org_id = public.current_org_id() and public.is_admin());

do $$
begin
  execute 'drop policy if exists platform_tenant_isolation on public.media_assets';
  execute 'create policy platform_tenant_isolation on public.media_assets as restrictive for all
             using (org_id = (select public.current_org_id()))
             with check (org_id = (select public.current_org_id()))';
  if exists (select 1 from pg_proc where proname = 'suspended_org_ids' and pronamespace = 'public'::regnamespace) then
    execute 'drop policy if exists platform_suspension_guard on public.media_assets';
    execute 'create policy platform_suspension_guard on public.media_assets as restrictive for all
               using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
               with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.media_assets from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant select, insert, update, delete on public.media_assets to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant all on public.media_assets to service_role';
  end if;
end $$;

drop trigger if exists trg_audit_media_assets on public.media_assets;
create trigger trg_audit_media_assets after insert or update or delete on public.media_assets
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- 3) club-media: covers / banners / gallery folders, 5 MB
-- ---------------------------------------------------------------------------
create or replace function public.club_media_can_write(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public.is_admin()
     and split_part(coalesce(p_name, ''), '/', 1) = public.current_org_id()::text
     and split_part(coalesce(p_name, ''), '/', 2) in ('products', 'venues', 'covers', 'banners', 'gallery')
     and p_name !~ '\.\.';
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'club-media'$q$;
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) athlete-covers: private bucket, same access as athlete photos
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('athlete-covers', 'athlete-covers', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 5242880 where id = 'athlete-covers'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['image/jpeg','image/webp','image/png']
                 where id = 'athlete-covers'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists athlete_covers_select on storage.objects$p$;
    execute $p$create policy athlete_covers_select on storage.objects for select to authenticated
      using (bucket_id = 'athlete-covers' and public.athlete_photo_access(name, false))$p$;
    execute $p$drop policy if exists athlete_covers_insert on storage.objects$p$;
    execute $p$create policy athlete_covers_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'athlete-covers' and public.athlete_photo_access(name, true))$p$;
    execute $p$drop policy if exists athlete_covers_update on storage.objects$p$;
    execute $p$create policy athlete_covers_update on storage.objects for update to authenticated
      using (bucket_id = 'athlete-covers' and public.athlete_photo_access(name, true))
      with check (bucket_id = 'athlete-covers' and public.athlete_photo_access(name, true))$p$;
    execute $p$drop policy if exists athlete_covers_delete on storage.objects$p$;
    execute $p$create policy athlete_covers_delete on storage.objects for delete to authenticated
      using (bucket_id = 'athlete-covers' and public.athlete_photo_access(name, true))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) set_cover() + media_cover_targets()
-- ---------------------------------------------------------------------------
create or replace function public.media_cover_table(p_target text)
returns text
language sql
immutable
as $$
  select case p_target
    when 'org'          then 'organizations'
    when 'team'         then 'teams'
    when 'athlete'      then 'athletes'
    when 'program'      then 'programs'
    when 'camp_edition' then 'camp_editions'
  end;
$$;

-- Targets whose table has the three cover columns in this database.
create or replace function public.media_cover_targets()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(t order by t), '{}')
    from unnest(array['org', 'team', 'athlete', 'program', 'camp_edition']) t
   where (select count(*) from information_schema.columns c
           where c.table_schema = 'public'
             and c.table_name = public.media_cover_table(t)
             and c.column_name in ('cover_path', 'cover_focal_x', 'cover_focal_y')) = 3;
$$;

-- Public surfaces: images there are seen by anyone (consent confirmation required).
create or replace function public.media_cover_is_public(p_target text)
returns boolean
language sql
immutable
as $$
  select p_target in ('org', 'program', 'camp_edition');
$$;

/**
 * Set, change (focal point only) or remove the cover of one record.
 *   p_target  'org' | 'team' | 'athlete' | 'program' | 'camp_edition'
 *   p_id      the record id (for 'org' it must be the caller's org)
 *   p_path    null = remove; a library path of the caller's org (registered
 *             in media_assets); for 'athlete' also the private
 *             <org>/<athlete>/<file> key in the athlete-covers bucket
 *   p_focal_x / p_focal_y  0..100 (clamped), object-position in percent
 *   p_public_consent  must be true to put a library image on a public surface
 * Returns {previous_path, path}. Errors: NOT_AUTHORIZED, COVER_TARGET_UNSUPPORTED,
 * NOT_FOUND, INVALID_PATH, CONSENT_REQUIRED.
 */
create or replace function public.set_cover(
  p_target         text,
  p_id             uuid,
  p_path           text,
  p_focal_x        integer default 50,
  p_focal_y        integer default 50,
  p_public_consent boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_org   uuid := public.current_org_id();
  v_table text := public.media_cover_table(p_target);
  v_prev  text;
  v_found boolean;
  v_x     integer := least(100, greatest(0, coalesce(p_focal_x, 50)));
  v_y     integer := least(100, greatest(0, coalesce(p_focal_y, 50)));
  v_path  text := nullif(btrim(coalesce(p_path, '')), '');
begin
  if v_uid is null or v_org is null or v_table is null or p_id is null then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if not (p_target = any (public.media_cover_targets())) then
    raise exception 'COVER_TARGET_UNSUPPORTED' using errcode = 'P0001';
  end if;

  -- Role per target.
  if p_target = 'athlete' then
    if not (public.is_admin() or public.is_guardian_of_athlete(p_id)) then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
  elsif not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- The record must belong to the caller's org.
  if p_target = 'org' then
    if p_id is distinct from v_org then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
    select true, cover_path into v_found, v_prev from public.organizations where id = v_org;
  else
    execute format('select true, cover_path from public.%I where id = $1 and org_id = $2', v_table)
      into v_found, v_prev using p_id, v_org;
  end if;
  if not coalesce(v_found, false) then
    raise exception 'NOT_FOUND' using errcode = 'P0001';
  end if;

  -- The path must be the club's library image, or this athlete's private cover.
  if v_path is not null then
    if p_target = 'athlete' and public.media_is_athlete_cover_path(v_org, p_id, v_path) then
      null;
    elsif public.media_is_library_path(v_org, v_path)
          and exists (select 1 from public.media_assets m where m.org_id = v_org and m.path = v_path) then
      if public.media_cover_is_public(p_target) and v_path is distinct from v_prev then
        if not coalesce(p_public_consent, false) then
          raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
        end if;
        update public.media_assets
           set public_use_confirmed_at = now(), public_use_confirmed_by = v_uid
         where org_id = v_org and path = v_path;
      end if;
    else
      raise exception 'INVALID_PATH' using errcode = 'P0001';
    end if;
  end if;

  if p_target = 'org' then
    update public.organizations
       set cover_path = v_path, cover_focal_x = v_x, cover_focal_y = v_y
     where id = v_org;
  else
    execute format('update public.%I set cover_path = $1, cover_focal_x = $2, cover_focal_y = $3
                     where id = $4 and org_id = $5', v_table)
      using v_path, v_x, v_y, p_id, v_org;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, v_uid,
          case when v_path is null then 'cover.remove'
               when v_path is not distinct from v_prev then 'cover.focal'
               else 'cover.set' end,
          v_table, p_id,
          jsonb_build_object('cover_path', v_prev),
          jsonb_build_object('cover_path', v_path, 'focal_x', v_x, 'focal_y', v_y,
                             'public_consent', coalesce(p_public_consent, false)));

  return jsonb_build_object('previous_path', v_prev, 'path', v_path);
end $$;

-- Grants
do $$
declare f text;
begin
  foreach f in array array[
    'public.set_cover(text, uuid, text, integer, integer, boolean)',
    'public.media_cover_targets()',
    'public.media_asset_usage(uuid[])',
    'public.club_media_can_write(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  -- internal helpers
  foreach f in array array[
    'public.media_path_usage(uuid, text)',
    'public.media_assets_delete_guard()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;
