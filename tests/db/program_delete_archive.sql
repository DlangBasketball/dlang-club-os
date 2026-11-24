-- ============================================================================
-- Delete / archive / restore a programme
-- (migration 20250420105300_program_delete_archive.sql)
--
--   A. Unused programme: preview shows nothing linked; permanent delete
--      removes it (audit-logged).
--   B. Programme with a registration, invoice, payment and upcoming event:
--      preview counts per category, upcoming sessions and current enrolments
--      (child name + status); delete refused (PROGRAM_HAS_LINKED_RECORDS,
--      nothing removed, never archived silently); archive keeps every linked
--      record (registration, invoice, event untouched); no new registration
--      into the archived programme; restore puts the previous status back.
--   C. Race: a registration / session added after the preview -> delete
--      refused with fresh counts.
--   D. Restore fallback: draft when the previous status is unknown; a draft
--      programme archived by the edit form comes back as draft.
--   E. Lists are capped (10 + total).
--   F. Finance, coach and parent refused for impact / delete / archive /
--      restore; anon cannot execute.
--   G. Cross-tenant: the admin of org B cannot preview / delete / archive /
--      restore an org A programme (and vice versa).
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4 of family …061 with athlete …071). Org B …0002
-- (seed_tenants.sql); its admin is created here. SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema pd;
grant usage on schema pd to authenticated, anon, service_role;

create function pd.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = anon). 'OK:<first column>' or 'ERR:<message>'.
create function pd.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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

-- jsonb result of an RPC run as p (null when it failed).
create function pd.j(p uuid, p_fn text, p_program uuid) returns jsonb language plpgsql as $$
declare v text;
begin
  v := pd.run_as(p, format('select public.%I(%L::uuid)::text', p_fn, p_program));
  if v like 'OK:%' then return substr(v, 4)::jsonb; end if;
  return null;
end $$;
grant execute on all functions in schema pd to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures
--   P1 f…01 unused (published)              -> deleted
--   P2 f…02 registration + invoice + payment + team with upcoming event
--   P3 f…03 unused at preview, then a registration is added (race)
--   P4 f…04 unused at preview, then a programme session is added (race)
--   P5 f…05 draft, archived by a plain status update (edit form)
--   P6 f…06 many upcoming events (list cap)
--   PB f…0b org B programme
--   AB f…ab admin of org B
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('f0000000-0000-0000-0000-0000000000ab', 'pd-admin-b@example.test');
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'f0000000-0000-0000-0000-0000000000ab';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000ab', 'admin');

insert into public.programs (id, org_id, slug, name, kind, price_chf, status) values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'pd-unused-a1', 'Synthetic Unused', 'recurring_team', 0, 'published'),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'pd-linked-a2', 'Synthetic Linked', 'recurring_team', 300, 'published'),
  ('f0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'pd-race-a3', 'Synthetic Race Reg', 'recurring_team', 0, 'published'),
  ('f0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'pd-race-a4', 'Synthetic Race Session', 'recurring_team', 0, 'published'),
  ('f0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'pd-draft-a5', 'Synthetic Draft', 'recurring_team', 0, 'draft'),
  ('f0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'pd-busy-a6', 'Synthetic Busy', 'recurring_team', 0, 'published'),
  ('f0000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000002', 'pd-other-b', 'Synthetic Org B', 'recurring_team', 0, 'published');

-- P2: registration, invoice of the registration, payment, team + upcoming event.
insert into public.registrations (id, org_id, athlete_id, program_id, status) values
  ('f0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071',
   'f0000000-0000-0000-0000-000000000002', 'confirmed');
insert into public.invoices (id, org_id, number, family_id, registration_id, description, currency, total_chf, status, due_date)
values ('f0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'PD-0001', '00000000-0000-0000-0000-000000000061',
        'f0000000-0000-0000-0000-0000000000c1', 'Synthetic programme fee', 'CHF', 300, 'sent', current_date + 30);
insert into public.payments (org_id, invoice_id, amount_chf, method, status, paid_at)
values ('00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000d1', 100, 'twint', 'succeeded', now());
insert into public.teams (id, org_id, program_id, name) values
  ('f0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002', 'Synthetic PD Team'),
  ('f0000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000006', 'Synthetic PD Busy Team');
insert into public.events (id, org_id, team_id, type, title, starts_at, ends_at, status) values
  ('f0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a2', 'training', 'Synthetic practice',
   now() + interval '2 days', now() + interval '2 days 90 minutes', 'scheduled');
-- P6: 12 upcoming events.
insert into public.events (org_id, team_id, type, starts_at, ends_at, status)
select '00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a6', 'training',
       now() + make_interval(days => g), now() + make_interval(days => g, mins => 60), 'scheduled'
  from generate_series(1, 12) g;

-- ===========================================================================
-- A. Unused programme -> permanent delete
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete_impact', 'f0000000-0000-0000-0000-000000000001');
  perform pd.ok(v is not null and v->>'name' = 'Synthetic Unused', 'A: admin previews the unused programme (name shown)');
  perform pd.ok((v->>'total')::int = 0 and (v->>'can_delete')::boolean, 'A: nothing linked, can_delete');
  perform pd.ok(jsonb_array_length(v->'upcoming_sessions') = 0 and jsonb_array_length(v->'current_enrollments') = 0, 'A: no sessions, no enrolments');

  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete', 'f0000000-0000-0000-0000-000000000001');
  perform pd.ok((v->>'deleted')::boolean and (v->>'ok')::boolean, 'A: delete returns deleted');
  perform pd.ok(not exists (select 1 from public.programs where id = 'f0000000-0000-0000-0000-000000000001'), 'A: programme row is gone');
  perform pd.ok(exists (select 1 from public.audit_logs where action = 'program.delete' and target_id = 'f0000000-0000-0000-0000-000000000001'
                        and actor_id = '00000000-0000-0000-0000-0000000000f1'), 'A: delete is audit-logged with the actor');
  perform pd.ok(pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.program_delete_impact('f0000000-0000-0000-0000-000000000001')::text$q$)
                like 'ERR:%PROGRAM_NOT_FOUND%', 'A: deleted programme is not found afterwards');
end $$;

-- ===========================================================================
-- B. Linked programme: refused, archive, restore
-- ===========================================================================
do $$
declare v jsonb; r text;
begin
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete_impact', 'f0000000-0000-0000-0000-000000000002');
  perform pd.ok(not (v->>'can_delete')::boolean, 'B: linked programme cannot be deleted');
  perform pd.ok((v->'categories'->>'registrations')::int = 1, 'B: 1 registration counted');
  perform pd.ok((v->'categories'->>'invoices')::int = 1, 'B: 1 invoice counted (via the registration)');
  perform pd.ok((v->'categories'->>'payments')::int = 1, 'B: 1 payment counted (via the invoice)');
  perform pd.ok((v->'categories'->>'schedules')::int = 1 and (v->'counts'->>'events')::int = 1, 'B: team event counted under schedules');
  perform pd.ok((v->'categories'->>'attendance')::int = 0 and (v->'categories'->>'bookings')::int = 0, 'B: no attendance, no bookings');
  perform pd.ok((v->>'total')::int = 4, 'B: total = 4 (' || (v->>'total') || ')');
  perform pd.ok(v->>'upcoming_total' = '1' and v->'upcoming_sessions'->0->>'id' = 'f0000000-0000-0000-0000-0000000000e1'
                and v->'upcoming_sessions'->0->>'kind' = 'event' and v->'upcoming_sessions'->0->>'title' = 'Synthetic practice',
                'B: upcoming event listed (id, kind, title)');
  perform pd.ok(v->>'current_enrollments_total' = '1' and v->'current_enrollments'->0->>'status' = 'confirmed'
                and length(v->'current_enrollments'->0->>'child_name') > 0, 'B: current enrolment listed (child name + status)');

  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete', 'f0000000-0000-0000-0000-000000000002');
  perform pd.ok(v->>'code' = 'PROGRAM_HAS_LINKED_RECORDS' and not (v->>'deleted')::boolean, 'B: delete refused with PROGRAM_HAS_LINKED_RECORDS');
  perform pd.ok((v->'impact'->'categories'->>'registrations')::int = 1, 'B: refusal returns the counts');
  perform pd.ok((select status from public.programs where id = 'f0000000-0000-0000-0000-000000000002') = 'published',
                'B: refused delete leaves the programme as it was (not archived silently)');
  perform pd.ok(not exists (select 1 from public.audit_logs where target_id = 'f0000000-0000-0000-0000-000000000002' and action like 'program.%'),
                'B: nothing audit-logged for a refused delete');

  -- Archive
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_archive', 'f0000000-0000-0000-0000-000000000002');
  perform pd.ok(v->>'status' = 'archived' and v->>'previous_status' = 'published', 'B: archive returns archived (previous published)');
  perform pd.ok((select status = 'archived' and not is_active and archived_at is not null and status_before_archive = 'published'
                   from public.programs where id = 'f0000000-0000-0000-0000-000000000002'), 'B: archived row: inactive, archived_at, previous status kept');
  perform pd.ok(exists (select 1 from public.registrations where id = 'f0000000-0000-0000-0000-0000000000c1' and program_id = 'f0000000-0000-0000-0000-000000000002' and status = 'confirmed'),
                'B: registration still references the archived programme');
  perform pd.ok(exists (select 1 from public.invoices where id = 'f0000000-0000-0000-0000-0000000000d1' and registration_id = 'f0000000-0000-0000-0000-0000000000c1' and status = 'sent'),
                'B: invoice untouched');
  perform pd.ok((select status from public.events where id = 'f0000000-0000-0000-0000-0000000000e1') = 'scheduled', 'B: upcoming event not cancelled by archive');
  perform pd.ok(exists (select 1 from public.audit_logs where action = 'program.archive' and target_id = 'f0000000-0000-0000-0000-000000000002'), 'B: archive audit-logged');
  perform pd.ok(not exists (select 1 from public.programs where id = 'f0000000-0000-0000-0000-000000000002' and is_public and status = 'published'),
                'B: archived programme is not open for public registration');

  r := pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.program_archive('f0000000-0000-0000-0000-000000000002')::text$q$);
  perform pd.ok(r like 'ERR:%PROGRAM_ALREADY_ARCHIVED%', 'B: archiving twice is refused (' || r || ')');

  -- Archived programme still previews (detail page of an archived programme opens).
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete_impact', 'f0000000-0000-0000-0000-000000000002');
  perform pd.ok(v->>'status' = 'archived' and v->>'previous_status' = 'published', 'B: preview of archived programme works');

  -- No new registration in an archived programme (admin or any writer).
  r := pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$insert into public.registrations (org_id, athlete_id, program_id, status)
       values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', 'f0000000-0000-0000-0000-000000000002', 'confirmed') returning id::text$q$);
  perform pd.ok(r like 'ERR:%PROGRAM_ARCHIVED%', 'B: admin cannot add a registration to an archived programme (' || r || ')');
  r := pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.registrations set program_id = 'f0000000-0000-0000-0000-000000000002'
       where id = '00000000-0000-0000-0000-000000000082' returning id::text$q$);
  perform pd.ok(r like 'ERR:%PROGRAM_ARCHIVED%', 'B: a registration cannot be moved into an archived programme');
  -- Editing the existing registration of the archived programme still works.
  r := pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$update public.registrations set notes = 'Synthetic note'
       where id = 'f0000000-0000-0000-0000-0000000000c1' returning id::text$q$);
  perform pd.ok(r = 'OK:f0000000-0000-0000-0000-0000000000c1', 'B: existing registration of an archived programme stays editable (' || r || ')');

  -- Restore
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_restore', 'f0000000-0000-0000-0000-000000000002');
  perform pd.ok(v->>'status' = 'published', 'B: restore returns the previous status (published)');
  perform pd.ok((select status = 'published' and is_active and archived_at is null and status_before_archive is null
                   from public.programs where id = 'f0000000-0000-0000-0000-000000000002'), 'B: restored row is published and active again');
  perform pd.ok(exists (select 1 from public.audit_logs where action = 'program.restore' and target_id = 'f0000000-0000-0000-0000-000000000002'), 'B: restore audit-logged');
  r := pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.program_restore('f0000000-0000-0000-0000-000000000002')::text$q$);
  perform pd.ok(r like 'ERR:%PROGRAM_NOT_ARCHIVED%', 'B: restoring a non-archived programme is refused');
end $$;

-- ===========================================================================
-- C. Race: dependency added after the preview
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete_impact', 'f0000000-0000-0000-0000-000000000003');
  perform pd.ok((v->>'can_delete')::boolean, 'C: preview says deletable');
  insert into public.registrations (org_id, athlete_id, program_id, status)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', 'f0000000-0000-0000-0000-000000000003', 'pending');
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete', 'f0000000-0000-0000-0000-000000000003');
  perform pd.ok(v->>'code' = 'PROGRAM_HAS_LINKED_RECORDS' and (v->'impact'->'categories'->>'registrations')::int = 1,
                'C: registration added after preview -> delete refused with fresh counts');
  perform pd.ok(exists (select 1 from public.programs where id = 'f0000000-0000-0000-0000-000000000003'), 'C: programme kept');

  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete_impact', 'f0000000-0000-0000-0000-000000000004');
  perform pd.ok((v->>'can_delete')::boolean, 'C: second preview says deletable');
  insert into public.program_sessions (org_id, program_id, starts_at, ends_at)
  values ('00000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000004', now() + interval '1 day', now() + interval '1 day 1 hour');
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete', 'f0000000-0000-0000-0000-000000000004');
  perform pd.ok(v->>'code' = 'PROGRAM_HAS_LINKED_RECORDS' and (v->'impact'->'categories'->>'schedules')::int = 1
                and v->'impact'->'upcoming_sessions'->0->>'kind' = 'program_session',
                'C: session added after preview -> refused, counted under schedules and listed as upcoming');
end $$;

-- ===========================================================================
-- D. Restore fallback
-- ===========================================================================
do $$
declare v jsonb;
begin
  -- Draft archived by a plain status update (edit form): previous status recorded.
  update public.programs set status = 'archived' where id = 'f0000000-0000-0000-0000-000000000005';
  perform pd.ok((select status_before_archive from public.programs where id = 'f0000000-0000-0000-0000-000000000005') = 'draft',
                'D: the trigger records the previous status for any archiving path');
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_restore', 'f0000000-0000-0000-0000-000000000005');
  perform pd.ok(v->>'status' = 'draft', 'D: draft programme restored as draft');

  -- Unknown previous status -> draft.
  update public.programs set status = 'archived' where id = 'f0000000-0000-0000-0000-000000000005';
  update public.programs set status_before_archive = null where id = 'f0000000-0000-0000-0000-000000000005';
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_restore', 'f0000000-0000-0000-0000-000000000005');
  perform pd.ok(v->>'status' = 'draft' and (select status from public.programs where id = 'f0000000-0000-0000-0000-000000000005') = 'draft',
                'D: unknown previous status restores as draft');

  -- Legacy writer (is_active = false) archives and records published.
  update public.programs set is_active = false where id = 'f0000000-0000-0000-0000-000000000006';
  perform pd.ok((select status = 'archived' and status_before_archive = 'published' from public.programs where id = 'f0000000-0000-0000-0000-000000000006'),
                'D: legacy is_active=false archive records the previous status');
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_restore', 'f0000000-0000-0000-0000-000000000006');
  perform pd.ok(v->>'status' = 'published', 'D: legacy-archived programme restored as published');
end $$;

-- ===========================================================================
-- E. Capped lists
-- ===========================================================================
do $$
declare v jsonb;
begin
  v := pd.j('00000000-0000-0000-0000-0000000000f1', 'program_delete_impact', 'f0000000-0000-0000-0000-000000000006');
  perform pd.ok(jsonb_array_length(v->'upcoming_sessions') = 10 and (v->>'upcoming_total')::int = 12, 'E: upcoming list capped at 10 of 12');
  perform pd.ok((v->'upcoming_sessions'->0->>'starts_at') < (v->'upcoming_sessions'->9->>'starts_at'), 'E: upcoming sessions sorted by start');
end $$;

-- ===========================================================================
-- F. Roles: finance, coach, parent refused; anon cannot execute
-- ===========================================================================
do $$
declare u uuid; f text; r text; who text;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4']::uuid[] loop
    who := case u when '00000000-0000-0000-0000-0000000000f2' then 'finance' when '00000000-0000-0000-0000-0000000000f3' then 'coach' else 'parent' end;
    foreach f in array array['program_delete_impact', 'program_delete', 'program_archive', 'program_restore'] loop
      r := pd.run_as(u, format('select public.%I(%L::uuid)::text', f, 'f0000000-0000-0000-0000-000000000003'));
      perform pd.ok(r like 'ERR:%NOT_AUTHORIZED%', 'F: ' || who || ' refused for ' || f);
    end loop;
  end loop;
  perform pd.ok((select status from public.programs where id = 'f0000000-0000-0000-0000-000000000003') = 'published', 'F: refused calls changed nothing');
  r := pd.run_as(null, $q$select public.program_delete_impact('f0000000-0000-0000-0000-000000000003')::text$q$);
  perform pd.ok(r like 'ERR:%permission denied%', 'F: anon cannot execute program_delete_impact');
  r := pd.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.program_linked_records('f0000000-0000-0000-0000-000000000003')::text$q$);
  perform pd.ok(r like 'ERR:%permission denied%', 'F: internal program_linked_records is not callable by users');
end $$;

-- ===========================================================================
-- G. Cross-tenant denial
-- ===========================================================================
do $$
declare f text; r text;
begin
  foreach f in array array['program_delete_impact', 'program_delete', 'program_archive', 'program_restore'] loop
    r := pd.run_as('f0000000-0000-0000-0000-0000000000ab', format('select public.%I(%L::uuid)::text', f, 'f0000000-0000-0000-0000-000000000004'));
    perform pd.ok(r like 'ERR:%PROGRAM_NOT_FOUND%', 'G: org B admin cannot ' || f || ' an org A programme');
    r := pd.run_as('00000000-0000-0000-0000-0000000000f1', format('select public.%I(%L::uuid)::text', f, 'f0000000-0000-0000-0000-00000000000b'));
    perform pd.ok(r like 'ERR:%PROGRAM_NOT_FOUND%', 'G: org A admin cannot ' || f || ' an org B programme');
  end loop;
  perform pd.ok(exists (select 1 from public.programs where id = 'f0000000-0000-0000-0000-000000000004' and status = 'published'), 'G: org A programme untouched');
  perform pd.ok(exists (select 1 from public.programs where id = 'f0000000-0000-0000-0000-00000000000b' and status = 'published'), 'G: org B programme untouched');

  -- Org B admin manages its own programme.
  r := pd.run_as('f0000000-0000-0000-0000-0000000000ab', $q$select public.program_delete('f0000000-0000-0000-0000-00000000000b')::text$q$);
  perform pd.ok(r like 'OK:%"deleted": true%', 'G: org B admin deletes its own unused programme');
end $$;
