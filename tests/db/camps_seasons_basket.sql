-- ============================================================================
-- Camp seasons + camp basket (migration 20250420101200_camp_seasons_basket.sql):
--   * migration re-applies cleanly (idempotent)
--   * season helpers (spring / summer / fall / winter + winter year)
--   * DLang data script supabase/seeds/camps_dlang_2027_split.sql: one camp
--     per season, same options / age groups / slots, registrations move with
--     their week, old slug redirects to Summer, second run changes nothing
--   * program_slug_redirects: RLS per verb + cross-tenant denial
--   * move_camp_edition(): admin only, own org only, refuses a week with
--     registrations unless confirmed, carries the week's prices, remaps refs
--   * split_camp_by_season() / duplicate_camp_next_year(): admin, own org
--   * register_camp_basket(): service only, all-or-nothing (capacity failure
--     on one line writes nothing), per-line errors, multi-week + promo rules,
--     public guest family created once, admin may book a closed week,
--     cross-tenant denial (org / family / athlete / programme)
--   * discounts: 'multi_week' rule; cover focal point range
--
-- Fixtures (seed): org A …0001 'dlang' (admin …f1, finance …f2, coach …f3,
-- parent …f4 = guardian of family …061 / athlete …071), family …062
-- (athletes …072, …073). Org B = …0002; its admin is created here.
-- Every assertion prints PASS / FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

\i supabase/migrations/20250420101200_camp_seasons_basket.sql
\i supabase/seeds/camps_dlang_2027.sql

create schema sb;
grant usage on schema sb to authenticated, anon;

create function sb.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function sb.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function sb.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- p_sql as user p (null = anon): 'OK:<first column>' or 'ERR:<message>'.
create function sb.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform sb.as_user(p);
    execute p_sql into v_res;
    perform sb.as_super();
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform sb.as_super();
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;

-- register_camp_basket as the service: 'OK:<json>' or 'ERR:<message>|<detail>'.
create function sb.basket(p_payload jsonb) returns text language plpgsql as $$
declare v_msg text; v_det text; v_res text;
begin
  begin
    perform sb.as_super();
    v_res := public.register_camp_basket(p_payload)::text;
    return 'OK:' || v_res;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_det = pg_exception_detail;
    return 'ERR:' || coalesce(v_msg, 'error') || '|' || coalesce(v_det, '');
  end;
end $$;
grant execute on all functions in schema sb to authenticated, anon;

create table sb.ctx (k text primary key, v text);
grant all on sb.ctx to authenticated;
create function sb.get(p text) returns uuid language sql as $$ select v::uuid from sb.ctx where k = p $$;
grant execute on function sb.get(text) to authenticated, anon;

-- Anchor for the test camps (weeks at +40..+58 days). Multi-week positions are
-- counted per child per calendar year and the fixtures below register the child
-- in 2027, so the test weeks must sit inside one calendar year other than 2027.
-- Normally that is simply today; near a year end or in 2027 it moves to the
-- next suitable January (ages stay within the 8-12 group).
create function sb.d0() returns date language plpgsql as $$
declare y int := extract(year from current_date + 40)::int;
begin
  if y <> 2027 and extract(year from current_date + 58)::int = y then return current_date; end if;
  y := greatest(y + 1, 2028);
  return make_date(y, 1, 10);
end $$;
grant execute on function sb.d0() to authenticated, anon;

create function sb.days(p_from int, p_n int) returns jsonb language sql as $$
  select jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d)
    from (select (sb.d0() + p_from + g)::date d from generate_series(0, p_n - 1) g) x
$$;

-- Org B admin
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test') on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin')
on conflict do nothing;

-- ===========================================================================
-- 1. Season helpers
-- ===========================================================================
do $$
begin
  perform sb.ok(public.camp_season_of('2027-04-05') = 'spring' and public.camp_season_of('2027-07-12') = 'summer'
            and public.camp_season_of('2027-08-31') = 'summer' and public.camp_season_of('2027-10-04') = 'fall'
            and public.camp_season_of('2027-12-27') = 'winter' and public.camp_season_of('2028-02-14') = 'winter',
                'season of a day: Mar–May spring, Jun–Aug summer, Sep–Nov fall, Dec–Feb winter');
  perform sb.ok(public.camp_season_year_of('2027-12-27') = 2027 and public.camp_season_year_of('2028-02-14') = 2027
            and public.camp_season_year_of('2027-04-05') = 2027, 'a winter belongs to the year of its December');
end $$;

-- ===========================================================================
-- 2. DLang split script: one camp per season, registrations move with weeks
-- ===========================================================================
do $$
declare v_prog uuid; v_spring uuid; v_summer uuid; v_g812 uuid; v_g1217 uuid; v_o uuid; v_reg uuid;
begin
  select id into v_prog from public.programs where slug = 'dlang-skills-technical-camp-2027';
  insert into sb.ctx values ('orig', v_prog::text);
  select id into v_spring from public.camp_editions where program_id = v_prog and starts_on = '2027-04-05';
  select id into v_summer from public.camp_editions where program_id = v_prog and starts_on = '2027-07-19';
  insert into sb.ctx values ('ed_spring', v_spring::text), ('ed_summer2', v_summer::text);
  select id into v_g812 from public.camp_age_groups where program_id = v_prog and min_age = 8;
  select id into v_g1217 from public.camp_age_groups where program_id = v_prog and min_age = 12;
  select id into v_o from public.camp_price_options where program_id = v_prog and days_count = 5 and includes_lunch;
  -- existing registrations (written as the service, like register_camp)
  perform set_config('app.camp_pricing', 'on', true);
  insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id, camp_price_option_id, camp_age_group_id,
                                    camp_days, camp_includes_lunch, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', v_prog, 'confirmed', v_spring, v_o, v_g812,
          array['2027-04-05','2027-04-06','2027-04-07','2027-04-08','2027-04-09']::date[], true, 550, 0, 550, 'CHF', '{"option_label": "5 days"}')
  returning id into v_reg;
  insert into sb.ctx values ('reg_spring', v_reg::text);
  insert into public.registrations (org_id, athlete_id, program_id, status, camp_edition_id, camp_price_option_id, camp_age_group_id,
                                    camp_days, camp_includes_lunch, price_list_amount, price_discount_amount, price_amount, price_currency, price_snapshot)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', v_prog, 'pending', v_summer, v_o, v_g1217,
          array['2027-07-19','2027-07-20','2027-07-21','2027-07-22','2027-07-23']::date[], true, 550, 0, 550, 'CHF', '{"option_label": "5 days"}')
  returning id into v_reg;
  insert into sb.ctx values ('reg_summer', v_reg::text);
  perform set_config('app.camp_pricing', 'off', true);
end $$;

\i supabase/seeds/camps_dlang_2027_split.sql

do $$
declare v_sp uuid; v_su uuid; v_fa uuid; t record; v_counts text;
begin
  select id into v_sp from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'dlang-spring-camp-2027';
  select id into v_su from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'dlang-summer-camp-2027';
  select id into v_fa from public.programs where org_id = '00000000-0000-0000-0000-000000000001' and slug = 'dlang-fall-camp-2027';
  insert into sb.ctx values ('spring', v_sp::text), ('summer', v_su::text), ('fall', v_fa::text);
  perform sb.ok(v_sp is not null and v_su is not null and v_fa is not null, 'split: Spring / Summer / Fall 2027 camps with their own slugs');
  perform sb.ok(v_su = sb.get('orig'), 'split: the original programme (id kept) is the Summer camp');
  perform sb.ok((select name from public.programs where id = v_sp) = 'Spring Camp 2027'
            and (select name from public.programs where id = v_su) = 'Summer Camp 2027'
            and (select name from public.programs where id = v_fa) = 'Fall Camp 2027', 'split: camp names');
  perform sb.ok((select season = 'spring' and season_year = 2027 from public.programs where id = v_sp)
            and (select season = 'summer' and season_year = 2027 from public.programs where id = v_su)
            and (select season = 'fall' and season_year = 2027 from public.programs where id = v_fa), 'split: season + year set');
  perform sb.ok((select count(*) from public.camp_editions where program_id = v_sp) = 1
            and (select count(*) from public.camp_editions where program_id = v_su) = 3
            and (select count(*) from public.camp_editions where program_id = v_fa) = 1, 'split: editions 1 / 3 / 1');
  perform sb.ok((select starts_on = '2027-04-05' and city = 'Lausanne' from public.camp_editions where program_id = v_sp)
            and (select starts_on = '2027-10-04' from public.camp_editions where program_id = v_fa)
            and (select array_agg(starts_on order by starts_on) = array['2027-07-12','2027-07-19','2027-08-02']::date[] from public.camp_editions where program_id = v_su),
                'split: the right weeks in each camp');
  for t in select id from public.programs where id in (v_sp, v_su, v_fa) loop
    perform sb.ok((select count(*) from public.camp_price_options where program_id = t.id and edition_id is null) = 8
              and (select count(*) from public.camp_age_groups where program_id = t.id) = 2
              and (select count(*) from public.camp_time_slots where program_id = t.id and edition_id is null) = 2
              and (select count(*) from public.camp_price_options where program_id = t.id and edition_id is not null) = 0,
                  'split: same 8 price options, 2 age groups, 2 slots, no overrides — ' || t.id);
  end loop;
  perform sb.ok((select price from public.camp_price_options where program_id = v_fa and days_count = 5 and includes_lunch) = 550
            and (select price from public.camp_price_options where program_id = v_sp and days_count = 2 and not includes_lunch) = 200,
                'split: prices carried (5d lunch 550, 2d without 200)');
  perform sb.ok((select g.time_slot_id is not null and s.starts_at = '09:00' and s.program_id = v_sp
                   from public.camp_age_groups g join public.camp_time_slots s on s.id = g.time_slot_id
                  where g.program_id = v_sp and g.min_age = 8), 'split: age group 8–12 linked to the copied morning slot');
  perform sb.ok((select description from public.programs where id = v_sp) = (select description from public.programs where id = v_su),
                'split: description copied');
  perform sb.ok((select program_id = v_sp and camp_edition_id = sb.get('ed_spring')
                        and camp_price_option_id in (select id from public.camp_price_options where program_id = v_sp)
                        and camp_age_group_id in (select id from public.camp_age_groups where program_id = v_sp and min_age = 8)
                        and price_amount = 550
                   from public.registrations where id = sb.get('reg_spring')), 'split: spring registration moved with its week, refs remapped, price kept');
  perform sb.ok((select program_id = v_su from public.registrations where id = sb.get('reg_summer')), 'split: summer registration stays in the Summer camp');
  perform sb.ok((select program_id from public.program_slug_redirects
                  where org_id = '00000000-0000-0000-0000-000000000001' and old_slug = 'dlang-skills-technical-camp-2027') = v_su,
                'split: old slug redirects to the Summer camp');
  perform sb.ok(exists (select 1 from public.audit_logs where action = 'camp.split_by_season' and target_id = v_su)
            and (select count(*) from public.audit_logs where action = 'camp.move_edition') >= 2, 'split: audit log rows');
  select format('%s/%s/%s/%s/%s', (select count(*) from public.programs where kind = 'camp'), (select count(*) from public.camp_editions),
                (select count(*) from public.camp_price_options), (select count(*) from public.camp_age_groups),
                (select count(*) from public.program_slug_redirects)) into v_counts;
  insert into sb.ctx values ('counts', v_counts);
end $$;

\i supabase/seeds/camps_dlang_2027_split.sql

do $$
begin
  perform sb.ok(format('%s/%s/%s/%s/%s', (select count(*) from public.programs where kind = 'camp'), (select count(*) from public.camp_editions),
                (select count(*) from public.camp_price_options), (select count(*) from public.camp_age_groups),
                (select count(*) from public.program_slug_redirects)) = (select v from sb.ctx where k = 'counts'),
                'split script: second run changes nothing (idempotent)');
end $$;

-- ===========================================================================
-- 3. program_slug_redirects: RLS + cross-tenant
-- ===========================================================================
do $$
declare v text; a_admin uuid := '00000000-0000-0000-0000-0000000000f1'; a_parent uuid := '00000000-0000-0000-0000-0000000000f4';
  a_fin uuid := '00000000-0000-0000-0000-0000000000f2'; b uuid := 'b0000000-0000-0000-0000-0000000000b1';
begin
  v := sb.run_as(a_parent, 'select count(*) from public.program_slug_redirects');
  perform sb.ok(v = 'OK:1', 'redirects: member of the club reads its redirects (' || v || ')');
  v := sb.run_as(a_parent, format($q$insert into public.program_slug_redirects (org_id, old_slug, program_id) values ('00000000-0000-0000-0000-000000000001', 'x-old', %L) returning id::text$q$, sb.get('spring')));
  perform sb.ok(v like 'ERR:%', 'redirects: parent cannot create one');
  v := sb.run_as(a_fin, format($q$insert into public.program_slug_redirects (org_id, old_slug, program_id) values ('00000000-0000-0000-0000-000000000001', 'x-old', %L) returning id::text$q$, sb.get('spring')));
  perform sb.ok(v like 'ERR:%', 'redirects: finance cannot create one (admin only)');
  v := sb.run_as(a_admin, format($q$insert into public.program_slug_redirects (org_id, old_slug, program_id) values ('00000000-0000-0000-0000-000000000001', 'Spring-Old', %L) returning old_slug$q$, sb.get('spring')));
  perform sb.ok(v = 'OK:spring-old', 'redirects: admin creates one (slug normalised) (' || v || ')');
  v := sb.run_as(a_admin, format($q$insert into public.program_slug_redirects (org_id, old_slug, program_id) values ('00000000-0000-0000-0000-000000000001', 'dlang-fall-camp-2027', %L) returning id::text$q$, sb.get('spring')));
  perform sb.ok(v like '%SLUG_IN_USE%', 'redirects: cannot shadow a live programme slug');
  v := sb.run_as(a_parent, 'with u as (delete from public.program_slug_redirects returning 1) select count(*) from u');
  perform sb.ok(v = 'OK:0', 'redirects: parent cannot delete');
  v := sb.run_as(b, $q$select count(*) from public.program_slug_redirects where org_id = '00000000-0000-0000-0000-000000000001'$q$);
  perform sb.ok(v = 'OK:0', 'cross-tenant: org B admin reads no org A redirect');
  v := sb.run_as(b, $q$with u as (update public.program_slug_redirects set old_slug = 'hijack' where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*) from u$q$);
  perform sb.ok(v = 'OK:0', 'cross-tenant: org B admin updates no org A redirect');
  v := sb.run_as(b, $q$with u as (delete from public.program_slug_redirects where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*) from u$q$);
  perform sb.ok(v = 'OK:0', 'cross-tenant: org B admin deletes no org A redirect');
  v := sb.run_as(b, format($q$insert into public.program_slug_redirects (org_id, old_slug, program_id) values ('00000000-0000-0000-0000-000000000001', 'b-old', %L) returning id::text$q$, sb.get('spring')));
  perform sb.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot insert into org A');
  v := sb.run_as(b, format($q$insert into public.program_slug_redirects (org_id, old_slug, program_id) values ('10000000-0000-0000-0000-000000000002', 'b-old', %L) returning id::text$q$, sb.get('spring')));
  perform sb.ok(v like 'ERR:%', 'cross-tenant: org B redirect cannot point at an org A camp (' || left(v, 60) || ')');
  v := sb.run_as(null, 'select count(*) from public.program_slug_redirects');
  perform sb.ok(v like 'ERR:%' or v = 'OK:0', 'redirects: anon reads nothing directly');
end $$;

-- ===========================================================================
-- 4. Test camps relative to today (the 2027 dates age out) + multi_week rule
-- ===========================================================================
do $$
declare v_a uuid; v_b uuid; v_e1 uuid; v_e2 uuid; v_e3 uuid; v_d uuid; v_src uuid := sb.get('summer');
  v_org uuid := '00000000-0000-0000-0000-000000000001';
begin
  insert into public.programs (org_id, slug, name, kind, is_public, status) values (v_org, 'test-camp-a', 'Test Camp A', 'camp', true, 'published') returning id into v_a;
  insert into public.programs (org_id, slug, name, kind, is_public, status) values (v_org, 'test-camp-b', 'Test Camp B', 'camp', true, 'published') returning id into v_b;
  perform public.camp_copy_config(v_org, v_src, v_a);
  perform public.camp_copy_config(v_org, v_src, v_b);
  insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, city, capacity, status, registration_opens_at, registration_closes_at)
  values (v_org, v_a, 'Week 1', sb.d0() + 40, sb.d0() + 44, 'Lausanne', 3, 'published', now() - interval '1 day', now() + interval '30 days') returning id into v_e1;
  insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, city, capacity, status, registration_opens_at, registration_closes_at)
  values (v_org, v_a, 'Week 2', sb.d0() + 47, sb.d0() + 51, 'Lausanne', 10, 'published', now() - interval '1 day', now() + interval '30 days') returning id into v_e2;
  insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, city, capacity, status, registration_opens_at, registration_closes_at)
  values (v_org, v_b, 'Week 3', sb.d0() + 54, sb.d0() + 58, 'Zurich', 1, 'published', now() - interval '1 day', now() + interval '30 days') returning id into v_e3;
  insert into sb.ctx values ('A', v_a::text), ('B', v_b::text), ('e1', v_e1::text), ('e2', v_e2::text), ('e3', v_e3::text);
  insert into sb.ctx select 'a5l', id::text from public.camp_price_options where program_id = v_a and days_count = 5 and includes_lunch and edition_id is null;
  insert into sb.ctx select 'a2n', id::text from public.camp_price_options where program_id = v_a and days_count = 2 and not includes_lunch and edition_id is null;
  insert into sb.ctx select 'b2n', id::text from public.camp_price_options where program_id = v_b and days_count = 2 and not includes_lunch and edition_id is null;
  insert into sb.ctx select 'ag812', id::text from public.camp_age_groups where program_id = v_a and min_age = 8;
  insert into sb.ctx select 'ag1217', id::text from public.camp_age_groups where program_id = v_a and min_age = 12;
  insert into sb.ctx select 'bg812', id::text from public.camp_age_groups where program_id = v_b and min_age = 8;
  insert into sb.ctx select 'bg1217', id::text from public.camp_age_groups where program_id = v_b and min_age = 12;

  insert into public.discounts (org_id, name, kind, value, scope, rule, is_active)
  values (v_org, 'Multi-week', 'percent', 10, 'camps', 'multi_week', true) returning id into v_d;
  insert into sb.ctx values ('mw', v_d::text);
  perform sb.ok((select multi_week_min_position from public.discounts where id = v_d) = 2, 'multi_week: from the 2nd week by default');
  insert into public.discounts (org_id, name, kind, value, currency, scope, rule, code, max_redemptions, is_active)
  values (v_org, 'Once', 'fixed_amount', 25, 'CHF', 'camps', 'promo_code', 'ONCE27', 1, true) returning id into v_d;
  insert into sb.ctx values ('once', v_d::text);
  insert into sb.ctx select 'sib', id::text from public.discounts where org_id = v_org and rule = 'sibling';
end $$;

do $$
declare v text;
begin
  v := sb.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.discounts (org_id, name, kind, value, rule, multi_week_min_position) values ('00000000-0000-0000-0000-000000000001', 'x', 'percent', 5, 'multi_week', 1) returning id::text$q$);
  perform sb.ok(v like 'ERR:%', 'multi_week: position below 2 refused');
  v := sb.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.discounts (org_id, name, kind, value, rule, multi_week_min_position) values ('00000000-0000-0000-0000-000000000001', 'x3', 'percent', 5, 'multi_week', 3) returning multi_week_min_position::text$q$);
  perform sb.ok(v = 'OK:3', 'multi_week: admin creates a rule from the 3rd week (' || v || ')');
  v := sb.run_as('00000000-0000-0000-0000-0000000000f1', format($q$with u as (update public.programs set cover_focal_x = 150 where id = %L returning 1) select count(*) from u$q$, sb.get('A')));
  perform sb.ok(v like 'ERR:%', 'cover focal point must be 0–100');
  v := sb.run_as('00000000-0000-0000-0000-0000000000f1', format($q$with u as (update public.camp_editions set cover_path = '00000000-0000-0000-0000-000000000001/covers/a.webp', cover_focal_y = 30 where id = %L returning cover_focal_x) select string_agg(cover_focal_x::text, ',') from u$q$, sb.get('e1')));
  perform sb.ok(v = 'OK:50', 'edition cover set by admin, focal x defaults to 50 (' || v || ')');
  update public.camp_editions set cover_path = null where id = sb.get('e1');
end $$;

-- ===========================================================================
-- 5. register_camp_basket: grants, parent happy path, multi-week
-- ===========================================================================
create function sb.parent_payload(p_lines jsonb, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'parent',
    'family_id', '00000000-0000-0000-0000-000000000061', 'registered_by', '00000000-0000-0000-0000-0000000000f4',
    'children', jsonb_build_array(jsonb_build_object('ref', 'c1', 'athlete_id', '00000000-0000-0000-0000-000000000071')),
    'lines', p_lines, 'consents', '["media"]'::jsonb) || p_extra
$$;

create function sb.fam2(p_lines jsonb) returns jsonb language sql as $$
  select jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'parent',
    'family_id', '00000000-0000-0000-0000-000000000062',
    'children', jsonb_build_array(jsonb_build_object('ref', 'k1', 'athlete_id', '00000000-0000-0000-0000-000000000072'),
                                  jsonb_build_object('ref', 'k2', 'athlete_id', '00000000-0000-0000-0000-000000000073')),
    'lines', p_lines)
$$;

create function sb.line(p_key text, p_child text, p_prog text, p_ed text, p_grp text, p_opt text, p_days jsonb, p_list numeric, p_disc jsonb default '[]'::jsonb)
returns jsonb language sql as $$
  select jsonb_build_object('key', p_key, 'child_ref', p_child, 'program_id', sb.get(p_prog), 'edition_id', sb.get(p_ed),
                            'age_group_id', sb.get(p_grp), 'price_option_id', sb.get(p_opt), 'days', p_days,
                            'list_amount', p_list, 'discounts', p_disc)
$$;

do $$
declare v text;
begin
  perform sb.ok(not has_function_privilege('anon', 'public.register_camp_basket(jsonb)', 'execute')
            and not has_function_privilege('authenticated', 'public.register_camp_basket(jsonb)', 'execute'),
                'basket: no EXECUTE for anon / authenticated');
  v := sb.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.register_camp_basket('{}'::jsonb)::text$q$);
  perform sb.ok(v like 'ERR:%', 'basket: refused for a signed-in user');
  perform sb.ok(not has_function_privilege('authenticated', 'public.camp_move_edition_core(uuid, uuid, uuid, boolean, uuid)', 'execute')
            and not has_function_privilege('authenticated', 'public.camp_split_by_season_core(uuid, uuid, jsonb, uuid)', 'execute')
            and not has_function_privilege('authenticated', 'public.camp_duplicate_core(uuid, uuid, text, text, integer, uuid)', 'execute')
            and not has_function_privilege('anon', 'public.move_camp_edition(uuid, uuid, boolean)', 'execute'),
                'cores are not callable through the API; wrappers not for anon');
end $$;

do $$
declare v text; r jsonb; v_inv uuid; n_inv int := (select count(*) from public.invoices);
begin
  -- multi-week on the FIRST week of the child is refused
  v := sb.basket(sb.parent_payload(jsonb_build_array(
    sb.line('l00', 'c1', 'A', 'e1', 'ag812', 'a5l', sb.days(40, 5), 550, jsonb_build_array(jsonb_build_object('discount_id', sb.get('mw'), 'amount', 55))))));
  perform sb.ok(v like 'ERR:BASKET_INVALID%' and v like '%"key": "l00"%' and v like '%DISCOUNT_NOT_AVAILABLE%', 'basket: multi-week refused on the first week (' || left(v, 120) || ')');

  v := sb.basket(sb.parent_payload(jsonb_build_array(
    sb.line('l00', 'c1', 'A', 'e1', 'ag812', 'a5l', sb.days(40, 5), 550),
    sb.line('l01', 'c1', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('mw'), 'amount', 20))),
    sb.line('l02', 'c1', 'B', 'e3', 'bg812', 'b2n', sb.days(54, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('mw'), 'amount', 20))))));
  perform sb.ok(v like 'OK:%', 'basket (parent): one child, three weeks across two camps (' || left(v, 100) || ')');
  r := substr(v, 4)::jsonb;
  v_inv := (r->>'invoice_id')::uuid;
  insert into sb.ctx values ('inv_p', v_inv::text), ('reg_p0', r->'lines'->0->>'registration_id');
  perform sb.ok((select count(*) from public.invoices) = n_inv + 1, 'basket: exactly one invoice');
  perform sb.ok((select total_chf from public.invoices where id = v_inv) = 910, 'basket: total 550 + (200 − 10%) + (200 − 10%) = 910');
  perform sb.ok((select count(*) from public.invoice_items where invoice_id = v_inv) = 5
            and (select count(*) from public.invoice_items where invoice_id = v_inv and amount_chf = -20) = 2,
                'basket: one line per child-week + two negative multi-week lines');
  perform sb.ok((select count(*) from public.registrations where invoice_id = v_inv) = 3
            and (select count(distinct program_id) from public.registrations where invoice_id = v_inv) = 2,
                'basket: one registration per child-week, two camps');
  perform sb.ok((select program_id is null and currency = 'CHF' and registration_id is null from public.invoices where id = v_inv),
                'basket: multi-camp invoice has no single programme, club currency');
  perform sb.ok((select count(*) from public.applied_discounts where invoice_id = v_inv and rule = 'multi_week' and amount = 20) = 2,
                'basket: multi-week uses recorded');
  perform sb.ok((select price_snapshot->>'basket' = 'true' and price_snapshot->>'line_key' = 'l01' and price_amount = 180
                   from public.registrations where invoice_id = v_inv and camp_edition_id = sb.get('e2')), 'basket: price snapshot per line');
  perform sb.ok((select count(*) from public.consent_acceptances ca join public.consent_forms f on f.id = ca.consent_form_id
                  where f.key = 'media' and ca.athlete_id = '00000000-0000-0000-0000-000000000071' and ca.program_id in (sb.get('A'), sb.get('B'))) = 2,
                'basket: consent recorded per child and camp');
  perform sb.ok(exists (select 1 from public.audit_logs where action = 'camp.basket_checkout' and target_id = v_inv), 'basket: audit log row');
  perform sb.ok(public.invoice_activity_start(v_inv) = sb.d0() + 40, 'basket: instalment activity start = first week');
end $$;

-- ===========================================================================
-- 6. register_camp_basket: all-or-nothing + per-line errors
-- ===========================================================================
do $$
declare v text; n_inv int := (select count(*) from public.invoices); n_reg int := (select count(*) from public.registrations);
  n_ath int := (select count(*) from public.athletes);
begin
  -- family 062: week 2 is fine, week 3 (capacity 1) is already full
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'parent',
    'family_id', '00000000-0000-0000-0000-000000000062',
    'children', jsonb_build_array(jsonb_build_object('ref', 'k1', 'athlete_id', '00000000-0000-0000-0000-000000000072'),
                                  jsonb_build_object('ref', 'k2', 'athlete_id', '00000000-0000-0000-0000-000000000073')),
    'lines', jsonb_build_array(
      sb.line('l00', 'k2', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200),
      sb.line('l01', 'k2', 'B', 'e3', 'bg812', 'b2n', sb.days(54, 2), 200))));
  perform sb.ok(v like 'ERR:BASKET_INVALID%' and v like '%"key": "l01"%EDITION_FULL%' and v not like '%"key": "l00"%',
                'atomic: capacity failure reported on its line only (' || left(v, 140) || ')');
  perform sb.ok((select count(*) from public.invoices) = n_inv and (select count(*) from public.registrations) = n_reg,
                'atomic: nothing written when one line fails (no invoice, no registration)');

  -- several problems at once, each on its line (child 073 of family 062)
  v := sb.basket(sb.fam2(jsonb_build_array(
    sb.line('l00', 'k2', 'A', 'e1', 'ag812', 'a5l', sb.days(40, 5), 550),
    sb.line('l01', 'k2', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 150),
    sb.line('l02', 'k2', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200))));
  perform sb.ok(v not like '%"key": "l00"%' and v like '%"key": "l01"%PRICE_CHANGED%' and v like '%"key": "l02"%DUPLICATE_LINE%',
                'per-line errors: price changed + duplicate week, the good line is not flagged (' || left(v, 200) || ')');
  v := sb.basket(sb.parent_payload(jsonb_build_array(sb.line('l00', 'c1', 'A', 'e1', 'ag812', 'a5l', sb.days(40, 5), 550))));
  perform sb.ok(v like '%"key": "l00"%ALREADY_REGISTERED%', 'per-line errors: already registered for that week');
  v := sb.basket(sb.fam2(jsonb_build_array(sb.line('l00', 'k2', 'A', 'e2', 'ag812', 'a5l', sb.days(47, 3), 550))));
  perform sb.ok(v like '%INVALID_DAYS%', 'per-line errors: days must match the option');
  v := sb.basket(sb.fam2(jsonb_build_array(sb.line('l00', 'k2', 'A', 'e2', 'ag1217', 'a2n', sb.days(47, 2), 200))));
  perform sb.ok(v like '%AGE_OUT_OF_RANGE%', 'per-line errors: age group checked against the child');
  v := sb.basket(sb.fam2(jsonb_build_array(sb.line('l00', 'k2', 'A', 'e2', 'bg812', 'a2n', sb.days(47, 2), 200))));
  perform sb.ok(v like '%AGE_GROUP_NOT_FOUND%', 'per-line errors: age group must belong to the line''s camp');
  v := sb.basket(sb.fam2(jsonb_build_array(sb.line('l00', 'k2', 'A', 'e3', 'ag812', 'a2n', sb.days(54, 2), 200))));
  perform sb.ok(v like '%EDITION_NOT_FOUND%', 'per-line errors: the week must belong to the line''s camp');
  perform sb.ok((select count(*) from public.athletes) = n_ath, 'refusals create no athlete');
end $$;

-- Promo limit inside one basket, sibling discount, closed week (admin only)
do $$
declare v text; r jsonb;
begin
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'parent',
    'family_id', '00000000-0000-0000-0000-000000000062',
    'children', jsonb_build_array(jsonb_build_object('ref', 'k1', 'athlete_id', '00000000-0000-0000-0000-000000000072'),
                                  jsonb_build_object('ref', 'k2', 'athlete_id', '00000000-0000-0000-0000-000000000073')),
    'lines', jsonb_build_array(
      sb.line('l00', 'k1', 'A', 'e2', 'ag1217', 'a2n', sb.days(47, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('once'), 'amount', 25, 'code', 'once27'))),
      sb.line('l01', 'k2', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('once'), 'amount', 25, 'code', 'ONCE27'))))));
  perform sb.ok(v like '%"key": "l01"%PROMO_LIMIT_REACHED%' and v not like '%"key": "l00"%', 'promo: a single-use code works on one line only (' || left(v, 160) || ')');

  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'parent',
    'family_id', '00000000-0000-0000-0000-000000000062',
    'children', jsonb_build_array(jsonb_build_object('ref', 'k1', 'athlete_id', '00000000-0000-0000-0000-000000000072'),
                                  jsonb_build_object('ref', 'k2', 'athlete_id', '00000000-0000-0000-0000-000000000073')),
    'lines', jsonb_build_array(
      sb.line('l00', 'k1', 'A', 'e2', 'ag1217', 'a2n', sb.days(47, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('once'), 'amount', 25, 'code', 'ONCE27'))),
      sb.line('l01', 'k2', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('sib'), 'amount', 20))))));
  perform sb.ok(v like 'OK:%', 'basket: siblings, promo on one line + sibling on the other (' || left(v, 100) || ')');
  r := substr(v, 4)::jsonb;
  perform sb.ok((select total_chf from public.invoices where id = (r->>'invoice_id')::uuid) = 355, 'basket: 200 − 25 + 200 − 20 = 355');

  update public.camp_editions set registration_closes_at = now() - interval '1 minute', registration_opens_at = now() - interval '2 days' where id = sb.get('e1');
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'parent',
    'family_id', '00000000-0000-0000-0000-000000000062',
    'children', jsonb_build_array(jsonb_build_object('ref', 'k1', 'athlete_id', '00000000-0000-0000-0000-000000000073')),
    'lines', jsonb_build_array(sb.line('l00', 'k1', 'A', 'e1', 'ag812', 'a2n', sb.days(40, 2), 200))));
  perform sb.ok(v like '%REGISTRATION_CLOSED%', 'window: closed week refused for a parent');
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'admin',
    'family_id', '00000000-0000-0000-0000-000000000062', 'registered_by', '00000000-0000-0000-0000-0000000000f1',
    'children', jsonb_build_array(jsonb_build_object('ref', 'k1', 'athlete_id', '00000000-0000-0000-0000-000000000073')),
    'lines', jsonb_build_array(sb.line('l00', 'k1', 'A', 'e1', 'ag812', 'a2n', sb.days(40, 2), 200))));
  perform sb.ok(v like 'OK:%', 'admin on behalf of a family may book a closed week (' || left(v, 80) || ')');
  perform sb.ok((select registered_by from public.registrations where id = (substr(v, 4)::jsonb->'lines'->0->>'registration_id')::uuid)
                = '00000000-0000-0000-0000-0000000000f1', 'admin booking records who registered');
  update public.camp_editions set registration_closes_at = now() + interval '30 days' where id = sb.get('e1');
end $$;

-- Public (guest) basket: family + children created once for the whole basket
do $$
declare v text; r jsonb; v_fam uuid;
begin
  update public.camp_editions set capacity = 10 where id = sb.get('e3');
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'public',
    'parent', jsonb_build_object('name', 'Guest Parent', 'email', 'basket.guest@example.test', 'phone', '+41 00 000 00 00',
                                 'emergency_name', 'Contact', 'emergency_phone', '+41 00 000 00 01'),
    'children', jsonb_build_array(
      jsonb_build_object('ref', 'g1', 'first_name', 'Kid', 'last_name', 'Alpha', 'dob', to_char(current_date - interval '10 years', 'YYYY-MM-DD')),
      jsonb_build_object('ref', 'g2', 'first_name', 'Kid', 'last_name', 'Beta', 'dob', to_char(current_date - interval '9 years', 'YYYY-MM-DD'))),
    'lines', jsonb_build_array(
      sb.line('l00', 'g1', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200),
      sb.line('l01', 'g1', 'B', 'e3', 'bg812', 'b2n', sb.days(54, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('mw'), 'amount', 20))),
      sb.line('l02', 'g2', 'B', 'e3', 'bg812', 'b2n', sb.days(54, 2), 200, jsonb_build_array(jsonb_build_object('discount_id', sb.get('sib'), 'amount', 20)))),
    'consents', '["media", "terms"]'::jsonb));
  perform sb.ok(v like 'OK:%', 'basket (public): two new children, three weeks (' || left(v, 100) || ')');
  r := substr(v, 4)::jsonb;
  v_fam := (r->>'family_id')::uuid;
  perform sb.ok((select membership_status from public.families where id = v_fam) = 'guest'
            and (select count(*) from public.families where contact_email = 'basket.guest@example.test') = 1, 'public: one guest family');
  perform sb.ok((select count(*) from public.athletes where family_id = v_fam) = 2, 'public: each child created once (not per week)');
  perform sb.ok((select count(*) from public.invitations where family_id = v_fam and status = 'pending') = 1, 'public: one pending parent invitation');
  perform sb.ok((select total_chf from public.invoices where id = (r->>'invoice_id')::uuid) = 560, 'public: 200 + 180 + 180 = 560');
  perform sb.ok((select count(*) from public.consent_acceptances where athlete_id in (select id from public.athletes where family_id = v_fam)) = 6,
                'public: 2 consents × (child 1: 2 camps + child 2: 1 camp) = 6');
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'public',
    'parent', jsonb_build_object('name', 'X', 'email', 'x@example.test', 'phone', '0'),
    'children', jsonb_build_array(jsonb_build_object('ref', 'g1', 'first_name', 'K', 'last_name', 'X', 'dob', to_char(current_date - interval '10 years', 'YYYY-MM-DD'))),
    'lines', jsonb_build_array(sb.line('l00', 'g1', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200))));
  perform sb.ok(v like 'OK:%', 'public: a second guest basket works');
  update public.programs set is_public = false where id = sb.get('B');
  v := sb.basket(jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', 'public',
    'parent', jsonb_build_object('name', 'Y', 'email', 'y@example.test', 'phone', '0'),
    'children', jsonb_build_array(jsonb_build_object('ref', 'g1', 'first_name', 'K', 'last_name', 'Y', 'dob', to_char(current_date - interval '10 years', 'YYYY-MM-DD'))),
    'lines', jsonb_build_array(sb.line('l00', 'g1', 'B', 'e3', 'bg812', 'b2n', sb.days(54, 2), 200))));
  perform sb.ok(v like '%PROGRAM_NOT_OPEN%', 'public: a members-only camp cannot be booked publicly');
  update public.programs set is_public = true where id = sb.get('B');
end $$;

-- Cross-tenant denial for the basket
do $$
declare v text; n_inv int := (select count(*) from public.invoices);
begin
  v := sb.basket(sb.parent_payload(jsonb_build_array(sb.line('l00', 'c1', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200)),
                 '{"org_id": "10000000-0000-0000-0000-000000000002"}'));
  perform sb.ok(v like '%FAMILY_NOT_FOUND%', 'cross-tenant: an org A family cannot be billed under org B (' || left(v, 60) || ')');
  v := sb.basket(jsonb_build_object('org_id', '10000000-0000-0000-0000-000000000002', 'mode', 'public',
    'parent', jsonb_build_object('name', 'Z', 'email', 'z@example.test', 'phone', '0'),
    'children', jsonb_build_array(jsonb_build_object('ref', 'g1', 'first_name', 'K', 'last_name', 'Z', 'dob', to_char(current_date - interval '14 years', 'YYYY-MM-DD'))),
    'lines', jsonb_build_array(sb.line('l00', 'g1', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200))));
  perform sb.ok(v like '%PROGRAM_NOT_FOUND%', 'cross-tenant: org A camps cannot be booked under org B');
  v := sb.basket(sb.parent_payload(jsonb_build_array(sb.line('l00', 'c1', 'A', 'e2', 'ag812', 'a2n', sb.days(47, 2), 200)),
                 jsonb_build_object('children', jsonb_build_array(jsonb_build_object('ref', 'c1', 'athlete_id', '00000000-0000-0000-0000-000000000072')))));
  perform sb.ok(v like '%ATHLETE_NOT_FOUND%', 'basket: a child of another family is refused');
  perform sb.ok((select count(*) from public.invoices) = n_inv, 'cross-tenant refusals write nothing');
end $$;

-- ===========================================================================
-- 7. move_camp_edition
-- ===========================================================================
do $$
declare v text; a_admin uuid := '00000000-0000-0000-0000-0000000000f1'; a_parent uuid := '00000000-0000-0000-0000-0000000000f4';
  a_fin uuid := '00000000-0000-0000-0000-0000000000f2'; b uuid := 'b0000000-0000-0000-0000-0000000000b1';
  v_c uuid; n_regs int; v_snap numeric;
begin
  -- a third camp with a DIFFERENT price list (2-day option only, 260)
  insert into public.programs (org_id, slug, name, kind, is_public, status)
  values ('00000000-0000-0000-0000-000000000001', 'test-camp-c', 'Test Camp C', 'camp', true, 'published') returning id into v_c;
  insert into public.camp_price_options (org_id, program_id, label, days_count, includes_lunch, price)
  values ('00000000-0000-0000-0000-000000000001', v_c, '2 days', 2, false, 260);
  insert into sb.ctx values ('C', v_c::text);
  select count(*) into n_regs from public.registrations where camp_edition_id = sb.get('e2') and status <> 'cancelled';
  select sum(price_amount) into v_snap from public.registrations where camp_edition_id = sb.get('e2');

  v := sb.run_as(a_parent, format($q$select public.move_camp_edition(%L, %L, true)::text$q$, sb.get('e2'), v_c));
  perform sb.ok(v like '%NOT_AUTHORIZED%', 'move: refused for a parent');
  v := sb.run_as(a_fin, format($q$select public.move_camp_edition(%L, %L, true)::text$q$, sb.get('e2'), v_c));
  perform sb.ok(v like '%NOT_AUTHORIZED%', 'move: refused for finance (admin only)');
  v := sb.run_as(b, format($q$select public.move_camp_edition(%L, %L, true)::text$q$, sb.get('e2'), v_c));
  perform sb.ok(v like '%EDITION_NOT_FOUND%', 'cross-tenant: org B admin cannot move an org A week (' || left(v, 60) || ')');
  v := sb.run_as(a_admin, format($q$select public.move_camp_edition(%L, %L, false)::text$q$, sb.get('e2'), v_c));
  perform sb.ok(v like '%EDITION_HAS_REGISTRATIONS%', 'move: a week with registrations needs confirmation');
  v := sb.run_as(a_admin, format($q$select public.move_camp_edition(%L, %L, true)::text$q$, sb.get('e2'), sb.get('A')));
  perform sb.ok(v like '%SAME_CAMP%', 'move: target must be another camp');
  v := sb.run_as(a_admin, format($q$select public.move_camp_edition(%L, '00000000-0000-0000-0000-000000000043', true)::text$q$, sb.get('e2')));
  perform sb.ok(v like '%NOT_A_CAMP%' or v like '%PROGRAM_NOT_FOUND%', 'move: target must be a camp (' || left(v, 60) || ')');

  v := sb.run_as(a_admin, format($q$select public.move_camp_edition(%L, %L, true)::text$q$, sb.get('e2'), v_c));
  perform sb.ok(v like 'OK:%', 'move: admin moves the week with its registrations (' || left(v, 140) || ')');
  perform sb.ok((select program_id from public.camp_editions where id = sb.get('e2')) = v_c, 'move: week now in the target camp');
  perform sb.ok((select count(*) from public.camp_price_options where program_id = v_c and edition_id = sb.get('e2')) = 8,
                'move: different price list -> the week keeps its 8 prices as overrides');
  perform sb.ok((select count(*) from public.registrations where camp_edition_id = sb.get('e2') and program_id = v_c) =
                (select count(*) from public.registrations where camp_edition_id = sb.get('e2')), 'move: every registration moved');
  perform sb.ok(not exists (select 1 from public.registrations r where r.camp_edition_id = sb.get('e2')
                              and (r.camp_price_option_id not in (select id from public.camp_price_options where program_id = v_c)
                                   or r.camp_age_group_id not in (select id from public.camp_age_groups where program_id = v_c))),
                'move: option + age group refs remapped into the target camp');
  perform sb.ok((select sum(price_amount) from public.registrations where camp_edition_id = sb.get('e2')) = v_snap,
                'move: price snapshots unchanged');
  perform sb.ok((select count(*) from public.camp_age_groups where program_id = v_c and not is_active) >= 1,
                'move: missing age groups copied (inactive) into the target');
  v := sb.run_as(a_fin, format($q$with u as (update public.registrations set program_id = %L where camp_edition_id = %L returning 1) select count(*) from u$q$, sb.get('A'), sb.get('e2')));
  perform sb.ok(v like '%PRICE_SNAPSHOT_LOCKED%' or v like 'ERR:%', 'move: registrations still cannot be moved by a direct update');
  -- and back again (target's camp-wide prices equal the source's -> reuse rows)
  v := sb.run_as(a_admin, format($q$select public.move_camp_edition(%L, %L, true)::text$q$, sb.get('e1'), sb.get('B')));
  perform sb.ok(v like 'OK:%' and (substr(v, 4)::jsonb->>'options_copied')::int = 0, 'move: same price list -> no copies (' || left(v, 140) || ')');
  perform sb.ok(not exists (select 1 from public.registrations r where r.camp_edition_id = sb.get('e1')
                              and r.camp_price_option_id not in (select id from public.camp_price_options where program_id = sb.get('B') and edition_id is null)),
                'move: registrations mapped onto the target''s own price rows');
end $$;

-- ===========================================================================
-- 8. split_camp_by_season / duplicate_camp_next_year (admin wrappers)
-- ===========================================================================
do $$
declare v text; a_admin uuid := '00000000-0000-0000-0000-0000000000f1'; a_parent uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1'; r jsonb; v_new uuid;
begin
  v := sb.run_as(a_admin, format($q$select public.split_camp_by_season(%L, '{}'::jsonb)::text$q$, sb.get('fall')));
  perform sb.ok(v like '%NOTHING_TO_SPLIT%', 'split: a one-season camp has nothing to split');
  v := sb.run_as(b, format($q$select public.split_camp_by_season(%L, '{}'::jsonb)::text$q$, sb.get('summer')));
  perform sb.ok(v like '%PROGRAM_NOT_FOUND%', 'cross-tenant: org B admin cannot split an org A camp');
  v := sb.run_as(a_parent, format($q$select public.split_camp_by_season(%L, '{}'::jsonb)::text$q$, sb.get('summer')));
  perform sb.ok(v like '%NOT_AUTHORIZED%', 'split: refused for a parent');

  v := sb.run_as(a_parent, format($q$select public.duplicate_camp_next_year(%L)::text$q$, sb.get('summer')));
  perform sb.ok(v like '%NOT_AUTHORIZED%', 'duplicate: refused for a parent');
  v := sb.run_as(b, format($q$select public.duplicate_camp_next_year(%L)::text$q$, sb.get('summer')));
  perform sb.ok(v like '%PROGRAM_NOT_FOUND%', 'cross-tenant: org B admin cannot duplicate an org A camp');
  v := sb.run_as(a_admin, format($q$select public.duplicate_camp_next_year(%L, 'Summer Camp 2028', 'dlang-summer-camp-2028')::text$q$, sb.get('summer')));
  perform sb.ok(v like 'OK:%', 'duplicate: admin copies the Summer camp for next year (' || left(v, 120) || ')');
  r := substr(v, 4)::jsonb;
  v_new := (r->>'program_id')::uuid;
  perform sb.ok((select status = 'draft' and slug = 'dlang-summer-camp-2028' and name = 'Summer Camp 2028' and season = 'summer' and season_year = 2028
                   from public.programs where id = v_new), 'duplicate: draft camp, new slug + name, season year + 1');
  perform sb.ok((select array_agg(starts_on order by starts_on) from public.camp_editions where program_id = v_new)
                = (select array_agg(starts_on + 364 order by starts_on) from public.camp_editions where program_id = sb.get('summer')),
                'duplicate: weeks shifted by 52 weeks (same weekday)');
  perform sb.ok(not exists (select 1 from public.camp_editions where program_id = v_new and status <> 'draft'), 'duplicate: weeks are drafts');
  perform sb.ok((select count(*) from public.camp_price_options where program_id = v_new) = 8
            and (select count(*) from public.camp_age_groups where program_id = v_new) = 2
            and not exists (select 1 from public.registrations where program_id = v_new), 'duplicate: configuration copied, no registrations');
  v := sb.run_as(a_admin, format($q$select public.duplicate_camp_next_year(%L, null, 'dlang-summer-camp-2028')::text$q$, sb.get('summer')));
  perform sb.ok(v like 'OK:%' and (substr(v, 4)::jsonb->>'slug') = 'dlang-summer-camp-2028-2', 'duplicate: taken slug gets a suffix');
end $$;
