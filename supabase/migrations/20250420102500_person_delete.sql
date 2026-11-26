-- ============================================================================
-- Club OS · Remove a person everywhere (archive / erase / restore / purge)
--
--   One reliable flow to remove a player (athlete), a family or a guardian
--   from every section of the club at once:
--
--   delete_athlete(id, mode) / delete_family(id, mode)        admin only
--     mode 'archive' (default): reversible for 30 days. The person is hidden
--       everywhere (status 'archived'), removed from rosters, registrations,
--       waiting lists, upcoming bookings (credits restored by the existing
--       booking rules), carpools, upcoming RSVPs, pending kit, scout links and
--       member cards; open UNPAID invoices are cancelled with a reason;
--       payment plans and autopay stop; memberships are cancelled; the logins
--       of guardians who belong to no other family of the club are detached.
--     mode 'erase': everything above, then every personal record is removed
--       by walking the foreign-key graph from the catalog (a cascade planner:
--       tables added later are covered without touching this file).
--       Accounting and compliance records (invoices, payments, payment plans,
--       family credit, refunds, dunning, autopay, consent evidence, credit
--       ledgers, privacy requests) are KEPT: 10-year retention (Swiss CO
--       art. 958f) and nFADP/GDPR art. 17(3)(b). Their free text is scrubbed of
--       the person's names; the athlete / family row they point to stays as an
--       anonymised tombstone ("Deleted player" / "Deleted family", status
--       'erased') because those ledgers are append-only and closed accounting
--       periods are locked, so their links cannot be rewritten. Rows without
--       retained records are hard-deleted. Storage paths of removed files are
--       returned so the server removes the objects from their buckets.
--   preview_delete_athlete(id) / preview_delete_family(id)
--     The same impact summary (counts per section) without changing anything.
--   remove_guardian(family, profile)                          admin only
--     Unlinks one guardian; detaches the login when it belongs to no other
--     family of the club.
--   restore_person(deletion)                                  admin only
--     Within 30 days: status back to active, team memberships, guardian links
--     and parent roles put back. Cancelled registrations, bookings, invoices,
--     plans, memberships, scout links and member cards are NOT restored (money
--     and capacity may have moved on); the admin re-registers if needed.
--     Reminders paused on invoices that stayed open resume.
--   purge_due_person_deletions() / person_deletions_due_notice()   service role
--     Daily cron: archived people older than 30 days are erased; admins get a
--     notice 3 days before.
--
--   Finance, coaches and parents cannot delete people. Audit entries carry ids
--   and counts only. Additive and idempotent. SYNTHETIC DATA ONLY in tests.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Status columns
-- ---------------------------------------------------------------------------
alter table public.athletes add column if not exists archived_at timestamptz;
alter table public.athletes add column if not exists archived_by uuid references public.profiles(id) on delete set null;

alter table public.families add column if not exists status text not null default 'active';
alter table public.families add column if not exists archived_at timestamptz;
alter table public.families add column if not exists archived_by uuid references public.profiles(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'families_status_chk') then
    alter table public.families add constraint families_status_chk check (status in ('active', 'archived', 'erased'));
  end if;
end $$;
create index if not exists idx_athletes_org_status on public.athletes(org_id, status);
create index if not exists idx_families_org_status on public.families(org_id, status);

-- ---------------------------------------------------------------------------
-- 2) person_deletions: one row per archive / erase (ids and counts only)
-- ---------------------------------------------------------------------------
create table if not exists public.person_deletions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  kind              text not null,
  target_id         uuid not null,
  family_id         uuid,
  status            text not null default 'archived',
  mode              text not null default 'archive',
  summary           jsonb not null default '{}'::jsonb,
  snapshot          jsonb,
  requested_by      uuid references public.profiles(id) on delete set null,
  purge_after       timestamptz,
  purge_notified_at timestamptz,
  restored_at       timestamptz,
  restored_by       uuid references public.profiles(id) on delete set null,
  erased_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint person_deletions_kind_chk check (kind in ('athlete', 'family')),
  constraint person_deletions_status_chk check (status in ('archived', 'restored', 'erased')),
  constraint person_deletions_mode_chk check (mode in ('archive', 'erase'))
);
create index if not exists idx_person_deletions_org on public.person_deletions(org_id, status, created_at desc);
create index if not exists idx_person_deletions_due on public.person_deletions(purge_after) where status = 'archived';
create unique index if not exists uq_person_deletions_open on public.person_deletions(org_id, kind, target_id) where status = 'archived';
drop trigger if exists trg_person_deletions_updated on public.person_deletions;
create trigger trg_person_deletions_updated before update on public.person_deletions
  for each row execute function public.set_updated_at();

alter table public.person_deletions enable row level security;
alter table public.person_deletions force row level security;
drop policy if exists person_deletions_select on public.person_deletions;
create policy person_deletions_select on public.person_deletions for select to authenticated
  using (org_id = public.current_org_id() and public.is_admin());
-- Writes only through the security-definer functions below.
drop policy if exists person_deletions_insert on public.person_deletions;
create policy person_deletions_insert on public.person_deletions for insert to authenticated with check (false);
drop policy if exists person_deletions_update on public.person_deletions;
create policy person_deletions_update on public.person_deletions for update to authenticated using (false) with check (false);
drop policy if exists person_deletions_delete on public.person_deletions;
create policy person_deletions_delete on public.person_deletions for delete to authenticated using (false);
revoke all on public.person_deletions from anon;
grant select on public.person_deletions to authenticated;
grant all on public.person_deletions to service_role;

-- ---------------------------------------------------------------------------
-- 3) Configuration of the planner
-- ---------------------------------------------------------------------------
-- Retained records: never deleted by an erase. Explicit list plus every table
-- holding a RESTRICT / NO ACTION key to athletes or families (the schema's own
-- statement that these rows must outlive the person).
create or replace function public.pdel_retained_tables()
returns text[]
language sql
stable
set search_path = public
as $$
  select array(
    select distinct t from (
      select unnest(array[
        'invoices', 'invoice_items', 'invoice_adjustments', 'payments', 'payment_plans',
        'payment_plan_installments', 'family_credit_entries', 'refund_requests', 'dunning_cases',
        'dunning_notices', 'autopay_mandates', 'autopay_charges', 'consent_acceptances',
        'parental_consents', 'training_credit_adjustments', 'education_record_disclosures',
        'dsar_requests', 'deletion_requests', 'person_deletions', 'audit_logs'
      ]) as t
      union
      select c.conrelid::regclass::text
        from pg_constraint c
       where c.contype = 'f'
         and c.confrelid in ('public.athletes'::regclass, 'public.families'::regclass)
         and c.confdeltype in ('r', 'a')
    ) s
    where to_regclass('public.' || t) is not null
  )
$$;

-- Append-only / immutable tables whose text is never rewritten.
create or replace function public.pdel_immutable_tables()
returns text[] language sql immutable as $$
  select array['payments', 'invoice_adjustments', 'family_credit_entries', 'training_credit_adjustments',
               'consent_acceptances', 'parental_consents', 'education_record_disclosures', 'audit_logs', 'person_deletions']
$$;

-- Files: table.column -> bucket.
create or replace function public.pdel_storage_columns()
returns table (tbl text, col text, bucket text)
language sql immutable as $$
  values ('athletes', 'photo_path', 'athlete-photos'),
         ('athletes', 'cover_path', 'athlete-covers'),
         ('documents', 'storage_path', 'documents'),
         ('contracts', 'pdf_path', 'contracts'),
         ('form_submissions', 'signature_path', 'form-files'),
         ('incident_reports', 'clearance_file_path', 'club-admin-files')
$$;

-- "c.a = p.x and c.b = p.y" for a foreign key.
create or replace function public.pdel_fk_join(p_con oid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by k.ord)
    from pg_constraint con
    cross join lateral unnest(con.conkey, con.confkey) with ordinality as k(ck, pk, ord)
    join pg_attribute ca on ca.attrelid = con.conrelid and ca.attnum = k.ck
    join pg_attribute pa on pa.attrelid = con.confrelid and pa.attnum = k.pk
   where con.oid = p_con
$$;

-- ---------------------------------------------------------------------------
-- 4) Cascade planner
--    Roots: _pdel_roots(rel, id, tomb). A non-tomb root is deleted (Postgres
--    cascades); a tomb root stays as an anonymised row and its direct
--    dependents are deleted. The planner walks every ON DELETE CASCADE key
--    from the catalog (fixpoint), never into retained tables, and records:
--      _pdel_rows    rows that will disappear (rel, ctid, generation)
--      _pdel_kept    retained rows reached through a cascade key
--      _pdel_block   keys that would block or silently delete retained rows
-- ---------------------------------------------------------------------------
create or replace function public.pdel_plan_reset()
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if to_regclass('pg_temp._pdel_roots') is null then
    create temp table _pdel_roots (rel oid not null, id uuid not null, tomb boolean not null, primary key (rel, id)) on commit drop;
    create temp table _pdel_rows (rel oid not null, tid tid not null, gen int not null, primary key (rel, tid)) on commit drop;
    create temp table _pdel_kept (rel oid not null, tid tid not null, primary key (rel, tid)) on commit drop;
    create temp table _pdel_block (rel oid not null, con oid not null, n bigint not null) on commit drop;
  end if;
  truncate _pdel_roots, _pdel_rows, _pdel_kept, _pdel_block;
end $$;

-- Does any retained row reference this root directly?
create or replace function public.pdel_has_retained_refs(p_rel regclass, p_id uuid)
returns boolean
language plpgsql
stable
set search_path = public, pg_catalog
as $$
declare
  con record;
  v boolean;
  v_retained text[] := public.pdel_retained_tables();
begin
  for con in
    select c.oid, c.conrelid::regclass as child
      from pg_constraint c
     where c.contype = 'f' and c.confrelid = p_rel
       and c.conrelid::regclass::text = any(v_retained)
  loop
    execute format('select exists (select 1 from %s c join %s p on %s where p.id = $1)',
                   con.child, p_rel, public.pdel_fk_join(con.oid))
      into v using p_id;
    if v then return true; end if;
  end loop;
  return false;
end $$;

-- " and p is not a tomb root" (only root tables have tomb rows).
create or replace function public.pdel_not_tomb(p_rel oid, p_root_rels oid[])
returns text
language sql
immutable
as $$
  select case when p_rel = any(p_root_rels)
    then format(' and not exists (select 1 from _pdel_roots r where r.rel = %s and r.tomb and r.id = p.id)', p_rel)
    else '' end
$$;

create or replace function public.pdel_plan_build()
returns void
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  g int := 0;
  n bigint;
  total bigint;
  con record;
  v_retained text[] := public.pdel_retained_tables();
  v_root_rels oid[];
  v_skip_roots text;
begin
  select array_agg(distinct rel) into v_root_rels from _pdel_roots;

  -- Generation 0: every root (tomb roots too: they are parents of the walk).
  for con in select distinct rel from _pdel_roots loop
    execute format('insert into _pdel_rows (rel, tid, gen) select %s, p.ctid, 0 from %s p
                     where p.id in (select id from _pdel_roots where rel = %s) on conflict do nothing',
                   con.rel, con.rel::regclass, con.rel);
  end loop;

  loop
    total := 0;
    for con in
      select c.oid, c.conrelid, c.confrelid, c.confdeltype
        from pg_constraint c
       where c.contype = 'f'
         and c.confrelid in (select distinct rel from _pdel_rows where gen = g)
    loop
      -- Children that are roots themselves are handled as roots.
      v_skip_roots := case when con.conrelid = any(v_root_rels)
        then format(' and c.id not in (select id from _pdel_roots where rel = %s)', con.conrelid) else '' end;

      if con.confdeltype = 'c' then
        if con.conrelid::regclass::text = any(v_retained) then
          execute format('insert into _pdel_kept (rel, tid)
                            select distinct %s, c.ctid from %s c join %s p on %s
                              join _pdel_rows d on d.rel = %s and d.tid = p.ctid and d.gen = %s
                            on conflict do nothing',
                         con.conrelid, con.conrelid::regclass, con.confrelid::regclass,
                         public.pdel_fk_join(con.oid), con.confrelid, g);
          -- A retained row under a row that will be deleted: refuse.
          execute format('select count(*) from %s c join %s p on %s
                            join _pdel_rows d on d.rel = %s and d.tid = p.ctid and d.gen = %s
                           where true %s',
                         con.conrelid::regclass, con.confrelid::regclass, public.pdel_fk_join(con.oid),
                         con.confrelid, g, public.pdel_not_tomb(con.confrelid, v_root_rels))
            into n;
          if n > 0 then insert into _pdel_block values (con.conrelid, con.oid, n); end if;
        else
          execute format('insert into _pdel_rows (rel, tid, gen)
                            select distinct %s, c.ctid, %s from %s c join %s p on %s
                              join _pdel_rows d on d.rel = %s and d.tid = p.ctid and d.gen = %s
                             where true %s
                            on conflict do nothing',
                         con.conrelid, g + 1, con.conrelid::regclass, con.confrelid::regclass,
                         public.pdel_fk_join(con.oid), con.confrelid, g, v_skip_roots);
          get diagnostics n = row_count;
          total := total + n;
        end if;
      end if;
    end loop;
    exit when total = 0 or g >= 25;
    g := g + 1;
  end loop;

  -- Restrict / no-action keys: rows that stay but reference a row that
  -- disappears (tomb roots stay, so they do not count).
  for con in
    select c.oid, c.conrelid, c.confrelid
      from pg_constraint c
     where c.contype = 'f' and c.confdeltype in ('r', 'a')
       and c.confrelid in (select distinct rel from _pdel_rows)
  loop
    execute format('select count(*) from %s c join %s p on %s
                      join _pdel_rows d on d.rel = %s and d.tid = p.ctid
                     where not exists (select 1 from _pdel_rows e where e.rel = %s and e.tid = c.ctid) %s',
                   con.conrelid::regclass, con.confrelid::regclass, public.pdel_fk_join(con.oid),
                   con.confrelid, con.conrelid, public.pdel_not_tomb(con.confrelid, v_root_rels))
      into n;
    if n > 0 then insert into _pdel_block values (con.conrelid, con.oid, n); end if;
  end loop;

  -- Tomb roots stay.
  for con in select distinct rel from _pdel_roots where tomb loop
    execute format('delete from _pdel_rows d using %s p
                     where d.rel = %s and d.gen = 0 and d.tid = p.ctid
                       and p.id in (select id from _pdel_roots where rel = %s and tomb)',
                   con.rel::regclass, con.rel, con.rel);
  end loop;
end $$;

-- Rows per table of the current plan, plus the ids of planned rows.
create or replace function public.pdel_plan_tables()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
begin
  return (select coalesce(jsonb_object_agg(t, n), '{}'::jsonb)
            from (select rel::regclass::text as t, count(*) as n from _pdel_rows group by rel) s);
end $$;

create or replace function public.pdel_plan_ids()
returns uuid[]
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  r record;
  v uuid[] := '{}';
  part uuid[];
begin
  for r in
    select d.rel, array_agg(d.tid) as tids
      from _pdel_rows d
     where exists (select 1 from pg_attribute a where a.attrelid = d.rel and a.attname = 'id'
                     and a.atttypid = 'uuid'::regtype and not a.attisdropped)
     group by d.rel
  loop
    execute format('select coalesce(array_agg(id), ''{}'') from %s where ctid = any($1)', r.rel::regclass)
      into part using r.tids;
    v := v || part;
  end loop;
  return v || coalesce((select array_agg(id) from _pdel_roots), '{}');
end $$;

-- Files of planned rows and of tomb roots: {bucket: [paths]}.
create or replace function public.pdel_plan_files()
returns jsonb
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  s record;
  part text[];
  v jsonb := '{}'::jsonb;
begin
  for s in select * from public.pdel_storage_columns() where to_regclass('public.' || tbl) is not null loop
    if not exists (select 1 from pg_attribute where attrelid = ('public.' || s.tbl)::regclass and attname = s.col and not attisdropped) then
      continue;
    end if;
    execute format('select coalesce(array_agg(distinct x.%1$I), ''{}'') from public.%2$I x
                     where x.%1$I is not null
                       and (x.ctid in (select tid from _pdel_rows where rel = %3$s)
                            or x.id in (select id from _pdel_roots where rel = %3$s and tomb))',
                   s.col, s.tbl, ('public.' || s.tbl)::regclass::oid)
      into part;
    if array_length(part, 1) > 0 then
      v := jsonb_set(v, array[s.bucket], coalesce(v -> s.bucket, '[]'::jsonb) || to_jsonb(part));
    end if;
  end loop;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Name scrubbing for retained free text
-- ---------------------------------------------------------------------------
create or replace function public.pdel_scrub(p_text text, p_names jsonb)
returns text
language plpgsql
immutable
as $$
declare
  r record;
  v text := p_text;
begin
  if v is null or p_names is null then return v; end if;
  -- Longest first, so "Mia Example" goes before "Mia".
  for r in
    select e.key as name, e.value #>> '{}' as repl
      from jsonb_each(p_names) e
     where length(btrim(e.key)) >= 2
     order by length(e.key) desc
  loop
    v := regexp_replace(v, '\m' || regexp_replace(btrim(r.name), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M', r.repl, 'gi');
  end loop;
  return v;
end $$;

-- Retained rows that hang off the roots (directly, then one hop further
-- inside retained tables), as (rel, id).
create or replace function public.pdel_retained_rows()
returns table (rel oid, id uuid)
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  con record;
  v_retained text[] := public.pdel_retained_tables();
  hop int;
begin
  if to_regclass('pg_temp._pdel_ret') is null then
    create temp table _pdel_ret (rel oid not null, id uuid not null, primary key (rel, id)) on commit drop;
  end if;
  truncate _pdel_ret;
  for con in
    select c.oid, c.conrelid, c.confrelid from pg_constraint c
     where c.contype = 'f' and c.confrelid in (select distinct o.rel from _pdel_roots o)
       and c.conrelid::regclass::text = any(v_retained)
       and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'id' and not a.attisdropped)
  loop
    execute format('insert into _pdel_ret select %s, c.id from %s c join %s p on %s
                     where p.id in (select o.id from _pdel_roots o where o.rel = %s) on conflict do nothing',
                   con.conrelid, con.conrelid::regclass, con.confrelid::regclass, public.pdel_fk_join(con.oid), con.confrelid);
  end loop;
  for hop in 1..2 loop
    for con in
      select c.oid, c.conrelid, c.confrelid from pg_constraint c
       where c.contype = 'f' and c.confrelid in (select distinct x.rel from _pdel_ret x)
         and c.conrelid::regclass::text = any(v_retained) and c.conrelid <> c.confrelid
         and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'id' and not a.attisdropped)
    loop
      execute format('insert into _pdel_ret select %s, c.id from %s c join %s p on %s
                       where p.id in (select x.id from _pdel_ret x where x.rel = %s) on conflict do nothing',
                     con.conrelid, con.conrelid::regclass, con.confrelid::regclass, public.pdel_fk_join(con.oid), con.confrelid);
    end loop;
  end loop;
  return query select x.rel, x.id from _pdel_ret x;
end $$;

-- Rewrite names in every text column of the retained rows (not immutable
-- ledgers; invoice descriptions of closed accounting periods stay as booked).
create or replace function public.pdel_scrub_retained(p_names jsonb)
returns integer
language plpgsql
set search_path = public, pg_catalog, pg_temp
as $$
declare
  t record;
  col record;
  v_total integer := 0;
  n integer;
  v_extra text;
begin
  if p_names is null or p_names = '{}'::jsonb then return 0; end if;
  for t in
    select rr.rel, array_agg(rr.id) as ids from public.pdel_retained_rows() rr
     where not (rr.rel::regclass::text = any(public.pdel_immutable_tables()))
     group by rr.rel
  loop
    for col in
      select a.attname from pg_attribute a
       where a.attrelid = t.rel and a.attnum > 0 and not a.attisdropped
         and a.atttypid in ('text'::regtype, 'varchar'::regtype)
         and a.attname not in ('number', 'currency', 'status', 'payment_reference', 'idempotency_key', 'kind',
                               'stripe_payment_intent_id', 'stripe_subscription_schedule_id', 'stripe_customer_id',
                               'stripe_payment_method_id', 'stripe_account_id', 'consent_version', 'consent_text',
                               'source', 'frequency', 'locale', 'tax_label')
    loop
      v_extra := case when t.rel = 'public.invoices'::regclass and col.attname = 'description'
        then ' and not public.accounting_period_closed(org_id, issued_at::date)' else '' end;
      begin
        execute format('update %s set %I = public.pdel_scrub(%I, $1) where id = any($2) and %I is not null
                          and %I is distinct from public.pdel_scrub(%I, $1)%s',
                       t.rel::regclass, col.attname, col.attname, col.attname, col.attname, col.attname, v_extra)
          using p_names, t.ids;
        get diagnostics n = row_count;
        v_total := v_total + n;
      exception when others then
        -- A guard refused (locked record): the text stays as booked.
        null;
      end;
    end loop;
  end loop;
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 6) Section counts (the impact summary)
-- ---------------------------------------------------------------------------
create or replace function public.pdel_open_invoice_statuses()
returns text[] language sql immutable as $$ select array['draft', 'pending', 'sent', 'overdue'] $$;

create or replace function public.pdel_sections(p_org uuid, p_athletes uuid[], p_family uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v jsonb;
  v_inv_ids uuid[];
  v_cancel jsonb;
  v_cancel_n integer;
  v_kept integer;
  v_guardians integer := 0;
begin
  select coalesce(array_agg(i.id), '{}') into v_inv_ids
    from public.invoices i
   where i.org_id = p_org
     and ((p_family is not null and i.family_id = p_family) or i.athlete_id = any(p_athletes));

  select count(*), coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'amount', amount) order by currency), '[]')
    into v_cancel_n, v_cancel
    from (select currency, sum(total_chf + adjustments_total) as amount, count(*) as n
            from public.invoices
           where id = any(v_inv_ids) and status::text = any(public.pdel_open_invoice_statuses())
             and public.invoice_net_paid(id) = 0
           group by currency) s;
  select coalesce(sum(n), 0) into v_cancel_n
    from (select count(*) as n from public.invoices
           where id = any(v_inv_ids) and status::text = any(public.pdel_open_invoice_statuses())
             and public.invoice_net_paid(id) = 0) s;
  v_kept := coalesce(array_length(v_inv_ids, 1), 0) - v_cancel_n;

  if p_family is not null then
    select count(*) into v_guardians from public.family_members where family_id = p_family;
  end if;

  v := jsonb_build_object(
    'athletes', coalesce(array_length(p_athletes, 1), 0),
    'guardians', v_guardians,
    'teams', (select count(*) from public.team_memberships where org_id = p_org and athlete_id = any(p_athletes)),
    'registrations', (select count(*) from public.registrations r where r.org_id = p_org and r.athlete_id = any(p_athletes)
                        and r.status in ('pending', 'confirmed', 'waitlist')),
    'programmes', (select count(distinct r.program_id) from public.registrations r join public.programs p on p.id = r.program_id
                     where r.org_id = p_org and r.athlete_id = any(p_athletes) and r.status in ('pending', 'confirmed', 'waitlist')
                       and p.kind <> 'camp'),
    'camps', (select count(*) from public.registrations r join public.programs p on p.id = r.program_id
                where r.org_id = p_org and r.athlete_id = any(p_athletes) and r.status in ('pending', 'confirmed', 'waitlist')
                  and p.kind = 'camp'),
    'bookings', (select count(*) from public.training_bookings b where b.org_id = p_org and b.athlete_id = any(p_athletes)
                   and b.status = 'booked' and b.slot_start > now()),
    'waitlists', (select count(*) from public.waitlist_entries w where w.org_id = p_org
                    and (w.athlete_id = any(p_athletes) or w.family_id = p_family) and w.status in ('waiting', 'offered')),
    'memberships', (select count(*) from public.memberships m where m.org_id = p_org
                      and (m.athlete_id = any(p_athletes) or m.family_id = p_family) and m.status in ('active', 'pending_payment')),
    'carpools', case when p_family is null then 0 else
                  (select count(*) from public.carpool_offers where family_id = p_family and status in ('open', 'full'))
                + (select count(*) from public.carpool_requests where family_id = p_family and status in ('open', 'matched')) end,
    'rsvps', (select count(*) from public.event_rsvps r join public.events e on e.id = r.event_id
                where r.org_id = p_org and r.athlete_id = any(p_athletes) and e.starts_at > now()),
    'kit', (select count(*) from public.kit_assignments k where k.org_id = p_org and k.athlete_id = any(p_athletes)
              and k.status in ('sizes_requested', 'sizes_submitted')),
    'invoices_cancelled', v_cancel_n,
    'invoices_cancelled_amounts', v_cancel,
    'invoices_kept', v_kept,
    'payment_plans', (select count(*) from public.payment_plans pp where pp.org_id = p_org
                        and ((p_family is not null and pp.family_id = p_family) or pp.athlete_id = any(p_athletes))
                        and pp.status in ('active', 'paused')),
    'autopay', case when p_family is null then 0 else
                 (select count(*) from public.autopay_mandates where family_id = p_family and status in ('pending', 'active')) end,
    'documents', (select count(*) from public.documents d where d.org_id = p_org
                    and (d.athlete_id = any(p_athletes) or d.family_id = p_family)),
    'photos', (select count(*) from public.athletes a where a.id = any(p_athletes) and (a.photo_path is not null or a.cover_path is not null))
  );
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Archive steps (shared by archive and erase)
-- ---------------------------------------------------------------------------
create or replace function public.pdel_cancel_invoice(p_invoice uuid, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if public.is_finance() and exists (select 1 from public.invoices where id = p_invoice and org_id = public.current_org_id()) then
    perform public.cancel_invoice(p_invoice, p_reason);
  else
    perform set_config('app.money_edit', 'on', true);
    update public.invoices set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason where id = p_invoice;
    perform set_config('app.money_edit', 'off', true);
  end if;
end $$;

create or replace function public.pdel_cancel_booking(p_booking uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
set search_path = public
as $$
declare v_b public.training_bookings%rowtype;
begin
  if public.is_finance() and exists (select 1 from public.training_bookings where id = p_booking and org_id = public.current_org_id()) then
    -- Existing rules: staff cancellation refunds credits / package sessions,
    -- frees the slot and cancels an unpaid booking invoice.
    perform public.cancel_training_booking(p_booking);
  else
    select * into v_b from public.training_bookings where id = p_booking for update;
    update public.training_bookings set status = 'cancelled', updated_at = now() where id = p_booking;
    update public.coach_availability set is_booked = false
     where coach_id = v_b.coach_id and starts_at = v_b.slot_start and org_id = v_b.org_id;
  end if;
  update public.training_bookings
     set cancel_reason = left(p_reason, 500), cancelled_at = coalesce(cancelled_at, now()), cancelled_by = p_actor
   where id = p_booking;
end $$;

-- Returns the snapshot of what restore puts back.
create or replace function public.pdel_archive_steps(p_org uuid, p_athletes uuid[], p_family uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason constant text := 'Person deleted';
  v_snap jsonb := '{}'::jsonb;
  v_guardians uuid[] := '{}';
  r record;
begin
  -- Rosters (put back by restore).
  v_snap := v_snap || jsonb_build_object('team_memberships',
    coalesce((select jsonb_agg(to_jsonb(tm)) from public.team_memberships tm where tm.org_id = p_org and tm.athlete_id = any(p_athletes)), '[]'));
  delete from public.team_memberships where org_id = p_org and athlete_id = any(p_athletes);

  update public.registrations
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = v_reason, cancelled_by = p_actor
   where org_id = p_org and athlete_id = any(p_athletes) and status in ('pending', 'confirmed', 'waitlist');

  update public.waitlist_entries
     set status = 'removed', skip_reason = v_reason, offer_token_hash = null
   where org_id = p_org and (athlete_id = any(p_athletes) or family_id = p_family) and status in ('waiting', 'offered');

  for r in select id from public.training_bookings
            where org_id = p_org and athlete_id = any(p_athletes) and status = 'booked' and slot_start > now()
  loop
    perform public.pdel_cancel_booking(r.id, v_reason, p_actor);
  end loop;

  if p_family is not null then
    update public.carpool_offers set status = 'cancelled' where org_id = p_org and family_id = p_family and status in ('open', 'full');
    update public.carpool_requests set status = 'cancelled' where org_id = p_org and family_id = p_family and status in ('open', 'matched');
  end if;

  delete from public.event_rsvps rs using public.events e
   where e.id = rs.event_id and rs.org_id = p_org and rs.athlete_id = any(p_athletes) and e.starts_at > now();

  delete from public.kit_assignments
   where org_id = p_org and athlete_id = any(p_athletes) and status in ('sizes_requested', 'sizes_submitted');

  delete from public.form_reminders where org_id = p_org and (athlete_id = any(p_athletes) or family_id = p_family);

  update public.scout_profiles set revoked_at = now(), revoked_by = p_actor
   where org_id = p_org and athlete_id = any(p_athletes) and revoked_at is null;
  update public.member_cards set is_active = false
   where org_id = p_org and athlete_id = any(p_athletes) and is_active;

  update public.memberships set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason
   where org_id = p_org and (athlete_id = any(p_athletes) or family_id = p_family) and status in ('active', 'pending_payment');

  update public.payment_plans set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, autopay = false
   where org_id = p_org and status in ('active', 'paused')
     and ((p_family is not null and family_id = p_family) or athlete_id = any(p_athletes));

  for r in
    select id from public.invoices
     where org_id = p_org and status::text = any(public.pdel_open_invoice_statuses())
       and ((p_family is not null and family_id = p_family) or athlete_id = any(p_athletes))
       and public.invoice_net_paid(id) = 0
  loop
    perform public.pdel_cancel_invoice(r.id, v_reason);
  end loop;

  -- Invoices that stay open (part-paid, written down…): no reminders / dunning
  -- to a removed person; restore resumes them.
  v_snap := v_snap || jsonb_build_object('paused_invoices', coalesce((
    select jsonb_agg(id) from public.invoices
     where org_id = p_org and not reminders_paused
       and status::text in ('draft', 'pending', 'sent', 'overdue', 'partially_paid')
       and ((p_family is not null and family_id = p_family) or athlete_id = any(p_athletes))), '[]'));
  update public.invoices set reminders_paused = true
   where id in (select jsonb_array_elements_text(v_snap -> 'paused_invoices')::uuid);

  if p_family is not null then
    update public.autopay_mandates set status = 'revoked', enabled = false, revoked_at = now(), revoked_by = p_actor
     where org_id = p_org and family_id = p_family and status in ('pending', 'active');

    -- Guardians: unlink; a login that belongs to no other active family of
    -- this club also loses its parent role here.
    select coalesce(array_agg(profile_id), '{}') into v_guardians from public.family_members where family_id = p_family;
    v_snap := v_snap || jsonb_build_object(
      'family_members', coalesce((select jsonb_agg(to_jsonb(fm)) from public.family_members fm where fm.family_id = p_family), '[]'),
      'staff_roles', coalesce((select jsonb_agg(to_jsonb(sr)) from public.staff_roles sr
                                 where sr.org_id = p_org and sr.role = 'parent' and sr.profile_id = any(v_guardians)
                                   and not exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                                                    where fm.profile_id = sr.profile_id and f.org_id = p_org
                                                      and f.id <> p_family and f.status = 'active')), '[]'),
      'primary_contact_id', (select primary_contact_id from public.families where id = p_family));
    delete from public.staff_roles sr
     where sr.org_id = p_org and sr.role = 'parent' and sr.profile_id = any(v_guardians)
       and not exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                        where fm.profile_id = sr.profile_id and f.org_id = p_org and f.id <> p_family and f.status = 'active');
    delete from public.family_members where family_id = p_family;
    update public.families set status = 'archived', archived_at = now(), archived_by = p_actor, primary_contact_id = null
     where id = p_family;
  end if;

  update public.athletes set status = 'archived', archived_at = now(), archived_by = p_actor
   where org_id = p_org and id = any(p_athletes);

  return v_snap || jsonb_build_object('athletes', to_jsonb(p_athletes), 'guardians', to_jsonb(v_guardians));
end $$;

-- ---------------------------------------------------------------------------
-- 8) Core (no caller checks: only reached through the checked wrappers below
--    or the service-role purge).
-- ---------------------------------------------------------------------------
create or replace function public.pdel_target(p_kind text, p_id uuid, out org_id uuid, out athletes uuid[], out family_id uuid)
language plpgsql
stable
set search_path = public
as $$
begin
  if p_kind = 'athlete' then
    select a.org_id, array[a.id] into org_id, athletes from public.athletes a where a.id = p_id;
    family_id := null;
  elsif p_kind = 'family' then
    select f.org_id, f.id into org_id, family_id from public.families f where f.id = p_id;
    select coalesce(array_agg(a.id), '{}') into athletes from public.athletes a where a.family_id = p_id;
  else
    raise exception 'INVALID_KIND' using errcode = 'P0001';
  end if;
end $$;

create or replace function public.pdel_names(p_athletes uuid[], p_family uuid, p_guardians uuid[])
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select a.first_name || ' ' || a.last_name as k, 'Deleted player' as v from public.athletes a where a.id = any(p_athletes)
    union select a.last_name || ' ' || a.first_name, 'Deleted player' from public.athletes a where a.id = any(p_athletes)
    union select a.first_name, 'Deleted player' from public.athletes a where a.id = any(p_athletes) and length(a.first_name) >= 3
    union select f.name, 'Deleted family' from public.families f where f.id = p_family and f.status <> 'erased'
    union select f.contact_name, 'Deleted guardian' from public.families f where f.id = p_family and f.contact_name is not null
    union select f.contact_email::text, 'deleted@deleted.invalid' from public.families f where f.id = p_family and f.contact_email is not null
    union select p.full_name, 'Deleted guardian' from public.profiles p where p.id = any(p_guardians) and p.full_name is not null
    union select p.email::text, 'deleted@deleted.invalid' from public.profiles p where p.id = any(p_guardians)
  ) s where k is not null and length(btrim(k)) >= 2
$$;

-- Anonymise a tomb root in place: every nullable column (except keys and
-- bookkeeping) becomes null, names become the placeholder.
create or replace function public.pdel_tombstone(p_rel regclass, p_id uuid)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_set text;
begin
  select string_agg(format('%I = null', a.attname), ', ') into v_set
    from pg_attribute a
   where a.attrelid = p_rel and a.attnum > 0 and not a.attisdropped and not a.attnotnull
     and a.attgenerated = ''
     and a.attname not in ('id', 'org_id', 'family_id', 'status', 'created_at', 'updated_at', 'archived_at', 'archived_by');
  if p_rel = 'public.athletes'::regclass then
    execute format('update public.athletes set %s%s first_name = %L, last_name = %L, dob = %L, status = %L where id = $1',
                   v_set, case when v_set is null then '' else ',' end, 'Deleted', 'player', '1900-01-01', 'erased') using p_id;
  elsif p_rel = 'public.families'::regclass then
    execute format('update public.families set %s%s name = %L, status = %L where id = $1',
                   v_set, case when v_set is null then '' else ',' end, 'Deleted family', 'erased') using p_id;
  end if;
end $$;

create or replace function public.pdel_preview(p_kind text, p_id uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  t record;
  v jsonb;
  a uuid;
begin
  select * into t from public.pdel_target(p_kind, p_id);
  v := public.pdel_sections(t.org_id, t.athletes, t.family_id);
  perform public.pdel_plan_reset();
  foreach a in array t.athletes loop
    insert into _pdel_roots values ('public.athletes'::regclass, a, public.pdel_has_retained_refs('public.athletes', a));
  end loop;
  if t.family_id is not null then
    insert into _pdel_roots values ('public.families'::regclass, t.family_id, public.pdel_has_retained_refs('public.families', t.family_id));
  end if;
  perform public.pdel_plan_build();
  v := v || jsonb_build_object(
    'kind', p_kind, 'id', p_id,
    'status', case when p_kind = 'athlete' then (select status from public.athletes where id = p_id)
                   else (select status from public.families where id = p_id) end,
    'records', (select count(*) from _pdel_rows),
    'records_kept', (select count(*) from _pdel_kept),
    'tables', public.pdel_plan_tables(),
    'blocked', (select coalesce(jsonb_agg(distinct rel::regclass::text), '[]') from _pdel_block)
  );
  return v;
end $$;

create or replace function public.pdel_archive(p_kind text, p_id uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  t record;
  v_summary jsonb;
  v_snap jsonb;
  v_del uuid;
begin
  select * into t from public.pdel_target(p_kind, p_id);
  if t.org_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if (p_kind = 'athlete' and (select status from public.athletes where id = p_id) in ('archived', 'erased'))
     or (p_kind = 'family' and (select status from public.families where id = p_id) in ('archived', 'erased')) then
    raise exception 'ALREADY_DELETED' using errcode = 'P0001';
  end if;
  -- A family archive covers its children that are still active.
  if p_kind = 'family' then
    select coalesce(array_agg(id), '{}') into t.athletes from public.athletes
     where family_id = p_id and status not in ('archived', 'erased');
  end if;
  v_summary := public.pdel_sections(t.org_id, t.athletes, t.family_id);
  v_snap := public.pdel_archive_steps(t.org_id, t.athletes, t.family_id, p_actor);
  insert into public.person_deletions (org_id, kind, target_id, family_id, status, mode, summary, snapshot, requested_by, purge_after)
  values (t.org_id, p_kind, p_id,
          case when p_kind = 'athlete' then (select family_id from public.athletes where id = p_id) else p_id end,
          'archived', 'archive', v_summary, v_snap, p_actor, now() + interval '30 days')
  returning id into v_del;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (t.org_id, p_actor, 'person.archive', case when p_kind = 'athlete' then 'athletes' else 'families' end, p_id,
          jsonb_build_object('deletion_id', v_del, 'counts', v_summary - 'invoices_cancelled_amounts'));
  return v_summary || jsonb_build_object('kind', p_kind, 'id', p_id, 'mode', 'archive', 'deletion_id', v_del,
                                         'purge_after', now() + interval '30 days');
end $$;

create or replace function public.pdel_erase(p_kind text, p_id uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  t record;
  v_summary jsonb;
  v_snap jsonb;
  v_guardians uuid[] := '{}';
  v_names jsonb;
  v_ids uuid[];
  v_files jsonb;
  v_tables jsonb;
  v_records bigint;
  v_scrubbed integer;
  v_auth uuid[] := '{}';
  v_profiles integer := 0;
  v_del uuid;
  v_block text;
  r record;
  a uuid;
begin
  select * into t from public.pdel_target(p_kind, p_id);
  if t.org_id is null then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if (p_kind = 'athlete' and (select status from public.athletes where id = p_id) = 'erased')
     or (p_kind = 'family' and (select status from public.families where id = p_id) = 'erased') then
    raise exception 'ALREADY_DELETED' using errcode = 'P0001';
  end if;

  -- Sections from the live state (before the archive steps change it).
  v_summary := public.pdel_sections(t.org_id,
    array(select id from public.athletes where id = any(t.athletes) and status not in ('archived', 'erased')),
    case when (select status from public.families where id = t.family_id) = 'active' then t.family_id end);

  -- Archive steps first for whatever is still active.
  if p_kind = 'family' and (select status from public.families where id = p_id) = 'active' then
    v_snap := public.pdel_archive_steps(t.org_id,
      array(select id from public.athletes where family_id = p_id and status not in ('archived', 'erased')), p_id, p_actor);
  elsif p_kind = 'athlete' and (select status from public.athletes where id = p_id) <> 'archived' then
    v_snap := public.pdel_archive_steps(t.org_id, t.athletes, null, p_actor);
  else
    v_snap := '{}'::jsonb;
  end if;

  -- Guardians: those unlinked now plus those unlinked by an earlier archive.
  select coalesce(array_agg(distinct g), '{}') into v_guardians from (
    select jsonb_array_elements_text(coalesce(v_snap -> 'guardians', '[]'))::uuid as g
    union
    select jsonb_array_elements_text(coalesce(d.snapshot -> 'guardians', '[]'))::uuid
      from public.person_deletions d
     where d.org_id = t.org_id and d.status = 'archived' and d.target_id = p_id
  ) s;
  if p_kind = 'athlete' then v_guardians := '{}'; end if;

  -- Plan.
  perform public.pdel_plan_reset();
  foreach a in array t.athletes loop
    insert into _pdel_roots values ('public.athletes'::regclass, a, public.pdel_has_retained_refs('public.athletes', a));
  end loop;
  if t.family_id is not null then
    insert into _pdel_roots values ('public.families'::regclass, t.family_id, public.pdel_has_retained_refs('public.families', t.family_id));
  end if;
  perform public.pdel_plan_build();
  select string_agg(distinct rel::regclass::text, ', ') into v_block from _pdel_block;
  if v_block is not null then
    raise exception 'PERSON_DELETE_BLOCKED: %', v_block using errcode = 'P0001';
  end if;

  v_names := public.pdel_names(t.athletes, t.family_id, v_guardians);
  v_ids := public.pdel_plan_ids();
  v_files := public.pdel_plan_files();
  v_tables := public.pdel_plan_tables();
  select count(*) into v_records from _pdel_rows;

  -- Retained records: scrub names out of their free text.
  v_scrubbed := public.pdel_scrub_retained(v_names);

  -- Delete. Non-tomb roots: Postgres cascades. Tomb roots: their direct
  -- dependents (generation 1) are deleted, then the root is anonymised.
  for r in
    select d.rel, array_agg(d.tid) as tids from _pdel_rows d
     where d.gen = 1
     group by d.rel
  loop
    execute format('delete from %s where ctid = any($1)', r.rel::regclass) using r.tids;
  end loop;
  -- Athletes first (a family delete cascades to them anyway).
  delete from public.athletes where id in (select id from _pdel_roots where rel = 'public.athletes'::regclass and not tomb);
  for r in select id from _pdel_roots where rel = 'public.athletes'::regclass and tomb loop
    perform public.pdel_tombstone('public.athletes', r.id);
  end loop;
  if t.family_id is not null then
    if (select tomb from _pdel_roots where rel = 'public.families'::regclass and id = t.family_id) then
      perform public.pdel_tombstone('public.families', t.family_id);
    else
      delete from public.families where id = t.family_id;
    end if;
  end if;

  -- Guardian logins: a profile that belongs to no other family (any club)
  -- and holds no staff role is anonymised; the server deletes its auth user.
  for r in
    select p.id from public.profiles p
     where p.id = any(v_guardians)
       and not exists (select 1 from public.family_members fm where fm.profile_id = p.id)
       and not exists (select 1 from public.staff_roles sr where sr.profile_id = p.id)
       and not exists (select 1 from public.coaches c where c.profile_id = p.id)
       and not exists (select 1 from public.org_memberships m where m.profile_id = p.id and m.org_id <> t.org_id and m.status = 'active')
  loop
    update public.profiles
       set full_name = '[deleted]', email = 'deleted-' || r.id || '@deleted.invalid', phone = null, is_active = false
     where id = r.id;
    delete from public.org_memberships where profile_id = r.id and org_id = t.org_id;
    v_auth := v_auth || r.id;
    v_profiles := v_profiles + 1;
  end loop;

  -- Audit rows about the removed records keep the event, not the content.
  update public.audit_logs
     set old_data = null, new_data = jsonb_build_object('redacted', 'erasure')
   where org_id = t.org_id and target_id = any(v_ids || v_auth)
     and (old_data is not null or new_data is distinct from jsonb_build_object('redacted', 'erasure'));

  -- Close any archive row of this person (and of its children).
  update public.person_deletions
     set status = 'erased', erased_at = now(), snapshot = null, mode = 'erase'
   where org_id = t.org_id and status = 'archived'
     and (target_id = p_id or (kind = 'athlete' and target_id = any(t.athletes)));
  insert into public.person_deletions (org_id, kind, target_id, family_id, status, mode, summary, requested_by, erased_at)
  select t.org_id, p_kind, p_id, t.family_id, 'erased', 'erase', v_summary, p_actor, now()
   where not exists (select 1 from public.person_deletions where org_id = t.org_id and target_id = p_id and status = 'erased' and erased_at >= now())
  returning id into v_del;
  if v_del is null then
    select id into v_del from public.person_deletions
     where org_id = t.org_id and target_id = p_id and status = 'erased' order by erased_at desc limit 1;
    update public.person_deletions set summary = summary || jsonb_build_object('records', v_records) where id = v_del;
  end if;

  v_summary := v_summary || jsonb_build_object(
    'kind', p_kind, 'id', p_id, 'mode', 'erase', 'deletion_id', v_del,
    'records', v_records, 'tables', v_tables, 'retained_scrubbed', v_scrubbed,
    'profiles_anonymised', v_profiles,
    'tombstone', exists (select 1 from _pdel_roots where id = p_id and tomb));
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (t.org_id, p_actor, 'person.erase', case when p_kind = 'athlete' then 'athletes' else 'families' end, p_id,
          jsonb_build_object('deletion_id', v_del, 'counts', v_summary - 'invoices_cancelled_amounts' - 'tables'));
  return v_summary || jsonb_build_object('files', v_files, 'auth_user_ids', to_jsonb(v_auth));
end $$;

-- ---------------------------------------------------------------------------
-- 9) Client RPCs (admin of the caller's club only)
-- ---------------------------------------------------------------------------
create or replace function public.pdel_check(p_kind text, p_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select org_id into v_org from public.pdel_target(p_kind, p_id);
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return v_org;
end $$;

create or replace function public.preview_delete_athlete(p_athlete uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.pdel_check('athlete', p_athlete);
  return public.pdel_preview('athlete', p_athlete);
end $$;

create or replace function public.preview_delete_family(p_family uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.pdel_check('family', p_family);
  return public.pdel_preview('family', p_family);
end $$;

create or replace function public.delete_athlete(p_athlete uuid, p_mode text default 'archive')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.pdel_check('athlete', p_athlete);
  if coalesce(p_mode, 'archive') = 'archive' then return public.pdel_archive('athlete', p_athlete, auth.uid()); end if;
  if p_mode = 'erase' then return public.pdel_erase('athlete', p_athlete, auth.uid()); end if;
  raise exception 'INVALID_MODE' using errcode = 'P0001';
end $$;

create or replace function public.delete_family(p_family uuid, p_mode text default 'archive')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.pdel_check('family', p_family);
  if coalesce(p_mode, 'archive') = 'archive' then return public.pdel_archive('family', p_family, auth.uid()); end if;
  if p_mode = 'erase' then return public.pdel_erase('family', p_family, auth.uid()); end if;
  raise exception 'INVALID_MODE' using errcode = 'P0001';
end $$;

create or replace function public.remove_guardian(p_family uuid, p_profile uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_primary boolean;
  v_next uuid;
  v_detached boolean := false;
begin
  v_org := public.pdel_check('family', p_family);
  select is_primary into v_primary from public.family_members where family_id = p_family and profile_id = p_profile;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.family_members where family_id = p_family and profile_id = p_profile;
  if v_primary or (select primary_contact_id from public.families where id = p_family) = p_profile then
    select profile_id into v_next from public.family_members where family_id = p_family order by created_at limit 1;
    if v_next is not null then
      update public.family_members set is_primary = (profile_id = v_next) where family_id = p_family;
    end if;
    update public.families set primary_contact_id = v_next where id = p_family;
  end if;
  if not exists (select 1 from public.family_members fm join public.families f on f.id = fm.family_id
                  where fm.profile_id = p_profile and f.org_id = v_org and f.status = 'active') then
    delete from public.staff_roles where org_id = v_org and profile_id = p_profile and role = 'parent';
    v_detached := true;
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'guardian.remove', 'families', p_family,
          jsonb_build_object('profile_id', p_profile, 'login_detached', v_detached));
  return jsonb_build_object('family_id', p_family, 'profile_id', p_profile, 'login_detached', v_detached,
                            'guardians_left', (select count(*) from public.family_members where family_id = p_family));
end $$;

create or replace function public.restore_person(p_deletion uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.person_deletions;
  v_ath uuid[];
  v_tm integer := 0;
  v_fm integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into d from public.person_deletions where id = p_deletion for update;
  if not found or d.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status <> 'archived' then raise exception 'NOT_RESTORABLE' using errcode = 'P0001'; end if;
  if d.kind = 'athlete' and (select status from public.families where id = d.family_id) <> 'active' then
    raise exception 'FAMILY_DELETED' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(x::uuid), '{}') into v_ath from jsonb_array_elements_text(coalesce(d.snapshot -> 'athletes', '[]')) x;
  if d.kind = 'family' then
    update public.families set status = 'active', archived_at = null, archived_by = null,
           primary_contact_id = nullif(d.snapshot ->> 'primary_contact_id', '')::uuid
     where id = d.target_id and org_id = d.org_id;
    insert into public.family_members
      select * from jsonb_populate_recordset(null::public.family_members, coalesce(d.snapshot -> 'family_members', '[]'))
      on conflict do nothing;
    get diagnostics v_fm = row_count;
    insert into public.staff_roles
      select * from jsonb_populate_recordset(null::public.staff_roles, coalesce(d.snapshot -> 'staff_roles', '[]'))
      on conflict do nothing;
  end if;
  update public.athletes set status = 'active', archived_at = null, archived_by = null
   where id = any(v_ath) and org_id = d.org_id and status = 'archived';
  insert into public.team_memberships
    select * from jsonb_populate_recordset(null::public.team_memberships, coalesce(d.snapshot -> 'team_memberships', '[]'))
    on conflict do nothing;
  get diagnostics v_tm = row_count;
  update public.invoices set reminders_paused = false
   where org_id = d.org_id and reminders_paused
     and id in (select jsonb_array_elements_text(coalesce(d.snapshot -> 'paused_invoices', '[]'))::uuid)
     and status::text in ('draft', 'pending', 'sent', 'overdue', 'partially_paid');

  update public.person_deletions set status = 'restored', restored_at = now(), restored_by = auth.uid(), snapshot = null
   where id = d.id;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (d.org_id, auth.uid(), 'person.restore', case when d.kind = 'athlete' then 'athletes' else 'families' end, d.target_id,
          jsonb_build_object('deletion_id', d.id, 'teams', v_tm, 'guardians', v_fm));
  return jsonb_build_object('deletion_id', d.id, 'kind', d.kind, 'id', d.target_id, 'athletes', coalesce(array_length(v_ath, 1), 0),
                            'teams', v_tm, 'guardians', v_fm);
end $$;

-- "Delete now" from the Recently deleted page.
create or replace function public.erase_person_deletion(p_deletion uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare d public.person_deletions;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into d from public.person_deletions where id = p_deletion;
  if not found or d.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if d.status <> 'archived' then raise exception 'NOT_RESTORABLE' using errcode = 'P0001'; end if;
  return public.pdel_erase(d.kind, d.target_id, auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- 10) Scheduled purge (service role; called by the daily club-admin cron)
-- ---------------------------------------------------------------------------
create or replace function public.purge_due_person_deletions(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d record;
  v jsonb := '[]'::jsonb;
  res jsonb;
begin
  for d in
    select * from public.person_deletions
     where status = 'archived' and purge_after <= now()
     order by purge_after
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    -- An athlete archived together with its family is erased with the family.
    if d.kind = 'athlete' and exists (select 1 from public.person_deletions f
                                       where f.kind = 'family' and f.status = 'archived' and f.target_id = d.family_id) then
      continue;
    end if;
    begin
      res := public.pdel_erase(d.kind, d.target_id, null);
      v := v || jsonb_build_array(jsonb_build_object('org_id', d.org_id, 'deletion_id', d.id, 'ok', true,
             'files', res -> 'files', 'auth_user_ids', res -> 'auth_user_ids'));
    exception when others then
      v := v || jsonb_build_array(jsonb_build_object('org_id', d.org_id, 'deletion_id', d.id, 'ok', false, 'error', sqlerrm));
    end;
  end loop;
  return v;
end $$;

-- Archived people whose erasure is due within p_days and whose admins have
-- not been told yet. Marks them as notified.
create or replace function public.person_deletions_due_notice(p_days integer default 3)
returns table (org_id uuid, deletion_id uuid, kind text, purge_after timestamptz)
language sql
security definer
set search_path = public
as $$
  update public.person_deletions d
     set purge_notified_at = now()
   where d.status = 'archived' and d.purge_notified_at is null
     and d.purge_after <= now() + make_interval(days => greatest(0, coalesce(p_days, 3)))
  returning d.org_id, d.id, d.kind, d.purge_after
$$;

-- ---------------------------------------------------------------------------
-- 11) Grants: client RPCs check role + org; internals for nobody.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.pdel_retained_tables()', 'public.pdel_immutable_tables()', 'public.pdel_storage_columns()',
    'public.pdel_fk_join(oid)', 'public.pdel_plan_reset()', 'public.pdel_has_retained_refs(regclass, uuid)',
    'public.pdel_plan_build()', 'public.pdel_not_tomb(oid, oid[])', 'public.pdel_plan_tables()', 'public.pdel_plan_ids()', 'public.pdel_plan_files()',
    'public.pdel_scrub(text, jsonb)', 'public.pdel_retained_rows()', 'public.pdel_scrub_retained(jsonb)',
    'public.pdel_open_invoice_statuses()', 'public.pdel_sections(uuid, uuid[], uuid)',
    'public.pdel_cancel_invoice(uuid, text)', 'public.pdel_cancel_booking(uuid, text, uuid)',
    'public.pdel_archive_steps(uuid, uuid[], uuid, uuid)', 'public.pdel_target(text, uuid)',
    'public.pdel_names(uuid[], uuid, uuid[])', 'public.pdel_tombstone(regclass, uuid)',
    'public.pdel_preview(text, uuid)', 'public.pdel_archive(text, uuid, uuid)', 'public.pdel_erase(text, uuid, uuid)',
    'public.pdel_check(text, uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon, authenticated', f); end if;
  end loop;
  foreach f in array array[
    'public.preview_delete_athlete(uuid)', 'public.preview_delete_family(uuid)',
    'public.delete_athlete(uuid, text)', 'public.delete_family(uuid, text)',
    'public.remove_guardian(uuid, uuid)', 'public.restore_person(uuid)', 'public.erase_person_deletion(uuid)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', f);
      execute format('grant execute on function %s to authenticated, service_role', f);
    end if;
  end loop;
  foreach f in array array['public.purge_due_person_deletions(integer)', 'public.person_deletions_due_notice(integer)'] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
