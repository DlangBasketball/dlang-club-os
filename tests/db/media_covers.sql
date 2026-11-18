-- ============================================================================
-- Media library, covers and roster suite (migration 20250420101100_media_covers.sql)
--
--   A. media_assets: admin writes own org; finance/coach read only; parents
--      nothing; org B admin neither reads nor writes org A rows; a library
--      path outside <org>/<covers|banners|gallery>/ is refused.
--   B. club-media: admins write covers/ in their own org folder only.
--   C. set_cover(): admin sets org / team covers; public surfaces need the
--      consent confirmation; focal point clamped; non-admins and other orgs
--      refused; audit rows written; unsupported targets refused.
--   D. Athlete covers are PRIVATE: guardian of the athlete and the org admin
--      write; another family, finance, a coach of another org and org B admin
--      cannot read; the bucket is private.
--   E. A library image in use cannot be deleted.
--   F. Roster changes (team_memberships): admin yes; parent, finance and the
--      admin of another org no.
--   G. Programme covers work as soon as the camps migration adds the columns
--      (runtime discovery); public surface, so consent is required.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 leading
-- program …043 with athletes …072/…073, guardian …f4 of family …061 /
-- athlete …071). Org B …0002 from seed_tenants.sql; its users are created here.
-- SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema mc;
grant usage on schema mc to authenticated, anon, service_role;

create function mc.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p. Returns 'OK:<first column>' or 'ERR:<message>'.
create function mc.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p is null then execute 'set local role service_role'; else execute 'set local role authenticated'; end if;
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
grant execute on all functions in schema mc to authenticated, anon, service_role;

-- Org B: admin, coach (with a team), guardian + athlete (synthetic).
insert into auth.users (id, email) values
  ('b1000000-0000-0000-0000-0000000000c1', 'mc-admin-b@example.test'),
  ('b1000000-0000-0000-0000-0000000000c2', 'mc-coach-b@example.test'),
  ('b1000000-0000-0000-0000-0000000000c3', 'mc-guardian-b@example.test'),
  ('a1000000-0000-0000-0000-0000000000c4', 'mc-guardian-a2@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id in ('b1000000-0000-0000-0000-0000000000c1', 'b1000000-0000-0000-0000-0000000000c2', 'b1000000-0000-0000-0000-0000000000c3');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001'
 where id = 'a1000000-0000-0000-0000-0000000000c4';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-0000000000c1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-0000000000c2', 'coach');
insert into public.coaches (id, org_id, profile_id, display_name) values
  ('b1000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-0000000000c2', 'Coach B');
insert into public.families (id, org_id, name) values
  ('b1000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-000000000002', 'Synthetic B family'),
  ('a1000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', 'Synthetic A second family');
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('b1000000-0000-0000-0000-0000000000d1', 'b1000000-0000-0000-0000-0000000000c3', 'guardian', true),
  ('a1000000-0000-0000-0000-0000000000d2', 'a1000000-0000-0000-0000-0000000000c4', 'guardian', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob) values
  ('b1000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-000000000002',
   'b1000000-0000-0000-0000-0000000000d1', 'Test', 'Bplayer', '2015-01-01'),
  ('a1000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001',
   'a1000000-0000-0000-0000-0000000000d2', 'Test', 'Asecond', '2014-01-01');

-- Teams: one per org (org B's team is coached by Coach B, with the B athlete).
insert into public.teams (id, org_id, name) values
  ('a1000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'MC Team A'),
  ('a1000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', 'MC Team A2'),
  ('b1000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-000000000002', 'MC Team B');
insert into public.team_coaches (team_id, coach_id, org_id, role) values
  ('b1000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000002', 'head');
insert into public.team_memberships (org_id, team_id, athlete_id) values
  ('10000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-0000000000f1', 'b1000000-0000-0000-0000-0000000000e1');

-- ===========================================================================
-- A. media_assets
-- ===========================================================================
do $$
declare v text;
begin
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into public.media_assets (id, org_id, path, kind, width, height, alt_text, uploaded_by)
    values ('a1000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 'cover', 2400, 1200, 'Court at sunset',
            '00000000-0000-0000-0000-0000000000f1')
    returning id::text$q$);
  perform mc.ok(v like 'OK:%', 'org A admin adds a library image (' || v || ')');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into public.media_assets (id, org_id, path, kind)
    values ('a1000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000001',
            '00000000-0000-0000-0000-000000000001/covers/unused.webp', 'cover')
    returning id::text$q$);
  perform mc.ok(v like 'OK:%', 'org A admin adds a second (unused) image');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into public.media_assets (org_id, path, kind)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001/products/x.webp', 'cover')
    returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'a path outside covers/banners/gallery is refused');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into public.media_assets (org_id, path, kind)
    values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002/covers/planted.webp', 'cover')
    returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'org A admin cannot insert into org B''s library');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.media_assets$q$);
  perform mc.ok(v = 'OK:2', 'finance reads the club library (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f2', $q$
    insert into public.media_assets (org_id, path, kind)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001/covers/fin.webp', 'cover')
    returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'finance cannot add library images');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.media_assets$q$);
  perform mc.ok(v = 'OK:2', 'coach reads the club library (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f3', $q$
    with d as (update public.media_assets set alt_text = 'x' returning 1) select count(*)::text from d$q$);
  perform mc.ok(v = 'OK:0', 'coach cannot edit library images (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.media_assets$q$);
  perform mc.ok(v = 'OK:0', 'parent reads no library rows (' || v || ')');

  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$select count(*)::text from public.media_assets$q$);
  perform mc.ok(v = 'OK:0', 'org B admin reads no org A library rows (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$
    with d as (update public.media_assets set alt_text = 'hijack' returning 1) select count(*)::text from d$q$);
  perform mc.ok(v = 'OK:0', 'org B admin cannot edit org A library rows (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$
    with d as (delete from public.media_assets returning 1) select count(*)::text from d$q$);
  perform mc.ok(v = 'OK:0', 'org B admin cannot delete org A library rows (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from public.media_asset_usage(array['a1000000-0000-0000-0000-00000000a001'::uuid])$q$);
  perform mc.ok(v = 'OK:0', 'org B admin gets no usage data for org A assets (' || v || ')');
end $$;

-- ===========================================================================
-- B. club-media storage (public bucket): covers folder
-- ===========================================================================
do $$
declare v text;
begin
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into storage.objects (bucket_id, name)
    values ('club-media', '00000000-0000-0000-0000-000000000001/covers/hero-1.webp') returning name$q$);
  perform mc.ok(v like 'OK:%', 'org A admin uploads to club-media covers/ (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into storage.objects (bucket_id, name)
    values ('club-media', '10000000-0000-0000-0000-000000000002/covers/planted.webp') returning name$q$);
  perform mc.ok(v like 'ERR:%', 'org A admin cannot write into org B''s club-media folder');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    insert into storage.objects (bucket_id, name)
    values ('club-media', '00000000-0000-0000-0000-000000000001/covers/parent.webp') returning name$q$);
  perform mc.ok(v like 'ERR:%', 'a parent cannot upload club covers');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into storage.objects (bucket_id, name)
    values ('club-media', '00000000-0000-0000-0000-000000000001/secret/x.webp') returning name$q$);
  perform mc.ok(v like 'ERR:%', 'unknown club-media folders are refused');
end $$;

-- ===========================================================================
-- C. set_cover() for org / team (+ consent, focal clamp, audit, refusals)
-- ===========================================================================
do $$
declare v text; v_audit_before int; v_audit_after int;
begin
  perform mc.ok((select 'org' = any (public.media_cover_targets()) and 'team' = any (public.media_cover_targets())
                         and 'athlete' = any (public.media_cover_targets())),
                'org, team and athlete are supported cover targets');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('org', '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 30, 70, false)::text$q$);
  perform mc.ok(v like 'ERR:%CONSENT_REQUIRED%', 'a public org cover needs the consent confirmation (' || v || ')');

  select count(*) into v_audit_before from public.audit_logs where action like 'cover.%';
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('org', '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 130, -5, true)::text$q$);
  perform mc.ok(v like 'OK:%', 'org A admin sets the club cover with consent (' || v || ')');
  perform mc.ok((select cover_path = '00000000-0000-0000-0000-000000000001/covers/hero-1.webp'
                        and cover_focal_x = 100 and cover_focal_y = 0
                   from public.organizations where id = '00000000-0000-0000-0000-000000000001'),
                'org cover stored with the focal point clamped to 0..100');
  perform mc.ok((select public_use_confirmed_by = '00000000-0000-0000-0000-0000000000f1'
                   from public.media_assets where id = 'a1000000-0000-0000-0000-00000000a001'),
                'public-use consent confirmation recorded on the asset');
  select count(*) into v_audit_after from public.audit_logs where action like 'cover.%';
  perform mc.ok(v_audit_after = v_audit_before + 1, 'cover change written to audit_logs');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('team', 'a1000000-0000-0000-0000-0000000000f1',
      '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 50, 40, false)::text$q$);
  perform mc.ok(v like 'OK:%', 'team cover (not public) needs no consent (' || v || ')');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('team', 'a1000000-0000-0000-0000-0000000000f2',
      '00000000-0000-0000-0000-000000000001/covers/not-in-library.webp', 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%INVALID_PATH%', 'a path that is not in the library is refused (' || v || ')');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('team', 'b1000000-0000-0000-0000-0000000000f1',
      '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_FOUND%', 'org A admin cannot set the cover of an org B team (' || v || ')');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('org', '10000000-0000-0000-0000-000000000002', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'org A admin cannot change org B''s cover (' || v || ')');

  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$
    select public.set_cover('team', 'a1000000-0000-0000-0000-0000000000f1', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%', 'org B admin cannot remove an org A team cover (' || v || ')');
  perform mc.ok((select cover_path is not null from public.teams where id = 'a1000000-0000-0000-0000-0000000000f1'),
                'org A team cover unchanged after the cross-tenant attempt');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f2', $q$
    select public.set_cover('team', 'a1000000-0000-0000-0000-0000000000f1', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance cannot change covers (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f3', $q$
    select public.set_cover('team', 'a1000000-0000-0000-0000-0000000000f1', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a coach cannot change team covers (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    select public.set_cover('org', '00000000-0000-0000-0000-000000000001', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'a parent cannot change the club cover (' || v || ')');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('nonsense', '00000000-0000-0000-0000-000000000001', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%', 'unknown targets are refused (' || v || ')');

  -- Direct column writes are still bound by the path constraint.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    with u as (update public.teams set cover_path = '10000000-0000-0000-0000-000000000002/covers/x.webp'
                where id = 'a1000000-0000-0000-0000-0000000000f2' returning 1) select count(*)::text from u$q$);
  perform mc.ok(v like 'ERR:%', 'a team cover path of another org is refused by the constraint (' || v || ')');

  -- Anonymous: no RPC.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    execute 'set local role anon';
    perform public.set_cover('org', '00000000-0000-0000-0000-000000000001', null, 50, 50, false);
    execute 'reset role';
    v := 'allowed';
  exception when others then
    execute 'reset role';
    v := 'denied';
  end;
  perform mc.ok(v = 'denied', 'anonymous callers cannot call set_cover');
end $$;

-- ===========================================================================
-- D. Athlete covers are private
-- ===========================================================================
do $$
declare v text;
  k71 text := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000071/cover1.webp';
  k72 text := '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/cover1.webp';
begin
  perform mc.ok((select public = false from storage.buckets where id = 'athlete-covers'), 'athlete-covers bucket exists and is private');

  -- Guardian of 071 uploads and sets the cover of her own child.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-covers', %L) returning name$q$, k71));
  perform mc.ok(v like 'OK:%', 'guardian uploads a cover for her own child (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$select public.set_cover('athlete', '00000000-0000-0000-0000-000000000071', %L, 40, 60, false)::text$q$, k71));
  perform mc.ok(v like 'OK:%', 'guardian sets her child''s cover (' || v || ')');

  -- ... but not another family's child.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-covers', %L) returning name$q$, k72));
  perform mc.ok(v like 'ERR:%', 'guardian cannot upload a cover of another family''s child');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4',
       $q$select public.set_cover('athlete', '00000000-0000-0000-0000-000000000072', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'guardian cannot set another child''s cover (' || v || ')');

  -- A private key of another athlete is refused as a cover path.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$select public.set_cover('athlete', '00000000-0000-0000-0000-000000000072', %L, 50, 50, false)::text$q$, k71));
  perform mc.ok(v like 'ERR:%INVALID_PATH%', 'another athlete''s private key cannot be used as a cover (' || v || ')');

  -- Admin uploads a cover for 072.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-covers', %L) returning name$q$, k72));
  perform mc.ok(v like 'OK:%', 'org A admin uploads an athlete cover (' || v || ')');

  -- Readers: another family (org A) sees nothing.
  v := mc.run_as('a1000000-0000-0000-0000-0000000000c4',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-covers'$q$);
  perform mc.ok(v = 'OK:0', 'a guardian of another family reads no athlete cover (' || v || ')');
  -- Coach of program 043 reads 072 only.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f3',
       $q$select string_agg(name, ',') from storage.objects where bucket_id = 'athlete-covers'$q$);
  perform mc.ok(v = 'OK:' || k72, 'coach reads only the cover of an athlete he coaches (' || v || ')');
  -- Finance nothing.
  v := mc.run_as('00000000-0000-0000-0000-0000000000f2',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-covers'$q$);
  perform mc.ok(v = 'OK:0', 'finance reads no athlete cover (' || v || ')');
  -- Org B: coach, guardian, admin nothing.
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c2',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-covers'$q$);
  perform mc.ok(v = 'OK:0', 'a coach of another org reads no athlete cover (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c3',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-covers'$q$);
  perform mc.ok(v = 'OK:0', 'a guardian of another org reads no athlete cover (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1',
       $q$select count(*)::text from storage.objects where bucket_id = 'athlete-covers'$q$);
  perform mc.ok(v = 'OK:0', 'org B admin reads no org A athlete cover (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1',
       format($q$insert into storage.objects (bucket_id, name) values ('athlete-covers', %L) returning name$q$,
              '00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000072/planted.webp'));
  perform mc.ok(v like 'ERR:%', 'org B admin cannot plant an org A athlete cover');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1',
       $q$select public.set_cover('athlete', '00000000-0000-0000-0000-000000000071', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%', 'org B admin cannot remove an org A athlete cover (' || v || ')');
  perform mc.ok((select cover_path = k71 from public.athletes where id = '00000000-0000-0000-0000-000000000071'),
                'org A athlete cover unchanged');
  -- The cover path column itself is not readable by another family.
  v := mc.run_as('a1000000-0000-0000-0000-0000000000c4',
       $q$select count(*)::text from public.athletes where id = '00000000-0000-0000-0000-000000000071'$q$);
  perform mc.ok(v = 'OK:0', 'another family cannot read the athlete row with its cover path (' || v || ')');

  -- Anonymous: nothing.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    execute 'set local role anon';
    v := (select count(*)::text from storage.objects where bucket_id = 'athlete-covers');
    execute 'reset role';
  exception when insufficient_privilege then
    execute 'reset role';
    v := 'denied';
  end;
  perform mc.ok(v in ('0', 'denied'), 'anonymous caller reads no athlete cover (' || v || ')');
end $$;

-- ===========================================================================
-- E. Library images in use cannot be deleted
-- ===========================================================================
do $$
declare v text;
begin
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select string_agg(asset_id::text || '=' || uses::text, ',' order by asset_id)
            from public.media_asset_usage(array['a1000000-0000-0000-0000-00000000a001'::uuid, 'a1000000-0000-0000-0000-00000000a002'::uuid])$q$);
  perform mc.ok(v = 'OK:a1000000-0000-0000-0000-00000000a001=2,a1000000-0000-0000-0000-00000000a002=0',
                'usage counts the org and the team cover (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    with d as (delete from public.media_assets where id = 'a1000000-0000-0000-0000-00000000a001' returning 1)
    select count(*)::text from d$q$);
  perform mc.ok(v like 'ERR:%MEDIA_IN_USE%', 'a used image cannot be deleted (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    with d as (delete from public.media_assets where id = 'a1000000-0000-0000-0000-00000000a002' returning 1)
    select count(*)::text from d$q$);
  perform mc.ok(v = 'OK:1', 'an unused image can be deleted (' || v || ')');
end $$;

-- ===========================================================================
-- F. Roster changes
-- ===========================================================================
do $$
declare v text;
begin
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number, position)
    values ('00000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-000000000071', 7, 'Guard') returning id::text$q$);
  perform mc.ok(v like 'OK:%', 'org A admin adds a player to a team (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    with u as (update public.team_memberships set team_id = 'a1000000-0000-0000-0000-0000000000f2'
                where team_id = 'a1000000-0000-0000-0000-0000000000f1'
                  and athlete_id = '00000000-0000-0000-0000-000000000071' returning 1)
    select count(*)::text from u$q$);
  perform mc.ok(v = 'OK:1', 'org A admin moves the player to another team (' || v || ')');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    insert into public.team_memberships (org_id, team_id, athlete_id)
    values ('00000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-000000000071') returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'a parent cannot add their child to a team (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f4', $q$
    with u as (update public.team_memberships set jersey_number = 99 returning 1) select count(*)::text from u$q$);
  perform mc.ok(v = 'OK:0', 'a parent cannot change roster rows (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f2', $q$
    insert into public.team_memberships (org_id, team_id, athlete_id)
    values ('00000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-000000000072') returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'finance cannot change rosters (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$
    with d as (delete from public.team_memberships where org_id = '00000000-0000-0000-0000-000000000001' returning 1)
    select count(*)::text from d$q$);
  perform mc.ok(v = 'OK:0', 'org B admin cannot remove org A roster rows (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$
    insert into public.team_memberships (org_id, team_id, athlete_id)
    values ('10000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-000000000072') returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'org B admin cannot put an org A athlete on an org B team (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c2', $q$
    insert into public.team_memberships (org_id, team_id, athlete_id)
    values ('00000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000f1',
            '00000000-0000-0000-0000-000000000072') returning id::text$q$);
  perform mc.ok(v like 'ERR:%', 'a coach of another org cannot change org A rosters (' || v || ')');
end $$;

-- ===========================================================================
-- G. Programme covers: discovered at runtime once the columns exist
--    (the camps migration adds them; until then the target is unsupported)
-- ===========================================================================
do $$
declare v text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'programs' and column_name = 'cover_path') then
    v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
      select public.set_cover('program', '00000000-0000-0000-0000-000000000043', null, 50, 50, false)::text$q$);
    perform mc.ok(v like 'ERR:%COVER_TARGET_UNSUPPORTED%', 'program covers are unsupported until the columns exist (' || v || ')');
    alter table public.programs add column cover_path text;
    alter table public.programs add column cover_focal_x smallint not null default 50;
    alter table public.programs add column cover_focal_y smallint not null default 50;
  end if;
  perform mc.ok('program' = any (public.media_cover_targets()), 'program becomes a cover target once the columns exist');

  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('program', '00000000-0000-0000-0000-000000000043',
      '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%CONSENT_REQUIRED%', 'a programme page is public: consent required (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1', $q$
    select public.set_cover('program', '00000000-0000-0000-0000-000000000043',
      '00000000-0000-0000-0000-000000000001/covers/hero-1.webp', 10, 90, true)::text$q$);
  perform mc.ok(v like 'OK:%', 'org A admin sets a programme cover with consent (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f1',
       $q$select uses::text from public.media_asset_usage(array['a1000000-0000-0000-0000-00000000a001'::uuid])$q$);
  perform mc.ok(v = 'OK:3', 'usage now also counts the programme cover (' || v || ')');
  v := mc.run_as('b1000000-0000-0000-0000-0000000000c1', $q$
    select public.set_cover('program', '00000000-0000-0000-0000-000000000043', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%', 'org B admin cannot change an org A programme cover (' || v || ')');
  v := mc.run_as('00000000-0000-0000-0000-0000000000f3', $q$
    select public.set_cover('program', '00000000-0000-0000-0000-000000000043', null, 50, 50, false)::text$q$);
  perform mc.ok(v like 'ERR:%NOT_AUTHORIZED%', 'the programme''s coach cannot change its cover (' || v || ')');
end $$;
