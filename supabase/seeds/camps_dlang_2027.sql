-- ============================================================================
-- Demo data: DLang 2027 camp calendar (NOT a test seed — see
-- testing/seed_plan.conf, which skips it; tests/db/camps_discounts.sql loads
-- it explicitly to prove it is idempotent).
--
-- Runs only when the organisation with slug 'dlang' exists. Idempotent: every
-- row is looked up before it is created, so running it again changes nothing.
--
--   Camp "Skills & Technical Development Camp" (programme kind 'camp')
--   Editions 2027: 5–9 Apr Lausanne, 12–16 Jul Lausanne, 19–23 Jul Zurich,
--                  2–6 Aug Zurich, 4–8 Oct Lausanne
--   Time slots 09:00–12:00 and 13:30–16:00; age groups 8–12 and 12–17
--   Price options 2–5 days × with / without lunch
--   Registration open now until the Friday before each edition
--   Discounts: sibling 10% from the 2nd child (ACTIVE), early bird example (inactive)
--
--   psql "$DATABASE_URL" -f supabase/seeds/camps_dlang_2027.sql
-- ============================================================================
do $$
declare
  v_org      uuid;
  v_cur      text;
  v_tz       text;
  v_prog     uuid;
  v_lausanne uuid;
  v_zurich   uuid;
  v_morning  uuid;
  v_after    uuid;
  e          record;
  o          record;
begin
  select id, upper(coalesce(currency, 'CHF')), coalesce(nullif(timezone, ''), 'Europe/Zurich')
    into v_org, v_cur, v_tz
    from public.organizations where slug = 'dlang';
  if v_org is null then
    raise notice 'camps_dlang_2027: no organisation with slug dlang — nothing to do';
    return;
  end if;

  -- Venues -------------------------------------------------------------------
  select id into v_lausanne from public.venues where org_id = v_org and name = 'Vieux Moulin';
  if v_lausanne is null then
    insert into public.venues (org_id, name, address, city, postal_code, country)
    values (v_org, 'Vieux Moulin', 'Salle Omnisport du Vieux Moulin, Rte des Plaines-du-Loup 6', 'Lausanne', '1018', 'CH')
    returning id into v_lausanne;
  end if;
  select id into v_zurich from public.venues where org_id = v_org and name = 'Zurich International School';
  if v_zurich is null then
    insert into public.venues (org_id, name, city, country, notes)
    values (v_org, 'Zurich International School', 'Zürich', 'CH', 'Address to confirm with the school.')
    returning id into v_zurich;
  end if;

  -- Camp programme -------------------------------------------------------------
  select id into v_prog from public.programs where org_id = v_org and slug = 'dlang-skills-technical-camp-2027';
  if v_prog is null then
    insert into public.programs (org_id, slug, name, kind, description, price_chf, currency, min_age, max_age,
                                 location, is_public, status, schedule)
    values (v_org, 'dlang-skills-technical-camp-2027', 'Skills & Technical Development Camp', 'camp',
            'Monday to Friday, half-day sessions. Boys & girls. Choose 2 to 5 days, with or without lunch.',
            0, v_cur, 8, 17, 'Lausanne · Zurich', true, 'published',
            jsonb_build_object('summary', 'Mon–Fri · 09:00–12:00 / 13:30–16:00'))
    returning id into v_prog;
  end if;

  -- Time slots (every edition) -------------------------------------------------
  select id into v_morning from public.camp_time_slots where program_id = v_prog and edition_id is null and starts_at = '09:00';
  if v_morning is null then
    insert into public.camp_time_slots (org_id, program_id, label, starts_at, ends_at, sort)
    values (v_org, v_prog, 'Morning', '09:00', '12:00', 1) returning id into v_morning;
  end if;
  select id into v_after from public.camp_time_slots where program_id = v_prog and edition_id is null and starts_at = '13:30';
  if v_after is null then
    insert into public.camp_time_slots (org_id, program_id, label, starts_at, ends_at, sort)
    values (v_org, v_prog, 'Afternoon', '13:30', '16:00', 2) returning id into v_after;
  end if;

  -- Age groups -------------------------------------------------------------------
  insert into public.camp_age_groups (org_id, program_id, label, min_age, max_age, time_slot_id, sort)
  select v_org, v_prog, g.label, g.min_age, g.max_age, g.slot, g.sort
    from (values ('8–12', 8::smallint, 12::smallint, v_morning, 1),
                 ('12–17', 12::smallint, 17::smallint, v_after, 2)) as g(label, min_age, max_age, slot, sort)
   where not exists (select 1 from public.camp_age_groups x where x.program_id = v_prog and x.label = g.label);

  -- Price options (every edition) ------------------------------------------------
  for o in
    select * from (values
      (2, true, 250.00, 1), (2, false, 200.00, 2),
      (3, true, 350.00, 3), (3, false, 300.00, 4),
      (4, true, 450.00, 5), (4, false, 400.00, 6),
      (5, true, 550.00, 7), (5, false, 500.00, 8)
    ) as t(days, lunch, price, sort)
  loop
    if not exists (select 1 from public.camp_price_options
                    where program_id = v_prog and edition_id is null and days_count = o.days and includes_lunch = o.lunch) then
      insert into public.camp_price_options (org_id, program_id, label, days_count, includes_lunch, price, sort)
      values (v_org, v_prog,
              o.days || ' days – ' || case when o.lunch then 'with lunch' else 'without lunch' end,
              o.days, o.lunch, o.price, o.sort);
    end if;
  end loop;

  -- Editions ------------------------------------------------------------------------
  for e in
    select * from (values
      ('Easter 2027',     date '2027-04-05', date '2027-04-09', v_lausanne, 'Lausanne'),
      ('Summer 2027 · 1', date '2027-07-12', date '2027-07-16', v_lausanne, 'Lausanne'),
      ('Summer 2027 · 2', date '2027-07-19', date '2027-07-23', v_zurich,   'Zürich'),
      ('Summer 2027 · 3', date '2027-08-02', date '2027-08-06', v_zurich,   'Zürich'),
      ('Autumn 2027',     date '2027-10-04', date '2027-10-08', v_lausanne, 'Lausanne')
    ) as t(name, starts_on, ends_on, venue, city)
  loop
    if not exists (select 1 from public.camp_editions where program_id = v_prog and starts_on = e.starts_on and venue_id = e.venue) then
      insert into public.camp_editions (org_id, program_id, name, starts_on, ends_on, venue_id, city, status,
                                        registration_opens_at, registration_closes_at)
      values (v_org, v_prog, e.name, e.starts_on, e.ends_on, e.venue, e.city, 'published',
              now(),
              -- the Friday before the Monday start, end of day in the club's time zone
              ((e.starts_on - 3)::timestamp + time '23:59') at time zone v_tz);
    end if;
  end loop;

  -- Example discounts (inactive until the club turns them on) ----------------------
  if not exists (select 1 from public.discounts where org_id = v_org and rule = 'sibling' and name = 'Sibling discount') then
    insert into public.discounts (org_id, name, description, kind, value, scope, rule, sibling_min_position, is_active)
    values (v_org, 'Sibling discount', '10% for the second and every further child of the same family.',
            'percent', 10, 'camps', 'sibling', 2, true);
  end if;
  if not exists (select 1 from public.discounts where org_id = v_org and rule = 'early_bird' and name = 'Early bird') then
    insert into public.discounts (org_id, name, description, kind, value, scope, scope_program_id, rule,
                                  early_bird_days_before, is_active)
    values (v_org, 'Early bird', '10% when booked at least 30 days before the camp starts.',
            'percent', 10, 'program', v_prog, 'early_bird', 30, false);
  end if;

  raise notice 'camps_dlang_2027: camp % ready', v_prog;
end $$;
