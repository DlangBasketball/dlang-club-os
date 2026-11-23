-- ============================================================================
-- Family attendance UI suite (migration 20250420104300_family_attendance_ui.sql)
--
--   A. Alert recipients: guardian login -> 'g:' row; no login but a family
--      contact e-mail -> 'f:' e-mail-only row; neither -> 'no_contact'; a
--      contact e-mail that is the player's own login is never used.
--   B. Idempotency with the recipient key: re-sync adds nothing, the unique
--      index refuses a duplicate e-mail-only row; a family that gets a
--      guardian login supersedes its unsent 'none' row.
--   C. Dispatcher: claim hands out the e-mail-only row with the family
--      address (service only); a provider bounce marks it failed at the
--      attempt cap -> staff follow-up; corrections reach the same recipient.
--   D. Record page RPC: own child only (cross-family, other org and player
--      denied), finalized value only, no staff notes.
--   E. Overview: cancel reason, rescheduled_from, season name.
--   Idempotent migration re-run.
--
-- Fixtures: synthetic only (ids …fa…). Org A …0001, org B …0002.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema fat;
grant usage on schema fat to authenticated, anon, service_role;

create function fat.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;
create function fat.run_as(p uuid, p_sql text, p_service boolean default false) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
    if p_service then execute 'set local role service_role';
    elsif p is null then execute 'set local role anon';
    else execute 'set local role authenticated'; end if;
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
create function fat.js(p uuid, p_sql text) returns jsonb language plpgsql as $$
declare r text;
begin
  r := fat.run_as(p, p_sql);
  if r = 'OK:<null>' then return 'null'::jsonb; end if;
  if r like 'OK:%' then return substr(r, 4)::jsonb; end if;
  return jsonb_build_object('error', substr(r, 5));
end $$;
create function fat.svc(p_sql text) returns text language plpgsql as $$
begin return fat.run_as(null, p_sql, true); end $$;
grant execute on all functions in schema fat to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures. G1 fa11 guardian of family FA (PA fa31); family FB without login,
-- contact e-mail (PB fa32); family FC without login or e-mail (PC fa33);
-- family FD whose contact e-mail is its player's own login (PD fa34, player
-- login fa14); G2 fa12 guardian of family FE (PE fa35); G3 fa13 joins FC
-- later. Org B: admin b…ac91 (from the seed of this suite).
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000fa011', 'fa-g1@example.test'),
  ('00000000-0000-0000-0000-0000000fa012', 'fa-g2@example.test'),
  ('00000000-0000-0000-0000-0000000fa013', 'fa-g3@example.test'),
  ('00000000-0000-0000-0000-0000000fa014', 'fd-player@example.test'),
  ('b0000000-0000-0000-0000-0000000fa091', 'fa-admin-b@example.test');
update public.profiles set org_id = '00000000-0000-0000-0000-000000000001' where id::text like '00000000-0000-0000-0000-0000000fa0%';
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000fa091';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000fa091', 'admin');
insert into public.families (id, org_id, name, contact_email) values
  ('00000000-0000-0000-0000-0000000fa021', '00000000-0000-0000-0000-000000000001', 'Synthetic FA', 'fa-family@example.test'),
  ('00000000-0000-0000-0000-0000000fa022', '00000000-0000-0000-0000-000000000001', 'Synthetic FB', ' FB-Contact@Example.test '),
  ('00000000-0000-0000-0000-0000000fa023', '00000000-0000-0000-0000-000000000001', 'Synthetic FC', null),
  ('00000000-0000-0000-0000-0000000fa024', '00000000-0000-0000-0000-000000000001', 'Synthetic FD', 'fd-player@example.test'),
  ('00000000-0000-0000-0000-0000000fa025', '00000000-0000-0000-0000-000000000001', 'Synthetic FE', null);
insert into public.family_members (family_id, profile_id, relation, is_primary) values
  ('00000000-0000-0000-0000-0000000fa021', '00000000-0000-0000-0000-0000000fa011', 'guardian', true),
  ('00000000-0000-0000-0000-0000000fa025', '00000000-0000-0000-0000-0000000fa012', 'guardian', true);
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status) values
  ('00000000-0000-0000-0000-0000000fa031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa021', 'Synth', 'Pa', '2013-01-01', 'active'),
  ('00000000-0000-0000-0000-0000000fa032', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa022', 'Synth', 'Pb', '2013-01-01', 'active'),
  ('00000000-0000-0000-0000-0000000fa033', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa023', 'Synth', 'Pc', '2013-01-01', 'active'),
  ('00000000-0000-0000-0000-0000000fa034', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa024', 'Synth', 'Pd', '2013-01-01', 'active'),
  ('00000000-0000-0000-0000-0000000fa035', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa025', 'Synth', 'Pe', '2013-01-01', 'active');
update public.athletes set player_profile_id = '00000000-0000-0000-0000-0000000fa014', player_linked_at = now()
 where id = '00000000-0000-0000-0000-0000000fa034';
insert into public.seasons (id, org_id, name, starts_on, ends_on) values
  ('00000000-0000-0000-0000-0000000fa061', '00000000-0000-0000-0000-000000000001', 'FA synthetic season', current_date - 200, current_date + 165);
insert into public.teams (id, org_id, season_id, name, sport) values
  ('00000000-0000-0000-0000-0000000fa041', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa061', 'FA Team', 'basketball');
insert into public.team_memberships (org_id, team_id, athlete_id, status, joined_on)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', a, 'active', current_date - 60
  from unnest(array['00000000-0000-0000-0000-0000000fa031', '00000000-0000-0000-0000-0000000fa032', '00000000-0000-0000-0000-0000000fa033',
                    '00000000-0000-0000-0000-0000000fa034', '00000000-0000-0000-0000-0000000fa035']::uuid[]) a;
select fat.run_as('00000000-0000-0000-0000-0000000000f1', 'select public.attendance_settings_set(current_date - 30)::text');
-- E1 ended yesterday, E2 in two days, E3 in three days (cancelled below).
insert into public.events (id, org_id, team_id, season_id, type, title, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', '00000000-0000-0000-0000-0000000fa061', 'training', 'FA E1', now() - interval '26 hours', now() - interval '24 hours'),
  ('00000000-0000-0000-0000-00000fa0e002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', '00000000-0000-0000-0000-0000000fa061', 'training', 'FA E2', now() + interval '2 days', now() + interval '2 days 2 hours'),
  ('00000000-0000-0000-0000-00000fa0e003', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000fa041', '00000000-0000-0000-0000-0000000fa061', 'training', 'FA E3', now() + interval '3 days', now() + interval '3 days 2 hours');

-- ===========================================================================
-- A. Recipients at finalize
-- ===========================================================================
do $$
declare j jsonb; v int;
begin
  j := fat.js('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_open('00000000-0000-0000-0000-00000fa0e001')::text$q$);
  v := (j->'sheet'->>'version')::int;
  j := fat.js('00000000-0000-0000-0000-0000000000f1', format($q$select public.attendance_save('00000000-0000-0000-0000-00000fa0e001',
         '[{"athlete_id":"00000000-0000-0000-0000-0000000fa031","status":"unexcused","note":"Synthetic staff note"},
           {"athlete_id":"00000000-0000-0000-0000-0000000fa032","status":"unexcused"},
           {"athlete_id":"00000000-0000-0000-0000-0000000fa033","status":"unexcused"},
           {"athlete_id":"00000000-0000-0000-0000-0000000fa034","status":"unexcused"},
           {"athlete_id":"00000000-0000-0000-0000-0000000fa035","status":"present"}]'::jsonb, %s, null)::text$q$, v));
  perform fat.ok(jsonb_array_length(j->'applied') = 5, 'admin marks the five players — ' || left(j::text, 200));
  v := (j->>'version')::int;
  j := fat.js('00000000-0000-0000-0000-0000000000f1', format($q$select public.attendance_finalize('00000000-0000-0000-0000-00000fa0e001', null, %s, null)::text$q$, v));
  perform fat.ok((j->>'ok')::boolean, 'finalize after the end — ' || j::text);

  perform fat.ok((select count(*) = 1 and bool_and(recipient_key = 'g:00000000-0000-0000-0000-0000000fa011' and status = 'pending')
                    from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa031'),
                 'family with a guardian login: one guardian alert (the family contact e-mail is not used)');
  perform fat.ok((select count(*) = 1 and bool_and(guardian_profile_id is null and recipient_family_id = '00000000-0000-0000-0000-0000000fa022'
                                                   and recipient_key = 'f:00000000-0000-0000-0000-0000000fa022' and status = 'pending')
                    from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa032'),
                 'family without login but with a contact e-mail: one e-mail-only alert keyed by the family');
  perform fat.ok((select count(*) = 1 and bool_and(recipient_key = 'none' and status = 'no_contact')
                    from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa033'),
                 'family without login or e-mail: no_contact for staff follow-up');
  perform fat.ok((select count(*) = 1 and bool_and(recipient_key = 'none' and status = 'no_contact')
                    from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa034'),
                 'a contact e-mail that is the player''s own login is never used (minor not e-mailed)');
  perform fat.ok(not exists (select 1 from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa035'),
                 'present player: no alert');
end $$;

-- ===========================================================================
-- B. Idempotency with the recipient key
-- ===========================================================================
do $$
declare v_before int; v_n int; r text;
begin
  select count(*) into v_before from public.attendance_no_show_alerts;
  select public.ta_sync_sheet_alerts(id) into v_n from public.team_attendance_sheets where event_id = '00000000-0000-0000-0000-00000fa0e001';
  perform fat.ok(v_n = 0 and (select count(*) from public.attendance_no_show_alerts) = v_before, 're-sync of the sheet adds no alert');
  begin
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, recipient_family_id, kind, mark_status, status)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa032',
            '00000000-0000-0000-0000-0000000fa022', 'initial', 'unexcused', 'pending');
    r := 'inserted';
  exception when unique_violation then r := 'unique';
  end;
  perform fat.ok(r = 'unique', 'the unique index refuses a second initial alert for the same e-mail-only recipient');
  begin
    insert into public.attendance_no_show_alerts (org_id, event_id, athlete_id, guardian_profile_id, recipient_family_id, kind, mark_status, status)
    values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa035',
            '00000000-0000-0000-0000-0000000fa012', '00000000-0000-0000-0000-0000000fa025', 'initial', 'unexcused', 'pending');
    r := 'inserted';
  exception when check_violation then r := 'check';
  end;
  perform fat.ok(r = 'check', 'an alert has one recipient (guardian or family, not both)');
  r := fat.run_as('00000000-0000-0000-0000-0000000fa011', $q$select count(*)::text from public.ta_alert_family_email('00000000-0000-0000-0000-0000000fa032')$q$);
  perform fat.ok(r like 'ERR:%permission denied%', 'family e-mail resolution is not callable by signed-in users');

  -- FC gets a guardian login: the unsent 'none' row is superseded, a guardian alert appears.
  insert into public.family_members (family_id, profile_id, relation, is_primary)
  values ('00000000-0000-0000-0000-0000000fa023', '00000000-0000-0000-0000-0000000fa013', 'guardian', true);
  perform public.ta_sync_mark_alerts(id) from public.team_attendance_marks
   where event_id = '00000000-0000-0000-0000-00000fa0e001' and athlete_id = '00000000-0000-0000-0000-0000000fa033';
  perform fat.ok((select count(*) filter (where recipient_key = 'g:00000000-0000-0000-0000-0000000fa013' and status = 'pending') = 1
                     and count(*) filter (where recipient_key = 'none' and status = 'superseded') = 1
                    from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa033'),
                 'a family that gets a guardian login: guardian alert, the no_contact row is superseded');
  perform public.ta_sync_mark_alerts(id) from public.team_attendance_marks
   where event_id = '00000000-0000-0000-0000-00000fa0e001' and athlete_id = '00000000-0000-0000-0000-0000000fa033';
  perform fat.ok((select count(*) = 2 from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa033'),
                 'running it again adds nothing');
end $$;

-- ===========================================================================
-- C. Dispatcher: claim, bounce, correction
-- ===========================================================================
do $$
declare r text; j jsonb; v_alert uuid;
begin
  r := fat.run_as('00000000-0000-0000-0000-0000000000f1', $q$select count(*)::text from public.attendance_alerts_claim(50, null)$q$);
  perform fat.ok(r like 'ERR:%', 'claim is service only');
  r := fat.svc($q$select json_agg(json_build_object('a', athlete_id, 'g', guardian_profile_id, 'e', guardian_email, 'r', receives_emails, 'l', guardian_locale))::text
                   from public.attendance_alerts_claim(50, '00000000-0000-0000-0000-000000000001')$q$);
  j := substr(r, 4)::jsonb;
  perform fat.ok(exists (select 1 from jsonb_array_elements(j) x
                          where x->>'a' = '00000000-0000-0000-0000-0000000fa032' and x->>'g' is null
                            and x->>'e' = 'fb-contact@example.test' and (x->>'r')::boolean),
                 'claim hands out the e-mail-only alert with the normalized family address — ' || left(j::text, 300));
  perform fat.ok(not exists (select 1 from jsonb_array_elements(j) x
                              where x->>'a' in ('00000000-0000-0000-0000-0000000fa034', '00000000-0000-0000-0000-0000000fa035')),
                 'no_contact and other players are never claimed');
  perform fat.ok(not exists (select 1 from jsonb_array_elements(j) x where x->>'e' = 'fd-player@example.test'),
                 'the player login address is never handed out');

  select id into v_alert from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa032' and kind = 'initial';
  r := fat.svc(format($q$select public.attendance_alert_record(%L, 'sent', '{"email":{"ok":true,"provider_id":"re_synthetic_1"}}'::jsonb, null, null)::text$q$, v_alert));
  perform fat.ok((select status = 'sent' and sent_at is not null from public.attendance_no_show_alerts where id = v_alert), 'e-mail-only alert recorded sent');

  r := fat.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_alert_email_failed('re_synthetic_1', 'bounced')::text$q$);
  perform fat.ok(r like 'ERR:%', 'recording a bounce is service only');
  r := fat.svc($q$select public.attendance_alert_email_failed('re_synthetic_1', 'bounced: mailbox does not exist')::text$q$);
  perform fat.ok(r = 'OK:1', 'a provider bounce updates the alert — ' || r);
  perform fat.ok((select status = 'failed' and attempts >= public.ta_alert_max_attempts() and last_error like 'bounced%'
                         and (channel_results->'email'->>'ok')::boolean = false
                    from public.attendance_no_show_alerts where id = v_alert),
                 'bounce -> failed at the attempt cap with the error');
  r := fat.svc($q$select count(*)::text from public.attendance_alerts_claim(50, '00000000-0000-0000-0000-000000000001') where athlete_id = '00000000-0000-0000-0000-0000000fa032'$q$);
  perform fat.ok(r = 'OK:0', 'a bounced alert is not retried');
  r := fat.run_as('00000000-0000-0000-0000-0000000000f1', format($q$select count(*)::text from public.attendance_alerts_followup(100) where alert_id = %L and guardian_profile_id is null$q$, v_alert));
  perform fat.ok(r = 'OK:1', 'the bounced alert shows in the staff follow-up list — ' || r);
  r := fat.svc($q$select public.attendance_alert_email_failed('re_unknown', 'bounced')::text$q$);
  perform fat.ok(r = 'OK:0', 'an unknown provider id changes nothing');

  -- Correction after a send: the e-mail-only recipient gets a correction alert.
  r := fat.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_correct('00000000-0000-0000-0000-00000fa0e001',
         '00000000-0000-0000-0000-0000000fa032', 'late', 'Synthetic: arrived late', null)::text$q$);
  perform fat.ok(r like 'OK:%', 'admin corrects to late — ' || r);
  perform fat.ok((select count(*) = 1 and bool_and(recipient_key = 'f:00000000-0000-0000-0000-0000000fa022' and mark_status = 'late' and status = 'pending')
                    from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa032' and kind = 'correction'),
                 'one correction alert for the e-mail-only recipient (late)');
  perform public.ta_sync_mark_alerts(id) from public.team_attendance_marks
   where event_id = '00000000-0000-0000-0000-00000fa0e001' and athlete_id = '00000000-0000-0000-0000-0000000fa032';
  perform fat.ok((select count(*) = 1 from public.attendance_no_show_alerts where athlete_id = '00000000-0000-0000-0000-0000000fa032' and kind = 'correction'),
                 'correction alert stays unique per (correction, recipient)');
end $$;

-- ===========================================================================
-- D. Record page RPC
-- ===========================================================================
do $$
declare r text; j jsonb;
begin
  j := fat.js('00000000-0000-0000-0000-0000000fa011', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(j->'attendance'->>'status' = 'unexcused' and (j->>'final')::boolean and (j->>'can_request_correction')::boolean
                 and j->'event'->>'team_name' = 'FA Team' and j->>'timezone' is not null,
                 'guardian reads the record of their own child — ' || left(j::text, 300));
  perform fat.ok(position('Synthetic staff note' in j::text) = 0 and not (j::text like '%"note"%'), 'the record carries no staff note');
  perform fat.ok(position('Pb' in j::text) = 0 and position('Pe' in j::text) = 0, 'the record carries no other player');
  r := fat.run_as('00000000-0000-0000-0000-0000000fa011', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa035')::text$q$);
  perform fat.ok(r like 'ERR:NOT_AUTHORIZED%', 'cross-family: another family''s child is denied');
  r := fat.run_as('00000000-0000-0000-0000-0000000fa012', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(r like 'ERR:NOT_AUTHORIZED%', 'cross-family: guardian G2 cannot read G1''s child');
  r := fat.run_as('b0000000-0000-0000-0000-0000000fa091', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(r like 'ERR:ATHLETE_NOT_FOUND%', 'other org admin: ATHLETE_NOT_FOUND');
  r := fat.run_as('00000000-0000-0000-0000-0000000fa014', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa034')::text$q$);
  perform fat.ok(r like 'ERR:NOT_AUTHORIZED%', 'a player cannot use the guardian record');
  r := fat.run_as(null, $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(r like 'ERR:%', 'anonymous: denied');
  j := fat.js('00000000-0000-0000-0000-0000000fa011', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e002', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(not (j->>'final')::boolean and j->'attendance' = 'null'::jsonb and (j->>'can_report')::boolean,
                 'upcoming session: not final, no attendance value, absence can be reported — ' || left(j::text, 200));
  -- A draft is never shown: reopen E1 and change PA's mark; the guardian still sees the finalized value.
  r := fat.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.attendance_reopen('00000000-0000-0000-0000-00000fa0e001', 'Synthetic reopen')::text$q$);
  update public.team_attendance_marks set status = 'present'
   where event_id = '00000000-0000-0000-0000-00000fa0e001' and athlete_id = '00000000-0000-0000-0000-0000000fa031';
  j := fat.js('00000000-0000-0000-0000-0000000fa011', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(j->'attendance'->>'status' = 'unexcused', 'reopened sheet: the guardian sees the last finalized value, not the draft');
  -- Correction request then shows on the record with its status.
  r := fat.run_as('00000000-0000-0000-0000-0000000fa011', $q$select public.attendance_correction_request('00000000-0000-0000-0000-00000fa0e001',
         '00000000-0000-0000-0000-0000000fa031', 'Synthetic: was at the dentist', 'excused')::text$q$);
  j := fat.js('00000000-0000-0000-0000-0000000fa011', $q$select public.guardian_attendance_record('00000000-0000-0000-0000-00000fa0e001', '00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(jsonb_array_length(j->'requests') = 1 and j->'requests'->0->>'status' = 'open' and not (j->>'can_request_correction')::boolean,
                 'open correction request shows on the record and blocks a second one');
end $$;

-- ===========================================================================
-- E. Overview: cancel reason, reschedule, season
-- ===========================================================================
do $$
declare j jsonb; v_old timestamptz;
begin
  select starts_at into v_old from public.events where id = '00000000-0000-0000-0000-00000fa0e002';
  update public.events set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
   where id = '00000000-0000-0000-0000-00000fa0e002';
  update public.events set status = 'cancelled', cancel_reason = 'Synthetic gym closed' where id = '00000000-0000-0000-0000-00000fa0e003';
  perform fat.ok((select rescheduled_from = v_old from public.events where id = '00000000-0000-0000-0000-00000fa0e002'),
                 'moving a session keeps its original start');
  update public.events set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
   where id = '00000000-0000-0000-0000-00000fa0e002';
  perform fat.ok((select rescheduled_from = v_old from public.events where id = '00000000-0000-0000-0000-00000fa0e002'),
                 'moving it again keeps the first original start');
  j := fat.js('00000000-0000-0000-0000-0000000fa011', $q$select public.guardian_attendance_overview('00000000-0000-0000-0000-0000000fa031')::text$q$);
  perform fat.ok(exists (select 1 from jsonb_array_elements(j->'upcoming') x
                          where x->>'event_id' = '00000000-0000-0000-0000-00000fa0e003' and x->>'status' = 'cancelled'
                            and x->>'cancel_reason' = 'Synthetic gym closed' and not (x->>'can_report')::boolean),
                 'overview: cancelled session with its reason');
  perform fat.ok(exists (select 1 from jsonb_array_elements(j->'upcoming') x
                          where x->>'event_id' = '00000000-0000-0000-0000-00000fa0e002' and x->>'rescheduled_from' is not null),
                 'overview: moved session with its original start');
  perform fat.ok(exists (select 1 from jsonb_array_elements(j->'history') x where x->>'season_name' = 'FA synthetic season'),
                 'overview: history carries the season');
  j := fat.js('00000000-0000-0000-0000-0000000fa014', $q$select public.player_attendance_overview()::text$q$);
  perform fat.ok(j ? 'upcoming' and jsonb_array_length(j->'correction_requests') = 0
                 and not exists (select 1 from jsonb_array_elements(j->'history') x where x->'alert' <> 'null'::jsonb),
                 'player overview: no guardian alerts or correction requests');
end $$;

-- Idempotent re-run of the migration.
create temp table fat_counts as
  select (select count(*) from public.attendance_no_show_alerts) a, (select count(*) from public.events where rescheduled_from is not null) e;
\set QUIET on
\i supabase/migrations/20250420104300_family_attendance_ui.sql
\set QUIET off
select fat.ok((select a = (select count(*) from public.attendance_no_show_alerts)
                  and e = (select count(*) from public.events where rescheduled_from is not null) from fat_counts),
              'migration re-run is idempotent');
