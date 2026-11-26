-- ============================================================================
-- Courtside member card suite (migration 20250420105200_member_card_courtside.sql)
--
--   A. Brand resolution: club membership -> its entity, selection enrolment
--      and training package -> routed entity, dual brand, fallback default.
--   B. Brand save: admin only, logo path rules, text-only brand, audit.
--   C. Card read: guardian own child, other family denied, player self,
--      cross-tenant denial.
--   D. Credential unchanged after brand and photo changes; existing token
--      still resolves.
--   E. Photo permissions: storage access helper, athlete row update by
--      another family denied; brand logo bucket access.
--   F. Card check-in on a team attendance sheet: authorised coach, same
--      mark as the sheet, repeated scans idempotent, unknown card, not on
--      sheet, other coach / guardian denied, final sheet.
--   G. RLS on member_card_brands for every verb + cross-tenant.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete …071; family …062 =
-- athletes …072, …073), org B …0002 (seed_tenants). SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema mc;
grant usage on schema mc to authenticated, anon, service_role;
create table mc.ctx (k text primary key, v text);
grant all on mc.ctx to authenticated, anon, service_role;

create function mc.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function mc.put(p_k text, p_v text) returns void language sql as $$
  insert into mc.ctx (k, v) values (p_k, p_v) on conflict (k) do update set v = excluded.v;
$$;
create function mc.get(p_k text) returns text language sql stable as $$ select v from mc.ctx where k = p_k $$;
create function mc.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
create function mc.j(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text := mc.run_as(p, p_sql);
begin
  if left(r, 3) = 'OK:' then
    if substr(r, 4) = '<null>' then return 'null'::jsonb; end if;
    return substr(r, 4)::jsonb;
  end if;
  return jsonb_build_object('err', substr(r, 5));
end $$;
-- Display names of the brands in a card JSON, in order.
create function mc.brands(p jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(b->>'display_name', '|' order by o), '') from jsonb_array_elements(p->'brands') with ordinality x(b, o)
$$;
grant execute on all functions in schema mc to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Users: coach2 (coach row …012, not on the team), player of athlete …072,
-- guardian2 of family …062, admin of org B.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007b1', 'mc-coach2@example.test'),
  ('00000000-0000-0000-0000-0000000007b2', 'mc-player@example.test'),
  ('00000000-0000-0000-0000-0000000007b3', 'mc-guardian2@example.test'),
  ('b0000000-0000-0000-0000-0000000007b4', 'mc-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id in ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-0000000007b2', '00000000-0000-0000-0000-0000000007b3');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000007b4';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007b1', 'coach'),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007b3', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000007b4', 'admin');
update public.coaches set profile_id = '00000000-0000-0000-0000-0000000007b1' where id = '00000000-0000-0000-0000-000000000012';
insert into public.family_members (family_id, profile_id, relation) values
  ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-0000000007b3', 'guardian');
update public.athletes set player_profile_id = '00000000-0000-0000-0000-0000000007b2' where id = '00000000-0000-0000-0000-000000000072';
update public.organizations set timezone = 'Europe/Zurich' where id = '00000000-0000-0000-0000-000000000001';

-- Entities: the org's default ("club") + a second one ("academy"); routes.
select mc.put('club', (select id::text from public.billing_entities
                         where org_id = '00000000-0000-0000-0000-000000000001' and is_default limit 1));
update public.billing_entities set name = 'MC Synthetic Club' where id = mc.get('club')::uuid;
insert into public.billing_entities (id, org_id, name, country) values
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-000000000001', 'MC Synthetic Academy', 'CH');
insert into public.billing_entity_routes (org_id, activity, billing_entity_id) values
  ('00000000-0000-0000-0000-000000000001', 'selection', '00000000-0000-0000-0000-0000000007e2'),
  ('00000000-0000-0000-0000-000000000001', 'training',  '00000000-0000-0000-0000-0000000007e2'),
  ('00000000-0000-0000-0000-000000000001', 'shop',      '00000000-0000-0000-0000-0000000007e2'),
  ('00000000-0000-0000-0000-000000000001', 'camp',      '00000000-0000-0000-0000-0000000007e2')
on conflict (org_id, activity) do update set billing_entity_id = excluded.billing_entity_id;
select mc.put('academy', '00000000-0000-0000-0000-0000000007e2');

insert into public.seasons (id, org_id, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-000000000001', 'MC synthetic season', current_date - 60, current_date + 300);
insert into public.programs (id, org_id, slug, name, kind, price_chf, is_public, is_active, status, selection_enabled)
values ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-000000000001', 'mc-sel', 'MC Selection', 'selection', 0, false, true, 'published', true);
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, session_type, max_participants, min_participants)
values ('00000000-0000-0000-0000-0000000007a3', '00000000-0000-0000-0000-000000000001', 'mc-pt', 'MC PT', 60, 90, 'individual', 1, 1);

-- ===========================================================================
-- A. Brand resolution
-- ===========================================================================
do $$
declare j jsonb;
begin
  -- …073 has nothing: fallback to the default entity, flagged.
  j := mc.j('00000000-0000-0000-0000-0000000000f1', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000073')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Synthetic Club' and (j->'brands'->0->>'is_fallback')::boolean,
                'no membership / enrolment: one fallback card of the default entity (' || coalesce(j::text, '') || ')');

  -- …071: active season fee -> club (route club_membership = default entity).
  insert into public.memberships (org_id, family_id, athlete_id, valid_from, valid_until, status, price_amount, currency,
                                  season_id, kind, agreed_fee)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000071',
          current_date - 60, current_date + 300, 'active', 0, 'CHF', '00000000-0000-0000-0000-0000000007a1', 'season_fee', 0);
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Synthetic Club' and not (j->'brands'->0->>'is_fallback')::boolean
                and j->'brands'->0->'sources' = '["club_membership"]'::jsonb,
                'active club membership -> the club entity (' || mc.brands(j) || ')');

  -- …071 also enrolled in a selection programme -> two brands, club first.
  insert into public.program_applications (org_id, program_id, athlete_id, family_id, status, source)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-000000000071',
          '00000000-0000-0000-0000-000000000061', 'enrolled', 'admin');
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Synthetic Club|MC Synthetic Academy', 'membership + selection enrolment -> dual brand (' || mc.brands(j) || ')');

  -- An applied (not enrolled) application gives no brand.
  insert into public.program_applications (org_id, program_id, athlete_id, family_id, status, source)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-000000000073',
          '00000000-0000-0000-0000-000000000062', 'applied', 'admin');
  j := mc.j('00000000-0000-0000-0000-0000000000f1', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000073')::text$q$);
  perform mc.ok((j->'brands'->0->>'is_fallback')::boolean, 'an application that is not enrolled gives no brand');

  -- …072: active training package only -> academy.
  insert into public.training_package_purchases (org_id, athlete_id, family_id, service_id, sessions, sessions_used, currency, status, payment_mode)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-000000000062',
          '00000000-0000-0000-0000-0000000007a3', 5, 1, 'CHF', 'active', 'comp');
  j := mc.j('00000000-0000-0000-0000-0000000007b3', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000072')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Synthetic Academy' and j->'brands'->0->'sources' = '["training"]'::jsonb,
                'active training package -> the training entity (' || mc.brands(j) || ')');

  -- Used-up package: no longer eligible -> fallback.
  update public.training_package_purchases set sessions_used = sessions where athlete_id = '00000000-0000-0000-0000-000000000072';
  j := mc.j('00000000-0000-0000-0000-0000000007b3', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000072')::text$q$);
  perform mc.ok((j->'brands'->0->>'is_fallback')::boolean, 'a used-up package is not eligible');
  update public.training_package_purchases set sessions_used = 1 where athlete_id = '00000000-0000-0000-0000-000000000072';

  -- Membership invoice issued by the academy wins over the route.
  update public.memberships set status = 'active' where athlete_id = '00000000-0000-0000-0000-000000000071';
  -- Expired membership: not eligible.
  update public.memberships set valid_until = current_date - 1, valid_from = current_date - 100
   where athlete_id = '00000000-0000-0000-0000-000000000071';
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Synthetic Academy', 'expired membership drops the club brand (' || mc.brands(j) || ')');
  update public.memberships set valid_from = current_date - 60, valid_until = current_date + 300
   where athlete_id = '00000000-0000-0000-0000-000000000071';

  -- Inactive entity is never shown.
  update public.billing_entities set is_active = false where id = '00000000-0000-0000-0000-0000000007e2';
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Synthetic Club', 'an inactive entity gives no card (' || mc.brands(j) || ')');
  update public.billing_entities set is_active = true where id = '00000000-0000-0000-0000-0000000007e2';
end $$;

-- ===========================================================================
-- B. Brand save
-- ===========================================================================
do $$
declare j jsonb; v_path text;
begin
  v_path := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-0000000007e2/logo_1.png';
  j := mc.j('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('academy'), 'display_name', 'MC Basketball',
                            'subtitle', 'Powered by MC Synthetic Academy', 'logo_path', v_path)::text));
  perform mc.ok(j->>'display_name' = 'MC Basketball' and j->>'logo_path' = v_path, 'admin saves a brand with a logo (' || j::text || ')');
  perform mc.ok(exists (select 1 from public.audit_logs where action = 'member_card.brand.save' and target_id = (j->>'id')::uuid),
                'brand save is audited');

  j := mc.j('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('club'), 'display_name', 'MC Sports Club')::text));
  perform mc.ok(j->>'logo_path' is null, 'text-only brand (no logo) is allowed');

  j := mc.j('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('academy'), 'logo_path', '../etc/passwd')::text));
  perform mc.ok(j->>'err' like '%INVALID_LOGO_PATH%', 'a logo path outside <org>/<entity>/ is refused');
  j := mc.j('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('academy'),
           'logo_path', '00000000-0000-0000-0000-000000000001/' || mc.get('club') || '/x.png')::text));
  perform mc.ok(j->>'err' like '%INVALID_LOGO_PATH%', 'a logo path of another entity is refused');

  j := mc.j('00000000-0000-0000-0000-0000000000f4', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('academy'), 'display_name', 'Hijack')::text));
  perform mc.ok(j->>'err' like '%NOT_AUTHORIZED%', 'a guardian cannot save a brand');
  j := mc.j('00000000-0000-0000-0000-0000000000f2', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('academy'), 'display_name', 'Hijack')::text));
  perform mc.ok(j->>'err' like '%NOT_AUTHORIZED%', 'finance cannot save a brand');
  j := mc.j('b0000000-0000-0000-0000-0000000007b4', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('academy'), 'display_name', 'Hijack')::text));
  perform mc.ok(j->>'err' like '%ENTITY_NOT_FOUND%', 'another club''s admin cannot brand this entity');

  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(mc.brands(j) = 'MC Sports Club|MC Basketball'
                and j->'brands'->1->>'subtitle' = 'Powered by MC Synthetic Academy'
                and j->'brands'->1->>'watermark_path' = j->'brands'->1->>'logo_path'
                and j->'brands'->0->>'logo_path' is null,
                'card brands carry display name, subtitle, logo; watermark defaults to the logo (' || mc.brands(j) || ')');
end $$;

-- ===========================================================================
-- C. Card read permissions
-- ===========================================================================
do $$
declare j jsonb;
begin
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000072')::text$q$);
  perform mc.ok(j->>'err' like '%NOT_AUTHORIZED%', 'a guardian cannot read another family''s card');
  j := mc.j('00000000-0000-0000-0000-0000000007b2', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000072')::text$q$);
  perform mc.ok(j->>'token' ~ '^M1\.[0-9a-f]{32}\.[0-9a-f]{32}$' and j->>'first_name' = 'Lucas', 'the player reads their own card');
  j := mc.j('00000000-0000-0000-0000-0000000007b2', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000073')::text$q$);
  perform mc.ok(j->>'err' like '%NOT_AUTHORIZED%', 'the player cannot read a sibling''s card (' || j::text || ')');
  j := mc.j('00000000-0000-0000-0000-0000000000f3', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(j->>'err' like '%NOT_AUTHORIZED%', 'a coach cannot read a card (scan only) (' || left(j::text, 200) || ')');
  j := mc.j('b0000000-0000-0000-0000-0000000007b4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(j->>'err' like '%ATHLETE_NOT_FOUND%', 'cross-tenant: another club''s admin gets not found');
  j := mc.j(null, $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(j ? 'err', 'anonymous callers are refused');
end $$;

-- ===========================================================================
-- D. Credential unchanged after brand / photo changes
-- ===========================================================================
do $$
declare j jsonb; v_tok text; v_nonce text; v_ver int; r text;
begin
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  v_tok := j->>'token';
  select nonce, version into v_nonce, v_ver from public.member_cards where athlete_id = '00000000-0000-0000-0000-000000000071';
  perform mc.ok(v_tok = 'M1.' || v_nonce || '.' || public.member_card_sign('00000000-0000-0000-0000-000000000001', v_nonce, v_ver),
                'the card QR is the existing credential (nonce + version + club key)');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_token('00000000-0000-0000-0000-000000000071')$q$);
  perform mc.ok(r = 'OK:' || v_tok, 'the existing member_card_token RPC returns the same token');

  -- brand change
  perform mc.j('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_brand_save('%s'::jsonb)::text$q$,
         jsonb_build_object('billing_entity_id', mc.get('club'), 'display_name', 'MC Sports Club Renamed')::text));
  -- photo change by the guardian (row pointer, as the upload action does)
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.athletes set photo_path = '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/p1.webp',
                       photo_updated_at = now() where id = '00000000-0000-0000-0000-000000000071' returning 1) select count(*)::text from u$q$);
  perform mc.ok(r = 'OK:1', 'the guardian sets the child''s photo pointer (' || r || ')');
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(j->>'token' = v_tok and j->>'photo_path' like '%/p1.webp', 'brand + photo change: same token, photo on the card');
  perform mc.ok((select nonce = v_nonce and version = v_ver from public.member_cards where athlete_id = '00000000-0000-0000-0000-000000000071'),
                'brand + photo change: nonce and version unchanged');
  -- photo removed
  perform mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.athletes set photo_path = null where id = '00000000-0000-0000-0000-000000000071' returning 1) select count(*)::text from u$q$);
  j := mc.j('00000000-0000-0000-0000-0000000000f4', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(j->>'token' = v_tok and j->>'photo_path' is null, 'photo removed: same token, no photo');
  perform mc.ok((select count(*) from public.member_cards where athlete_id = '00000000-0000-0000-0000-000000000071') = 1,
                'repeated card reads never create a second card');
  -- the existing scan resolver still resolves it (admin)
  r := mc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select athlete_id::text from public.resolve_member_token('%s')$q$, v_tok));
  perform mc.ok(r = 'OK:00000000-0000-0000-0000-000000000071', 'resolve_member_token still resolves the card');
  perform mc.put('tok71', v_tok);
end $$;

-- ===========================================================================
-- E. Photo permissions + brand logo storage
-- ===========================================================================
do $$
declare r text;
begin
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.athlete_photo_access('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/a.webp', true)::text$q$);
  perform mc.ok(r = 'OK:true', 'guardian may write their child''s photo object');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.athlete_photo_access('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/a.webp', false)::text$q$);
  perform mc.ok(r = 'OK:false', 'guardian may not read another family''s photo object (signed URL scope)');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.athlete_photo_access('00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/a.webp', true)::text$q$);
  perform mc.ok(r = 'OK:false', 'guardian may not write another family''s photo object');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$with u as (update public.athletes set photo_path = null where id = '00000000-0000-0000-0000-000000000072' returning 1) select count(*)::text from u$q$);
  perform mc.ok(r = 'OK:0' or r like 'ERR:%', 'guardian cannot change another family''s photo pointer (' || r || ')');

  r := mc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.member_card_brand_asset_access('00000000-0000-0000-0000-000000000001/%s/logo_1.png', false)::text$q$, mc.get('academy')));
  perform mc.ok(r = 'OK:true', 'a member of the club may read a brand logo (signed URL)');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.member_card_brand_asset_access('00000000-0000-0000-0000-000000000001/%s/logo_1.png', true)::text$q$, mc.get('academy')));
  perform mc.ok(r = 'OK:false', 'a guardian may not upload a brand logo');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_brand_asset_access('00000000-0000-0000-0000-000000000001/%s/logo_2.webp', true)::text$q$, mc.get('academy')));
  perform mc.ok(r = 'OK:true', 'an admin may upload a brand logo');
  r := mc.run_as('b0000000-0000-0000-0000-0000000007b4', format($q$select public.member_card_brand_asset_access('00000000-0000-0000-0000-000000000001/%s/logo_1.png', false)::text$q$, mc.get('academy')));
  perform mc.ok(r = 'OK:false', 'cross-tenant: another club cannot read the logo object');
end $$;

-- ===========================================================================
-- F. Card check-in on the team attendance sheet
-- ===========================================================================
insert into public.teams (id, org_id, season_id, name, sport) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007a1', 'MC Team', 'basketball');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'head');
insert into public.team_memberships (org_id, team_id, athlete_id, status, joined_on) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-000000000071', 'active', current_date - 30),
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c1', '00000000-0000-0000-0000-000000000072', 'active', current_date - 30);
insert into public.events (id, org_id, team_id, season_id, type, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-0000000007d1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000007c1',
   '00000000-0000-0000-0000-0000000007a1', 'training', 'MC training', now() - interval '30 minutes', now() + interval '90 minutes');

-- QR check-in is a separate club decision (20250420106900): off by default.
do $$
declare j jsonb;
begin
  perform mc.ok(not public.org_card_check_in_enabled('00000000-0000-0000-0000-000000000001'), 'QR check-in is off by default');
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$, mc.get('tok71')));
  perform mc.ok(j->>'err' like '%CHECK_IN_DISABLED%', 'setting off: a scan is refused (' || j::text || ')');
  perform mc.ok(not exists (select 1 from public.team_attendance_marks where event_id = '00000000-0000-0000-0000-0000000007d1' and status = 'present'),
                'setting off: nothing written');
  j := mc.j('00000000-0000-0000-0000-0000000000f3', 'select public.card_check_in_setting()::text');
  perform mc.ok(j = 'false'::jsonb, 'coach reads the setting (off)');
end $$;
update public.app_settings set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{member_card}', '{"qr_check_in": true}'::jsonb)
 where org_id = '00000000-0000-0000-0000-000000000001';
do $$
begin
  perform mc.ok(public.org_card_check_in_enabled('00000000-0000-0000-0000-000000000001'), 'club turns QR check-in on');
  perform mc.ok(not public.org_card_check_in_enabled('10000000-0000-0000-0000-000000000002'), 'the other club stays off');
end $$;

do $$
declare j jsonb; v_req uuid := gen_random_uuid(); v_tok73 text; v_hist int;
begin
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', '%s')::text$q$,
         mc.get('tok71'), v_req));
  perform mc.ok((j->>'ok')::boolean and not (j->>'already')::boolean and j->>'athlete_id' = '00000000-0000-0000-0000-000000000071'
                and j->>'name' = 'Mateo Lopes', 'team coach scans the card: athlete checked in (' || j::text || ')');
  perform mc.ok((select status from public.team_attendance_marks
                  where event_id = '00000000-0000-0000-0000-0000000007d1' and athlete_id = '00000000-0000-0000-0000-000000000071') = 'present',
                'the saved record is the team attendance sheet mark (present)');
  select count(*) into v_hist from public.team_attendance_mark_history
   where event_id = '00000000-0000-0000-0000-0000000007d1' and athlete_id = '00000000-0000-0000-0000-000000000071';
  perform mc.ok(v_hist = 1, 'one history row for the scan');

  -- same request id (network retry) and a second scan: no duplicates
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', '%s')::text$q$,
         mc.get('tok71'), v_req));
  perform mc.ok((j->>'ok')::boolean and (j->>'already')::boolean, 'retry with the same request id is a no-op');
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$,
         mc.get('tok71')));
  perform mc.ok((j->>'ok')::boolean and (j->>'already')::boolean, 'a repeated scan reports already checked in');
  perform mc.ok((select count(*) from public.team_attendance_marks
                  where event_id = '00000000-0000-0000-0000-0000000007d1' and athlete_id = '00000000-0000-0000-0000-000000000071') = 1
                and (select count(*) from public.team_attendance_mark_history
                      where event_id = '00000000-0000-0000-0000-0000000007d1' and athlete_id = '00000000-0000-0000-0000-000000000071') = v_hist,
                'repeated scans: one mark, no new history');
  perform mc.ok((select count(*) from public.audit_logs where action = 'MEMBER_CARD_CHECK_IN') = 1, 'the check-in is audited once');

  -- the sheet read (roster / history source) shows the same mark
  j := mc.j('00000000-0000-0000-0000-0000000000f3', $q$select public.attendance_sheet('00000000-0000-0000-0000-0000000007d1')::text$q$);
  perform mc.ok(exists (select 1 from jsonb_array_elements(j->'marks') m
                         where m->>'athlete_id' = '00000000-0000-0000-0000-000000000071' and m->>'status' = 'present'),
                'attendance_sheet shows the scanned player as present');

  -- forged / unknown card
  j := mc.j('00000000-0000-0000-0000-0000000000f3', $q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', 'M1.00000000000000000000000000000000.00000000000000000000000000000000', null)::text$q$);
  perform mc.ok(j->>'code' = 'UNKNOWN_CARD', 'an unknown card is refused');
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$,
         left(mc.get('tok71'), length(mc.get('tok71')) - 1) || 'x'));
  perform mc.ok(j->>'code' = 'UNKNOWN_CARD', 'a tampered signature is refused');

  -- …073 is not on this team
  v_tok73 := (mc.j('00000000-0000-0000-0000-0000000000f1', $q$select public.member_card_courtside('00000000-0000-0000-0000-000000000073')::text$q$))->>'token';
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$, v_tok73));
  perform mc.ok(j->>'code' = 'NOT_ON_SHEET', 'a card of a player not on the sheet is reported, nothing saved');
  perform mc.ok(not exists (select 1 from public.team_attendance_marks
                             where event_id = '00000000-0000-0000-0000-0000000007d1' and athlete_id = '00000000-0000-0000-0000-000000000073'),
                'no mark for the player who is not on the sheet');

  -- a coach who does not run this event, a guardian, another club
  j := mc.j('00000000-0000-0000-0000-0000000007b1', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$, mc.get('tok71')));
  perform mc.ok(j->>'err' like '%NOT_AUTHORIZED%', 'a coach of another team cannot check in on this event');
  j := mc.j('00000000-0000-0000-0000-0000000000f4', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$, mc.get('tok71')));
  perform mc.ok(j ? 'err', 'a guardian cannot check in');
  j := mc.j('b0000000-0000-0000-0000-0000000007b4', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$, mc.get('tok71')));
  perform mc.ok(j->>'err' like '%EVENT_NOT_FOUND%' or j->>'err' like '%CHECK_IN_DISABLED%', 'cross-tenant: another club''s admin is refused (' || j::text || ')');

  -- admin scans the player's card for …072 (another mark on the same sheet)
  j := mc.j('00000000-0000-0000-0000-0000000000f1', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$,
         (mc.j('00000000-0000-0000-0000-0000000000f1', $s$select public.member_card_courtside('00000000-0000-0000-0000-000000000072')::text$s$))->>'token'));
  perform mc.ok((j->>'ok')::boolean and j->>'athlete_id' = '00000000-0000-0000-0000-000000000072', 'admin check-in works for any player on the sheet');

  -- final sheet: refused, mark unchanged
  update public.team_attendance_sheets set status = 'final', finalized_at = now() where event_id = '00000000-0000-0000-0000-0000000007d1';
  j := mc.j('00000000-0000-0000-0000-0000000000f3', format($q$select public.member_card_check_in('00000000-0000-0000-0000-0000000007d1', '%s', null)::text$q$, mc.get('tok71')));
  perform mc.ok(j->>'code' = 'SHEET_FINAL', 'a final sheet is not changed by a scan');
end $$;

-- ===========================================================================
-- G. RLS on member_card_brands (every verb) + cross-tenant
-- ===========================================================================
do $$
declare r text;
begin
  r := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.member_card_brands$q$);
  perform mc.ok(r = 'OK:2', 'admin reads the club''s brands (' || r || ')');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.member_card_brands$q$);
  perform mc.ok(r = 'OK:2', 'finance reads the brands');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.member_card_brands$q$);
  perform mc.ok(r = 'OK:0', 'a guardian reads no brand rows directly');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.member_card_brands$q$);
  perform mc.ok(r = 'OK:0', 'a coach reads no brand rows');
  r := mc.run_as('b0000000-0000-0000-0000-0000000007b4', $q$select count(*)::text from public.member_card_brands$q$);
  perform mc.ok(r = 'OK:0', 'cross-tenant: another club''s admin reads no brand rows');
  r := mc.run_as('b0000000-0000-0000-0000-0000000007b4',
       format($q$insert into public.member_card_brands (org_id, billing_entity_id, display_name) values ('00000000-0000-0000-0000-000000000001', '%s', 'X') returning id::text$q$, mc.get('academy')));
  perform mc.ok(r like 'ERR:%', 'cross-tenant insert is refused');
  r := mc.run_as('b0000000-0000-0000-0000-0000000007b4', $q$with u as (update public.member_card_brands set display_name = 'X' returning 1) select count(*)::text from u$q$);
  perform mc.ok(r = 'OK:0', 'cross-tenant update touches nothing');
  r := mc.run_as('b0000000-0000-0000-0000-0000000007b4', $q$with d as (delete from public.member_card_brands returning 1) select count(*)::text from d$q$);
  perform mc.ok(r = 'OK:0', 'cross-tenant delete touches nothing');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$with u as (update public.member_card_brands set display_name = 'X' returning 1) select count(*)::text from u$q$);
  perform mc.ok(r = 'OK:0', 'a guardian cannot update brands');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f2', $q$with d as (delete from public.member_card_brands returning 1) select count(*)::text from d$q$);
  perform mc.ok(r = 'OK:0', 'finance cannot delete brands');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f2',
       format($q$insert into public.member_card_brands (org_id, billing_entity_id, display_name) values ('00000000-0000-0000-0000-000000000001', '%s', 'X') returning id::text$q$, mc.get('academy')));
  perform mc.ok(r like 'ERR:%', 'finance cannot insert brands');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$with u as (update public.member_card_brands set subtitle = 'Updated' returning 1) select count(*)::text from u$q$);
  perform mc.ok(r = 'OK:2', 'admin updates brands');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$with d as (delete from public.member_card_brands where billing_entity_id = '%s' returning 1) select count(*)::text from d$q$, mc.get('club')));
  perform mc.ok(r = 'OK:1', 'admin deletes a brand (card falls back to the entity name)');
  r := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.member_card_brand_sources('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071')::text$q$);
  perform mc.ok(r like 'ERR:%', 'the internal brand resolver is not callable by members');
end $$;

select 'PASS — member card courtside suite finished' as result;
