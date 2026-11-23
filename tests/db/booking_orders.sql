-- ============================================================================
-- Booking orders suite (migration 20250420104800_booking_orders.sql)
--
--   A. Pricing catalogue: options (1 Session + packages with totals), the
--      pricing editor (admin / finance; coach and other club refused), group
--      rate missing -> PRICING_MISSING.
--   B. Single session order: one date only, idempotent confirm, invoice once.
--   C. Package order: sold once at the agreed total (override needs a
--      reason), dates now and later consume the package exactly once,
--      cancellation restores per policy, the invoice is never touched.
--   D. Group order: rate 30, 4 players on date 1 + 3 on date 2 = 210; one
--      shared session per date; capacity and duplicate athlete refused;
--      invoices per payer with one line per athlete; payer visibility;
--      coach scope; payments (idempotent); partial cancel (one booking, one
--      date) with credit notes; reschedule of one date.
--   E. Mixed revenue categories refused on one invoice run.
--   F. Draft invoice: a cancelled booking leaves the draft line.
--   G. Idempotent invoice retries, To Invoice lists, single-booking paths.
--   H. RLS: no direct writes, guardians / coaches / other clubs see no orders.
--   I. Concurrency (dblink): two orders race for the last group place.
--   J. Open availability: dates outside the declared availability become
--      requests, never invoiced.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073). SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema bo;
grant usage on schema bo to authenticated, anon, service_role;
create table bo.ctx (k text primary key, v text);
grant all on bo.ctx to authenticated, anon, service_role;

create function bo.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function bo.put(p_k text, p_v text) returns void language sql as $$
  insert into bo.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function bo.get(p_k text) returns text language sql stable as $$ select v from bo.ctx where k = p_k $$;
create function bo.uid(p_k text) returns uuid language sql stable as $$ select v::uuid from bo.ctx where k = p_k $$;
create function bo.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
    execute p_sql into v_res;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
create function bo.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := bo.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
create function bo.err(p jsonb) returns text language sql immutable as $$ select split_part(p->>'err', ':', 1) $$;
create function bo.at(p_day text, p_hours numeric) returns text language sql stable as $$
  select (bo.get(p_day)::timestamptz + make_interval(mins => (p_hours * 60)::int))::text
$$;
-- RPC wrappers (as a user)
create function bo.quote(p_user text, p jsonb) returns jsonb language sql as $$
  select bo.j(bo.uid(p_user), format('select public.booking_order_quote(%L)::text', p))
$$;
create function bo.confirm(p_user text, p jsonb, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select bo.j(bo.uid(p_user), format('select public.booking_order_confirm(%L, %L)::text', p, p_req))
$$;
create function bo.invoice(p_user text, p_orders uuid[], p_req uuid default gen_random_uuid(), p_send boolean default true) returns jsonb language sql as $$
  select bo.j(bo.uid(p_user), format('select public.booking_order_create_invoices(%L::uuid[], %L, %L)::text', p_orders, p_req, p_send))
$$;
create function bo.detail(p_user text, p_order uuid) returns jsonb language sql as $$
  select bo.j(bo.uid(p_user), format('select public.booking_order_detail(%L)::text', p_order))
$$;
create function bo.cancel(p_user text, p_order uuid, p jsonb, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select bo.j(bo.uid(p_user), format('select public.booking_order_cancel(%L, %L, %L)::text', p_order, p, p_req))
$$;
create function bo.add_dates(p_user text, p_order uuid, p jsonb, p_req uuid default gen_random_uuid()) returns jsonb language sql as $$
  select bo.j(bo.uid(p_user), format('select public.booking_order_add_dates(%L, %L, %L)::text', p_order, p, p_req))
$$;
create function bo.count_as(p_user text, p_sql text) returns int language plpgsql as $$
declare r text := bo.run_as(bo.uid(p_user), p_sql);
begin
  if left(r, 3) <> 'OK:' or substr(r, 4) = '<null>' then return -1; end if;
  return substr(r, 4)::int;
end $$;
grant execute on all functions in schema bo to authenticated, anon, service_role;

select bo.put('org', '00000000-0000-0000-0000-000000000001'),
       bo.put('admin', '00000000-0000-0000-0000-0000000000f1'),
       bo.put('finance', '00000000-0000-0000-0000-0000000000f2'),
       bo.put('coach', '00000000-0000-0000-0000-0000000000f3'),
       bo.put('guardian', '00000000-0000-0000-0000-0000000000f4'),
       bo.put('coach2', '00000000-0000-0000-0000-0000000008b1'),
       bo.put('guardian2', '00000000-0000-0000-0000-0000000008b2'),
       bo.put('guardian3', '00000000-0000-0000-0000-0000000008b3'),
       bo.put('adminB', 'b0000000-0000-0000-0000-0000000008b5'),
       bo.put('coachRow', '00000000-0000-0000-0000-000000000011'),
       bo.put('coach2Row', '00000000-0000-0000-0000-000000000812'),
       bo.put('a71', '00000000-0000-0000-0000-000000000071'),
       bo.put('a72', '00000000-0000-0000-0000-000000000072'),
       bo.put('a73', '00000000-0000-0000-0000-000000000073'),
       bo.put('a74', '00000000-0000-0000-0000-000000000874'),
       bo.put('a75', '00000000-0000-0000-0000-000000000875'),
       bo.put('a76', '00000000-0000-0000-0000-000000000876'),
       bo.put('fam63', '00000000-0000-0000-0000-000000000863'),
       bo.put('venue', '00000000-0000-0000-0000-0000000008a1'),
       bo.put('svcPt', '00000000-0000-0000-0000-0000000008c1'),
       bo.put('svcGrp', '00000000-0000-0000-0000-0000000008c2'),
       bo.put('svcCamp', '00000000-0000-0000-0000-0000000008c3'),
       bo.put('svcNoRate', '00000000-0000-0000-0000-0000000008c4'),
       bo.put('sponsor', '00000000-0000-0000-0000-0000000008e1'),
       bo.put('pk5', '00000000-0000-0000-0000-0000000008d5'),
       bo.put('pk10', '00000000-0000-0000-0000-0000000008da'),
       bo.put('pk16', '00000000-0000-0000-0000-0000000008df'),
       bo.put('pk20', '00000000-0000-0000-0000-0000000008d2');

-- Days (UTC midnight). Club time zone Europe/Zurich; venue open 07:00-21:00
-- local; coach …011 declared 07:00-18:00 UTC on each day.
select bo.put('d1', ((current_date + 10)::timestamp at time zone 'UTC')::text),
       bo.put('d2', ((current_date + 11)::timestamp at time zone 'UTC')::text),
       bo.put('d3', ((current_date + 12)::timestamp at time zone 'UTC')::text),
       bo.put('d4', ((current_date + 13)::timestamp at time zone 'UTC')::text),
       bo.put('d5', ((current_date + 14)::timestamp at time zone 'UTC')::text);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000008b1', 'bo-coach2@example.test'),
  ('00000000-0000-0000-0000-0000000008b2', 'bo-guardian2@example.test'),
  ('00000000-0000-0000-0000-0000000008b3', 'bo-guardian3@example.test'),
  ('b0000000-0000-0000-0000-0000000008b5', 'bo-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic ' || left(id::text, 4)
 where id in ('00000000-0000-0000-0000-0000000008b1', '00000000-0000-0000-0000-0000000008b2', '00000000-0000-0000-0000-0000000008b3');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000008b5';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008b1', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008b2', 'parent'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008b3', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000008b5', 'admin');
insert into public.coaches (id, org_id, display_name, profile_id, is_active) values
  ('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000001', 'Synthetic Coach Two', '00000000-0000-0000-0000-0000000008b1', true);
insert into public.families (id, org_id, name, contact_email) values
  ('00000000-0000-0000-0000-000000000863', '00000000-0000-0000-0000-000000000001', 'Synthetic BO family', 'bo-family@example.test');
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000008b2', 'guardian'),
  ('00000000-0000-0000-0000-000000000863', '00000000-0000-0000-0000-0000000008b3', 'guardian');
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-000000000874', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000863', 'Synthetic', 'Four', '2013-02-02', 'active'),
  ('00000000-0000-0000-0000-000000000875', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000863', 'Synthetic', 'Five', '2013-03-03', 'active'),
  ('00000000-0000-0000-0000-000000000876', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000863', 'Synthetic', 'Six', '2013-04-04', 'active');
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';
insert into public.app_settings (org_id) values ('00000000-0000-0000-0000-000000000001') on conflict (org_id) do nothing;
update public.app_settings set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';

insert into public.venues (id, org_id, name, opening_hours) values
  ('00000000-0000-0000-0000-0000000008a1', '00000000-0000-0000-0000-000000000001', 'BO Hall',
   jsonb_build_object('1', '[["07:00","21:00"]]'::jsonb, '2', '[["07:00","21:00"]]'::jsonb, '3', '[["07:00","21:00"]]'::jsonb,
                      '4', '[["07:00","21:00"]]'::jsonb, '5', '[["07:00","21:00"]]'::jsonb, '6', '[["07:00","21:00"]]'::jsonb,
                      '7', '[["07:00","21:00"]]'::jsonb));
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, kind, session_type, max_participants, currency, venue_id, billing_category) values
  ('00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-000000000001', 'bo-pt', 'Personal Training (1-on-1)', 60, 95, 'private', 'individual', 1, 'CHF', '00000000-0000-0000-0000-0000000008a1', 'training'),
  ('00000000-0000-0000-0000-0000000008c2', '00000000-0000-0000-0000-000000000001', 'bo-grp', 'BO Group Training', 60, 0, 'group', 'group', 4, 'CHF', '00000000-0000-0000-0000-0000000008a1', 'training'),
  ('00000000-0000-0000-0000-0000000008c3', '00000000-0000-0000-0000-000000000001', 'bo-camp', 'BO Camp Group', 60, 0, 'group', 'group', 6, 'CHF', '00000000-0000-0000-0000-0000000008a1', 'camp'),
  ('00000000-0000-0000-0000-0000000008c4', '00000000-0000-0000-0000-000000000001', 'bo-norate', 'BO Unpriced Group', 60, 0, 'group', 'group', 6, 'CHF', '00000000-0000-0000-0000-0000000008a1', 'training');
update public.training_services set group_rate_chf = 30 where id = '00000000-0000-0000-0000-0000000008c2';
update public.training_services set group_rate_chf = 20 where id = '00000000-0000-0000-0000-0000000008c3';
insert into public.credit_packages (id, org_id, service_id, name, credits, price_chf, sort_order, is_active) values
  ('00000000-0000-0000-0000-0000000008d5', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008c1', '5 sessions', 5, 450, 10, true),
  ('00000000-0000-0000-0000-0000000008da', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008c1', '10 sessions', 10, 850, 20, true),
  ('00000000-0000-0000-0000-0000000008df', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008c1', '16 sessions', 16, 1280, 30, true),
  ('00000000-0000-0000-0000-0000000008d2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000008c1', '20 sessions', 20, 1500, 40, true);
insert into public.training_service_coaches (org_id, service_id, coach_id)
select '00000000-0000-0000-0000-000000000001', s, '00000000-0000-0000-0000-000000000011'
  from unnest(array['00000000-0000-0000-0000-0000000008c1', '00000000-0000-0000-0000-0000000008c2',
                    '00000000-0000-0000-0000-0000000008c3', '00000000-0000-0000-0000-0000000008c4']::uuid[]) s;
insert into public.coach_availability (org_id, coach_id, starts_at, ends_at, capacity)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
       bo.at(d, 7)::timestamptz, bo.at(d, 18)::timestamptz, 10
  from unnest(array['d1', 'd2', 'd3', 'd4', 'd5']) d;
insert into public.billing_payers (id, org_id, kind, name, email) values
  ('00000000-0000-0000-0000-0000000008e1', '00000000-0000-0000-0000-000000000001', 'sponsor', 'Synthetic Sponsor', 'bo-sponsor@example.test');

-- Number series: Personal Training -> "BO PT", camp -> "BO CAMP" (issuing entity = the club default).
do $$
begin
  perform bo.run_as(bo.uid('admin'), 'select public.invoice_number_series_set(''training'', ''BO PT'', true)::text');
  perform bo.run_as(bo.uid('admin'), 'select public.invoice_number_series_set(''camp'', ''BO CAMP'', true)::text');
end $$;

-- ===========================================================================
-- A. Pricing catalogue
-- ===========================================================================
do $$
declare c jsonb; s jsonb; r jsonb; q jsonb;
begin
  c := bo.j(bo.uid('admin'), 'select public.training_service_catalog(false)::text');
  select e into s from jsonb_array_elements(c) e where e->>'id' = bo.get('svcPt');
  perform bo.ok((select string_agg((o->>'sessions') || '=' || trim_scale((o->>'total')::numeric)::text, ',' order by ord)
                   from jsonb_array_elements(s->'pricing_options') with ordinality x(o, ord)) = '1=95,5=450,10=850,16=1280,20=1500',
                'catalogue: Personal Training options = 1 session 95, 5 / 450, 10 / 850, 16 / 1280, 20 / 1500 (totals)');
  perform bo.ok(s->'pricing_options'->0->>'option_id' = 'single' and s->'pricing_options'->1->>'kind' = 'package',
                'catalogue: "1 Session" first, packages after');
  select e into s from jsonb_array_elements(c) e where e->>'id' = bo.get('svcNoRate');
  perform bo.ok(s->'pricing_missing' ? 'GROUP_RATE' and jsonb_array_length(s->'pricing_options') = 0,
                'catalogue: a group service without a group rate reports GROUP_RATE missing');
  select e into s from jsonb_array_elements(c) e where e->>'id' = bo.get('svcGrp');
  perform bo.ok((s->>'group_rate')::numeric = 30 and s->>'pricing_basis' = 'per_player_per_session',
                'catalogue: group rate + explicit pricing basis');

  r := bo.j(bo.uid('finance'), format('select public.service_pricing_save(%L, %L)::text', bo.get('svcPt'),
            '{"short_description": "One coach, one athlete: technique and conditioning."}'));
  perform bo.ok((r->>'ok')::boolean and (select short_description from public.training_services where id = bo.uid('svcPt')) like 'One coach%'
                and jsonb_array_length(r->'pricing_options') = 5,
                'pricing editor: finance saves the short description; packages untouched without a packages list');
  r := bo.j(bo.uid('coach'), format('select public.service_pricing_save(%L, %L)::text', bo.get('svcPt'), '{"price": 1}'));
  perform bo.ok(bo.err(r) = 'NOT_AUTHORIZED', 'pricing editor: a coach is refused');
  r := bo.j(bo.uid('adminB'), format('select public.service_pricing_save(%L, %L)::text', bo.get('svcPt'), '{"price": 1}'));
  perform bo.ok(bo.err(r) = 'SERVICE_NOT_FOUND' and (select price_chf from public.training_services where id = bo.uid('svcPt')) = 95,
                'pricing editor: another club''s admin gets SERVICE_NOT_FOUND (cross-tenant)');
  r := bo.j(bo.uid('admin'), format('select public.service_pricing_save(%L, %L)::text', bo.get('svcGrp'), '{"pricing_basis": "per_session_flat"}'));
  perform bo.ok(bo.err(r) = 'INVALID_PRICING_BASIS', 'pricing editor: only per_player_per_session is accepted');
  r := bo.j(bo.uid('admin'), format('select public.service_pricing_save(%L, %L)::text', bo.get('svcPt'),
            jsonb_build_object('packages', jsonb_build_array(jsonb_build_object('sessions', 5, 'total', 450), jsonb_build_object('sessions', 5, 'total', 400)))));
  perform bo.ok(bo.err(r) = 'DUPLICATE_PACKAGE', 'pricing editor: two active packages with the same session count are refused');

  q := bo.quote('admin', jsonb_build_object('service_id', bo.get('svcNoRate'), 'option', 'group', 'coach_id', bo.get('coachRow'),
                 'dates', jsonb_build_array(bo.at('d5', 9)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.ok(q->'errors' ? 'PRICING_MISSING' and not (q->>'ok')::boolean, 'quote: a group service without a rate -> PRICING_MISSING (confirm blocked)');
  r := bo.confirm('admin', jsonb_build_object('service_id', bo.get('svcNoRate'), 'option', 'group', 'coach_id', bo.get('coachRow'),
                   'dates', jsonb_build_array(bo.at('d5', 9)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.ok(bo.err(r) = 'PRICING_MISSING' and not exists (select 1 from public.booking_orders where service_id = bo.uid('svcNoRate')),
                'confirm: PRICING_MISSING refused, nothing written');
  q := bo.quote('admin', jsonb_build_object('service_id', bo.get('svcPt'), 'option', 'group', 'coach_id', bo.get('coachRow'),
                 'dates', jsonb_build_array(bo.at('d5', 9)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.ok(q->'errors' ? 'OPTION_NOT_OFFERED', 'quote: group pricing on a private service -> OPTION_NOT_OFFERED');
end $$;

-- ===========================================================================
-- B. Single session order
-- ===========================================================================
do $$
declare q jsonb; r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); p jsonb; inv jsonb;
begin
  p := jsonb_build_object('service_id', bo.get('svcPt'), 'option', 'single', 'coach_id', bo.get('coachRow'),
                          'dates', jsonb_build_array(bo.at('d1', 8)),
                          'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71'))),
                          'description', 'Shooting technique, 1 hour', 'internal_notes', 'Synthetic internal note',
                          'received_on', (current_date - 2)::text);
  q := bo.quote('admin', p);
  perform bo.ok((q->>'ok')::boolean and (q->'totals'->>'charge')::numeric = 95 and q->'dates'->0->>'creates' = 'booked',
                'single: quote ok, charge 95, confirmed booking');
  q := bo.quote('admin', p || jsonb_build_object('dates', jsonb_build_array(bo.at('d1', 8), bo.at('d2', 8))));
  perform bo.ok(q->'errors' ? 'SINGLE_ONE_DATE', 'single: two dates -> SINGLE_ONE_DATE');
  q := bo.quote('admin', p || jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')), jsonb_build_object('athlete_id', bo.get('a72')))));
  perform bo.ok(q->'errors' ? 'ONE_ATHLETE_ONLY', 'single: two athletes -> ONE_ATHLETE_ONLY');

  r := bo.confirm('admin', p, v_req);
  r2 := bo.confirm('admin', p, v_req);
  perform bo.put('oSingle', r->>'order_id');
  perform bo.ok((r->>'ok')::boolean and (r2->>'replayed')::boolean and r2->>'order_id' = r->>'order_id'
                and (select count(*) from public.booking_orders where request_id = v_req) = 1
                and (select count(*) from public.training_bookings where order_id = bo.uid('oSingle')) = 1,
                'single: confirm idempotent (replay returns the same order, one booking)');
  perform bo.ok((select price_chf = 95 and list_price = 95 and billing_mode = 'invoice' and status = 'booked'
                   from public.training_bookings where order_id = bo.uid('oSingle')),
                'single: booking snapshot 95 by invoice');
  perform bo.ok((select received_on = current_date - 2 and description like 'Shooting%' and internal_notes like 'Synthetic%'
                        and agreed_total = 95 and option_kind = 'single'
                   from public.booking_orders where id = bo.uid('oSingle')),
                'single: received date, description and internal notes stored separately');

  -- Catalogue change after the order: only new orders are affected.
  update public.training_services set price_chf = 99 where id = bo.uid('svcPt');
  inv := bo.invoice('finance', array[bo.uid('oSingle')]);
  perform bo.put('invSingle', inv->'invoices'->0->>'invoice_id');
  perform bo.ok((inv->>'ok')::boolean and jsonb_array_length(inv->'invoices') = 1 and (inv->'invoices'->0->>'total')::numeric = 95
                and inv->'invoices'->0->>'number' like 'BO PT-%',
                'single: one invoice, 95 (agreed snapshot, not the new catalogue price), "BO PT" number');
  update public.training_services set price_chf = 95 where id = bo.uid('svcPt');
  perform bo.ok((select activity = 'training' and description like 'Shooting%' and billing_entity_id is not null
                   from public.invoices where id = bo.uid('invSingle')),
                'single: invoice category training, customer-facing description, issuing entity');
end $$;

-- ===========================================================================
-- C. Package order
-- ===========================================================================
do $$
declare q jsonb; r jsonb; v_req uuid := gen_random_uuid(); p jsonb; inv jsonb; d jsonb; o uuid; v_lot uuid; a jsonb;
begin
  p := jsonb_build_object('service_id', bo.get('svcPt'), 'option', 'package', 'package_id', bo.get('pk10'),
                          'coach_id', bo.get('coachRow'),
                          'dates', jsonb_build_array(bo.at('d2', 8), bo.at('d3', 8)),
                          'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a72'))));
  q := bo.quote('admin', p || '{"agreed_total": 800}'::jsonb);
  perform bo.ok(q->'errors' ? 'PRICE_OVERRIDE_REASON_REQUIRED', 'package: a different total needs a reason');
  q := bo.quote('admin', p || jsonb_build_object('dates', jsonb_build_array(bo.at('d4', 8), bo.at('d4', 8.5))));
  perform bo.ok(exists (select 1 from jsonb_array_elements(q->'dates') x where x->'errors' ? 'ORDER_DATES_OVERLAP'),
                'package: two overlapping dates of the same order are flagged');
  q := bo.quote('admin', p);
  perform bo.ok((q->>'ok')::boolean and (q->'totals'->>'charge')::numeric = 850 and (q->'option'->>'sessions')::int = 10,
                'package: quote 10 sessions, 850 once');

  r := bo.confirm('admin', p, v_req);
  o := (r->>'order_id')::uuid;
  perform bo.put('oPkg', o::text);
  select purchase_id into v_lot from public.booking_orders where id = o;
  perform bo.put('pkgLot', v_lot::text);
  perform bo.ok((select sessions = 10 and sessions_used = 2 and amount = 850 and status = 'active' and invoice_id is null
                   from public.training_package_purchases where id = v_lot),
                'package: sold once (10 sessions, 850), active at once, 2 sessions used by the 2 dates');
  perform bo.ok((select count(*) from public.training_booking_entitlements e join public.training_bookings b on b.id = e.booking_id
                  where b.order_id = o) = 2
                and (select bool_and(billing_mode = 'package' and price_chf = 0 and purchase_id = v_lot) from public.training_bookings where order_id = o),
                'package: one entitlement per booking, bookings covered by the package (no charge)');
  r := bo.confirm('admin', p, v_req);
  perform bo.ok((r->>'replayed')::boolean and (select sessions_used from public.training_package_purchases where id = v_lot) = 2,
                'package: confirm replay does not sell or consume again');

  inv := bo.invoice('finance', array[o]);
  perform bo.put('invPkg', inv->'invoices'->0->>'invoice_id');
  perform bo.ok(jsonb_array_length(inv->'invoices') = 1 and (inv->'invoices'->0->>'total')::numeric = 850
                and (select invoice_id from public.training_package_purchases where id = v_lot) = bo.uid('invPkg')
                and (select count(*) from public.invoice_items where invoice_id = bo.uid('invPkg')) = 1
                and not exists (select 1 from public.training_bookings where order_id = o and invoice_id is not null),
                'package: invoiced once for the total (one line), sessions never invoiced');
  inv := bo.invoice('finance', array[o]);
  perform bo.ok((inv->>'nothing_to_invoice')::boolean, 'package: a second invoice run finds nothing (one charge only)');

  -- Later scheduling consumes the package (no new charge), idempotent.
  d := bo.add_dates('admin', o, jsonb_build_object('dates', jsonb_build_array(bo.at('d4', 8)), 'dry_run', true), null);
  perform bo.ok((d->>'ok')::boolean and (d->'totals'->>'charge')::numeric = 0, 'package: schedule check (dry run) ok, no charge');
  v_req := gen_random_uuid();
  d := bo.add_dates('admin', o, jsonb_build_object('dates', jsonb_build_array(bo.at('d4', 8))), v_req);
  d := bo.add_dates('admin', o, jsonb_build_object('dates', jsonb_build_array(bo.at('d4', 8))), v_req);
  perform bo.ok((d->>'replayed')::boolean and (select sessions_used from public.training_package_purchases where id = v_lot) = 3
                and (select count(*) from public.training_booking_entitlements e join public.training_bookings b on b.id = e.booking_id where b.order_id = o) = 3,
                'package: scheduling later consumes one session per booking, retry does not consume again');
  d := bo.add_dates('admin', o, jsonb_build_object('dates', (select jsonb_agg(bo.at('d5', h)) from generate_series(7, 14) h)), gen_random_uuid());
  perform bo.ok(bo.err(d) = 'PACKAGE_TOO_MANY_DATES', 'package: more dates than sessions left -> PACKAGE_TOO_MANY_DATES');
  a := bo.detail('admin', o);
  perform bo.ok((a->'package'->>'available')::int = 7 and (a->'package'->>'booked')::int = 3 and (a->'totals'->>'charged')::numeric = 850
                and (a->'totals'->>'uninvoiced')::numeric = 0,
                'package: order shows 3 booked, 7 available, charged 850, nothing left to invoice');

  -- Cancellation restores a session per policy (start > 24 h away); the invoice is untouched.
  r := bo.cancel('admin', o, jsonb_build_object('scope', 'booking', 'reason', 'Synthetic: athlete ill',
                   'booking_id', (select id from public.training_bookings where order_id = o and slot_start = bo.at('d3', 8)::timestamptz)));
  perform bo.ok((r->>'ok')::boolean and (r->'cancelled'->0->>'package_restored')::boolean
                and (select sessions_used from public.training_package_purchases where id = v_lot) = 2
                and (select total_chf = 850 and adjustments_total = 0 from public.invoices where id = bo.uid('invPkg')),
                'package: cancellation restores the session (policy), the package invoice is unchanged');
  -- Agreed total with a reason (another order).
  r := bo.confirm('admin', p || jsonb_build_object('agreed_total', 800, 'price_reason', 'Synthetic loyalty price',
                                                   'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a73'))),
                                                   'dates', '[]'::jsonb));
  perform bo.ok((select tp.amount = 800 and tp.list_price = 850 and tp.sessions_used = 0
                   from public.booking_orders bo2 join public.training_package_purchases tp on tp.id = bo2.purchase_id
                  where bo2.id = (r->>'order_id')::uuid)
                and (select price_override_reason from public.booking_orders where id = (r->>'order_id')::uuid) like 'Synthetic loyalty%',
                'package: agreed total 800 with a reason (list 850 kept), 0 dates scheduled now');
end $$;

-- ===========================================================================
-- D. Group order: 4 players on date 1, 3 of them on date 2
-- ===========================================================================
do $$
declare q jsonb; r jsonb; p jsonb; v_req uuid := gen_random_uuid(); o uuid; inv jsonb;
begin
  p := jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d1', 12), bo.at('d2', 12)),
         'description', 'Small group: ball handling',
         'participants', jsonb_build_array(
            jsonb_build_object('athlete_id', bo.get('a71')),
            jsonb_build_object('athlete_id', bo.get('a72')),
            jsonb_build_object('athlete_id', bo.get('a73')),
            jsonb_build_object('athlete_id', bo.get('a74'), 'payer_id', bo.get('sponsor'), 'dates', jsonb_build_array(bo.at('d1', 12)))));
  q := bo.quote('admin', p);
  perform bo.ok((q->>'ok')::boolean and (q->'totals'->>'charge')::numeric = 210
                and (select string_agg(trim_scale((x->>'charge')::numeric)::text, ',' order by x->>'last_name', x->>'first_name')
                       from jsonb_array_elements(q->'participants') x) = '30,60,60,60'
                and (q->'dates'->0->>'adding')::int = 4 and (q->'dates'->1->>'adding')::int = 3,
                'group: rate 30 x sessions -> 4 players on date 1 = 120, 3 also on date 2 -> total 210');
  perform bo.ok(jsonb_array_length(q->'totals'->'payers') = 3, 'group: preview per payer (family 061, family 062, sponsor)');
  q := bo.quote('admin', p || jsonb_build_object('participants', (p->'participants') || jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.ok(q->'errors' ? 'DUPLICATE_ATHLETE', 'group: the same athlete twice -> DUPLICATE_ATHLETE');
  q := bo.quote('admin', p || jsonb_build_object('participants', (p->'participants') || jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a75')))));
  perform bo.ok(q->'dates'->0->'errors' ? 'SESSION_FULL' and not (q->'dates'->1->'errors' ? 'SESSION_FULL'),
                'group: 5 players on date 1 exceed the capacity 4 (date 1 marked, date 2 fine)');

  r := bo.confirm('admin', p, v_req);
  o := (r->>'order_id')::uuid;
  perform bo.put('oGrp', o::text);
  perform bo.ok((r->>'ok')::boolean and jsonb_array_length(r->'bookings') = 7
                and (select count(distinct session_id) from public.training_bookings where order_id = o) = 2
                and (select count(*) from public.training_bookings where order_id = o and slot_start = bo.at('d1', 12)::timestamptz) = 4,
                'group: 7 bookings, one shared session per date (4 players on date 1)');
  perform bo.put('sGrp1', (select session_id::text from public.training_bookings where order_id = o and slot_start = bo.at('d1', 12)::timestamptz limit 1));
  perform bo.put('sGrp2', (select session_id::text from public.training_bookings where order_id = o and slot_start = bo.at('d2', 12)::timestamptz limit 1));
  perform bo.ok((select count(*) from public.events where training_session_id in (bo.uid('sGrp1'), bo.uid('sGrp2'))) = 2,
                'group: one calendar event per shared session');

  -- The full session refuses a 5th player; an athlete already on the session is flagged.
  r := bo.confirm('admin', jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d1', 12)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a75')))));
  perform bo.ok(r->>'code' = 'DATES_UNAVAILABLE' and r->'dates'->0->'errors' ? 'SESSION_FULL'
                and (select count(*) from public.training_bookings where session_id = bo.uid('sGrp1')) = 4,
                'group: confirm refuses the full session per date (DATES_UNAVAILABLE + SESSION_FULL), nothing written');
  q := bo.quote('admin', jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d2', 12)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.ok(exists (select 1 from jsonb_array_elements(q->'dates'->0->'athlete_errors') x where x->>'code' = 'ALREADY_BOOKED' and x->>'athlete_id' = bo.get('a71')),
                'group: an athlete already on the session -> ALREADY_BOOKED for that athlete');

  -- Invoices per payer: family 061 (60), family 062 (60 + 60), sponsor (30).
  v_req := gen_random_uuid();
  inv := bo.invoice('finance', array[o], v_req);
  perform bo.ok(jsonb_array_length(inv->'invoices') = 3
                and (select sum((x->>'total')::numeric) from jsonb_array_elements(inv->'invoices') x) = 210,
                'group invoices: one invoice per payer, 210 in total');
  perform bo.put('invF61', (select i.id::text from public.invoices i join public.training_bookings b on b.invoice_id = i.id
                             where b.order_id = o and b.athlete_id = bo.uid('a71') limit 1));
  perform bo.put('invF62', (select i.id::text from public.invoices i join public.training_bookings b on b.invoice_id = i.id
                             where b.order_id = o and b.athlete_id = bo.uid('a72') limit 1));
  perform bo.put('invSp', (select i.id::text from public.invoices i join public.training_bookings b on b.invoice_id = i.id
                             where b.order_id = o and b.athlete_id = bo.uid('a74') limit 1));
  perform bo.ok((select total_chf = 120 and family_id = '00000000-0000-0000-0000-000000000062' and athlete_id is null
                   from public.invoices where id = bo.uid('invF62'))
                and (select count(*) from public.invoice_items where invoice_id = bo.uid('invF62')) = 2
                and (select bool_and(quantity = 2 and unit_price_chf = 30 and amount_chf = 60 and description like '%(2 × 30.00 CHF)%')
                       from public.invoice_items where invoice_id = bo.uid('invF62'))
                and exists (select 1 from public.invoice_items where invoice_id = bo.uid('invF62') and description like '%Lucas Müller%')
                and exists (select 1 from public.invoice_items where invoice_id = bo.uid('invF62') and description like '%Sophia Müller%'),
                'group invoices: family 062 = one line per athlete (athlete, dates, 2 x 30), total 120');
  perform bo.ok((select payer_kind = 'sponsor' and total_chf = 30 from public.invoices where id = bo.uid('invSp'))
                and (select total_chf = 60 and activity = 'training' and number like 'BO PT-%' from public.invoices where id = bo.uid('invF61')),
                'group invoices: sponsor 30, family 061 60, category training, "BO PT" numbers');
  perform bo.ok((bo.invoice('finance', array[o], v_req)->>'replayed')::boolean
                and (select count(*) from public.invoices where id in (select invoice_id from public.training_bookings where order_id = o)) = 3,
                'group invoices: retry with the same request id replays (no second invoice)');

  -- Payer visibility (existing invoice RLS): each payer sees only their own invoice.
  perform bo.ok(bo.count_as('guardian', format('select count(*)::text from public.invoices where id in (%L, %L, %L)', bo.get('invF61'), bo.get('invF62'), bo.get('invSp'))) = 1
                and bo.count_as('guardian', format('select count(*)::text from public.invoices where id = %L', bo.get('invF61'))) = 1,
                'visibility: guardian of family 061 sees only the family 061 invoice');
  perform bo.ok(bo.count_as('guardian2', format('select count(*)::text from public.invoices where id in (%L, %L, %L)', bo.get('invF61'), bo.get('invF62'), bo.get('invSp'))) = 1
                and bo.count_as('guardian2', format('select count(*)::text from public.invoices where id = %L', bo.get('invF62'))) = 1,
                'visibility: guardian of family 062 sees only the family 062 invoice');
  perform bo.ok(bo.count_as('guardian3', format('select count(*)::text from public.invoices where id in (%L, %L, %L)', bo.get('invF61'), bo.get('invF62'), bo.get('invSp'))) = 0,
                'visibility: the athlete''s guardian does not see the sponsor''s invoice');
  r := bo.j(bo.uid('guardian'), format('select public.guardian_booking_overview(%L)::text', bo.get('a71')));
  perform bo.ok((select count(*) from jsonb_array_elements(r->0->'upcoming') x where x->>'service_name' = 'BO Group Training') = 2
                and exists (select 1 from jsonb_array_elements(r->0->'invoices') x where x->>'invoice_id' = bo.get('invF61'))
                and not exists (select 1 from jsonb_array_elements(r->0->'invoices') x where x->>'invoice_id' in (bo.get('invF62'), bo.get('invSp'))),
                'portal: guardian sees the child''s order sessions and only their own invoice');
end $$;

-- Coach scope and cross-tenant / RLS denials
do $$
declare r jsonb; o uuid := bo.uid('oGrp');
begin
  perform bo.ok(bo.count_as('coach', 'select count(*)::text from public.booking_orders') = 0
                and bo.count_as('coach', 'select count(*)::text from public.booking_order_participants') = 0,
                'coach scope: a coach reads no orders or participants (money, payers)');
  perform bo.ok(bo.err(bo.detail('coach', o)) = 'NOT_AUTHORIZED', 'coach scope: order detail refused');
  r := bo.j(bo.uid('coach'), format('select public.coach_booking_agenda(%L, %L)::text', bo.get('d1'), bo.at('d3', 0)));
  perform bo.ok(exists (select 1 from jsonb_array_elements(r) x where x->>'session_id' = bo.get('sGrp1')
                          and jsonb_array_length(x->'participants') = 4 and not (x ? 'price')),
                'coach scope: the session coach sees one shared roster of 4 names (no money)');
  r := bo.j(bo.uid('coach2'), format('select public.coach_booking_agenda(%L, %L)::text', bo.get('d1'), bo.at('d3', 0)));
  perform bo.ok(not exists (select 1 from jsonb_array_elements(coalesce(r, '[]'::jsonb)) x where x->>'session_id' = bo.get('sGrp1')),
                'coach scope: another coach does not see the session roster');
  perform bo.ok(bo.count_as('guardian', 'select count(*)::text from public.booking_orders') = 0
                and bo.count_as('guardian', 'select count(*)::text from public.booking_order_participants') = 0,
                'cross-family: a guardian reads no orders (internal notes, other payers)');
  perform bo.ok(bo.err(bo.detail('adminB', o)) = 'ORDER_NOT_FOUND'
                and bo.count_as('adminB', 'select count(*)::text from public.booking_orders') = 0,
                'cross-tenant: another club''s admin cannot read the order');
  perform bo.ok(bo.err(bo.invoice('adminB', array[o])) = 'ORDER_NOT_FOUND', 'cross-tenant: another club cannot invoice the order');
  perform bo.ok(bo.err(bo.cancel('adminB', o, '{"scope": "date", "reason": "x"}'::jsonb)) = 'ORDER_NOT_FOUND',
                'cross-tenant: another club cannot change the order');
  perform bo.ok(bo.err(bo.quote('adminB', jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group'))) = 'SERVICE_NOT_FOUND',
                'cross-tenant: another club cannot quote our service');
  perform bo.ok(left(bo.run_as(bo.uid('admin'), format('insert into public.booking_orders (org_id, service_id, kind, option_kind, currency, billing_category) values (%L, %L, ''group'', ''group'', ''CHF'', ''training'') returning id::text', bo.get('org'), bo.get('svcGrp'))), 4) = 'ERR:'
                and left(bo.run_as(bo.uid('admin'), format('update public.booking_orders set description = ''x'' where id = %L returning id::text', o)), 7) = 'OK:<nul'
                and left(bo.run_as(bo.uid('admin'), format('delete from public.booking_orders where id = %L returning id::text', o)), 7) = 'OK:<nul'
                and left(bo.run_as(bo.uid('finance'), format('update public.booking_order_participants set rate = 0 where order_id = %L returning id::text', o)), 7) = 'OK:<nul',
                'RLS: no direct insert / update / delete on orders or participants (RPC only)');
  perform bo.ok(bo.count_as('finance', format('select count(*)::text from public.booking_order_participants where order_id = %L', o)) = 4,
                'RLS: finance reads the participants');
  perform bo.ok(bo.err(bo.j(bo.uid('guardian'), format('select public.booking_order_quote(%L)::text',
                  jsonb_build_object('service_id', bo.get('svcGrp'))))) = 'NOT_AUTHORIZED',
                'RLS: a guardian cannot quote or create orders');
end $$;

-- Payments per invoice (idempotent) and partial changes
do $$
declare r jsonb; r2 jsonb; v_req uuid := gen_random_uuid(); o uuid := bo.uid('oGrp'); b uuid; a jsonb;
begin
  r := bo.j(bo.uid('finance'), format('select public.booking_order_record_payment(%L, %L, %L)::text', o, bo.get('invF62'),
            jsonb_build_object('request_id', v_req, 'amount', 120, 'method', 'bank_transfer')));
  r2 := bo.j(bo.uid('finance'), format('select public.booking_order_record_payment(%L, %L, %L)::text', o, bo.get('invF62'),
            jsonb_build_object('request_id', v_req, 'amount', 120, 'method', 'bank_transfer')));
  perform bo.ok(r->>'err' is null and (r2->>'replayed')::boolean and public.invoice_net_paid(bo.uid('invF62')) = 120
                and (select status::text from public.invoices where id = bo.uid('invF62')) = 'paid',
                'payments: one payment per invoice, retry replays (paid 120 once)');
  r := bo.j(bo.uid('finance'), format('select public.booking_order_record_payment(%L, %L, %L)::text', o, bo.get('invSingle'),
            jsonb_build_object('request_id', gen_random_uuid(), 'amount', 10)));
  perform bo.ok(bo.err(r) = 'NOT_INVOICED', 'payments: an invoice of another order is refused');

  -- Cancel one player on one date (invoiced + paid): credit note for that line.
  b := (select id from public.training_bookings where order_id = o and athlete_id = bo.uid('a73') and slot_start = bo.at('d2', 12)::timestamptz);
  v_req := gen_random_uuid();
  r := bo.cancel('admin', o, jsonb_build_object('scope', 'booking', 'booking_id', b, 'reason', 'Synthetic: injury'), v_req);
  r2 := bo.cancel('admin', o, jsonb_build_object('scope', 'booking', 'booking_id', b, 'reason', 'Synthetic: injury'), v_req);
  perform bo.ok((r->>'ok')::boolean and (r2->>'replayed')::boolean
                and (select count(*) from public.invoice_adjustments where invoice_id = bo.uid('invF62') and kind = 'credit_note' and amount = 30) = 1
                and (select adjustments_total from public.invoices where id = bo.uid('invF62')) = -30
                and (select total_chf from public.invoices where id = bo.uid('invF62')) = 120,
                'partial cancel: one player on one date -> one credit note of 30 on the issued invoice (never edited), retry replays');
  perform bo.ok(public.bk_session_count(bo.uid('sGrp2')) = 2 and (select status from public.training_sessions where id = bo.uid('sGrp2')) = 'scheduled',
                'partial cancel: the shared session keeps the other players (roster 2)');

  -- Cancel one date for the remaining players: credit notes per invoice, session released.
  r := bo.cancel('admin', o, jsonb_build_object('scope', 'date', 'session_id', bo.get('sGrp2'), 'reason', 'Synthetic: hall closed'));
  perform bo.ok(jsonb_array_length(r->'cancelled') = 2
                and (select status from public.training_sessions where id = bo.uid('sGrp2')) = 'cancelled'
                and (select adjustments_total from public.invoices where id = bo.uid('invF61')) = -30
                and (select adjustments_total from public.invoices where id = bo.uid('invF62')) = -60,
                'partial cancel: one date -> credit note per payer invoice, empty session cancelled');

  -- Cancel the sponsored player (unpaid invoice of exactly that booking): the invoice is cancelled.
  r := bo.cancel('admin', o, jsonb_build_object('scope', 'participant',
         'participant_id', (select id from public.booking_order_participants where order_id = o and athlete_id = bo.uid('a74')),
         'reason', 'Synthetic: left the group'));
  perform bo.ok((select status::text from public.invoices where id = bo.uid('invSp')) = 'cancelled'
                and (select status from public.booking_order_participants where order_id = o and athlete_id = bo.uid('a74')) = 'cancelled'
                and public.bk_session_count(bo.uid('sGrp1')) = 3,
                'partial cancel: one player -> their only (unpaid) invoice cancelled, player leaves, roster 3');

  -- Reschedule date 1 for all remaining players: one new shared session.
  r := bo.j(bo.uid('admin'), format('select public.booking_order_reschedule(%L, %L, %L)::text', o,
            jsonb_build_object('scope', 'date', 'session_id', bo.get('sGrp1'), 'starts_at', bo.at('d3', 15)), gen_random_uuid()));
  perform bo.ok((r->>'ok')::boolean and jsonb_array_length(r->'rescheduled') = 3
                and (select count(distinct session_id) from public.training_bookings where order_id = o and status = 'booked') = 1
                and (select count(*) from public.training_bookings where order_id = o and status = 'booked' and slot_start = bo.at('d3', 15)::timestamptz) = 3
                and (select status from public.training_sessions where id = bo.uid('sGrp1')) = 'cancelled',
                'reschedule: one date of the group moves all its players to one new shared session');
  a := bo.detail('finance', o);
  perform bo.ok((a->'totals'->>'charged')::numeric = 90 and (a->'totals'->>'uninvoiced')::numeric = 0
                and jsonb_array_length(a->'invoices') = 3
                and (select (x->>'balance')::numeric from jsonb_array_elements(a->'invoices') x where x->>'invoice_id' = bo.get('invF62')) = -60,
                'order detail: charged 90 after the changes, invoices per payer with balances (credit owed to family 062)');
  r := bo.j(bo.uid('admin'), format('select public.booking_create_invoice(%L, %L, false)::text',
            (select id from public.training_bookings where order_id = o and status = 'booked' limit 1), gen_random_uuid()));
  perform bo.ok(r->>'already_invoiced' = 'true' or bo.err(r) = 'ORDER_INVOICING',
                'single-booking invoice path never invoices an order booking twice');
end $$;

-- ===========================================================================
-- E. Mixed revenue categories
-- ===========================================================================
do $$
declare r jsonb; inv jsonb;
begin
  r := bo.confirm('admin', jsonb_build_object('service_id', bo.get('svcCamp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d4', 12)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.put('oCamp', r->>'order_id');
  r := bo.confirm('admin', jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d4', 14)), 'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a71')))));
  perform bo.put('oGrp2', r->>'order_id');
  inv := bo.invoice('finance', array[bo.uid('oCamp'), bo.uid('oGrp2')]);
  perform bo.ok(bo.err(inv) = 'CATEGORY_MIXED'
                and not exists (select 1 from public.training_bookings where order_id in (bo.uid('oCamp'), bo.uid('oGrp2')) and invoice_id is not null),
                'mixed categories: camp + training on one invoice run -> CATEGORY_MIXED, nothing invoiced');
  inv := bo.invoice('finance', array[bo.uid('oCamp')]);
  perform bo.ok((inv->'invoices'->0->>'activity') = 'camp' and inv->'invoices'->0->>'number' like 'BO CAMP-%',
                'mixed categories: the camp order alone is invoiced in its own category / series');
end $$;

-- ===========================================================================
-- F. Draft invoice: a cancelled booking leaves the draft line
-- ===========================================================================
do $$
declare r jsonb; inv jsonb; o uuid; b uuid;
begin
  r := bo.confirm('admin', jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d5', 9), bo.at('d5', 11)),
         'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a75')), jsonb_build_object('athlete_id', bo.get('a76')))));
  o := (r->>'order_id')::uuid;
  inv := bo.invoice('finance', array[o], gen_random_uuid(), false);
  perform bo.ok(jsonb_array_length(inv->'invoices') = 1 and inv->'invoices'->0->>'status' = 'draft' and (inv->'invoices'->0->>'total')::numeric = 120,
                'draft: both players of one family on one draft invoice (120)');
  b := (select id from public.training_bookings where order_id = o and athlete_id = bo.uid('a76') and slot_start = bo.at('d5', 11)::timestamptz);
  r := bo.cancel('admin', o, jsonb_build_object('scope', 'booking', 'booking_id', b, 'reason', 'Synthetic change'));
  perform bo.ok((select total_chf from public.invoices where id = (inv->'invoices'->0->>'invoice_id')::uuid) = 90
                and (select invoice_id from public.training_bookings where id = b) is null
                and not exists (select 1 from public.invoice_adjustments where invoice_id = (inv->'invoices'->0->>'invoice_id')::uuid),
                'draft: the cancelled booking leaves the draft line (90 left), no credit note');
  perform bo.put('oDraft', o::text);
end $$;

-- ===========================================================================
-- G. To Invoice lists and single-booking paths
-- ===========================================================================
do $$
declare l jsonb; t jsonb;
begin
  l := bo.j(bo.uid('finance'), 'select public.booking_orders_to_invoice(100)::text');
  perform bo.ok(exists (select 1 from jsonb_array_elements(l) x where x->>'order_id' = bo.get('oGrp2') and (x->>'amount')::numeric = 30)
                and not exists (select 1 from jsonb_array_elements(l) x where x->>'order_id' in (bo.get('oGrp'), bo.get('oPkg'), bo.get('oSingle'))),
                'to invoice: orders with confirmed uninvoiced charges only (amount per order)');
  t := bo.j(bo.uid('finance'), 'select public.bookings_to_invoice(200)::text');
  perform bo.ok(not exists (select 1 from jsonb_array_elements(t) x where x->>'order_id' is not null),
                'to invoice: order bookings are not offered for single-booking invoicing');
  perform bo.ok(bo.err(bo.j(bo.uid('admin'), format('select public.booking_create_invoice(%L, %L)::text',
                  (select id from public.training_bookings where order_id = bo.uid('oGrp2') limit 1), gen_random_uuid()))) = 'ORDER_INVOICING',
                'single-booking invoice refuses an uninvoiced order booking (ORDER_INVOICING)');
  perform bo.ok(bo.err(bo.j(bo.uid('admin'), format('select public.booking_cancel(%L, ''x'', %L, ''cancel_invoice'')::text',
                  (select id from public.training_bookings where order_id = bo.uid('oDraft') and athlete_id = bo.uid('a75') and slot_start = bo.at('d5', 9)::timestamptz),
                  gen_random_uuid()))) = 'INVOICE_SHARED',
                'booking_cancel: "cancel invoice" refused on an invoice shared with other bookings (INVOICE_SHARED)');
end $$;

-- ===========================================================================
-- I. Concurrency: two orders race for the last place of a group session
-- ===========================================================================
create function bo.race(p_a text, p_b text) returns text[] language plpgsql as $$
declare v_conn text; r1 text; r2 text; v_pre text;
begin
  begin
    create extension if not exists dblink;
    v_conn := format('dbname=%s host=localhost port=%s user=%s password=postgres', current_database(), current_setting('port'), current_user);
    perform dblink_connect('bo_c1', v_conn);
    perform dblink_connect('bo_c2', v_conn);
  exception when others then
    raise notice 'INFO — concurrency check skipped (no second session: %)', sqlerrm;
    return null;
  end;
  v_pre := format('set request.jwt.claim.sub = %L; set role authenticated;', bo.get('admin'));
  perform dblink_exec('bo_c1', 'begin');
  perform dblink_exec('bo_c1', v_pre);
  perform dblink_exec('bo_c2', v_pre);
  select x into r1 from dblink('bo_c1', format('select public.booking_order_confirm(%L, %L)::text', p_a, gen_random_uuid())) as t(x text);
  perform dblink_send_query('bo_c2', format('select public.booking_order_confirm(%L, %L)::text', p_b, gen_random_uuid()));
  perform dblink_exec('bo_c1', 'commit');
  select x into r2 from dblink_get_result('bo_c2', false) as t(x text);
  if r2 is null then r2 := 'ERR:' || coalesce(dblink_error_message('bo_c2'), '?'); end if;
  perform dblink_disconnect('bo_c1');
  perform dblink_disconnect('bo_c2');
  return array[r1, r2];
end $$;

do $$
declare r jsonb; v text[]; base jsonb;
begin
  base := jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
                             'dates', jsonb_build_array(bo.at('d4', 16)));
  r := bo.confirm('admin', base || jsonb_build_object('participants', jsonb_build_array(
         jsonb_build_object('athlete_id', bo.get('a74')), jsonb_build_object('athlete_id', bo.get('a75')), jsonb_build_object('athlete_id', bo.get('a76')))));
  perform bo.ok((r->>'ok')::boolean, 'race: 3 of 4 places taken first');
  perform bo.put('sRace', (select session_id::text from public.training_bookings where order_id = (r->>'order_id')::uuid limit 1));
end $$;

-- (separate statement: the first order is committed before the two sessions race)
do $$
declare v text[]; base jsonb;
begin
  base := jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
                             'dates', jsonb_build_array(bo.at('d4', 16)));
  v := bo.race((base || jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a72')))))::text,
               (base || jsonb_build_object('participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a73')))))::text);
  if v is not null then
    perform bo.ok((v[1]::jsonb->>'ok')::boolean and (v[2] like '%DATES_UNAVAILABLE%' or v[2] like '%SESSION_FULL%'),
                  'race: two staff take the last place at once -> one order, the other refused (SESSION_FULL)');
    perform bo.ok(public.bk_session_count(bo.uid('sRace')) = 4, 'race: capacity 4 held under the session lock');
  end if;
end $$;

-- ===========================================================================
-- J. Open availability: dates outside the declared availability are requests
-- ===========================================================================
update public.app_settings
   set settings = jsonb_set(settings, '{booking}', coalesce(settings->'booking', '{}'::jsonb) || '{"availability_mode": "open_confirm"}'::jsonb)
 where org_id = '00000000-0000-0000-0000-000000000001';
do $$
declare r jsonb; inv jsonb;
begin
  r := bo.confirm('admin', jsonb_build_object('service_id', bo.get('svcGrp'), 'option', 'group', 'coach_id', bo.get('coachRow'),
         'dates', jsonb_build_array(bo.at('d2', 18.5)),
         'participants', jsonb_build_array(jsonb_build_object('athlete_id', bo.get('a75')), jsonb_build_object('athlete_id', bo.get('a76')))));
  perform bo.ok((r->>'ok')::boolean and (r->>'requested')::int = 2
                and (select bool_and(status::text = 'requested') from public.training_bookings where order_id = (r->>'order_id')::uuid),
                'open mode: a date outside the declared availability is placed as requests (coach confirms)');
  inv := bo.invoice('finance', array[(r->>'order_id')::uuid]);
  perform bo.ok((inv->>'nothing_to_invoice')::boolean, 'open mode: requests are never invoiced');
end $$;
