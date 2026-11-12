-- ============================================================================
-- Tenant isolation suite (multi-tenant / white-label guarantee)
--
-- Proves that users of one organization can neither READ nor WRITE another
-- organization's rows, on EVERY table that carries an org_id column. The table
-- list is discovered at run time from the catalog, so tables added by future
-- migrations are covered automatically — no edits needed here.
--
-- How it works
--   1. ARRANGE  Clone the seeded founding club (org A = …0001) into a second
--               tenant, org B. Every uuid is remapped deterministically
--               (tenant_test.map), so B is a complete, self-consistent copy:
--               its own admin / finance / coach / parent logins, families,
--               athletes, invoices, … Tables without org_id that hang off a
--               tenant table (e.g. family_members) are cloned too.
--   2. ASSERT   For each role in A and in B, and for anon:
--                 read   — no visible row has a foreign org_id
--                 update — UPDATE … WHERE org_id = <other> touches 0 rows
--                 delete — DELETE … WHERE org_id = <other> touches 0 rows
--                 insert — INSERT a row stamped with the other org_id is
--                          rejected by RLS (42501) or a guard trigger
--                 move   — UPDATE own row SET org_id = <other> is rejected
--               plus: RLS is enabled on every org-scoped table.
--   Writes run inside a sub-transaction that is always rolled back.
--
-- Output: PASS / FAIL lines (CI fails on any FAIL). Findings listed in
-- tenant_test.known are reported as XFAIL (tracked, non-blocking); when one of
-- them starts passing an XPASS line asks for it to be removed from the list.
-- Intentional cross-tenant visibility (e.g. public camp pages) is declared in
-- tenant_test.allowed_public.
-- ============================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set client_min_messages = notice;

create schema tenant_test;

create function tenant_test.map(u uuid) returns uuid
language sql immutable as $$ select case when u is null then null else md5('tenant-b:' || u::text)::uuid end $$;
create function tenant_test.map2(u uuid) returns uuid
language sql immutable as $$ select case when u is null then null else md5('probe:' || u::text)::uuid end $$;

-- Declared, intentional cross-tenant visibility: rows matching the predicate
-- may be visible to any authenticated/anon user.
create table tenant_test.allowed_public (tbl text primary key, predicate text not null, why text not null);
insert into tenant_test.allowed_public values
  ('programs', 'is_public', 'public camp / registration pages list public programs of every club');

-- Known, tracked findings: key = '<check>:<table>' (check = read|update|delete|insert|move|rls)
-- or '<check>:<table>:<role>' for a role-specific finding.
create table tenant_test.known (key text primary key, note text not null);
-- Findings from the first run of this suite against migrations 01–16 (single-
-- tenant era). Root causes:
--   (S) staff policies call is_admin()/is_finance()/has_role(), which ignore
--       org_id, and the policy itself has no `org_id = current_org_id()` term,
--       so an admin/finance user of ANY tenant reads/writes every tenant's rows.
--   (M) UPDATE policies whose WITH CHECK lacks `org_id = current_org_id()`,
--       so a row can be re-homed into another tenant.
--   (P) profiles_update_self lets any user rewrite their own profiles.org_id:
--       a tenant hop; combined with (S) it yields cross-tenant admin.
-- Fix (tenancy track): make has_role() org-aware (staff_roles.org_id =
-- current_org_id()), add `org_id = current_org_id()` to every USING and WITH
-- CHECK, and freeze profiles.org_id (column privilege or trigger). Delete
-- entries here as they are fixed; run with STRICT_KNOWN=1 to treat them as FAIL.
insert into tenant_test.known (key, note) values
  ('read:athlete_medical',        'S: medical policy uses is_admin() without org scope'),
  ('read:athletes',               'S: athletes_select uses is_finance() without org scope'),
  ('read:attendance_marks',       'S: att_marks_select uses is_admin() without org scope'),
  ('read:attendance_sessions',    'S: staff select without org scope'),
  ('read:consent_acceptances',    'S: staff select without org scope'),
  ('read:documents',              'S: documents_select uses is_admin() without org scope'),
  ('read:families',               'S: staff select without org scope'),
  ('read:invoice_items',          'S: finance select without org scope'),
  ('read:invoices',               'S: invoices_select uses is_finance() without org scope'),
  ('read:notifications',          'S: admin select without org scope'),
  ('read:payments',               'S: finance select without org scope'),
  ('read:program_sessions',       'S: staff select without org scope'),
  ('read:registrations',          'S: staff select without org scope'),
  ('read:staff_roles',            'S: staff_roles_select uses is_admin() without org scope'),
  ('read:training_credits',       'S: staff select without org scope'),
  ('update:attendance_marks',     'S: att_marks_write uses is_admin() without org scope'),
  ('update:documents',            'S: documents_write uses is_admin() without org scope'),
  ('delete:attendance_marks',     'S: att_marks_write uses is_admin() without org scope'),
  ('delete:documents',            'S: documents_write uses is_admin() without org scope'),
  ('insert:attendance_marks',     'S: WITH CHECK has no org scope'),
  ('insert:consent_acceptances',  'S: WITH CHECK has no org scope'),
  ('insert:documents',            'S: WITH CHECK has no org scope'),
  ('insert:registrations',        'S: WITH CHECK has no org scope'),
  ('move:athlete_medical',        'M: guardian write WITH CHECK has no org scope'),
  ('move:athletes',               'M: athletes_guardian_write WITH CHECK has no org scope'),
  ('move:attendance_marks',       'M: WITH CHECK has no org scope'),
  ('move:documents',              'M: WITH CHECK has no org scope'),
  ('move:families',               'M: guardian write WITH CHECK has no org scope'),
  ('move:registrations',          'M: guardian write WITH CHECK has no org scope'),
  ('move:profiles',               'P: profiles_update_self allows changing own org_id (tenant hop)'),
  ('read:deletion_requests',      'S: admin select without org scope'),
  ('update:deletion_requests',    'S: admin review policy without org scope'),
  ('move:deletion_requests',      'M: WITH CHECK has no org scope'),
  ('read:training_bookings',      'S: staff select without org scope'),
  ('update:training_bookings',    'S: staff write without org scope'),
  ('insert:training_bookings',    'S: WITH CHECK has no org scope'),
  ('move:training_bookings',      'M: WITH CHECK has no org scope');

create table tenant_test.results (id serial, status text, check_name text, who text, tbl text, detail text);
grant usage on schema tenant_test to anon, authenticated;
grant execute on all functions in schema tenant_test to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Org-scoped tables, discovered from the catalog.
-- ---------------------------------------------------------------------------
create view tenant_test.org_tables as
  select c.relname::text as tbl, c.oid as relid, c.relrowsecurity as rls
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');

-- Column list / clone expressions for a table (skips generated + serial/identity columns).
create function tenant_test.clone_cols(p_rel regclass, p_org_expr text, p_map text default 'tenant_test.map')
returns table (cols text, exprs text) language sql stable as $$
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
         string_agg(case
           when a.attname = 'org_id' then p_org_expr
           when a.atttypid = 'uuid'::regtype then format('%s(%I)', p_map, a.attname)
           when a.atttypid = 'uuid[]'::regtype then format('array(select %s(x) from unnest(%I) x)', p_map, a.attname)
           else quote_ident(a.attname) end, ', ' order by a.attnum)
  from pg_attribute a
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped
    and a.attgenerated = '' and a.attidentity = ''
    and coalesce(pg_get_expr(d.adbin, d.adrelid), '') not like 'nextval(%'
$$;

-- ---------------------------------------------------------------------------
-- ARRANGE: clone org A into org B
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-000000000001';
  v_b uuid := tenant_test.map('00000000-0000-0000-0000-000000000001');
  r record; v_cols text; v_exprs text; v_fk record; n int;
begin
  set local session_replication_role = replica;  -- no FK checks / user triggers while cloning

  -- Fixture rows for org-scoped tables the seeds leave empty (otherwise their
  -- read checks are vacuous). Guarded per table so schema drift only skips.
  -- Any table still empty after this is reported as a NOTE (coverage gap).
  begin
    insert into public.ai_queries (org_id, actor_id, role, question, answer_preview)
      values (v_a, '00000000-0000-0000-0000-0000000000f4', 'parent', 'When is the next session?', 'Monday 17:00');
  exception when others then raise notice 'fixture skipped (ai_queries): %', sqlerrm; end;
  begin
    insert into public.credit_packages (org_id, name, credits, price_chf) values (v_a, '10-session pack', 10, 650);
  exception when others then raise notice 'fixture skipped (credit_packages): %', sqlerrm; end;
  begin
    insert into public.deletion_requests (org_id, family_id, requested_by, reason)
      values (v_a, '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000000f4', 'fixture');
  exception when others then raise notice 'fixture skipped (deletion_requests): %', sqlerrm; end;
  begin
    insert into public.invitations (org_id, email, role, family_id, invited_by)
      values (v_a, 'fixture.parent@example.com', 'parent', '00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-0000000000f1');
  exception when others then raise notice 'fixture skipped (invitations): %', sqlerrm; end;
  begin
    insert into public.training_bookings (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, price_chf, created_by)
      values (v_a, '00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011',
              '2026-09-07 17:00+02', '2026-09-07 18:00+02', 'booked', 75, '00000000-0000-0000-0000-0000000000f4');
  exception when others then raise notice 'fixture skipped (training_bookings): %', sqlerrm; end;

  -- the organization row itself (id-keyed, globally unique slug)
  select c.cols, c.exprs into v_cols, v_exprs from tenant_test.clone_cols('public.organizations', 'NULL') c;
  v_exprs := replace(v_exprs, 'tenant_test.map(id)', quote_literal(v_b) || '::uuid');
  v_exprs := regexp_replace(v_exprs, '\mslug\M', $q$slug || '-tenant-b'$q$);
  v_exprs := regexp_replace(v_exprs, '\mname\M', $q$name || ' (tenant B)'$q$);
  execute format('insert into public.organizations (%s) select %s from public.organizations where id = $1', v_cols, v_exprs) using v_a;

  -- every org-scoped table
  for r in select * from tenant_test.org_tables order by tbl loop
    select c.cols, c.exprs into v_cols, v_exprs from tenant_test.clone_cols(r.relid, quote_literal(v_b) || '::uuid') c;
    execute format('insert into public.%I (%s) select %s from public.%I where org_id = $1', r.tbl, v_cols, v_exprs, r.tbl) using v_a;
  end loop;

  -- tables without org_id that hang off an org-scoped table (e.g. family_members)
  for v_fk in
    select c.relname::text as tbl, c.oid as relid, a.attname::text as fk_col, p.relname::text as parent
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_class p on p.oid = k.confrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
    where k.contype = 'f' and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and array_length(k.conkey, 1) = 1
      and p.relname in (select tbl from tenant_test.org_tables)
      and c.relname not in (select tbl from tenant_test.org_tables)
      and c.relname <> 'organizations'
    order by c.relname, k.conname
  loop
    -- clone each such table once, keyed on its first tenant-table FK
    continue when exists (select 1 from tenant_test.results where check_name = 'clone' and tbl = v_fk.tbl);
    select c.cols, c.exprs into v_cols, v_exprs from tenant_test.clone_cols(v_fk.relid, 'NULL') c;
    execute format('insert into public.%I (%s) select %s from public.%I t where exists (select 1 from public.%I p where p.id = t.%I and p.org_id = $1)',
                   v_fk.tbl, v_cols, v_exprs, v_fk.tbl, v_fk.parent, v_fk.fk_col) using v_a;
    get diagnostics n = row_count;
    insert into tenant_test.results (status, check_name, tbl, detail) values ('INFO', 'clone', v_fk.tbl, format('%s rows via %s.%s', n, v_fk.tbl, v_fk.fk_col));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Helpers that run a probe as a given user (sub-transaction, always rolled back)
-- ---------------------------------------------------------------------------
create function tenant_test.become(p_user uuid) returns void language plpgsql as $$
begin
  if p_user is null then
    perform set_config('request.jwt.claim.sub', '', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    execute 'set local role authenticated';
  end if;
end $$;

create function tenant_test.unbecome() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function tenant_test.record(p_status text, p_check text, p_who text, p_tbl text, p_detail text) returns void
language plpgsql as $$
declare v_known text;
begin
  select note into v_known from tenant_test.known
   where key in (p_check || ':' || p_tbl, p_check || ':' || p_tbl || ':' || p_who) limit 1;
  if p_status = 'FAIL' and v_known is not null then p_status := 'XFAIL'; p_detail := p_detail || ' [known: ' || v_known || ']'; end if;
  insert into tenant_test.results (status, check_name, who, tbl, detail) values (p_status, p_check, p_who, p_tbl, p_detail);
end $$;

-- Run one write probe. Returns ('ok' | 'blocked:<sqlstate>' | 'rows:<n>').
-- The statement always runs inside a block that is rolled back.
create function tenant_test.probe(p_user uuid, p_sql text, p_arg jsonb default null) returns text
language plpgsql as $$
declare n int; v_state text; v_msg text;
begin
  begin
    perform tenant_test.become(p_user);
    if p_arg is null then execute p_sql; else execute p_sql using p_arg; end if;
    get diagnostics n = row_count;
    raise exception using errcode = 'TT001', message = n::text;  -- roll back the probe
  exception
    when sqlstate 'TT001' then
      get stacked diagnostics v_msg = message_text;
      return 'rows:' || v_msg;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      return 'blocked:' || v_state || ':' || left(v_msg, 120);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- ASSERT
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid := '00000000-0000-0000-0000-000000000001';
  v_b uuid := tenant_test.map('00000000-0000-0000-0000-000000000001');
  u record; t record; n int; own int; v_allowed text; v_res text; v_row jsonb; v_cols text; v_exprs text; v_key text;
begin
  -- 0. RLS enabled everywhere
  for t in select * from tenant_test.org_tables order by tbl loop
    perform tenant_test.record(case when t.rls then 'PASS' else 'FAIL' end, 'rls', '-', t.tbl,
                               case when t.rls then 'row level security enabled' else 'row level security NOT enabled' end);
  end loop;

  -- 1. READ isolation for every role of both tenants, plus anon
  for u in
    select * from (values
      ('A:admin',   '00000000-0000-0000-0000-0000000000f1'::uuid, v_a),
      ('A:finance', '00000000-0000-0000-0000-0000000000f2'::uuid, v_a),
      ('A:coach',   '00000000-0000-0000-0000-0000000000f3'::uuid, v_a),
      ('A:parent',  '00000000-0000-0000-0000-0000000000f4'::uuid, v_a),
      ('B:admin',   tenant_test.map('00000000-0000-0000-0000-0000000000f1'), v_b),
      ('B:finance', tenant_test.map('00000000-0000-0000-0000-0000000000f2'), v_b),
      ('B:coach',   tenant_test.map('00000000-0000-0000-0000-0000000000f3'), v_b),
      ('B:parent',  tenant_test.map('00000000-0000-0000-0000-0000000000f4'), v_b),
      ('anon',      null::uuid, null::uuid)
    ) x(who, uid, org)
  loop
    for t in select * from tenant_test.org_tables order by tbl loop
      select predicate into v_allowed from tenant_test.allowed_public where tbl = t.tbl;
      perform tenant_test.become(u.uid);
      execute format('select count(*) from public.%I where org_id is distinct from $1 and not coalesce((%s), false)',
                     t.tbl, coalesce(v_allowed, 'false')) into n using u.org;
      perform tenant_test.unbecome();
      perform tenant_test.record(case when n = 0 then 'PASS' else 'FAIL' end, 'read', u.who, t.tbl,
                                 format('%s foreign-tenant row(s) visible', n));
    end loop;
  end loop;

  -- sanity: the clone is real and B's logins work (otherwise B-side checks prove nothing)
  perform tenant_test.become(tenant_test.map('00000000-0000-0000-0000-0000000000f1'));
  select count(*) into n from public.athletes where org_id = v_b;
  perform tenant_test.unbecome();
  select count(*) into own from public.athletes where org_id = v_a;
  perform tenant_test.record(case when n = own and n > 0 then 'PASS' else 'FAIL' end, 'sanity', 'B:admin', 'athletes',
                             format('tenant B admin sees %s athletes (A has %s)', n, own));
  perform tenant_test.become(tenant_test.map('00000000-0000-0000-0000-0000000000f4'));
  select count(*) into n from public.athletes where org_id = v_b;
  perform tenant_test.unbecome();
  perform tenant_test.record(case when n > 0 then 'PASS' else 'FAIL' end, 'sanity', 'B:parent', 'athletes',
                             format('tenant B parent sees %s own-family athlete(s)', n));

  -- 2. WRITE isolation — run as the most privileged tenant user (admin) of each org
  for u in
    select * from (values
      ('A:admin', '00000000-0000-0000-0000-0000000000f1'::uuid, v_a, v_b),
      ('B:admin', tenant_test.map('00000000-0000-0000-0000-0000000000f1'), v_b, v_a),
      ('A:parent', '00000000-0000-0000-0000-0000000000f4'::uuid, v_a, v_b)
    ) x(who, uid, own_org, other_org)
  loop
    for t in select * from tenant_test.org_tables order by tbl loop
      -- update foreign rows
      v_res := tenant_test.probe(u.uid, format('update public.%I set org_id = org_id where org_id = %L', t.tbl, u.other_org));
      perform tenant_test.record(case when v_res in ('rows:0') or v_res like 'blocked:%' then 'PASS' else 'FAIL' end,
                                 'update', u.who, t.tbl, v_res);
      -- delete foreign rows
      v_res := tenant_test.probe(u.uid, format('delete from public.%I where org_id = %L', t.tbl, u.other_org));
      perform tenant_test.record(case when v_res in ('rows:0') or v_res like 'blocked:%' then 'PASS' else 'FAIL' end,
                                 'delete', u.who, t.tbl, v_res);
      -- move one of my own rows into the other tenant
      v_res := tenant_test.probe(u.uid, format('update public.%I set org_id = %L where ctid = (select ctid from public.%I where org_id = %L limit 1)',
                                                t.tbl, u.other_org, t.tbl, u.own_org));
      perform tenant_test.record(case when v_res in ('rows:0') or v_res like 'blocked:%' then 'PASS' else 'FAIL' end,
                                 'move', u.who, t.tbl, v_res);
      -- insert a row stamped with the other tenant's org_id (fresh ids)
      execute format('select to_jsonb(x) from public.%I x where org_id = $1 limit 1', t.tbl) into v_row using u.own_org;
      if v_row is null then
        perform tenant_test.record('NOTE', 'insert', u.who, t.tbl, 'no seed row to build an insert probe from (coverage gap)');
      else
        select c.cols, c.exprs into v_cols, v_exprs from tenant_test.clone_cols(t.relid, quote_literal(u.other_org) || '::uuid', 'tenant_test.map2') c;
        v_res := tenant_test.probe(u.uid,
          format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', t.tbl, v_cols, v_exprs, t.tbl), v_row);
        -- RLS WITH CHECK runs after BEFORE triggers and before constraints, so:
        --   42501 = RLS/privilege denied (good); P0001 = guard trigger (good);
        --   success or a constraint error (23xxx) = RLS let the row through (bad).
        perform tenant_test.record(case when v_res like 'blocked:42501:%' or v_res like 'blocked:P0001:%' then 'PASS' else 'FAIL' end,
                                   'insert', u.who, t.tbl, v_res);
      end if;
    end loop;
  end loop;
end $$;

-- known findings that no longer reproduce for ANY role -> XPASS (please remove)
insert into tenant_test.results (status, check_name, who, tbl, detail)
select 'XPASS', split_part(k.key, ':', 1), '-', split_part(k.key, ':', 2),
       format('known finding "%s" no longer reproduces — remove it from tenant_test.known', k.key)
from tenant_test.known k
where not exists (select 1 from tenant_test.results r where r.status = 'XFAIL'
                  and (r.check_name || ':' || r.tbl = k.key or r.check_name || ':' || r.tbl || ':' || r.who = k.key));

-- ---------------------------------------------------------------------------
-- REPORT (one line per result; summary first)
-- ---------------------------------------------------------------------------
select format('INFO tenant isolation: %s org-scoped tables; %s PASS, %s FAIL, %s XFAIL, %s XPASS',
              (select count(*) from tenant_test.org_tables),
              count(*) filter (where status = 'PASS'), count(*) filter (where status = 'FAIL'),
              count(*) filter (where status = 'XFAIL'), count(*) filter (where status = 'XPASS'))
from tenant_test.results;

-- per check/role summary lines (PASS only when every table passed)
select format('%s — %s isolation as %s (%s tables)%s%s',
              case when bool_and(status in ('PASS', 'NOTE', 'XFAIL', 'XPASS')) then 'PASS' else 'FAIL' end,
              check_name, who, count(*),
              coalesce(': failing ' || string_agg(tbl, ', ' order by tbl) filter (where status = 'FAIL'), ''),
              coalesce('; known/XFAIL: ' || string_agg(tbl, ', ' order by tbl) filter (where status = 'XFAIL'), ''))
from tenant_test.results where check_name not in ('clone', 'sanity') and status <> 'XPASS'
group by check_name, who order by check_name, who;

-- detail lines for anything not plainly passing
select format('%s — %s %s on %s: %s', status, check_name, who, tbl, detail)
from tenant_test.results where status in ('FAIL', 'XFAIL', 'XPASS', 'NOTE') or check_name in ('clone', 'sanity')
order by status, check_name, tbl, who;
