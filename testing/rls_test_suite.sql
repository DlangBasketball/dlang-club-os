-- ============================================================================
-- DLang Basketball — RLS / permission regression suite
-- Run against a database seeded with the standard fixtures:
--   admin   = ...f1   finance = ...f2   coach(Derrick) = ...f3   parent(Carla) = ...f4
--   Lopes family = ...061 (child Mateo ...071)   Rossi family = ...063 (Giulia ...074)
-- Usage (local):
--   psql -d dlang -f testing/rls_test_suite.sql
-- ANY line that prints "FAIL" is a LAUNCH BLOCKER.
-- Simulates auth by setting the JWT claim the SECURITY DEFINER helpers read.
-- ============================================================================
\set ON_ERROR_STOP off
\pset tuples_only on
\pset format unaligned

-- capture ground-truth totals as superuser before switching roles
select count(*) as all_athletes from public.athletes \gset

\echo '--- #14 Parent sees only their own family ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
select case when bool_and(family_id='00000000-0000-0000-0000-000000000061') and count(*)>0 then 'PASS' else 'FAIL' end||' — parent athletes are own-family only' from public.athletes;
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — parent cannot see another family''s athlete' from public.athletes where id='00000000-0000-0000-0000-000000000074';
select case when bool_and(family_id='00000000-0000-0000-0000-000000000061') then 'PASS' else 'FAIL' end||' — parent invoices are own-family only' from public.invoices;
reset role;

\echo '--- #4 Medical notes protection ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — coach cannot read any medical record' from public.athlete_medical;
reset role;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — parent cannot read another child''s medical' from public.athlete_medical where athlete_id='00000000-0000-0000-0000-000000000074';
reset role;

\echo '--- #13 Financial records = admin/finance only ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — coach cannot read invoices' from public.invoices;
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — coach cannot read payments' from public.payments;
reset role;
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f2';
select case when count(*)>0 then 'PASS' else 'FAIL' end||' — finance can read invoices' from public.invoices;
reset role;

\echo '--- #15 Coach limited to assigned scope ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
select case when count(*) < :all_athletes and count(*) >= 0 then 'PASS' else 'FAIL' end||' — coach sees only a subset of athletes ('||count(*)||' of '||:all_athletes||')' from public.athletes;
reset role;

\echo '--- #7 Consent immutability ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
do $$ declare v_id uuid; v_before text; v_after text; begin
  select id, accepted_text into v_id, v_before from public.consent_acceptances where status='accepted' limit 1;
  update public.consent_acceptances set accepted_text='TAMPER' where id=v_id;  -- RLS: 0 rows
  select accepted_text into v_after from public.consent_acceptances where id=v_id;
  raise notice '%', case when v_before is not distinct from v_after then 'PASS' else 'FAIL' end||' — app cannot edit a consent acceptance (RLS)';
end $$;
reset role;
do $$ begin  -- privileged path: trigger must block
  begin update public.consent_acceptances set accepted_version=99 where status='accepted'; raise notice 'FAIL — trigger did not block privileged consent edit';
  exception when others then raise notice 'PASS — trigger blocks privileged consent edit'; end;
  begin delete from public.consent_acceptances where status='accepted'; raise notice 'FAIL — trigger did not block consent delete';
  exception when others then raise notice 'PASS — trigger blocks consent delete'; end;
end $$;

\echo '--- Documents scope (global/program visible; other-athlete hidden) ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — parent cannot see another athlete''s document' from public.documents where athlete_id='00000000-0000-0000-0000-000000000074';
reset role;

\echo '--- AI audit log isolation + append-only ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f3';
select case when count(*)=0 then 'PASS' else 'FAIL' end||' — coach cannot read another user''s AI queries' from public.ai_queries where actor_id='00000000-0000-0000-0000-0000000000f4';
reset role;

\echo '--- Deletion request: cannot target another family ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
do $$ begin
  begin insert into public.deletion_requests (org_id,family_id,requested_by) values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000063','00000000-0000-0000-0000-0000000000f4'); raise notice 'FAIL — parent could request deletion of another family';
  exception when others then raise notice 'PASS — parent cannot request deletion of another family'; end;
end $$;
reset role;

\echo '--- Erasure RPC is admin-only ---'
set role authenticated; set request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f4';
do $$ begin
  begin perform public.anonymise_family('00000000-0000-0000-0000-000000000063'); raise notice 'FAIL — non-admin could anonymise a family';
  exception when others then raise notice 'PASS — anonymise_family is admin-only'; end;
end $$;
reset role;
\echo '--- END OF SUITE (review for any FAIL above) ---'
