-- ============================================================================
-- Remove a person everywhere (migration 20250420102500_person_delete.sql)
--
--   A. Preview: counts per section, changes nothing.
--   B. Who may call: finance, coach, parent cannot preview / delete / restore;
--      org B admin cannot reach org A people (cross-tenant denial).
--   C. Archive: hidden, removed from rosters / registrations / waitlists /
--      bookings / carpools / RSVPs / kit, unpaid invoice cancelled, paid one
--      kept, plan + autopay stopped, guardian login detached only when it has
--      no other family in the club.
--   D. Restore: status, rosters and guardian links back; cancelled
--      registrations / invoices stay cancelled.
--   E. Erase: retained accounting rows kept and scrubbed, tombstone row, no
--      row of a non-retained table points at the person (generic check over
--      every single-column foreign key to athletes / families), files listed.
--   F. Purge after 30 days (service role) + notice 3 days before.
--   G. remove_guardian.
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3,
-- guardian …f4 of family …061). Org B …0002 (seed_tenants.sql); its admin is
-- created here. SYNTHETIC DATA ONLY. Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema pd;
grant usage on schema pd to authenticated, anon, service_role;

create function pd.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Run p_sql as user p (null = service_role). 'OK:<first column>' or 'ERR:<message>'.
create function pd.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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
grant execute on all functions in schema pd to authenticated, anon, service_role;

-- Rows of NON-retained tables that still reference one of the ids through a
-- single-column foreign key to athletes or families (generic over the catalog).
create function pd.refs(p_ids uuid[]) returns bigint language plpgsql as $$
declare con record; n bigint; total bigint := 0;
begin
  for con in
    select c.conrelid::regclass as child, a.attname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1
       and c.confrelid in ('public.athletes'::regclass, 'public.families'::regclass)
       and not (c.conrelid::regclass::text = any(public.pdel_retained_tables()))
  loop
    -- An athlete tombstone may point at its family tombstone.
    execute format('select count(*) from %s where %I = any($1)%s', con.child, con.attname,
                   case when con.child = 'public.athletes'::regclass then ' and status <> ''erased''' else '' end)
      into n using p_ids;
    if n > 0 then raise notice 'refs left: %.% = %', con.child, con.attname, n; end if;
    total := total + n;
  end loop;
  return total;
end $$;

-- Generic orphan check: every single-column foreign key in public, child
-- values that have no parent row.
create function pd.orphans() returns bigint language plpgsql as $$
declare con record; n bigint; total bigint := 0;
begin
  for con in
    select c.conrelid::regclass as child, ca.attname as ccol, c.confrelid::regclass as parent, pa.attname as pcol
      from pg_constraint c
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.connamespace = 'public'::regnamespace
  loop
    execute format('select count(*) from %s c where c.%I is not null and not exists (select 1 from %s p where p.%I = c.%I)',
                   con.child, con.ccol, con.parent, con.pcol, con.ccol) into n;
    if n > 0 then raise notice 'orphans: %.% -> % = %', con.child, con.ccol, con.parent, n; end if;
    total := total + n;
  end loop;
  return total;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures (org A unless noted)
--   G1 d…01  guardian of family F1 only (login detached on archive)
--   G2 d…02  guardian of F1 AND of family F2 (keeps parent role)
--   F1 d…a1  athletes K1 d…b1 (team, camp, booking, paid + unpaid invoice,
--            documents, photo, waitlist, RSVP, kit, scout link) and K2 d…b2
--   F2 d…a2  athlete K3 d…b3 (no money: hard-deleted on erase)
--   AB d…0b  admin of org B
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('d0000000-0000-0000-0000-000000000001', 'pd-g1@example.test'),
  ('d0000000-0000-0000-0000-000000000002', 'pd-g2@example.test'),
  ('d0000000-0000-0000-0000-00000000000b', 'pd-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Gamma One'
 where id = 'd0000000-0000-0000-0000-000000000001';
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001', full_name = 'Synthetic Gamma Two'
 where id = 'd0000000-0000-0000-0000-000000000002';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'd0000000-0000-0000-0000-00000000000b';
insert into public.staff_roles (org_id, profile_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'parent'),
  ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000002', 'parent'),
  ('10000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-00000000000b', 'admin');

insert into public.families (id, org_id, name, contact_name) values
  ('d0000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Zephyrine household', 'Synthetic Gamma One'),
  ('d0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Quillon household', null);
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000001', 'mother', true),
  ('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000002', 'father', false),
  ('d0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-000000000002', 'father', true);
update public.families set primary_contact_id = 'd0000000-0000-0000-0000-000000000001' where id = 'd0000000-0000-0000-0000-0000000000a1';
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, photo_path) values
  ('d0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1',
   'Xavanna', 'Zephyrine', '2013-02-02', '00000000-0000-0000-0000-000000000001/d0000000-0000-0000-0000-0000000000b1/photo.jpg'),
  ('d0000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1',
   'Yorrin', 'Zephyrine', '2015-03-03', null),
  ('d0000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a2',
   'Wendel', 'Quillon', '2014-04-04', null);
insert into public.athlete_medical (org_id, athlete_id, allergies) values
  ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', 'Synthetic allergy');

insert into public.teams (id, org_id, name) values
  ('d0000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001', 'Synthetic U12');
insert into public.team_memberships (org_id, team_id, athlete_id, jersey_number) values
  ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-0000000000b1', 7),
  ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-0000000000b3', 9);
insert into public.registrations (id, org_id, athlete_id, program_id, status) values
  ('d0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000041', 'confirmed'),
  ('d0000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000043', 'confirmed');

-- Money: one paid invoice (kept), one open unpaid (cancelled).
insert into public.invoices (id, org_id, number, family_id, athlete_id, program_id, registration_id, description, currency, total_chf, status, due_date) values
  ('d0000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', 'PD-0001', 'd0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000043', 'd0000000-0000-0000-0000-0000000000e2',
   'Team fee Xavanna Zephyrine', 'CHF', 300, 'pending', current_date + 30),
  ('d0000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000001', 'PD-0002', 'd0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000041', 'd0000000-0000-0000-0000-0000000000e1',
   'Camp Xavanna', 'CHF', 500, 'pending', current_date + 30);
insert into public.payments (org_id, invoice_id, amount_chf, method, status, paid_at)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000f2', 500, 'twint', 'succeeded', now());
update public.invoices set status = 'paid', paid_at = now() where id = 'd0000000-0000-0000-0000-0000000000f2';
-- A part-paid invoice stays open: kept, reminders paused while archived.
insert into public.invoices (id, org_id, number, family_id, description, currency, total_chf, status, due_date) values
  ('d0000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000001', 'PD-0003', 'd0000000-0000-0000-0000-0000000000a1',
   'Kit deposit', 'CHF', 200, 'pending', current_date + 30);
insert into public.payments (org_id, invoice_id, amount_chf, method, status, paid_at)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000f3', 50, 'twint', 'succeeded', now());
update public.invoices set status = 'partially_paid' where id = 'd0000000-0000-0000-0000-0000000000f3';

-- Upcoming booking (credits used), waiting list, upcoming RSVP, kit, scout link, documents.
insert into public.training_credits (org_id, athlete_id, credit_category, total_credits, used_credits)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', 'personal', 5, 1)
on conflict do nothing;
insert into public.training_bookings (id, org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, credits_used, paid_with)
values ('d0000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1',
        '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011',
        now() + interval '10 days', now() + interval '10 days 1 hour', 'booked', 1, null);
insert into public.waitlist_entries (org_id, target_kind, target_key, program_id, athlete_id, family_id, position, status, request)
values ('00000000-0000-0000-0000-000000000001', 'program', '00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000044',
        'd0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000a1', 1, 'waiting', '{}');
insert into public.events (id, org_id, team_id, type, starts_at, ends_at, status) values
  ('d0000000-0000-0000-0000-000000000ee1', '00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1',
   'game', now() + interval '5 days', now() + interval '5 days 2 hours', 'scheduled');
insert into public.event_rsvps (event_id, athlete_id, org_id, status) values
  ('d0000000-0000-0000-0000-000000000ee1', 'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'going');
insert into public.carpool_offers (org_id, event_id, family_id, profile_id, from_area, departs_at, seats_total, return_trip, status)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000ee1', 'd0000000-0000-0000-0000-0000000000a1',
        'd0000000-0000-0000-0000-000000000001', 'Synthetic area', now() + interval '5 days', 3, false, 'open');
insert into public.kit_assignments (org_id, team_id, athlete_id, status, include_jersey, include_shorts, include_warmup)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000c1', 'd0000000-0000-0000-0000-0000000000b1',
        'sizes_requested', true, true, false);
insert into public.scout_profiles (org_id, athlete_id, token_hash, fields, consented_at, consent_version, published_at, expires_at)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', repeat('a', 64), '{full_name}', now(), 'v1', now(), now() + interval '90 days');
insert into public.documents (org_id, athlete_id, family_id, kind, storage_path, file_name) values
  ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', null, 'medical', 'org/pd/b1/medical.pdf', 'medical.pdf'),
  ('00000000-0000-0000-0000-000000000001', null, 'd0000000-0000-0000-0000-0000000000a1', 'other', 'org/pd/a1/id.pdf', 'id.pdf');
insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, accepted_at, status)
values ('00000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000031', 1, now(), 'accepted');

-- ===========================================================================
-- A. Preview
-- ===========================================================================
do $$
declare v text; j jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := pd.run_as(admin_a, $q$select public.preview_delete_family('d0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform pd.ok(v like 'OK:%', 'admin previews a family delete: ' || left(v, 120));
  j := substr(v, 4)::jsonb;
  perform pd.ok((j->>'athletes')::int = 2, 'preview: 2 athletes');
  perform pd.ok((j->>'guardians')::int = 2, 'preview: 2 guardians');
  perform pd.ok((j->>'teams')::int = 1, 'preview: 1 team');
  perform pd.ok((j->>'camps')::int = 1 and (j->>'programmes')::int = 1, 'preview: 1 camp + 1 programme');
  perform pd.ok((j->>'bookings')::int = 1, 'preview: 1 upcoming booking');
  perform pd.ok((j->>'invoices_cancelled')::int = 1, 'preview: 1 unpaid invoice to cancel');
  perform pd.ok((j->'invoices_cancelled_amounts'->0->>'amount')::numeric = 300, 'preview: amount to cancel is 300');
  perform pd.ok((j->>'invoices_kept')::int = 2, 'preview: paid + part-paid invoices kept');
  perform pd.ok((j->>'documents')::int = 2 and (j->>'photos')::int = 1, 'preview: 2 documents + 1 photo');
  perform pd.ok((j->>'waitlists')::int = 1 and (j->>'rsvps')::int = 1 and (j->>'kit')::int = 1 and (j->>'carpools')::int = 1,
                'preview: waitlist, RSVP, kit, carpool counted');
  perform pd.ok(jsonb_array_length(j->'blocked') = 0, 'preview: nothing blocks an erase');
  perform pd.ok((select status from public.families where id = 'd0000000-0000-0000-0000-0000000000a1') = 'active'
            and (select status::text from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f1') = 'pending'
            and (select count(*) from public.team_memberships where athlete_id = 'd0000000-0000-0000-0000-0000000000b1') = 1,
                'preview changes nothing');
end $$;

-- ===========================================================================
-- B. Who may call
-- ===========================================================================
do $$
declare v text;
  finance uuid := '00000000-0000-0000-0000-0000000000f2';
  coach   uuid := '00000000-0000-0000-0000-0000000000f3';
  parent  uuid := 'd0000000-0000-0000-0000-000000000001';
  admin_b uuid := 'd0000000-0000-0000-0000-00000000000b';
  who uuid; lbl text;
begin
  foreach who in array array[finance, coach, parent, admin_b] loop
    lbl := case who when finance then 'finance' when coach then 'coach' when parent then 'parent' else 'org B admin' end;
    v := pd.run_as(who, $q$select public.delete_athlete('d0000000-0000-0000-0000-0000000000b1', 'archive')::text$q$);
    perform pd.ok(v like 'ERR:%', lbl || ' cannot archive an athlete');
    v := pd.run_as(who, $q$select public.delete_family('d0000000-0000-0000-0000-0000000000a1', 'erase')::text$q$);
    perform pd.ok(v like 'ERR:%', lbl || ' cannot erase a family');
    v := pd.run_as(who, $q$select public.preview_delete_athlete('d0000000-0000-0000-0000-0000000000b1')::text$q$);
    perform pd.ok(v like 'ERR:%', lbl || ' cannot preview a delete');
    v := pd.run_as(who, $q$select public.remove_guardian('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000002')::text$q$);
    perform pd.ok(v like 'ERR:%', lbl || ' cannot remove a guardian');
  end loop;
  v := pd.run_as(admin_b, $q$select public.preview_delete_family('d0000000-0000-0000-0000-0000000000a1')::text$q$);
  perform pd.ok(v like 'ERR:%NOT_FOUND%', 'cross-tenant: org B admin gets NOT_FOUND for an org A family');
  v := pd.run_as(null, $q$select public.delete_athlete('d0000000-0000-0000-0000-0000000000b1', 'archive')::text$q$);
  perform pd.ok(v like 'ERR:%', 'service role without a user cannot call the admin RPC');
  v := pd.run_as(parent, $q$select public.purge_due_person_deletions(10)::text$q$);
  perform pd.ok(v like 'ERR:%', 'an authenticated user cannot run the purge');
  v := pd.run_as(parent, $q$select count(*)::text from public.person_deletions$q$);
  perform pd.ok(v = 'OK:0', 'a parent reads no deletion rows');
  perform pd.ok((select count(*) from public.athletes where id = 'd0000000-0000-0000-0000-0000000000b1' and status = 'active') = 1,
                'denied calls changed nothing');
end $$;

-- ===========================================================================
-- C. Archive the family
-- ===========================================================================
do $$
declare v text; j jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := pd.run_as(admin_a, $q$select public.delete_family('d0000000-0000-0000-0000-0000000000a1', 'archive')::text$q$);
  perform pd.ok(v like 'OK:%', 'admin archives a family: ' || left(v, 120));
  j := substr(v, 4)::jsonb;
  perform pd.ok(j->>'mode' = 'archive' and j ? 'deletion_id' and j ? 'purge_after', 'archive returns the deletion id and purge date');
  perform pd.ok((select status from public.families where id = 'd0000000-0000-0000-0000-0000000000a1') = 'archived', 'family archived');
  perform pd.ok((select count(*) from public.athletes where family_id = 'd0000000-0000-0000-0000-0000000000a1' and status = 'archived') = 2,
                'both children archived');
  perform pd.ok((select count(*) from public.team_memberships where athlete_id = 'd0000000-0000-0000-0000-0000000000b1') = 0, 'removed from the roster');
  perform pd.ok((select count(*) from public.registrations where athlete_id = 'd0000000-0000-0000-0000-0000000000b1' and status <> 'cancelled') = 0,
                'registrations cancelled');
  perform pd.ok((select status from public.waitlist_entries where athlete_id = 'd0000000-0000-0000-0000-0000000000b1') = 'removed', 'waiting list entry removed');
  perform pd.ok((select status::text from public.training_bookings where id = 'd0000000-0000-0000-0000-0000000000d1') = 'cancelled', 'upcoming booking cancelled');
  perform pd.ok((select used_credits from public.training_credits where athlete_id = 'd0000000-0000-0000-0000-0000000000b1' and credit_category = 'personal') = 0,
                'booking credit restored');
  perform pd.ok((select count(*) from public.event_rsvps where athlete_id = 'd0000000-0000-0000-0000-0000000000b1') = 0, 'upcoming RSVP removed');
  perform pd.ok((select status from public.carpool_offers where family_id = 'd0000000-0000-0000-0000-0000000000a1') = 'cancelled', 'carpool offer cancelled');
  perform pd.ok((select count(*) from public.kit_assignments where athlete_id = 'd0000000-0000-0000-0000-0000000000b1') = 0, 'pending kit removed');
  perform pd.ok((select revoked_at is not null from public.scout_profiles where athlete_id = 'd0000000-0000-0000-0000-0000000000b1'), 'scout link revoked');
  perform pd.ok((select status::text from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f1') = 'cancelled'
            and (select cancel_reason from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f1') is not null,
                'open unpaid invoice cancelled with a reason');
  perform pd.ok((select status::text from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f2') = 'paid', 'paid invoice untouched');
  perform pd.ok((select status::text || '/' || reminders_paused from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f3') = 'partially_paid/true',
                'part-paid invoice kept open with reminders paused');
  perform pd.ok((select count(*) from public.family_members where family_id = 'd0000000-0000-0000-0000-0000000000a1') = 0, 'guardians unlinked');
  perform pd.ok(not exists (select 1 from public.staff_roles where profile_id = 'd0000000-0000-0000-0000-000000000001' and role = 'parent'),
                'guardian with no other family: parent role detached');
  perform pd.ok(exists (select 1 from public.staff_roles where profile_id = 'd0000000-0000-0000-0000-000000000002' and role = 'parent'),
                'guardian of another family keeps the parent role');
  v := pd.run_as('d0000000-0000-0000-0000-000000000001', $q$select count(*)::text from public.athletes where family_id = 'd0000000-0000-0000-0000-0000000000a1'$q$);
  perform pd.ok(v = 'OK:0', 'the detached guardian no longer sees the children');
  perform pd.ok(exists (select 1 from public.audit_logs where action = 'person.archive' and target_id = 'd0000000-0000-0000-0000-0000000000a1'
                          and new_data::text not ilike '%Zephyrine%' and new_data::text not ilike '%Xavanna%'),
                'audit entry without personal data');
  v := pd.run_as(admin_a, $q$select public.delete_family('d0000000-0000-0000-0000-0000000000a1', 'archive')::text$q$);
  perform pd.ok(v like 'ERR:%ALREADY_DELETED%', 'archiving twice is refused');
  v := pd.run_as(admin_a, $q$select count(*)::text from public.person_deletions where status = 'archived'$q$);
  perform pd.ok(v = 'OK:1', 'admin sees the archived row (Recently deleted)');
end $$;

-- ===========================================================================
-- D. Restore
-- ===========================================================================
do $$
declare v text; v_del uuid;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
  admin_b uuid := 'd0000000-0000-0000-0000-00000000000b';
begin
  select id into v_del from public.person_deletions where target_id = 'd0000000-0000-0000-0000-0000000000a1' and status = 'archived';
  v := pd.run_as(admin_b, format('select public.restore_person(%L)::text', v_del));
  perform pd.ok(v like 'ERR:%', 'cross-tenant: org B admin cannot restore');
  v := pd.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.restore_person(%L)::text', v_del));
  perform pd.ok(v like 'ERR:%', 'finance cannot restore');
  v := pd.run_as(admin_a, format('select public.restore_person(%L)::text', v_del));
  perform pd.ok(v like 'OK:%', 'admin restores within 30 days: ' || left(v, 120));
  perform pd.ok((select status from public.families where id = 'd0000000-0000-0000-0000-0000000000a1') = 'active', 'family active again');
  perform pd.ok((select count(*) from public.athletes where family_id = 'd0000000-0000-0000-0000-0000000000a1' and status = 'active') = 2, 'children active again');
  perform pd.ok((select jersey_number from public.team_memberships where athlete_id = 'd0000000-0000-0000-0000-0000000000b1') = 7, 'roster place back (same jersey)');
  perform pd.ok((select count(*) from public.family_members where family_id = 'd0000000-0000-0000-0000-0000000000a1') = 2, 'guardian links back');
  perform pd.ok((select primary_contact_id from public.families where id = 'd0000000-0000-0000-0000-0000000000a1') = 'd0000000-0000-0000-0000-000000000001', 'primary contact back');
  perform pd.ok(exists (select 1 from public.staff_roles where profile_id = 'd0000000-0000-0000-0000-000000000001' and role = 'parent'), 'parent role back');
  perform pd.ok((select status::text from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f1') = 'cancelled', 'cancelled invoice stays cancelled');
  perform pd.ok(not (select reminders_paused from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f3'), 'reminders resume on the part-paid invoice');
  perform pd.ok((select count(*) from public.registrations where athlete_id = 'd0000000-0000-0000-0000-0000000000b1' and status = 'cancelled') = 2,
                'cancelled registrations stay cancelled');
  perform pd.ok((select status from public.person_deletions where id = v_del) = 'restored' and (select snapshot from public.person_deletions where id = v_del) is null,
                'deletion row closed, snapshot dropped');
  v := pd.run_as(admin_a, format('select public.restore_person(%L)::text', v_del));
  perform pd.ok(v like 'ERR:%NOT_RESTORABLE%', 'restoring twice is refused');
end $$;

-- ===========================================================================
-- E. Erase: athlete without money (hard delete), then the family (tombstone)
-- ===========================================================================
do $$
declare v text; j jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := pd.run_as(admin_a, $q$select public.delete_athlete('d0000000-0000-0000-0000-0000000000b3', 'erase')::text$q$);
  perform pd.ok(v like 'OK:%', 'admin erases an athlete without accounting records: ' || left(v, 100));
  j := substr(v, 4)::jsonb;
  perform pd.ok(not exists (select 1 from public.athletes where id = 'd0000000-0000-0000-0000-0000000000b3'), 'athlete row hard-deleted (no retained records)');
  perform pd.ok((j->>'tombstone')::boolean = false, 'summary says no tombstone');
  perform pd.ok(pd.refs(array['d0000000-0000-0000-0000-0000000000b3'::uuid]) = 0, 'no row anywhere references the erased athlete');
  perform pd.ok((select count(*) from public.team_memberships where team_id = 'd0000000-0000-0000-0000-0000000000c1') = 1, 'team keeps the other player');

  v := pd.run_as(admin_a, $q$select public.delete_family('d0000000-0000-0000-0000-0000000000a1', 'erase')::text$q$);
  perform pd.ok(v like 'OK:%', 'admin erases the family permanently: ' || left(v, 100));
  j := substr(v, 4)::jsonb;
  perform pd.ok((j->>'tombstone')::boolean, 'family kept as a tombstone (accounting records)');
  perform pd.ok(j->'files'->'documents' @> '["org/pd/b1/medical.pdf", "org/pd/a1/id.pdf"]'::jsonb, 'document files returned for removal');
  perform pd.ok(jsonb_array_length(j->'files'->'athlete-photos') = 1, 'photo file returned for removal');
  perform pd.ok(j->'auth_user_ids' @> '["d0000000-0000-0000-0000-000000000001"]'::jsonb
            and not (j->'auth_user_ids' @> '["d0000000-0000-0000-0000-000000000002"]'::jsonb),
                'only the guardian with no other family is returned for login deletion');
  perform pd.ok((select full_name from public.profiles where id = 'd0000000-0000-0000-0000-000000000001') = '[deleted]'
            and not (select is_active from public.profiles where id = 'd0000000-0000-0000-0000-000000000001'), 'that guardian profile anonymised');
  perform pd.ok((select full_name from public.profiles where id = 'd0000000-0000-0000-0000-000000000002') = 'Synthetic Gamma Two', 'the other guardian is untouched');

  perform pd.ok((select name || '/' || status from public.families where id = 'd0000000-0000-0000-0000-0000000000a1') = 'Deleted family/erased', 'family tombstone anonymised');
  perform pd.ok((select contact_name from public.families where id = 'd0000000-0000-0000-0000-0000000000a1') is null, 'family contact cleared');
  perform pd.ok((select first_name || ' ' || last_name || '/' || status from public.athletes where id = 'd0000000-0000-0000-0000-0000000000b1') = 'Deleted player/erased',
                'athlete with retained records kept as an anonymised tombstone');
  perform pd.ok((select photo_path is null and dob = '1900-01-01' from public.athletes where id = 'd0000000-0000-0000-0000-0000000000b1'), 'tombstone has no photo or birth date');
  perform pd.ok(not exists (select 1 from public.athletes where id = 'd0000000-0000-0000-0000-0000000000b2'), 'sibling without records hard-deleted');
  perform pd.ok(not exists (select 1 from public.athlete_medical where athlete_id = 'd0000000-0000-0000-0000-0000000000b1'), 'medical record deleted');
  perform pd.ok(not exists (select 1 from public.documents where storage_path like 'org/pd/%'), 'document rows deleted');

  perform pd.ok((select count(*) from public.invoices where family_id = 'd0000000-0000-0000-0000-0000000000a1') = 3, 'all invoices kept');
  perform pd.ok((select count(*) from public.payments where invoice_id = 'd0000000-0000-0000-0000-0000000000f2' and amount_chf = 500) = 1, 'payment kept');
  perform pd.ok((select description from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f1') = 'Team fee Deleted player', 'invoice text scrubbed: ' ||
                coalesce((select description from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f1'), '<null>'));
  perform pd.ok((select description from public.invoices where id = 'd0000000-0000-0000-0000-0000000000f2') = 'Camp Deleted player', 'paid invoice text scrubbed');
  perform pd.ok(exists (select 1 from public.consent_acceptances where athlete_id = 'd0000000-0000-0000-0000-0000000000b1'), 'consent evidence retained');

  perform pd.ok(pd.refs(array['d0000000-0000-0000-0000-0000000000a1'::uuid, 'd0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b2']) = 0,
                'no non-retained row references the erased family or children');
  perform pd.ok(pd.orphans() = 0, 'generic orphan check over all single-column foreign keys');
  perform pd.ok(not exists (select 1 from public.audit_logs where target_id in ('d0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b2')
                              and (old_data::text ilike '%Xavanna%' or new_data::text ilike '%Xavanna%' or old_data::text ilike '%Yorrin%')),
                'audit trail redacted for the erased records');
  perform pd.ok(exists (select 1 from public.audit_logs where action = 'person.erase' and target_id = 'd0000000-0000-0000-0000-0000000000a1'), 'erase audited');
  perform pd.ok((select count(*) from public.person_deletions where target_id = 'd0000000-0000-0000-0000-0000000000a1' and status = 'erased') = 1, 'deletion row marked erased');
  v := pd.run_as(admin_a, $q$select public.delete_family('d0000000-0000-0000-0000-0000000000a1', 'erase')::text$q$);
  perform pd.ok(v like 'ERR:%ALREADY_DELETED%', 'erasing twice is refused');
end $$;

-- ===========================================================================
-- F. Purge after 30 days + notice
-- ===========================================================================
do $$
declare v text; j jsonb;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  -- The seed athlete …071 (has an invoice): archive, then age the row.
  v := pd.run_as(admin_a, $q$select public.delete_athlete('00000000-0000-0000-0000-000000000071')::text$q$);
  perform pd.ok(v like 'OK:%', 'archive is the default mode');
  v := pd.run_as(null, $q$select count(*)::text from public.person_deletions_due_notice(3)$q$);
  perform pd.ok(v = 'OK:0', 'no notice 30 days ahead');
  update public.person_deletions set purge_after = now() + interval '2 days' where target_id = '00000000-0000-0000-0000-000000000071' and status = 'archived';
  v := pd.run_as(null, $q$select count(*)::text from public.person_deletions_due_notice(3)$q$);
  perform pd.ok(v = 'OK:1', 'notice due 3 days before the purge');
  v := pd.run_as(null, $q$select count(*)::text from public.person_deletions_due_notice(3)$q$);
  perform pd.ok(v = 'OK:0', 'the notice is sent once');
  v := pd.run_as(null, $q$select public.purge_due_person_deletions(50)::text$q$);
  perform pd.ok(v = 'OK:[]', 'nothing purged before the date');
  update public.person_deletions set purge_after = now() - interval '1 minute' where target_id = '00000000-0000-0000-0000-000000000071' and status = 'archived';
  v := pd.run_as(null, $q$select public.purge_due_person_deletions(50)::text$q$);
  j := substr(v, 4)::jsonb;
  perform pd.ok(v like 'OK:%' and jsonb_array_length(j) = 1 and (j->0->>'ok')::boolean, 'service role purges the due row: ' || left(v, 120));
  perform pd.ok((select status from public.athletes where id = '00000000-0000-0000-0000-000000000071') = 'erased', 'purged athlete is erased');
  perform pd.ok(pd.orphans() = 0, 'no orphans after the purge');
end $$;

-- ===========================================================================
-- G. remove_guardian
-- ===========================================================================
do $$
declare v text;
  admin_a uuid := '00000000-0000-0000-0000-0000000000f1';
begin
  v := pd.run_as(admin_a, $q$select public.remove_guardian('d0000000-0000-0000-0000-0000000000a2', 'd0000000-0000-0000-0000-000000000002')::text$q$);
  perform pd.ok(v like 'OK:%', 'admin removes a guardian: ' || left(v, 100));
  perform pd.ok(not exists (select 1 from public.family_members where profile_id = 'd0000000-0000-0000-0000-000000000002'), 'guardian unlinked');
  perform pd.ok(not exists (select 1 from public.staff_roles where profile_id = 'd0000000-0000-0000-0000-000000000002' and role = 'parent'),
                'login detached (no other family)');
  perform pd.ok((select primary_contact_id from public.families where id = 'd0000000-0000-0000-0000-0000000000a2') is null, 'primary contact cleared');
  perform pd.ok(exists (select 1 from public.profiles where id = 'd0000000-0000-0000-0000-000000000002'), 'profile itself is kept');
end $$;
