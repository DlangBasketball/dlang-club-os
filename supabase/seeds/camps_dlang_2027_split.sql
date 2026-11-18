-- ============================================================================
-- Data script (NOT a test seed — testing/seed_plan.conf skips it;
-- tests/db/camps_seasons_basket.sql runs it explicitly, twice).
--
-- Splits the DLang 2027 camp ("Skills & Technical Development Camp", slug
-- dlang-skills-technical-camp-2027, from camps_dlang_2027.sql) into one camp
-- per season, each with its own public page:
--
--   Spring Camp 2027  dlang-spring-camp-2027  5–9 Apr Lausanne
--   Summer Camp 2027  dlang-summer-camp-2027  12–16 Jul Lausanne, 19–23 Jul Zurich, 2–6 Aug Zurich
--   Fall Camp 2027    dlang-fall-camp-2027    4–8 Oct Lausanne
--
-- Every camp gets the same price options (2–5 days, with / without lunch),
-- age groups (8–12 morning, 12–17 afternoon), time slots, description, cover
-- and registration form. Existing registrations move with their week. The
-- original programme becomes the Summer camp (it keeps its id) and its old
-- slug redirects there (program_slug_redirects).
--
-- Runs only when the organisation with slug 'dlang' exists. Idempotent: a
-- second run finds the split done and only re-asserts names / slugs.
-- Requires migration 20250420101200_camp_seasons_basket.sql.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seeds/camps_dlang_2027_split.sql
-- ============================================================================
do $$
declare
  c_old_slug constant text := 'dlang-skills-technical-camp-2027';
  v_org     uuid;
  v_orig    uuid;
  v_res     jsonb;
  v_created jsonb;
  v_target  record;
  v_id      uuid;
  n_seasons int;
begin
  select id into v_org from public.organizations where slug = 'dlang';
  if v_org is null then
    raise notice 'camps_dlang_2027_split: no organisation with slug dlang — nothing to do';
    return;
  end if;

  -- 1) Split (only while the original camp still holds several seasons) -----
  select id into v_orig from public.programs where org_id = v_org and slug = c_old_slug and kind = 'camp';
  if v_orig is null then
    select program_id into v_orig from public.program_slug_redirects where org_id = v_org and old_slug = c_old_slug;
  end if;
  if v_orig is null then
    raise notice 'camps_dlang_2027_split: camp % not found — run camps_dlang_2027.sql first', c_old_slug;
    return;
  end if;

  select count(distinct (public.camp_season_of(starts_on), public.camp_season_year_of(starts_on))) into n_seasons
    from public.camp_editions where program_id = v_orig;
  if n_seasons >= 2 then
    v_res := public.camp_split_by_season_core(v_org, v_orig,
      jsonb_build_object('spring-2027', 'Spring Camp 2027', 'summer-2027', 'Summer Camp 2027', 'fall-2027', 'Fall Camp 2027'),
      null);
    raise notice 'camps_dlang_2027_split: split done %', v_res;
  else
    raise notice 'camps_dlang_2027_split: already split (% season)', n_seasons;
  end if;

  -- 2) Names, seasons and stable public slugs --------------------------------
  for v_target in
    select * from (values
      ('spring', 'Spring Camp 2027', 'dlang-spring-camp-2027'),
      ('summer', 'Summer Camp 2027', 'dlang-summer-camp-2027'),
      ('fall',   'Fall Camp 2027',   'dlang-fall-camp-2027')
    ) as t(season, name, slug)
  loop
    -- the camp of that season: the original (summer) or the one split off it
    select p.id into v_id
      from public.programs p
     where p.org_id = v_org and p.kind = 'camp'
       and (p.id = v_orig or p.slug = v_target.slug or p.slug like c_old_slug || '-%')
       and exists (select 1 from public.camp_editions e
                    where e.program_id = p.id and public.camp_season_of(e.starts_on) = v_target.season
                      and public.camp_season_year_of(e.starts_on) = 2027)
     order by (p.slug = v_target.slug) desc, p.created_at
     limit 1;
    if v_id is null then
      raise notice 'camps_dlang_2027_split: no % 2027 camp found', v_target.season;
      continue;
    end if;
    update public.programs
       set name = v_target.name, season = v_target.season, season_year = 2027,
           slug = case when exists (select 1 from public.programs x where x.org_id = v_org and x.slug = v_target.slug and x.id <> v_id)
                       then slug else v_target.slug end
     where id = v_id;
    v_id := null;
  end loop;

  -- 3) The old public link opens the Summer camp ------------------------------
  if not exists (select 1 from public.programs where org_id = v_org and slug = c_old_slug) then
    select id into v_id from public.programs where org_id = v_org and slug = 'dlang-summer-camp-2027';
    if v_id is not null then
      insert into public.program_slug_redirects (org_id, old_slug, program_id)
      values (v_org, c_old_slug, v_id)
      on conflict (org_id, old_slug) do update set program_id = excluded.program_id;
    end if;
  end if;

  raise notice 'camps_dlang_2027_split: % camps (spring/summer/fall 2027) ready',
    (select count(*) from public.programs where org_id = v_org and slug in ('dlang-spring-camp-2027', 'dlang-summer-camp-2027', 'dlang-fall-camp-2027'));
end $$;
