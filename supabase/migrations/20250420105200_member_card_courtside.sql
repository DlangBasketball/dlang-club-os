-- ============================================================================
-- "Courtside" member card: card brands per billing entity, brand resolution
-- from memberships / enrolments / packages, a card read for guardians,
-- admins and the player, and card check-in on team / session attendance
-- sheets. Additive and idempotent.
--
--   1) member_card_brands: one brand per billing entity (display name,
--      optional second line, logo + watermark paths). Brands are DATA: no
--      tenant or brand is named in code.
--   2) Private storage bucket "member-card-brands" for logos, path
--      <org_id>/<billing_entity_id>/<file>; members of the org read through
--      signed URLs, admins write.
--   3) member_card_brand_sources(org, athlete) [internal]: eligible brands of
--      an athlete:
--        * active club membership (today within valid_from..valid_until)
--          -> the entity of its invoice (not a migration default), else the
--             entity routed for club_membership
--        * enrolled selection application (programme active, not ended)
--          -> entity routed for 'selection'
--        * active training package (not expired, sessions left)
--          -> entity routed for 'training'
--   4) member_card_courtside(athlete): card JSON for an admin, a guardian of
--      the athlete or the athlete's own player login. Builds the token from
--      the EXISTING credential (member_cards nonce + version, club key);
--      issues a card only when none exists, never rotates.
--   5) member_card_brand_save(payload): admin upsert of a brand (audited).
--   6) member_card_check_in(event, token, request_id): a coach / admin who
--      can run the event scans a card; the athlete is marked present on the
--      event's attendance sheet through attendance_open + attendance_save
--      (the same rows the roster, history, stats and follow-ups read).
--      Repeated scans are no-ops (already present).
--
-- Personal data: no new personal data columns. The card photo stays the
-- athlete identification photo (private bucket "athlete-photos").
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) member_card_brands
-- ---------------------------------------------------------------------------
create table if not exists public.member_card_brands (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  billing_entity_id uuid not null references public.billing_entities(id) on delete cascade,
  display_name      text not null,
  subtitle          text,
  logo_path         text,
  watermark_path    text,
  updated_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint member_card_brands_entity_key unique (billing_entity_id)
);
create index if not exists idx_member_card_brands_org on public.member_card_brands (org_id);

do $$ begin
  alter table public.member_card_brands add constraint member_card_brands_chk check (
    length(btrim(display_name)) between 1 and 60
    and coalesce(length(subtitle), 0) <= 80
    and (logo_path is null or length(logo_path) <= 300)
    and (watermark_path is null or length(watermark_path) <= 300));
exception when duplicate_object then null; end $$;

-- The billing entity must belong to the same org.
create or replace function public.member_card_brands_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.billing_entities e where e.id = new.billing_entity_id and e.org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: billing_entity_id' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_member_card_brands_guard on public.member_card_brands;
create trigger trg_member_card_brands_guard before insert or update on public.member_card_brands
  for each row execute function public.member_card_brands_guard();
drop trigger if exists trg_member_card_brands_updated on public.member_card_brands;
create trigger trg_member_card_brands_updated before update on public.member_card_brands
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_member_card_brands on public.member_card_brands;
create trigger trg_audit_member_card_brands after insert or update or delete on public.member_card_brands
  for each row execute function public.audit_trigger();

alter table public.member_card_brands enable row level security;
alter table public.member_card_brands force row level security;

drop policy if exists platform_tenant_isolation on public.member_card_brands;
create policy platform_tenant_isolation on public.member_card_brands as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
-- Staff with billing access read; admins manage. Families read their card's
-- brand through member_card_courtside() only.
drop policy if exists member_card_brands_select on public.member_card_brands;
create policy member_card_brands_select on public.member_card_brands for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists member_card_brands_insert on public.member_card_brands;
create policy member_card_brands_insert on public.member_card_brands for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists member_card_brands_update on public.member_card_brands;
create policy member_card_brands_update on public.member_card_brands for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists member_card_brands_delete on public.member_card_brands;
create policy member_card_brands_delete on public.member_card_brands for delete
  using (org_id = public.current_org_id() and public.is_admin());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on public.member_card_brands to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.member_card_brands from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.member_card_brands to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Storage: private bucket for brand logos
-- ---------------------------------------------------------------------------
-- <org_id>/<billing_entity_id>/<file>.(png|webp|jpg|jpeg)
create or replace function public.member_card_brand_path_ok(p_name text, p_org uuid, p_entity uuid)
returns boolean language sql immutable set search_path = public as $$
  select p_name is not null and p_org is not null and p_entity is not null
     and p_name ~ ('^' || p_org::text || '/' || p_entity::text || '/[A-Za-z0-9_-]{1,80}\.(png|webp|jpg|jpeg)$');
$$;

create or replace function public.member_card_brand_asset_access(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
  v_re    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_org   uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null or p_name is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 then return false; end if;
  if v_parts[1] !~ v_re or v_parts[2] !~ v_re then return false; end if;
  if v_parts[1]::uuid is distinct from v_org then return false; end if;
  if not exists (select 1 from public.billing_entities e where e.id = v_parts[2]::uuid and e.org_id = v_org) then return false; end if;
  if p_write then
    return public.is_admin() and public.member_card_brand_path_ok(p_name, v_org, v_parts[2]::uuid);
  end if;
  return true; -- logos carry no personal data: any signed-in member of the org
end $$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('member-card-brands', 'member-card-brands', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 1048576 where id = 'member-card-brands'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['image/jpeg','image/webp','image/png']
                 where id = 'member-card-brands'$q$;
    end if;
  end if;
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists member_card_brands_obj_select on storage.objects$p$;
    execute $p$create policy member_card_brands_obj_select on storage.objects for select to authenticated
      using (bucket_id = 'member-card-brands' and public.member_card_brand_asset_access(name, false))$p$;
    execute $p$drop policy if exists member_card_brands_obj_insert on storage.objects$p$;
    execute $p$create policy member_card_brands_obj_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'member-card-brands' and public.member_card_brand_asset_access(name, true))$p$;
    execute $p$drop policy if exists member_card_brands_obj_update on storage.objects$p$;
    execute $p$create policy member_card_brands_obj_update on storage.objects for update to authenticated
      using (bucket_id = 'member-card-brands' and public.member_card_brand_asset_access(name, true))
      with check (bucket_id = 'member-card-brands' and public.member_card_brand_asset_access(name, true))$p$;
    execute $p$drop policy if exists member_card_brands_obj_delete on storage.objects$p$;
    execute $p$create policy member_card_brands_obj_delete on storage.objects for delete to authenticated
      using (bucket_id = 'member-card-brands' and public.member_card_brand_asset_access(name, true))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Brand resolution (internal)
-- ---------------------------------------------------------------------------
create or replace function public.member_card_brand_sources(p_org uuid, p_athlete uuid)
returns table (billing_entity_id uuid, source text, sort_key integer)
language sql stable security definer set search_path = public as $$
  with today as (select public.ta_today(p_org) as d),
  src as (
    -- active club membership (season fee or legacy typed membership)
    select coalesce(
             (select i.billing_entity_id from public.invoices i
               where i.org_id = m.org_id and (i.membership_id = m.id or i.id = m.invoice_id)
                 and i.billing_entity_id is not null
                 and coalesce(i.billing_entity_source, '') <> 'migration_default'
                 and i.status::text not in ('void', 'cancelled', 'refunded')
               order by i.created_at limit 1),
             public.billing_entity_resolve(p_org, 'club_membership')) as entity,
           'club_membership'::text as source, 1 as sort_key
      from public.memberships m, today
     where m.org_id = p_org and m.athlete_id = p_athlete and m.status = 'active'
       and today.d between m.valid_from and m.valid_until
    union all
    -- enrolled selection programme (e.g. EYBL)
    select public.billing_entity_resolve(p_org, 'selection'), 'selection', 2
      from public.program_applications pa
      join public.programs p on p.id = pa.program_id and p.org_id = pa.org_id, today
     where pa.org_id = p_org and pa.athlete_id = p_athlete and pa.status = 'enrolled'
       and p.is_active and (p.ends_on is null or p.ends_on >= today.d)
    union all
    -- active training package
    select public.billing_entity_resolve(p_org, 'training'), 'training', 3
      from public.training_package_purchases tp
     where tp.org_id = p_org and tp.athlete_id = p_athlete and tp.status = 'active'
       and (tp.expires_at is null or tp.expires_at > now()) and tp.sessions_used < tp.sessions
  )
  select s.entity, s.source, min(s.sort_key)
    from src s
    join public.billing_entities e on e.id = s.entity and e.org_id = p_org and e.is_active
   where s.entity is not null
   group by s.entity, s.source;
$$;

-- Card brands of an athlete as JSON (internal): eligible entities first (by
-- source order), or the club's default entity as a fallback.
create or replace function public.member_card_brands_json(p_org uuid, p_athlete uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_out jsonb;
  v_default uuid;
begin
  select coalesce(jsonb_agg(x.b order by x.k, x.n), '[]'::jsonb) into v_out
    from (
      select min(s.sort_key) as k, e.name as n,
             jsonb_build_object(
               'billing_entity_id', e.id,
               'entity_name', e.name,
               'display_name', coalesce(b.display_name, e.name),
               'subtitle', b.subtitle,
               'logo_path', b.logo_path,
               'watermark_path', coalesce(b.watermark_path, b.logo_path),
               'sources', to_jsonb(array_agg(s.source order by s.sort_key)),
               'is_fallback', false) as b
        from public.member_card_brand_sources(p_org, p_athlete) s
        join public.billing_entities e on e.id = s.billing_entity_id
        left join public.member_card_brands b on b.billing_entity_id = e.id and b.org_id = p_org
       group by e.id, e.name, b.display_name, b.subtitle, b.logo_path, b.watermark_path
    ) x;
  if jsonb_array_length(v_out) > 0 then return v_out; end if;

  v_default := public.billing_entity_resolve(p_org, 'club_membership');
  if v_default is null then return '[]'::jsonb; end if;
  select jsonb_build_array(jsonb_build_object(
           'billing_entity_id', e.id, 'entity_name', e.name,
           'display_name', coalesce(b.display_name, e.name), 'subtitle', b.subtitle,
           'logo_path', b.logo_path, 'watermark_path', coalesce(b.watermark_path, b.logo_path),
           'sources', '[]'::jsonb, 'is_fallback', true))
    into v_out
    from public.billing_entities e
    left join public.member_card_brands b on b.billing_entity_id = e.id and b.org_id = p_org
   where e.id = v_default;
  return coalesce(v_out, '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 4) Card read: admin, guardian of the athlete, or the athlete's player login
-- ---------------------------------------------------------------------------
create or replace function public.member_card_courtside(p_athlete uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  a      public.athletes%rowtype;
  c      public.member_cards%rowtype;
  v_org  uuid := public.current_org_id();
  v_tok  text;
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into a from public.athletes where id = p_athlete;
  if not found or a.org_id is distinct from v_org then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or public.is_guardian_of_athlete(p_athlete) or coalesce(a.player_profile_id = auth.uid(), false)) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  select * into c from public.member_cards where athlete_id = p_athlete;
  if not found then
    -- First use: issue exactly like member_card_token() (no rotation ever here).
    insert into public.member_cards (org_id, athlete_id, nonce) values (v_org, p_athlete, encode(gen_random_bytes(16), 'hex'))
    on conflict (athlete_id) do nothing;
    select * into c from public.member_cards where athlete_id = p_athlete;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_org, auth.uid(), 'MEMBER_CARD_ISSUED', 'member_cards', c.id, jsonb_build_object('athlete_id', p_athlete));
  end if;
  if c.is_active then
    v_tok := 'M1.' || c.nonce || '.' || public.member_card_sign(v_org, c.nonce, c.version);
  end if;

  return jsonb_build_object(
    'athlete_id', a.id,
    'first_name', a.first_name,
    'last_name', a.last_name,
    'token', v_tok,
    'card_active', c.is_active,
    'photo_path', a.photo_path,
    'brands', public.member_card_brands_json(v_org, p_athlete));
end $$;

-- ---------------------------------------------------------------------------
-- 5) Brand save (admin)
-- ---------------------------------------------------------------------------
create or replace function public.member_card_brand_save(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_org     uuid := public.current_org_id();
  v_entity  uuid;
  v_name    text := nullif(btrim(coalesce(p_payload->>'display_name', '')), '');
  v_sub     text := nullif(btrim(coalesce(p_payload->>'subtitle', '')), '');
  v_logo    text := nullif(btrim(coalesce(p_payload->>'logo_path', '')), '');
  v_mark    text := nullif(btrim(coalesce(p_payload->>'watermark_path', '')), '');
  b         public.member_card_brands%rowtype;
begin
  if auth.uid() is null or v_org is null or not public.is_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  begin
    v_entity := (p_payload->>'billing_entity_id')::uuid;
  exception when others then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end;
  if v_entity is null or not exists (select 1 from public.billing_entities e where e.id = v_entity and e.org_id = v_org) then
    raise exception 'ENTITY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_name is null then
    select name into v_name from public.billing_entities where id = v_entity;
  end if;
  if length(v_name) > 60 or length(coalesce(v_sub, '')) > 80 then raise exception 'BRAND_TOO_LONG' using errcode = 'P0001'; end if;
  if (v_logo is not null and not public.member_card_brand_path_ok(v_logo, v_org, v_entity))
     or (v_mark is not null and not public.member_card_brand_path_ok(v_mark, v_org, v_entity)) then
    raise exception 'INVALID_LOGO_PATH' using errcode = 'P0001';
  end if;

  insert into public.member_card_brands (org_id, billing_entity_id, display_name, subtitle, logo_path, watermark_path, updated_by)
  values (v_org, v_entity, left(v_name, 60), v_sub, v_logo, v_mark, auth.uid())
  on conflict (billing_entity_id) do update
     set display_name = excluded.display_name, subtitle = excluded.subtitle, logo_path = excluded.logo_path,
         watermark_path = excluded.watermark_path, updated_by = excluded.updated_by
  returning * into b;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'member_card.brand.save', 'member_card_brands', b.id,
          jsonb_build_object('billing_entity_id', v_entity, 'has_logo', v_logo is not null, 'has_watermark', v_mark is not null));

  return jsonb_build_object('id', b.id, 'billing_entity_id', b.billing_entity_id, 'display_name', b.display_name,
                            'subtitle', b.subtitle, 'logo_path', b.logo_path, 'watermark_path', b.watermark_path);
end $$;

-- ---------------------------------------------------------------------------
-- 6) Card check-in on an attendance sheet
-- ---------------------------------------------------------------------------
create or replace function public.member_card_check_in(p_event uuid, p_token text, p_request_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_ev    public.events%rowtype;
  v_tok   text := btrim(coalesce(p_token, ''));
  v_parts text[];
  v_tag   text;
  c       public.member_cards%rowtype;
  s       public.team_attendance_sheets%rowtype;
  m       public.team_attendance_marks%rowtype;
  v_name  text;
  v_res   jsonb;
begin
  -- Same checks as every sheet write: org, ta_can_run (admin / coach who
  -- runs the event / approved substitute), sheet event type.
  v_ev := public.ta_event_for_write(p_event);
  if length(v_tok) = 0 or length(v_tok) > 200 then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD'); end if;

  if v_tok ~ '^M1\.[0-9a-f]{32}\.[0-9a-f]{32}$' then
    v_parts := string_to_array(v_tok, '.');
    select * into c from public.member_cards mc where mc.nonce = v_parts[2] and mc.org_id = v_ev.org_id and mc.is_active;
    if not found or public.member_card_sign(v_ev.org_id, c.nonce, c.version) <> v_parts[3] then
      return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD');
    end if;
  else
    v_tag := nullif(upper(regexp_replace(v_tok, '[^0-9A-Fa-f]', '', 'g')), '');
    if v_tag is null or length(v_tag) < 4 then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD'); end if;
    select * into c from public.member_cards mc where mc.nfc_tag_id = v_tag and mc.org_id = v_ev.org_id and mc.is_active;
    if not found then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD'); end if;
  end if;

  perform public.attendance_open(p_event);
  select * into s from public.team_attendance_sheets where event_id = p_event;
  select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = c.athlete_id;
  if found or public.is_admin() or public.coach_can_access_athlete(c.athlete_id) then
    select btrim(first_name || ' ' || last_name) into v_name from public.athletes where id = c.athlete_id;
  end if;
  if m.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_ON_SHEET', 'athlete_id', case when v_name is not null then c.athlete_id end,
                              'name', v_name);
  end if;
  if s.status = 'final' then
    return jsonb_build_object('ok', false, 'code', 'SHEET_FINAL', 'athlete_id', c.athlete_id, 'name', v_name, 'status', m.finalized_status);
  end if;
  if m.status in ('present', 'late') then
    return jsonb_build_object('ok', true, 'already', true, 'athlete_id', c.athlete_id, 'name', v_name, 'status', m.status,
                              'version', s.version);
  end if;

  v_res := public.attendance_save(p_event,
             jsonb_build_array(jsonb_build_object('athlete_id', c.athlete_id, 'status', 'present', 'base_rev', m.rev)),
             s.version, p_request_id, false);
  if jsonb_array_length(coalesce(v_res->'conflicts', '[]'::jsonb)) > 0 then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'athlete_id', c.athlete_id, 'name', v_name);
  end if;
  if jsonb_array_length(coalesce(v_res->'applied', '[]'::jsonb)) > 0 then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_ev.org_id, auth.uid(), 'MEMBER_CARD_CHECK_IN', 'team_attendance_marks', m.id,
            jsonb_build_object('event_id', p_event, 'athlete_id', c.athlete_id));
  end if;
  return jsonb_build_object('ok', true, 'already', coalesce((v_res->>'replayed')::boolean, false),
                            'athlete_id', c.athlete_id, 'name', v_name, 'status', 'present', 'version', v_res->'version');
end $$;

-- ---------------------------------------------------------------------------
-- 7) EXECUTE grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.member_card_courtside(uuid)',
    'public.member_card_brand_save(jsonb)',
    'public.member_card_check_in(uuid, text, uuid)',
    'public.member_card_brand_asset_access(text, boolean)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  foreach f in array array[
    'public.member_card_brand_sources(uuid, uuid)',
    'public.member_card_brands_json(uuid, uuid)',
    'public.member_card_brands_guard()'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  execute 'grant execute on function public.member_card_brand_path_ok(text, uuid, uuid) to public';
end $$;
