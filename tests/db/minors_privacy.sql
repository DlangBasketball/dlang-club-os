-- ============================================================================
-- Minors' privacy suite (migration 20250420095400_minors_privacy_fixes.sql).
--
--   A. Storage: an admin of org B cannot read, change or delete org A's
--      objects in the private documents bucket; org A's admin can.
--   B. register_public writes no medical notes into registrations.notes.
--   C. COPPA gate: an org that must obtain verifiable parental consent
--      cannot take an under-13 through online registration.
--   D. audit_logs hold no special-category values.
--   E. anonymise_family, called as the signed-in admin (the path the app
--      uses), clears registration notes, documents and audit payloads; the
--      service role (no user) is refused.
--
-- Fixture identities (seed): org A …0001 (admin …f1, finance …f2, family …061,
-- athletes …071/…072, public program …041), org B 10000000-…0002.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema mp;
grant usage on schema mp to authenticated, anon, service_role;

create function mp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service_role, no user). Returns
-- 'OK:<first column as text>' or 'ERR:<message>'. Side effects are kept.
create function mp.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema mp to authenticated, anon, service_role;

-- Org B admin
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b9', 'admin9@riverside.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000b9';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b9', 'admin');

-- ===========================================================================
-- A. Storage objects are scoped to the caller's org folder
-- ===========================================================================
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values
  ('documents', '00000000-0000-0000-0000-000000000001/a-medical.pdf'),
  ('documents', '10000000-0000-0000-0000-000000000002/b-medical.pdf');

do $$
declare v text;
begin
  v := mp.run_as('b0000000-0000-0000-0000-0000000000b9',
        $q$select count(*)::text from storage.objects where bucket_id = 'documents' and name like '00000000-0000-0000-0000-000000000001/%'$q$);
  perform mp.ok(v = 'OK:0', 'org B admin cannot list org A document objects (' || v || ')');

  v := mp.run_as('b0000000-0000-0000-0000-0000000000b9',
        $q$with d as (delete from storage.objects where name = '00000000-0000-0000-0000-000000000001/a-medical.pdf' returning 1) select count(*)::text from d$q$);
  perform mp.ok(v = 'OK:0', 'org B admin cannot delete an org A document object (' || v || ')');

  v := mp.run_as('b0000000-0000-0000-0000-0000000000b9',
        $q$insert into storage.objects (bucket_id, name) values ('documents', '00000000-0000-0000-0000-000000000001/planted.pdf') returning 1$q$);
  perform mp.ok(v like 'ERR:%', 'org B admin cannot upload into org A''s folder');

  v := mp.run_as('b0000000-0000-0000-0000-0000000000b9',
        $q$select count(*)::text from storage.objects where bucket_id = 'documents'$q$);
  perform mp.ok(v = 'OK:1', 'org B admin sees only its own objects (' || v || ')');

  v := mp.run_as('00000000-0000-0000-0000-0000000000f1',
        $q$select count(*)::text from storage.objects where bucket_id = 'documents'$q$);
  perform mp.ok(v = 'OK:1', 'org A admin sees only its own objects (' || v || ')');

  v := mp.run_as('00000000-0000-0000-0000-0000000000f2',
        $q$select count(*)::text from storage.objects where bucket_id = 'documents'$q$);
  perform mp.ok(v = 'OK:0', 'org A finance user (not admin) sees no document objects (' || v || ')');

  perform mp.ok((select count(*) from storage.objects where name = '00000000-0000-0000-0000-000000000001/a-medical.pdf') = 1,
                'org A object still present');
end $$;

-- ===========================================================================
-- B + C. register_public: no medical notes in registrations; COPPA gate
-- ===========================================================================
do $$
declare v jsonb; v_reg uuid; v_err text;
begin
  -- Org A is Swiss: no VPC gate; an 8-year-old can be registered.
  v := public.register_public(jsonb_build_object(
    'program_id', '00000000-0000-0000-0000-000000000041',
    'parent', jsonb_build_object('name', 'Test Parent', 'email', 'mp-parent@example.test', 'phone', '+41 00 000 00 00',
                                 'emergency_name', 'Test Contact', 'emergency_phone', '+41 00 000 00 01'),
    'children', jsonb_build_array(jsonb_build_object('first_name', 'Kid', 'last_name', 'Test',
                                  'dob', (current_date - interval '8 years')::date::text,
                                  'allergies', 'synthetic-allergy', 'medical_notes', 'synthetic-medical-note')),
    'consents', '[]'::jsonb));
  v_reg := (v->'registration_ids'->>0)::uuid;
  perform mp.ok((select notes from public.registrations where id = v_reg) is null,
                'register_public leaves registrations.notes empty');
  perform mp.ok((select notes from public.athlete_medical where athlete_id = (v->'athlete_ids'->>0)::uuid) = 'synthetic-medical-note',
                'medical notes are stored in athlete_medical');

  -- D. The INSERT audit rows carry no health values.
  perform mp.ok(not exists (select 1 from public.audit_logs
                             where (coalesce(old_data::text, '') || coalesce(new_data::text, '')) like '%synthetic-%'),
                'audit_logs hold no allergies / medical notes after registration');
  perform mp.ok(exists (select 1 from public.audit_logs where target_table = 'athlete_medical'
                          and new_data->>'allergies' = '[redacted]'),
                'athlete_medical audit row records the field as [redacted]');

  -- C. Make org A a US club that collects from under-13s.
  update public.compliance_settings set data_region = 'US', coppa_applies = true
   where org_id = '00000000-0000-0000-0000-000000000001';
  begin
    perform public.register_public(jsonb_build_object(
      'program_id', '00000000-0000-0000-0000-000000000041',
      'parent', jsonb_build_object('name', 'US Parent', 'email', 'mp-us@example.test'),
      'children', jsonb_build_array(jsonb_build_object('first_name', 'Young', 'last_name', 'Kid',
                                    'dob', (current_date - interval '9 years')::date::text))));
    v_err := 'none';
  exception when others then v_err := sqlerrm;
  end;
  perform mp.ok(v_err = 'VPC_REQUIRED', 'US/COPPA org: under-13 online registration refused (' || v_err || ')');

  begin
    v := public.register_public(jsonb_build_object(
      'program_id', '00000000-0000-0000-0000-000000000041',
      'parent', jsonb_build_object('name', 'US Parent', 'email', 'mp-us@example.test'),
      'children', jsonb_build_array(jsonb_build_object('first_name', 'Teen', 'last_name', 'Kid',
                                    'dob', (current_date - interval '15 years')::date::text))));
    v_err := 'none';
  exception when others then v_err := sqlerrm;
  end;
  perform mp.ok(v_err = 'none', 'US/COPPA org: 15-year-old can still register (' || v_err || ')');

  update public.compliance_settings set coppa_applies = false
   where org_id = '00000000-0000-0000-0000-000000000001';
  perform mp.ok(not public.org_requires_vpc('00000000-0000-0000-0000-000000000001'),
                'coppa_applies = false switches the gate off');
  update public.compliance_settings set data_region = 'CH'
   where org_id = '00000000-0000-0000-0000-000000000001';
end $$;

-- ===========================================================================
-- D + E. anonymise_family erases notes, documents and audit payloads
-- ===========================================================================
-- Simulate the pre-fix state: a registration note and a full-row audit copy.
update public.registrations set notes = 'synthetic-legacy-note'
 where athlete_id = '00000000-0000-0000-0000-000000000071';
update public.athlete_medical set notes = 'synthetic-secret-note'
 where athlete_id = '00000000-0000-0000-0000-000000000071';

do $$
declare v text; v_res jsonb;
begin
  -- Service role carries no user: refused (the app must use the admin's session).
  v := mp.run_as(null, $q$select public.anonymise_family('00000000-0000-0000-0000-000000000061')::text$q$);
  perform mp.ok(v like 'ERR:%FORBIDDEN%', 'anonymise_family via service role (no user) is refused (' || left(v, 40) || ')');

  -- Org B admin cannot erase org A's family.
  v := mp.run_as('b0000000-0000-0000-0000-0000000000b9', $q$select public.anonymise_family('00000000-0000-0000-0000-000000000061')::text$q$);
  perform mp.ok(v like 'ERR:%', 'org B admin cannot anonymise an org A family');

  -- Org A admin (session client path).
  v := mp.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.anonymise_family('00000000-0000-0000-0000-000000000061')::text$q$);
  perform mp.ok(v like 'OK:%', 'org A admin anonymises own family (' || left(v, 60) || ')');
  v_res := substr(v, 4)::jsonb;

  perform mp.ok((select first_name from public.athletes where id = '00000000-0000-0000-0000-000000000071') = 'Redacted',
                'athlete name redacted');
  perform mp.ok(not exists (select 1 from public.registrations
                             where athlete_id = '00000000-0000-0000-0000-000000000071' and notes is not null),
                'registrations.notes cleared');
  perform mp.ok(not exists (select 1 from public.documents where family_id = '00000000-0000-0000-0000-000000000061'
                               or athlete_id = '00000000-0000-0000-0000-000000000071'),
                'family documents deleted');
  perform mp.ok(jsonb_array_length(v_res->'storage_paths') = 2,
                'storage paths returned for object removal (' || coalesce(v_res->>'storage_paths', '<null>') || ')');
  perform mp.ok(not exists (select 1 from public.audit_logs
                             where (coalesce(old_data::text, '') || coalesce(new_data::text, ''))
                                   ~ '(synthetic-secret-note|synthetic-legacy-note|Mild asthma|Helsana|João)'),
                'no erased health or identity data left in audit_logs');
  perform mp.ok(exists (select 1 from public.audit_logs where target_table = 'athlete_medical'
                          and new_data->>'redacted' = 'erasure'),
                'audit rows keep the action metadata, marked as erased');
  -- Other families are untouched.
  perform mp.ok((select allergies from public.athlete_medical where athlete_id = '00000000-0000-0000-0000-000000000072') like 'Peanuts%',
                'another family''s medical record is untouched');
end $$;

-- ===========================================================================
-- D. Updates record which sensitive fields changed, not their values
-- ===========================================================================
do $$
begin
  update public.athlete_medical set conditions = 'synthetic-new-condition'
   where athlete_id = '00000000-0000-0000-0000-000000000072';
  perform mp.ok(exists (select 1 from public.audit_logs
                         where target_table = 'athlete_medical' and action = 'UPDATE'
                           and new_data->'_changed_sensitive' ? 'conditions'
                           and new_data->>'conditions' = '[redacted]'
                           and old_data->>'allergies' = '[redacted]'),
                'UPDATE audit row lists changed sensitive columns, values redacted');
  perform mp.ok(not exists (select 1 from public.audit_logs
                             where (coalesce(old_data::text, '') || coalesce(new_data::text, '')) ~ '(synthetic-new-condition|Peanuts)'),
                'no medical values in audit_logs after an update');
end $$;
