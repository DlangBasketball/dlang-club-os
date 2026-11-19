-- ============================================================================
-- Demo data script: DLang "Pro Training" set-up (personal + group training).
--
-- NOT a seed file: it is skipped by the test harness (testing/seed_plan.conf)
-- and is run by hand on a club database that has the org slug 'dlang':
--
--   psql "$DATABASE_URL" -f supabase/seeds/training_dlang.sql
--
-- Does nothing when no org has the slug 'dlang'. Idempotent: services,
-- packages, the venue and the weekly availability are created or updated in
-- place, never duplicated. Everything here stays editable in the admin UI
-- (/admin/services, /admin/availability); no code depends on these rows.
-- ============================================================================
do $$
declare
  v_org    uuid;
  v_venue  uuid;
  v_pt     uuid;
  v_group  uuid;
  v_coach  uuid;
  v_hours  constant jsonb := '{"1":[["10:00","18:00"]],"2":[["10:00","18:00"]],"3":[["10:00","18:00"]],"4":[["10:00","18:00"]],"5":[["10:00","18:00"]],"6":[["10:00","22:00"]],"7":[["10:00","22:00"]]}';
  v_pkg    record;
  d        integer;
begin
  select id into v_org from public.organizations where slug = 'dlang';
  if v_org is null then
    raise notice 'training_dlang: no org with slug dlang, nothing to do';
    return;
  end if;

  -- Venue (default location) with opening hours.
  select id into v_venue from public.venues where org_id = v_org and name = 'Dlang Gym';
  if v_venue is null then
    insert into public.venues (org_id, name, address, postal_code, city, country, opening_hours)
    values (v_org, 'Dlang Gym', 'Chemin d''Entre-Bois 21', '1018', 'Lausanne', 'CH', v_hours)
    returning id into v_venue;
  else
    update public.venues set opening_hours = coalesce(opening_hours, v_hours),
                             address = coalesce(address, 'Chemin d''Entre-Bois 21'),
                             postal_code = coalesce(postal_code, '1018'),
                             city = coalesce(city, 'Lausanne')
     where id = v_venue;
  end if;

  -- Personal Training (1-on-1): 60 min, single session 95 in the club currency.
  insert into public.training_services (org_id, slug, name, description, duration_min, price_chf, credit_category,
                                        session_type, max_participants, min_participants, venue_id, color, sort_order, is_active)
  values (v_org, 'personal-training', 'Personal Training (1-on-1)',
          'Individual session with a coach: choose your package, pick your coach, schedule your dates.',
          60, 95, 'personal', 'individual', 1, 1, v_venue, '#DA2627', 10, true)
  on conflict (org_id, slug) do update
    set name = excluded.name, duration_min = excluded.duration_min, price_chf = excluded.price_chf,
        session_type = excluded.session_type, max_participants = excluded.max_participants,
        min_participants = excluded.min_participants, venue_id = coalesce(public.training_services.venue_id, excluded.venue_id),
        is_active = true
  returning id into v_pt;

  -- Group Training: 2 to 6 athletes, 40 per person per session.
  insert into public.training_services (org_id, slug, name, description, duration_min, price_chf, credit_category,
                                        session_type, max_participants, min_participants, venue_id, color, sort_order, is_active)
  values (v_org, 'group-training', 'Group Training',
          'Small-group session (2 to 6 athletes). Price per person per session.',
          60, 40, 'personal', 'group', 6, 2, v_venue, '#C19A45', 20, true)
  on conflict (org_id, slug) do update
    set name = excluded.name, description = excluded.description, price_chf = excluded.price_chf,
        session_type = excluded.session_type, max_participants = excluded.max_participants,
        min_participants = excluded.min_participants, venue_id = coalesce(public.training_services.venue_id, excluded.venue_id),
        is_active = true
  returning id into v_group;

  -- Session packages for personal training (matched on sessions count).
  for v_pkg in select * from (values (5, 450::numeric, 10), (10, 850, 20), (16, 1280, 30), (20, 1500, 40)) as x(n, price, ord) loop
    update public.credit_packages
       set price_chf = v_pkg.price, sort_order = v_pkg.ord, is_active = true
     where org_id = v_org and service_id = v_pt and credits = v_pkg.n;
    if not found then
      insert into public.credit_packages (org_id, service_id, name, credit_category, credits, price_chf, sort_order, is_active)
      values (v_org, v_pt, v_pkg.n || ' sessions', 'personal', v_pkg.n, v_pkg.price, v_pkg.ord, true);
    end if;
  end loop;

  -- Coach Derrick Lang: offers both services, Mon-Fri 10:00-18:00 at the gym.
  select id into v_coach from public.coaches where org_id = v_org and display_name = 'Derrick Lang' limit 1;
  if v_coach is null then
    raise notice 'training_dlang: coach Derrick Lang not found, availability skipped';
    return;
  end if;
  update public.coaches
     set serves = (select array_agg(distinct s) from unnest(serves || array['personal-training', 'group-training']) s)
   where id = v_coach;
  for d in 1..5 loop
    if not exists (select 1 from public.coach_availability_templates
                    where org_id = v_org and coach_id = v_coach and weekday = d
                      and start_time = time '10:00' and end_time = time '18:00' and service_id is null) then
      insert into public.coach_availability_templates (org_id, coach_id, venue_id, weekday, start_time, end_time, capacity)
      values (v_org, v_coach, v_venue, d, time '10:00', time '18:00', 6);
    end if;
  end loop;
  raise notice 'training_dlang: done';
end $$;
