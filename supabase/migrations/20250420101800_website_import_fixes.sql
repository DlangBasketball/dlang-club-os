-- ============================================================================
-- Website importer fixes + automatic team slugs
--
-- 1. teams.slug_auto            true while the slug is generated from the
--                               team name; an admin editing the slug sets it
--                               false (the trigger does this on any explicit
--                               slug change). Existing non-null slugs are
--                               kept and marked manual.
-- 2. public.slugify_text()      lowercase, accents stripped, '/' and every
--                               other non-alphanumeric -> '-', trimmed,
--                               max 64 chars (same rule as src/lib/slug.ts).
-- 3. public.team_unique_slug()  unique per org: base, base-2, base-3 …
-- 4. trg_teams_slug             BEFORE INSERT / UPDATE on teams:
--                                 * empty slug            -> generated, auto
--                                 * explicit slug change  -> kept, manual
--                                 * rename + auto slug    -> regenerated
--                                 * slug_auto set to true -> regenerated
-- 5. Backfill                   teams with a null slug get one.
-- 6. website_import_map.skipped source rows the admin deselected in the
--                               import preview (or deleted / archived in the
--                               app): remembered so they stay deselected.
--                               target_id becomes optional for skipped rows.
--
-- Additive and idempotent. RLS on teams / website_import_map is unchanged
-- (tests: tests/db/website_import_fixes.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) teams.slug_auto (existing slugs were set by hand -> manual)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'teams' and column_name = 'slug_auto') then
    alter table public.teams add column slug_auto boolean not null default true;
    update public.teams set slug_auto = false where slug is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) slugify_text
-- ---------------------------------------------------------------------------
create or replace function public.slugify_text(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(left(
           btrim(
             regexp_replace(
               lower(translate(
                 replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(p, ''),
                   'ß', 'ss'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'ø', 'o'), 'Ø', 'O'), 'ł', 'l'), 'Ł', 'L'),
                 'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľŀñńņňòóôõöōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵýÿŷźżžÀÁÂÃÄÅĀĂĄÇĆĈĊČĎĐÈÉÊËĒĔĖĘĚĜĞĠĢĤĦÌÍÎÏĨĪĬĮĴĶĹĻĽĿÑŃŅŇÒÓÔÕÖŌŎŐŔŖŘŚŜŞŠŢŤŦÙÚÛÜŨŪŬŮŰŲŴÝŸŶŹŻŽ',
                 'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijkllllnnnnoooooooorrrsssstttuuuuuuuuuuwyyyzzzaaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiijkllllnnnnoooooooorrrsssstttuuuuuuuuuuwyyyzzz')),
               '[^a-z0-9]+', '-', 'g'),
             '-'),
           64), '-');
$$;

-- ---------------------------------------------------------------------------
-- 3) team_unique_slug: base (trimmed to leave room for a suffix), then -2, -3 …
--    Internal helper for the trigger: not callable by app users.
-- ---------------------------------------------------------------------------
create or replace function public.team_unique_slug(p_org uuid, p_name text, p_self uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_base text := btrim(left(public.slugify_text(p_name), 56), '-');
  v_try  text;
  n      int := 1;
begin
  if v_base is null or v_base = '' then v_base := 'team'; end if;
  v_try := v_base;
  while exists (select 1 from public.teams t
                 where t.org_id = p_org and t.slug = v_try
                   and t.id is distinct from p_self) loop
    n := n + 1;
    v_try := v_base || '-' || n;
  end loop;
  return v_try;
end $$;
revoke all on function public.team_unique_slug(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.team_unique_slug(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Trigger. security definer only so the uniqueness check sees every team
--    of the row's own org (never another org: it filters on new.org_id).
-- ---------------------------------------------------------------------------
create or replace function public.teams_auto_slug()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.slug, '')), '') is null then
      new.slug := public.team_unique_slug(new.org_id, new.name, new.id);
      new.slug_auto := true;
    else
      new.slug_auto := false; -- a slug chosen by the caller is manual
    end if;
    return new;
  end if;

  -- UPDATE
  if nullif(btrim(coalesce(new.slug, '')), '') is null then
    -- cleared (or never set): back to automatic
    new.slug := public.team_unique_slug(new.org_id, new.name, new.id);
    new.slug_auto := true;
  elsif new.slug is distinct from old.slug then
    new.slug_auto := false; -- edited by hand
  elsif new.slug_auto and not old.slug_auto then
    new.slug := public.team_unique_slug(new.org_id, new.name, new.id); -- reset to automatic
  elsif new.slug_auto and (new.name is distinct from old.name or new.org_id is distinct from old.org_id) then
    new.slug := public.team_unique_slug(new.org_id, new.name, new.id);
  end if;
  return new;
end $$;
revoke all on function public.teams_auto_slug() from public, anon, authenticated;

drop trigger if exists trg_teams_slug on public.teams;
create trigger trg_teams_slug before insert or update on public.teams
  for each row execute function public.teams_auto_slug();

-- ---------------------------------------------------------------------------
-- 5) Backfill (the trigger generates the slug for every touched row)
-- ---------------------------------------------------------------------------
update public.teams set slug = null where slug is null;

-- ---------------------------------------------------------------------------
-- 6) website_import_map.skipped
-- ---------------------------------------------------------------------------
alter table public.website_import_map add column if not exists skipped boolean not null default false;
alter table public.website_import_map alter column target_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'website_import_map_target_chk') then
    alter table public.website_import_map add constraint website_import_map_target_chk
      check (skipped or target_id is not null);
  end if;
end $$;

comment on column public.teams.slug_auto is 'true: slug follows the team name (trigger trg_teams_slug); false: set by an admin.';
comment on column public.website_import_map.skipped is 'Source row deselected by the admin (or its imported row removed): not imported again until re-selected.';
