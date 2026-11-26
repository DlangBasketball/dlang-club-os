-- ============================================================================
-- Club OS — Camp SEASONS (separate Spring / Summer / Fall camps) and the
-- multi-week CAMP BASKET.
--
-- Design
--   * programs (kind 'camp') gain season (spring | summer | fall | winter |
--     other) + season_year. Null = derived from the editions (first week)
--     with camp_season_of() / camp_season_year_of(), mirrored in TS
--     (src/lib/camps/seasons.ts). Each season is its own camp, with its own
--     public page /register/<slug>.
--   * programs + camp_editions gain cover_path / cover_focal_x / _y (hero
--     banner image in the public club-media bucket; no personal data).
--   * program_slug_redirects: an old public slug that now points to another
--     camp (e.g. after a split). Admin-managed, org-scoped, RLS per verb.
--   * discounts: new shared rule 'multi_week' (e.g. 10% from the 2nd week of
--     the same child in the same calendar year), multi_week_min_position.
--   * Admin RPCs (admin of the caller's org; org from current_org_id()):
--       move_camp_edition(edition, target camp, move_registrations)
--       split_camp_by_season(camp, names)
--       duplicate_camp_next_year(camp, name, slug, shift_days)
--     Each wraps an internal *_core(p_org, …) function that is never callable
--     through the API (the DLang data script calls the cores as the owner).
--   * register_camp_basket(payload): ONE transaction for several child-weeks
--     across camps of one club: locks every edition (capacity), validates
--     every line and reports ALL line errors at once (BASKET_INVALID with a
--     JSON detail), then one invoice (a line per child-week + negative
--     discount lines) and one registration per child-week. Service role
--     only: the server action resolves the org (session / public slug),
--     prices the basket with the pure TS pricing and this RPC re-checks it.
--
-- Additive and idempotent. Never trusts a client org: wrappers use
-- current_org_id(); the basket takes the org the server resolved and checks
-- every programme / edition / family / athlete against it.
-- ============================================================================

-- ===========================================================================
-- 1) SEASONS + COVER IMAGES
-- ===========================================================================
alter table public.programs
  add column if not exists season        text,
  add column if not exists season_year   smallint,
  add column if not exists cover_path    text,
  add column if not exists cover_focal_x smallint default 50,
  add column if not exists cover_focal_y smallint default 50;

alter table public.camp_editions
  add column if not exists cover_path    text,
  add column if not exists cover_focal_x smallint default 50,
  add column if not exists cover_focal_y smallint default 50;

do $$ begin
  alter table public.programs add constraint programs_season_chk
    check ((season is null or season in ('spring', 'summer', 'fall', 'winter', 'other'))
       and (season_year is null or season_year between 2000 and 2100));
exception when duplicate_object then null; end $$;

do $$
declare t text;
begin
  foreach t in array array['programs', 'camp_editions'] loop
    begin
      execute format('alter table public.%I add constraint %I check (
          (cover_path is null or (length(cover_path) between 1 and 300 and cover_path !~ ''\.\.''))
          and (cover_focal_x is null or cover_focal_x between 0 and 100)
          and (cover_focal_y is null or cover_focal_y between 0 and 100))', t, t || '_cover_chk');
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

create index if not exists idx_programs_org_season on public.programs(org_id, season_year, season) where kind = 'camp';

-- Season of a day: Mar–May spring, Jun–Aug summer, Sep–Nov fall, Dec–Feb
-- winter (a winter belongs to the year of its December).
create or replace function public.camp_season_of(p_day date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_day is null then null
    when extract(month from p_day) between 3 and 5 then 'spring'
    when extract(month from p_day) between 6 and 8 then 'summer'
    when extract(month from p_day) between 9 and 11 then 'fall'
    else 'winter' end;
$$;

create or replace function public.camp_season_year_of(p_day date)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_day is null then null
    when extract(month from p_day) <= 2 then extract(year from p_day)::int - 1
    else extract(year from p_day)::int end;
$$;

-- ===========================================================================
-- 2) PROGRAMME SLUG REDIRECTS (old public link -> another camp)
-- ===========================================================================
create table if not exists public.program_slug_redirects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  old_slug    text not null,
  program_id  uuid not null references public.programs(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, old_slug)
);
create index if not exists idx_program_slug_redirects_org on public.program_slug_redirects(org_id);
create index if not exists idx_program_slug_redirects_program on public.program_slug_redirects(program_id);
do $$ begin
  alter table public.program_slug_redirects add constraint program_slug_redirects_slug_chk
    check (old_slug ~ '^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$');
exception when duplicate_object then null; end $$;

drop trigger if exists trg_program_slug_redirects_updated on public.program_slug_redirects;
create trigger trg_program_slug_redirects_updated before update on public.program_slug_redirects
  for each row execute function public.set_updated_at();

create or replace function public.program_slug_redirects_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.old_slug := lower(btrim(new.old_slug));
  if not exists (select 1 from public.programs where id = new.program_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;
  -- A live programme slug always wins: a redirect may not shadow one.
  if exists (select 1 from public.programs where org_id = new.org_id and slug = new.old_slug) then
    raise exception 'SLUG_IN_USE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_program_slug_redirects_guard on public.program_slug_redirects;
create trigger trg_program_slug_redirects_guard before insert or update on public.program_slug_redirects
  for each row execute function public.program_slug_redirects_guard();

alter table public.program_slug_redirects enable row level security;
drop policy if exists program_slug_redirects_select on public.program_slug_redirects;
create policy program_slug_redirects_select on public.program_slug_redirects for select
  using (org_id = public.current_org_id());
drop policy if exists program_slug_redirects_insert on public.program_slug_redirects;
create policy program_slug_redirects_insert on public.program_slug_redirects for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists program_slug_redirects_update on public.program_slug_redirects;
create policy program_slug_redirects_update on public.program_slug_redirects for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists program_slug_redirects_delete on public.program_slug_redirects;
create policy program_slug_redirects_delete on public.program_slug_redirects for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists platform_tenant_isolation on public.program_slug_redirects;
create policy platform_tenant_isolation on public.program_slug_redirects as restrictive for all
  using (org_id = (select public.current_org_id()))
  with check (org_id = (select public.current_org_id()));
drop policy if exists platform_suspension_guard on public.program_slug_redirects;
create policy platform_suspension_guard on public.program_slug_redirects as restrictive for all
  using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
  with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.program_slug_redirects from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.program_slug_redirects to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.program_slug_redirects to service_role;
  end if;
end $$;

drop trigger if exists trg_audit_program_slug_redirects on public.program_slug_redirects;
create trigger trg_audit_program_slug_redirects after insert or update or delete on public.program_slug_redirects
  for each row execute function public.audit_trigger();

-- ===========================================================================
-- 3) DISCOUNTS: 'multi_week' rule (shared model, additive)
-- ===========================================================================
alter table public.discounts add column if not exists multi_week_min_position smallint;

alter table public.discounts drop constraint if exists discounts_rule_chk;
alter table public.discounts add constraint discounts_rule_chk
  check (rule in ('promo_code', 'sibling', 'early_bird', 'manual', 'multi_week')
     and (rule <> 'promo_code' or (code is not null and code ~ '^[A-Z0-9_-]{3,40}$'))
     and (rule = 'promo_code' or code is null)
     and (rule <> 'sibling' or coalesce(sibling_min_position, 2) between 2 and 20)
     and (rule <> 'multi_week' or coalesce(multi_week_min_position, 2) between 2 and 20)
     and (rule <> 'early_bird' or valid_until is not null or early_bird_days_before is not null));

create or replace function public.discounts_normalize()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.code := upper(nullif(btrim(new.code), ''));
  new.currency := upper(nullif(btrim(new.currency), ''));
  if new.rule = 'sibling' then new.sibling_min_position := coalesce(new.sibling_min_position, 2); end if;
  if new.rule = 'multi_week' then new.multi_week_min_position := coalesce(new.multi_week_min_position, 2);
  else new.multi_week_min_position := null; end if;
  if new.scope_program_id is not null
     and not exists (select 1 from public.programs where id = new.scope_program_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: program' using errcode = '42501';
  end if;
  if new.scope_service_id is not null
     and not exists (select 1 from public.training_services where id = new.scope_service_id and org_id = new.org_id) then
    raise exception 'CROSS_TENANT_REFERENCE: service' using errcode = '42501';
  end if;
  if new.scope <> 'program' then new.scope_program_id := null; end if;
  if new.scope <> 'service' then new.scope_service_id := null; end if;
  return new;
end;
$$;

-- ===========================================================================
-- 4) HELPERS
-- ===========================================================================
-- A free programme slug in the org: sanitised, never a live slug or redirect.
create or replace function public.camp_unique_slug(p_org uuid, p_base text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_base text := left(btrim(regexp_replace(regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9]+', '-', 'g'), '-+', '-', 'g'), '-'), 100);
  v_slug text;
  n      int := 1;
begin
  if v_base is null or length(v_base) < 2 then v_base := 'camp'; end if;
  v_slug := v_base;
  while exists (select 1 from public.programs where org_id = p_org and slug = v_slug)
     or exists (select 1 from public.program_slug_redirects where org_id = p_org and old_slug = v_slug) loop
    n := n + 1;
    v_slug := v_base || '-' || n;
  end loop;
  return v_slug;
end;
$$;

-- Copies a camp's camp-wide configuration (time slots, age groups, price
-- options with edition_id null, registration form) to another camp.
create or replace function public.camp_copy_config(p_org uuid, p_src uuid, p_dst uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s        record;
  v_new    uuid;
  v_slots  jsonb := '{}'::jsonb;
  n_slots  int := 0;
  n_groups int := 0;
  n_opts   int := 0;
begin
  for s in select * from public.camp_time_slots where org_id = p_org and program_id = p_src and edition_id is null order by sort, starts_at loop
    insert into public.camp_time_slots (org_id, program_id, label, starts_at, ends_at, sort)
    values (p_org, p_dst, s.label, s.starts_at, s.ends_at, s.sort) returning id into v_new;
    v_slots := v_slots || jsonb_build_object(s.id::text, v_new);
    n_slots := n_slots + 1;
  end loop;
  for s in select * from public.camp_age_groups where org_id = p_org and program_id = p_src order by sort, label loop
    insert into public.camp_age_groups (org_id, program_id, label, min_age, max_age, time_slot_id, is_active, sort)
    values (p_org, p_dst, s.label, s.min_age, s.max_age, nullif(v_slots->>(s.time_slot_id::text), '')::uuid, s.is_active, s.sort);
    n_groups := n_groups + 1;
  end loop;
  for s in select * from public.camp_price_options where org_id = p_org and program_id = p_src and edition_id is null order by sort, days_count loop
    insert into public.camp_price_options (org_id, program_id, label, days_count, includes_lunch, price, currency, is_active, sort)
    values (p_org, p_dst, s.label, s.days_count, s.includes_lunch, s.price, s.currency, s.is_active, s.sort);
    n_opts := n_opts + 1;
  end loop;
  if to_regclass('public.registration_form_configs') is not null then
    execute 'insert into public.registration_form_configs (org_id, program_id, builtin, questions)
             select org_id, $2, builtin, questions from public.registration_form_configs
              where org_id = $1 and program_id = $3
             on conflict (program_id) do nothing' using p_org, p_dst, p_src;
  end if;
  return jsonb_build_object('slots', n_slots, 'age_groups', n_groups, 'options', n_opts, 'slot_map', v_slots);
end;
$$;

-- ===========================================================================
-- 5) MOVE A WEEK (edition) TO ANOTHER CAMP OF THE SAME CLUB
--
-- The edition keeps its id, dates, venue, capacity and window. Its own
-- (edition-scoped) price options / time slots move with it. When it used the
-- camp-wide rows and the target camp's camp-wide rows differ, the source
-- rows are copied as edition-scoped overrides into the target, so the week
-- keeps exactly its prices and times. Registrations move only when asked
-- (p_with_regs); their option / age group references are remapped to the
-- target camp (missing age groups are copied as inactive rows).
-- ===========================================================================
create or replace function public.camp_move_edition_core(p_org uuid, p_edition uuid, p_target uuid, p_with_regs boolean, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e          public.camp_editions%rowtype;
  v_src      public.programs%rowtype;
  v_tgt      public.programs%rowtype;
  n_regs     int;
  v_own_opts boolean;
  v_own_slot boolean;
  v_opt_map  jsonb := '{}'::jsonb;
  v_slot_map jsonb := '{}'::jsonb;
  v_grp_map  jsonb := '{}'::jsonb;
  n_opt_copy int := 0;
  n_slot_copy int := 0;
  n_grp_copy int := 0;
  r          record;
  v_new      uuid;
  v_inv      uuid[];
begin
  select * into e from public.camp_editions where id = p_edition and org_id = p_org for update;
  if not found then raise exception 'EDITION_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_src from public.programs where id = e.program_id and org_id = p_org for update;
  select * into v_tgt from public.programs where id = p_target and org_id = p_org for update;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_tgt.kind <> 'camp' then raise exception 'NOT_A_CAMP' using errcode = 'P0001'; end if;
  if v_tgt.id = v_src.id then raise exception 'SAME_CAMP' using errcode = 'P0001'; end if;
  if upper(coalesce(v_tgt.currency, public.org_currency(p_org))) <> upper(coalesce(v_src.currency, public.org_currency(p_org))) then
    raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001';
  end if;

  select count(*) into n_regs from public.registrations where camp_edition_id = e.id;
  if n_regs > 0 and not coalesce(p_with_regs, false) then
    raise exception 'EDITION_HAS_REGISTRATIONS' using errcode = 'P0001';
  end if;

  v_own_opts := exists (select 1 from public.camp_price_options where edition_id = e.id);
  v_own_slot := exists (select 1 from public.camp_time_slots where edition_id = e.id);

  -- 1) the edition itself
  update public.camp_editions set program_id = v_tgt.id where id = e.id;

  -- 2) price options
  if v_own_opts then
    update public.camp_price_options set program_id = v_tgt.id where edition_id = e.id;
    select coalesce(jsonb_object_agg(id::text, id), '{}'::jsonb) into v_opt_map
      from public.camp_price_options where edition_id = e.id;
  elsif (select coalesce(array_agg(t order by t), '{}') from (
           select row(days_count, includes_lunch, price, upper(coalesce(currency, '')), is_active)::text as t
             from public.camp_price_options where program_id = v_src.id and edition_id is null) s)
      = (select coalesce(array_agg(t order by t), '{}') from (
           select row(days_count, includes_lunch, price, upper(coalesce(currency, '')), is_active)::text as t
             from public.camp_price_options where program_id = v_tgt.id and edition_id is null) s) then
    -- same camp-wide price list: reuse the target's rows
    for r in select s.id as src_id,
                    (select t.id from public.camp_price_options t
                      where t.program_id = v_tgt.id and t.edition_id is null and t.days_count = s.days_count
                        and t.includes_lunch = s.includes_lunch and t.price = s.price and t.is_active = s.is_active
                      order by t.sort, t.id limit 1) as tgt_id
               from public.camp_price_options s where s.program_id = v_src.id and s.edition_id is null loop
      v_opt_map := v_opt_map || jsonb_build_object(r.src_id::text, r.tgt_id);
    end loop;
  else
    -- different price list: carry the week's prices as edition overrides
    for r in select * from public.camp_price_options where program_id = v_src.id and edition_id is null order by sort, days_count loop
      insert into public.camp_price_options (org_id, program_id, edition_id, label, days_count, includes_lunch, price, currency, is_active, sort)
      values (p_org, v_tgt.id, e.id, r.label, r.days_count, r.includes_lunch, r.price, r.currency, r.is_active, r.sort)
      returning id into v_new;
      v_opt_map := v_opt_map || jsonb_build_object(r.id::text, v_new);
      n_opt_copy := n_opt_copy + 1;
    end loop;
  end if;

  -- 3) time slots (same rule)
  if v_own_slot then
    update public.camp_time_slots set program_id = v_tgt.id where edition_id = e.id;
    select coalesce(jsonb_object_agg(id::text, id), '{}'::jsonb) into v_slot_map from public.camp_time_slots where edition_id = e.id;
  elsif (select coalesce(array_agg(t order by t), '{}') from (
           select row(starts_at, ends_at)::text as t from public.camp_time_slots where program_id = v_src.id and edition_id is null) s)
      <> (select coalesce(array_agg(t order by t), '{}') from (
           select row(starts_at, ends_at)::text as t from public.camp_time_slots where program_id = v_tgt.id and edition_id is null) s) then
    for r in select * from public.camp_time_slots where program_id = v_src.id and edition_id is null order by sort, starts_at loop
      insert into public.camp_time_slots (org_id, program_id, edition_id, label, starts_at, ends_at, sort)
      values (p_org, v_tgt.id, e.id, r.label, r.starts_at, r.ends_at, r.sort) returning id into v_new;
      v_slot_map := v_slot_map || jsonb_build_object(r.id::text, v_new);
      n_slot_copy := n_slot_copy + 1;
    end loop;
  end if;

  -- 4) registrations follow the week
  if n_regs > 0 then
    -- age groups: same label + ages in the target, else an inactive copy
    for r in select distinct g.* from public.camp_age_groups g
               join public.registrations x on x.camp_age_group_id = g.id
              where x.camp_edition_id = e.id loop
      select t.id into v_new from public.camp_age_groups t
       where t.program_id = v_tgt.id and t.label = r.label
         and t.min_age is not distinct from r.min_age and t.max_age is not distinct from r.max_age
       order by t.is_active desc, t.sort limit 1;
      if v_new is null then
        insert into public.camp_age_groups (org_id, program_id, label, min_age, max_age, is_active, sort)
        values (p_org, v_tgt.id, r.label, r.min_age, r.max_age, false, r.sort) returning id into v_new;
        n_grp_copy := n_grp_copy + 1;
      end if;
      v_grp_map := v_grp_map || jsonb_build_object(r.id::text, v_new);
      v_new := null;
    end loop;

    -- a registered option that has no counterpart (e.g. an inactive row)
    for r in select distinct o.* from public.camp_price_options o
               join public.registrations x on x.camp_price_option_id = o.id
              where x.camp_edition_id = e.id and v_opt_map->>(o.id::text) is null loop
      if r.edition_id = e.id then
        v_opt_map := v_opt_map || jsonb_build_object(r.id::text, r.id);
      else
        insert into public.camp_price_options (org_id, program_id, edition_id, label, days_count, includes_lunch, price, currency, is_active, sort)
        values (p_org, v_tgt.id, e.id, r.label, r.days_count, r.includes_lunch, r.price, r.currency, false, r.sort)
        returning id into v_new;
        v_opt_map := v_opt_map || jsonb_build_object(r.id::text, v_new);
        n_opt_copy := n_opt_copy + 1;
      end if;
    end loop;

    select coalesce(array_agg(distinct invoice_id) filter (where invoice_id is not null), '{}') into v_inv
      from public.registrations where camp_edition_id = e.id;

    perform set_config('app.camp_pricing', 'on', true);
    update public.registrations
       set program_id = v_tgt.id,
           camp_price_option_id = case when camp_price_option_id is null then null
                                       else nullif(v_opt_map->>(camp_price_option_id::text), '')::uuid end,
           camp_age_group_id = case when camp_age_group_id is null then null
                                    else nullif(v_grp_map->>(camp_age_group_id::text), '')::uuid end,
           price_snapshot = case when price_snapshot is null then null
                                 else price_snapshot || jsonb_build_object('moved_from_program_id', v_src.id, 'moved_at', now()) end
     where camp_edition_id = e.id;
    perform set_config('app.camp_pricing', 'off', true);

    if to_regclass('public.registration_answers') is not null then
      execute 'update public.registration_answers set program_id = $1
                where program_id = $2 and registration_id in (select id from public.registrations where camp_edition_id = $3)'
        using v_tgt.id, v_src.id, e.id;
    end if;
    -- invoices that only bill this week now belong to the target camp
    update public.invoices i set program_id = v_tgt.id
     where i.id = any(v_inv) and i.program_id = v_src.id
       and not exists (select 1 from public.registrations x where x.invoice_id = i.id and x.camp_edition_id is distinct from e.id);
  end if;

  if to_regclass('public.expenses') is not null then
    execute 'update public.expenses set program_id = $1 where camp_edition_id = $2 and program_id = $3' using v_tgt.id, e.id, v_src.id;
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (p_org, p_actor, 'camp.move_edition', 'camp_editions', e.id,
          jsonb_build_object('program_id', v_src.id),
          jsonb_build_object('program_id', v_tgt.id, 'registrations', n_regs, 'options_copied', n_opt_copy,
                             'slots_copied', n_slot_copy, 'age_groups_created', n_grp_copy));

  return jsonb_build_object('edition_id', e.id, 'from_program_id', v_src.id, 'to_program_id', v_tgt.id,
                            'registrations', n_regs, 'options_copied', n_opt_copy, 'slots_copied', n_slot_copy,
                            'age_groups_created', n_grp_copy);
end;
$$;

create or replace function public.move_camp_edition(p_edition uuid, p_target uuid, p_move_registrations boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return public.camp_move_edition_core(v_org, p_edition, p_target, p_move_registrations, auth.uid());
end;
$$;

-- ===========================================================================
-- 6) SPLIT A CAMP BY SEASON
--
-- One camp per season of its editions. The original programme keeps its id,
-- slug and the season with the most editions (tie: the earliest); every other
-- season becomes a new camp (slug <original>-<season>-<year>) with a copy of
-- the description, cover, price options, age groups, time slots and
-- registration form; its editions move there WITH their registrations.
-- p_names: {"summer-2027": "Summer Camp 2027", …} (translated by the caller).
-- ===========================================================================
create or replace function public.camp_split_by_season_core(p_org uuid, p_program uuid, p_names jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p        public.programs%rowtype;
  g        record;
  k        record;
  ed       record;
  v_new    uuid;
  v_slug   text;
  v_key    text;
  v_out    jsonb := '[]'::jsonb;
  n_groups int;
begin
  select * into p from public.programs where id = p_program and org_id = p_org for update;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if p.kind <> 'camp' then raise exception 'NOT_A_CAMP' using errcode = 'P0001'; end if;

  select count(distinct (public.camp_season_of(starts_on), public.camp_season_year_of(starts_on))) into n_groups
    from public.camp_editions where program_id = p.id;
  if n_groups < 2 then raise exception 'NOTHING_TO_SPLIT' using errcode = 'P0001'; end if;

  -- the season the original keeps
  select public.camp_season_of(starts_on) as season, public.camp_season_year_of(starts_on) as yr,
         count(*) as n, min(starts_on) as first_day, max(ends_on) as last_day
    into k
    from public.camp_editions where program_id = p.id
   group by 1, 2 order by n desc, first_day limit 1;

  update public.programs
     set season = k.season, season_year = k.yr,
         name = coalesce(nullif(btrim(p_names->>(k.season || '-' || k.yr)), ''), name),
         starts_on = k.first_day, ends_on = k.last_day
   where id = p.id;

  for g in
    select public.camp_season_of(starts_on) as season, public.camp_season_year_of(starts_on) as yr,
           min(starts_on) as first_day, max(ends_on) as last_day, count(*) as n
      from public.camp_editions where program_id = p.id
     group by 1, 2
    having not (public.camp_season_of(min(starts_on)) = k.season and public.camp_season_year_of(min(starts_on)) = k.yr)
     order by first_day
  loop
    v_key := g.season || '-' || g.yr;
    v_slug := public.camp_unique_slug(p_org, coalesce(p.slug, 'camp') || '-' || g.season || '-' || g.yr);
    insert into public.programs (org_id, slug, name, kind, description, price_chf, capacity, starts_on, ends_on, location,
                                 schedule, is_public, status, currency, min_age, max_age, season, season_year,
                                 cover_path, cover_focal_x, cover_focal_y)
    values (p_org, v_slug, coalesce(nullif(btrim(p_names->>v_key), ''), p.name), 'camp', p.description, p.price_chf, p.capacity,
            g.first_day, g.last_day, p.location, p.schedule, p.is_public, p.status, p.currency, p.min_age, p.max_age,
            g.season, g.yr, p.cover_path, p.cover_focal_x, p.cover_focal_y)
    returning id into v_new;
    perform public.camp_copy_config(p_org, p.id, v_new);
    for ed in select id from public.camp_editions
               where program_id = p.id and public.camp_season_of(starts_on) = g.season
                 and public.camp_season_year_of(starts_on) = g.yr
               order by starts_on loop
      perform public.camp_move_edition_core(p_org, ed.id, v_new, true, p_actor);
    end loop;
    v_out := v_out || jsonb_build_object('program_id', v_new, 'slug', v_slug, 'season', g.season, 'season_year', g.yr, 'editions', g.n);
  end loop;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, p_actor, 'camp.split_by_season', 'programs', p.id,
          jsonb_build_object('kept', jsonb_build_object('season', k.season, 'season_year', k.yr), 'created', v_out));

  return jsonb_build_object('program_id', p.id, 'season', k.season, 'season_year', k.yr, 'created', v_out);
end;
$$;

create or replace function public.split_camp_by_season(p_program uuid, p_names jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_names is not null and jsonb_typeof(p_names) <> 'object' then
    raise exception 'INVALID_REQUEST' using errcode = 'P0001';
  end if;
  return public.camp_split_by_season_core(v_org, p_program, coalesce(p_names, '{}'::jsonb), auth.uid());
end;
$$;

-- ===========================================================================
-- 7) DUPLICATE A CAMP FOR NEXT YEAR
--
-- New DRAFT camp with the configuration and every non-cancelled edition
-- shifted by p_shift_days (default 364 = 52 weeks, same weekday), as drafts,
-- with their registration windows shifted too. No registrations.
-- ===========================================================================
create or replace function public.camp_duplicate_core(p_org uuid, p_program uuid, p_name text, p_slug text, p_shift_days int, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p       public.programs%rowtype;
  v_new   uuid;
  v_slug  text;
  v_shift int := coalesce(p_shift_days, 364);
  v_iv    interval;
  v_cfg   jsonb;
  e       record;
  s       record;
  v_ed    uuid;
  n_ed    int := 0;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_shift < 1 or v_shift > 1100 then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  if v_name is not null and length(v_name) > 200 then raise exception 'INVALID_REQUEST' using errcode = 'P0001'; end if;
  v_iv := make_interval(days => v_shift);
  select * into p from public.programs where id = p_program and org_id = p_org;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if p.kind <> 'camp' then raise exception 'NOT_A_CAMP' using errcode = 'P0001'; end if;

  v_slug := public.camp_unique_slug(p_org, coalesce(nullif(btrim(p_slug), ''), coalesce(p.slug, 'camp') || '-next'));
  insert into public.programs (org_id, slug, name, kind, description, price_chf, capacity, starts_on, ends_on, location,
                               schedule, is_public, status, currency, min_age, max_age, season, season_year,
                               cover_path, cover_focal_x, cover_focal_y)
  values (p_org, v_slug, coalesce(v_name, p.name), 'camp', p.description, p.price_chf, p.capacity,
          p.starts_on + v_shift, p.ends_on + v_shift, p.location, p.schedule, p.is_public, 'draft', p.currency,
          p.min_age, p.max_age, p.season,
          case when p.season_year is null then null else p.season_year + greatest(1, round(v_shift / 365.0))::int end,
          p.cover_path, p.cover_focal_x, p.cover_focal_y)
  returning id into v_new;
  v_cfg := public.camp_copy_config(p_org, p.id, v_new);

  for e in select * from public.camp_editions where program_id = p.id and status <> 'cancelled' order by starts_on loop
    insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, venue_id, location_name, address, city,
                                      capacity, registration_opens_at, registration_closes_at, status, notes,
                                      cover_path, cover_focal_x, cover_focal_y)
    values (p_org, v_new, e.name, e.starts_on + v_shift, e.ends_on + v_shift, e.venue_id, e.location_name, e.address, e.city,
            e.capacity, e.registration_opens_at + v_iv, e.registration_closes_at + v_iv, 'draft', e.notes,
            e.cover_path, e.cover_focal_x, e.cover_focal_y)
    returning id into v_ed;
    n_ed := n_ed + 1;
    for s in select * from public.camp_time_slots where edition_id = e.id loop
      insert into public.camp_time_slots (org_id, program_id, edition_id, label, starts_at, ends_at, sort)
      values (p_org, v_new, v_ed, s.label, s.starts_at, s.ends_at, s.sort);
    end loop;
    for s in select * from public.camp_price_options where edition_id = e.id loop
      insert into public.camp_price_options (org_id, program_id, edition_id, label, days_count, includes_lunch, price, currency, is_active, sort)
      values (p_org, v_new, v_ed, s.label, s.days_count, s.includes_lunch, s.price, s.currency, s.is_active, s.sort);
    end loop;
  end loop;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, p_actor, 'camp.duplicate', 'programs', v_new,
          jsonb_build_object('from_program_id', p.id, 'shift_days', v_shift, 'editions', n_ed));

  return jsonb_build_object('program_id', v_new, 'slug', v_slug, 'editions', n_ed);
end;
$$;

create or replace function public.duplicate_camp_next_year(p_program uuid, p_name text default null, p_slug text default null, p_shift_days int default 364)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  return public.camp_duplicate_core(v_org, p_program, p_name, p_slug, p_shift_days, auth.uid());
end;
$$;

-- ===========================================================================
-- 8) register_camp_basket(payload): several child-weeks, one checkout
--
-- payload = {
--   org_id                               (resolved by the server, never the client),
--   mode: 'public' | 'parent' | 'admin',
--   family_id                            (parent / admin; verified by the server),
--   parent: {name,email,phone,address,emergency_name,emergency_phone}   (public),
--   children: [{ ref, athlete_id | first_name,last_name,dob,gender,allergies,conditions,medical_notes }],
--   lines: [{ key, child_ref, program_id, edition_id, age_group_id, price_option_id,
--             days: [date], list_amount, discounts: [{discount_id, amount, code?}] }],
--   consents: [key], ip, registered_by (profile id)
-- }
-- All lines are validated first; any problem raises BASKET_INVALID with
-- DETAIL = [{"key": <line key | null>, "code": <CODE>}, …] and nothing is
-- written. Admin mode may book outside the registration window (not over
-- capacity). Multi-week discounts are re-checked: the line's week position
-- for its child = 1 + the child's active camp registrations that start in
-- the same calendar year + the child's earlier basket lines that year
-- (ordered by start date, then line key).
-- ===========================================================================
create or replace function public.register_camp_basket(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid := nullif(p_payload->>'org_id', '')::uuid;
  v_mode      text := coalesce(p_payload->>'mode', 'public');
  v_lines     jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_children  jsonb := coalesce(p_payload->'children', '[]'::jsonb);
  v_errors    jsonb := '[]'::jsonb;
  v_by        uuid := nullif(p_payload->>'registered_by', '')::uuid;
  v_currency  text;
  v_exp       int;
  v_family    uuid;
  v_email     citext;
  v_ip        inet;
  v_vpc       boolean;
  v_due       date := (now() + interval '14 days')::date;
  l           jsonb;
  c           jsonb;
  v_disc      jsonb;
  v_key       text;
  v_ref       text;
  v_code      text;
  v_prog      public.programs%rowtype;
  v_ed        public.camp_editions%rowtype;
  v_opt       public.camp_price_options%rowtype;
  v_grp       public.camp_age_groups%rowtype;
  d           public.discounts%rowtype;
  v_athletes  jsonb := '{}'::jsonb;   -- child ref -> athlete id (parent/admin: verified; public: created)
  v_dobs      jsonb := '{}'::jsonb;   -- child ref -> dob
  v_seen      jsonb := '{}'::jsonb;   -- "<ref>|<edition>" -> true
  v_keys      jsonb := '{}'::jsonb;
  v_promo     jsonb := '{}'::jsonb;   -- discount id -> uses inside this basket
  v_athlete   uuid;
  v_dob       date;
  v_age       int;
  v_list      numeric;
  v_nominal   numeric;
  v_damount   numeric;
  v_dsum      numeric;
  v_days      date[];
  v_used      int;
  v_pos       int;
  v_cap       record;
  v_invoice   uuid;
  v_invnum    text;
  v_item      uuid;
  v_reg       uuid;
  v_total     numeric := 0;
  v_name      text;
  v_desc      text;
  v_dlines    jsonb;
  v_out       jsonb := '[]'::jsonb;
  v_progs     uuid[];
  v_consent   text;
  v_form      record;
  v_pair      record;
  v_ath_ids   uuid[] := '{}';
  n           int;
begin
  if not public.is_service_caller() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if v_org is null or not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'ORG_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_mode not in ('public', 'parent', 'admin') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) < 1 then raise exception 'NO_LINES' using errcode = 'P0001'; end if;
  if jsonb_array_length(v_lines) > 40 then raise exception 'TOO_MANY_LINES' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_children) <> 'array' or jsonb_array_length(v_children) < 1 then raise exception 'NO_CHILDREN' using errcode = 'P0001'; end if;
  if jsonb_array_length(v_children) > 10 then raise exception 'TOO_MANY_CHILDREN' using errcode = 'P0001'; end if;
  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  -- ---- family + children (verified, nothing written yet) -------------------
  if v_mode in ('parent', 'admin') then
    select id into v_family from public.families where id = nullif(p_payload->>'family_id', '')::uuid and org_id = v_org;
    if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002'; end if;
    for c in select * from jsonb_array_elements(v_children) loop
      v_ref := nullif(c->>'ref', '');
      select id, dob into v_athlete, v_dob from public.athletes
       where id = nullif(c->>'athlete_id', '')::uuid and org_id = v_org and family_id = v_family;
      if v_ref is null or v_athlete is null then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
      v_athletes := v_athletes || jsonb_build_object(v_ref, v_athlete);
      v_dobs := v_dobs || jsonb_build_object(v_ref, v_dob);
    end loop;
  else
    v_email := nullif(btrim(p_payload->'parent'->>'email'), '');
    if v_email is null then raise exception 'EMAIL_REQUIRED' using errcode = 'P0001'; end if;
    v_vpc := public.org_requires_vpc(v_org);
    for c in select * from jsonb_array_elements(v_children) loop
      v_ref := nullif(c->>'ref', '');
      begin v_dob := nullif(c->>'dob', '')::date; exception when others then v_dob := null; end;
      if v_ref is null or v_dob is null or v_dob >= current_date
         or length(btrim(coalesce(c->>'first_name', ''))) < 1 or length(btrim(coalesce(c->>'last_name', ''))) < 1 then
        raise exception 'INVALID_CHILD' using errcode = 'P0001';
      end if;
      if v_vpc and v_dob > (current_date - interval '13 years') then raise exception 'VPC_REQUIRED' using errcode = 'P0001'; end if;
      v_dobs := v_dobs || jsonb_build_object(v_ref, v_dob);
    end loop;
  end if;

  -- ---- lock every edition of the basket (capacity), in a stable order ------
  perform 1 from public.camp_editions
   where org_id = v_org
     and id in (select nullif(x->>'edition_id', '')::uuid from jsonb_array_elements(v_lines) x)
   order by id
   for update;

  -- ---- validate every line ---------------------------------------------------
  for l in select * from jsonb_array_elements(v_lines) loop
    v_key := nullif(l->>'key', '');
    v_ref := nullif(l->>'child_ref', '');
    v_code := null;
    if v_key is null or length(v_key) > 40 or v_keys ? v_key then
      raise exception 'INVALID_LINE_KEY' using errcode = 'P0001';
    end if;
    v_keys := v_keys || jsonb_build_object(v_key, true);

    <<check>>
    begin
      select * into v_prog from public.programs where id = nullif(l->>'program_id', '')::uuid and org_id = v_org;
      if not found or v_prog.kind <> 'camp' then v_code := 'PROGRAM_NOT_FOUND'; exit check; end if;
      if v_prog.status <> 'published' or (v_mode = 'public' and not v_prog.is_public) then v_code := 'PROGRAM_NOT_OPEN'; exit check; end if;
      if v_currency is null then
        v_currency := upper(coalesce(v_prog.currency, public.org_currency(v_org)));
        v_exp := public.currency_exponent(v_currency);
      elsif upper(coalesce(v_prog.currency, public.org_currency(v_org))) <> v_currency then
        v_code := 'CURRENCY_MISMATCH'; exit check;
      end if;

      select * into v_ed from public.camp_editions
       where id = nullif(l->>'edition_id', '')::uuid and program_id = v_prog.id and org_id = v_org;
      if not found then v_code := 'EDITION_NOT_FOUND'; exit check; end if;
      if v_ed.status <> 'published' then v_code := 'EDITION_NOT_OPEN'; exit check; end if;
      if v_mode <> 'admin' and (
           (v_ed.registration_opens_at is not null and now() < v_ed.registration_opens_at)
           or (v_ed.registration_closes_at is not null and now() >= v_ed.registration_closes_at)
           or (v_ed.registration_closes_at is null and current_date > v_ed.starts_on)) then
        v_code := 'REGISTRATION_CLOSED'; exit check;
      end if;

      if v_ref is null or not (v_dobs ? v_ref) then v_code := 'CHILD_NOT_FOUND'; exit check; end if;
      if v_seen ? (v_ref || '|' || v_ed.id) then v_code := 'DUPLICATE_LINE'; exit check; end if;
      v_seen := v_seen || jsonb_build_object(v_ref || '|' || v_ed.id, true);
      v_athlete := nullif(v_athletes->>v_ref, '')::uuid;
      v_dob := nullif(v_dobs->>v_ref, '')::date;
      if v_athlete is not null and exists (
           select 1 from public.registrations where athlete_id = v_athlete and camp_edition_id = v_ed.id and status <> 'cancelled') then
        v_code := 'ALREADY_REGISTERED'; exit check;
      end if;

      select * into v_grp from public.camp_age_groups
       where id = nullif(l->>'age_group_id', '')::uuid and program_id = v_prog.id and org_id = v_org and is_active;
      if not found then v_code := 'AGE_GROUP_NOT_FOUND'; exit check; end if;
      if v_dob is not null then
        v_age := extract(year from age(v_ed.starts_on, v_dob))::int;
        if (v_grp.min_age is not null and v_age < v_grp.min_age) or (v_grp.max_age is not null and v_age > v_grp.max_age) then
          v_code := 'AGE_OUT_OF_RANGE'; exit check;
        end if;
      end if;

      select * into v_opt from public.camp_price_options
       where id = nullif(l->>'price_option_id', '')::uuid and program_id = v_prog.id and org_id = v_org
         and is_active and (edition_id is null or edition_id = v_ed.id);
      if not found then v_code := 'PRICE_OPTION_NOT_FOUND'; exit check; end if;
      if upper(coalesce(v_opt.currency, v_currency)) <> v_currency then v_code := 'CURRENCY_MISMATCH'; exit check; end if;
      v_list := round(v_opt.price, v_exp);
      if round(coalesce((l->>'list_amount')::numeric, -1), v_exp) <> v_list then v_code := 'PRICE_CHANGED'; exit check; end if;

      select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_days
        from jsonb_array_elements_text(coalesce(l->'days', '[]'::jsonb)) x;
      if coalesce(array_length(v_days, 1), 0) <> v_opt.days_count
         or jsonb_array_length(coalesce(l->'days', '[]'::jsonb)) <> v_opt.days_count
         or exists (select 1 from unnest(v_days) x where x < v_ed.starts_on or x > v_ed.ends_on) then
        v_code := 'INVALID_DAYS'; exit check;
      end if;

      -- week position of this line for its child (multi-week rule)
      select count(*) into v_pos
        from jsonb_array_elements(v_lines) x
        join public.camp_editions e2 on e2.id = nullif(x->>'edition_id', '')::uuid and e2.org_id = v_org
       where x->>'child_ref' = v_ref
         and public.camp_season_year_of(e2.starts_on) is not null
         and extract(year from e2.starts_on) = extract(year from v_ed.starts_on)
         and (e2.starts_on < v_ed.starts_on
              or (e2.starts_on = v_ed.starts_on and (x->>'key') collate "C" < v_key collate "C"));
      if v_athlete is not null then
        select v_pos + count(*) into v_pos
          from public.registrations r join public.camp_editions e3 on e3.id = r.camp_edition_id
         where r.athlete_id = v_athlete and r.org_id = v_org and r.status in ('pending', 'confirmed', 'completed')
           and extract(year from e3.starts_on) = extract(year from v_ed.starts_on);
      end if;
      v_pos := v_pos + 1;

      v_dsum := 0;
      for v_disc in select * from jsonb_array_elements(coalesce(l->'discounts', '[]'::jsonb)) loop
        select * into d from public.discounts where id = nullif(v_disc->>'discount_id', '')::uuid and org_id = v_org for update;
        if not found or not d.is_active or d.rule = 'manual' then v_code := 'DISCOUNT_NOT_AVAILABLE'; exit check; end if;
        if not (d.scope in ('all', 'camps') or (d.scope = 'program' and d.scope_program_id = v_prog.id)) then
          v_code := 'DISCOUNT_NOT_AVAILABLE'; exit check;
        end if;
        if (d.valid_from is not null and now() < d.valid_from) or (d.valid_until is not null and now() > d.valid_until) then
          v_code := 'DISCOUNT_EXPIRED'; exit check;
        end if;
        if d.rule = 'early_bird' and d.early_bird_days_before is not null
           and current_date > v_ed.starts_on - d.early_bird_days_before then
          v_code := 'DISCOUNT_EXPIRED'; exit check;
        end if;
        if d.rule = 'multi_week' and v_pos < coalesce(d.multi_week_min_position, 2) then
          v_code := 'DISCOUNT_NOT_AVAILABLE'; exit check;
        end if;
        if d.kind = 'fixed_amount' and d.currency <> v_currency then v_code := 'CURRENCY_MISMATCH'; exit check; end if;
        if d.rule = 'promo_code' then
          if upper(coalesce(v_disc->>'code', '')) <> d.code then v_code := 'PROMO_INVALID'; exit check; end if;
          if d.max_redemptions is not null then
            select count(*) into v_used from public.applied_discounts where discount_id = d.id and voided_at is null;
            if v_used + coalesce((v_promo->>(d.id::text))::int, 0) >= d.max_redemptions then v_code := 'PROMO_LIMIT_REACHED'; exit check; end if;
          end if;
          if d.max_redemptions_per_family is not null and v_family is not null then
            select count(*) into v_used from public.applied_discounts
             where discount_id = d.id and family_id = v_family and voided_at is null;
            if v_used + coalesce((v_promo->>(d.id::text))::int, 0) >= d.max_redemptions_per_family then v_code := 'PROMO_FAMILY_LIMIT'; exit check; end if;
          end if;
          v_promo := v_promo || jsonb_build_object(d.id::text, coalesce((v_promo->>(d.id::text))::int, 0) + 1);
        end if;
        v_nominal := case when d.kind = 'percent' then round(v_list * d.value / 100, v_exp) else least(d.value, v_list) end;
        v_damount := round(coalesce((v_disc->>'amount')::numeric, 0), v_exp);
        if v_damount <= 0 or v_damount > v_nominal then v_code := 'DISCOUNT_AMOUNT_INVALID'; exit check; end if;
        v_dsum := v_dsum + v_damount;
        if v_dsum > v_list then v_code := 'DISCOUNT_AMOUNT_INVALID'; exit check; end if;
      end loop;
    end;

    if v_code is not null then
      v_errors := v_errors || jsonb_build_object('key', v_key, 'code', v_code);
    end if;
  end loop;

  -- ---- capacity: every line of a full edition is reported --------------------
  for v_cap in
    select e.id, e.capacity,
           (select count(*) from public.registrations r where r.camp_edition_id = e.id and r.status in ('pending', 'confirmed')) as taken,
           (select count(*) from jsonb_array_elements(v_lines) x where nullif(x->>'edition_id', '')::uuid = e.id) as wanted
      from public.camp_editions e
     where e.org_id = v_org and e.capacity is not null
       and e.id in (select nullif(x->>'edition_id', '')::uuid from jsonb_array_elements(v_lines) x)
  loop
    if v_cap.taken + v_cap.wanted > v_cap.capacity then
      for l in select * from jsonb_array_elements(v_lines) x where nullif(x->>'edition_id', '')::uuid = v_cap.id loop
        if not exists (select 1 from jsonb_array_elements(v_errors) z where z->>'key' = l->>'key') then
          v_errors := v_errors || jsonb_build_object('key', l->>'key', 'code', 'EDITION_FULL');
        end if;
      end loop;
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    raise exception 'BASKET_INVALID' using errcode = 'P0001', detail = v_errors::text;
  end if;

  -- ---- writes ------------------------------------------------------------------
  if v_mode = 'public' then
    select id into v_family from public.families where org_id = v_org and contact_email = v_email limit 1;
    if v_family is null then
      insert into public.families (org_id, name, address, phone, contact_name, contact_email, membership_status)
      values (v_org,
              coalesce(nullif(p_payload->>'family_name', ''), (p_payload->'parent'->>'name') || ' family'),
              nullif(p_payload->'parent'->>'address', ''), nullif(p_payload->'parent'->>'phone', ''),
              nullif(p_payload->'parent'->>'name', ''), v_email, 'guest')
      returning id into v_family;
    else
      update public.families set
        phone        = coalesce(nullif(p_payload->'parent'->>'phone', ''), phone),
        address      = coalesce(nullif(p_payload->'parent'->>'address', ''), address),
        contact_name = coalesce(nullif(p_payload->'parent'->>'name', ''), contact_name)
      where id = v_family;
    end if;
    -- one athlete per child of the basket (only children that have a line)
    for c in select * from jsonb_array_elements(v_children) loop
      continue when not exists (select 1 from jsonb_array_elements(v_lines) x where x->>'child_ref' = c->>'ref');
      insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
      values (v_org, v_family, btrim(c->>'first_name'), btrim(c->>'last_name'), (c->>'dob')::date,
              nullif(c->>'gender', ''), 'active')
      returning id into v_athlete;
      insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, notes,
                                          emergency_contact_name, emergency_contact_phone)
      values (v_org, v_athlete, nullif(c->>'allergies', ''), nullif(c->>'conditions', ''), nullif(c->>'medical_notes', ''),
              nullif(p_payload->'parent'->>'emergency_name', ''), nullif(p_payload->'parent'->>'emergency_phone', ''))
      on conflict (athlete_id) do nothing;
      v_athletes := v_athletes || jsonb_build_object(c->>'ref', v_athlete);
    end loop;
  end if;

  select array_agg(distinct nullif(x->>'program_id', '')::uuid) into v_progs from jsonb_array_elements(v_lines) x;
  v_invnum := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, program_id, description, status, due_date, currency)
  values (v_org, v_invnum, v_family, case when array_length(v_progs, 1) = 1 then v_progs[1] end,
          left((select string_agg(name, ' · ' order by name) from public.programs where id = any(v_progs)), 500),
          'sent', v_due, v_currency)
  returning id into v_invoice;

  perform set_config('app.camp_pricing', 'on', true);

  for l in
    select x.value from jsonb_array_elements(v_lines) with ordinality as x(value, i)
    order by x.i
  loop
    v_ref := l->>'child_ref';
    v_athlete := (v_athletes->>v_ref)::uuid;
    select * into v_prog from public.programs where id = (l->>'program_id')::uuid;
    select * into v_ed from public.camp_editions where id = (l->>'edition_id')::uuid;
    select * into v_opt from public.camp_price_options where id = (l->>'price_option_id')::uuid;
    select * into v_grp from public.camp_age_groups where id = (l->>'age_group_id')::uuid;
    select btrim(first_name || ' ' || last_name) into v_name from public.athletes where id = v_athlete;
    select coalesce(array_agg(distinct x::date order by x::date), '{}') into v_days
      from jsonb_array_elements_text(coalesce(l->'days', '[]'::jsonb)) x;
    v_list := round(v_opt.price, v_exp);

    v_dsum := 0;
    v_dlines := '[]'::jsonb;
    for v_disc in select * from jsonb_array_elements(coalesce(l->'discounts', '[]'::jsonb)) loop
      select * into d from public.discounts where id = (v_disc->>'discount_id')::uuid;
      v_damount := round((v_disc->>'amount')::numeric, v_exp);
      v_dsum := v_dsum + v_damount;
      v_dlines := v_dlines || jsonb_build_object('discount_id', d.id, 'name', d.name, 'rule', d.rule, 'code', d.code,
                                                 'kind', d.kind, 'value', d.value, 'amount', v_damount);
    end loop;

    insert into public.registrations
      (org_id, athlete_id, program_id, status, registered_by, camp_edition_id, camp_price_option_id, camp_age_group_id,
       camp_days, camp_includes_lunch, invoice_id, price_list_amount, price_discount_amount, price_amount, price_currency,
       price_snapshot)
    values
      (v_org, v_athlete, v_prog.id, 'pending', v_by, v_ed.id, v_opt.id, v_grp.id,
       v_days, v_opt.includes_lunch, v_invoice, v_list, v_dsum, v_list - v_dsum, v_currency,
       jsonb_build_object(
         'program', v_prog.name, 'edition_id', v_ed.id, 'edition_name', v_ed.name,
         'starts_on', v_ed.starts_on, 'ends_on', v_ed.ends_on,
         'option_id', v_opt.id, 'option_label', v_opt.label, 'days_count', v_opt.days_count,
         'includes_lunch', v_opt.includes_lunch, 'age_group', v_grp.label, 'days', to_jsonb(v_days),
         'currency', v_currency, 'list_amount', v_list, 'discount_amount', v_dsum, 'amount', v_list - v_dsum,
         'discounts', v_dlines, 'basket', true, 'line_key', l->>'key', 'priced_at', now()))
    returning id into v_reg;

    v_desc := v_prog.name || ' — ' || coalesce(nullif(v_ed.name, ''), v_ed.starts_on::text || ' – ' || v_ed.ends_on::text)
              || ' — ' || v_opt.label || ' — ' || coalesce(v_name, '');
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice, left(v_desc, 500), 1, v_list, v_list);
    v_total := v_total + v_list;

    for v_disc in select * from jsonb_array_elements(v_dlines) loop
      v_damount := (v_disc->>'amount')::numeric;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, left((v_disc->>'name') || ' — ' || coalesce(v_name, ''), 500), 1, -v_damount, -v_damount)
      returning id into v_item;
      insert into public.applied_discounts
        (org_id, discount_id, registration_id, invoice_id, invoice_item_id, source, source_id, family_id, athlete_id,
         rule, name, code, kind, value, amount, currency, created_by)
      values
        (v_org, (v_disc->>'discount_id')::uuid, v_reg, v_invoice, v_item, 'registration', v_reg, v_family, v_athlete,
         v_disc->>'rule', v_disc->>'name', nullif(v_disc->>'code', ''), v_disc->>'kind', (v_disc->>'value')::numeric,
         v_damount, v_currency, v_by);
      v_total := v_total - v_damount;
    end loop;

    v_out := v_out || jsonb_build_object('key', l->>'key', 'registration_id', v_reg, 'athlete_id', v_athlete,
                                         'program_id', v_prog.id, 'edition_id', v_ed.id, 'amount', v_list - v_dsum);
    if not (v_athlete = any(v_ath_ids)) then v_ath_ids := v_ath_ids || v_athlete; end if;
  end loop;

  perform set_config('app.camp_pricing', 'off', true);

  select count(*) into n from jsonb_array_elements(v_out);
  update public.invoices set total_chf = v_total,
         registration_id = case when n = 1 then (v_out->0->>'registration_id')::uuid end
   where id = v_invoice;

  -- consents: latest active version per key, per child and camp booked
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents') loop
      select id, version into v_form from public.consent_forms
       where org_id = v_org and key = v_consent and is_active order by version desc limit 1;
      if found then
        for v_pair in select distinct (o->>'athlete_id')::uuid as athlete_id, (o->>'program_id')::uuid as program_id
                        from jsonb_array_elements(v_out) o loop
          insert into public.consent_acceptances
            (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address, accepted_by)
          values (v_org, v_pair.athlete_id, v_form.id, v_form.version, 'accepted', v_pair.program_id, v_ip, v_by);
        end loop;
      end if;
    end loop;
  end if;

  if v_mode = 'public' and not exists (
    select 1 from public.invitations where org_id = v_org and email = v_email and status = 'pending') then
    insert into public.invitations (org_id, email, role, family_id, status, expires_at)
    values (v_org, v_email, 'parent', v_family, 'pending', now() + interval '30 days');
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_by, 'camp.basket_checkout', 'invoices', v_invoice,
          jsonb_build_object('mode', v_mode, 'lines', n, 'total', v_total, 'currency', v_currency, 'family_id', v_family));

  return jsonb_build_object(
    'family_id', v_family, 'invoice_id', v_invoice, 'invoice_number', v_invnum,
    'total', (select total_chf from public.invoices where id = v_invoice), 'currency', v_currency,
    'lines', v_out, 'athletes', v_athletes, 'athlete_ids', to_jsonb(v_ath_ids));
end;
$$;

-- ===========================================================================
-- 9) GRANTS: cores + helpers never through the API; wrappers for signed-in
--    admins (checked inside); the basket for the service role only.
-- ===========================================================================
revoke all on function public.camp_unique_slug(uuid, text) from public, anon, authenticated;
revoke all on function public.camp_copy_config(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.camp_move_edition_core(uuid, uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.camp_split_by_season_core(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.camp_duplicate_core(uuid, uuid, text, text, int, uuid) from public, anon, authenticated;
revoke all on function public.program_slug_redirects_guard() from public, anon, authenticated;
revoke all on function public.register_camp_basket(jsonb) from public, anon, authenticated;
revoke all on function public.move_camp_edition(uuid, uuid, boolean) from public, anon;
revoke all on function public.split_camp_by_season(uuid, jsonb) from public, anon;
revoke all on function public.duplicate_camp_next_year(uuid, text, text, int) from public, anon;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.move_camp_edition(uuid, uuid, boolean) to authenticated;
    grant execute on function public.split_camp_by_season(uuid, jsonb) to authenticated;
    grant execute on function public.duplicate_camp_next_year(uuid, text, text, int) to authenticated;
    grant execute on function public.camp_season_of(date) to authenticated;
    grant execute on function public.camp_season_year_of(date) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.register_camp_basket(jsonb) to service_role;
    grant execute on function public.camp_season_of(date) to service_role;
    grant execute on function public.camp_season_year_of(date) to service_role;
  end if;
end $$;
