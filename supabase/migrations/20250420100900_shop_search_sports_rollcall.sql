-- ============================================================================
-- Online shop, training discounts, sports & locations, global search,
-- member cards (QR / NFC roll call).
--
--   1) helpers: search_fold() (accent / case folding for search)
--   2) sports: per-club list (name, icon, default terminology, active) and a
--      nullable sport_id on teams, programmes, assessment templates,
--      exercises and training plans, backfilled where the free-text sport
--      matches a sport name. The text columns stay (nothing breaks).
--   3) venues: map link + optional photo (locations admin page)
--   4) public media bucket "club-media": product + venue photos only (no
--      personal data); anyone reads by URL, admins of the folder's club write
--   5) discounts: scope 'shop' (check widened additively), applied_discounts
--      source 'shop'; discount_evaluate(): one SQL evaluator for the shared
--      model (scope, validity, early bird, manual, promo + usage limits with
--      a row lock), mirroring src/lib/pricing/discounts.ts
--   6) shop: products, variants (SKU, stock >= 0, low-stock threshold),
--      stock movements, orders, order items; shop_place_order() (service
--      role: guest or member, stock reserved, invoice with discount lines),
--      shop_set_order_status(), shop_adjust_stock(); invoice status drives
--      the order (paid / cancelled / refunded) and releases stock
--   7) training: training_purchase_discount() now evaluates the shared
--      discounts; purchase_training_package() / book_training() take an
--      optional promo code (and manual discounts for admins) and record
--      applied_discounts (source training_package / booking)
--   8) global_search(): tenant-scoped, role-aware, accent-insensitive
--   9) member cards: opaque HMAC-signed token per athlete (rotatable), NFC
--      tag id; resolve_member_token() resolves only inside the caller's club
--      and only athletes the coach may access
--
-- Additive and idempotent. Every policy and RPC resolves the club from the
-- session (current_org_id()) or, for service-role RPCs, from data the
-- server resolved (the org owning the requested shop slug).
-- ============================================================================

-- ===========================================================================
-- 1) Helpers
-- ===========================================================================
-- Lower-case and strip common Latin accents (no extension needed).
create or replace function public.search_fold(p text)
returns text
language sql
immutable
parallel safe
set search_path = public
as $$
  select translate(lower(coalesce(p, '')),
    'àáâãäåāăąçćčďèéêëēėęěìíîïīįłñńňòóôõöøōőŕřśšşťùúûüūůűųýÿžźżß',
    'aaaaaaaaacccdeeeeeeeeiiiiiilnnnooooooooorrsssstuuuuuuuuyyzzzs');
$$;

-- ===========================================================================
-- 2) SPORTS
-- ===========================================================================
create table if not exists public.sports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null,
  icon         text,                                  -- key from src/lib/sports/icons.ts
  terminology  jsonb not null default '{}'::jsonb,    -- {"athlete": "player", "team": "squad", ...}
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_sports_org on public.sports(org_id);
create unique index if not exists sports_org_name_uidx on public.sports(org_id, lower(name));
do $$ begin
  alter table public.sports add constraint sports_chk
    check (length(btrim(name)) between 1 and 60
       and (icon is null or icon ~ '^[a-z0-9-]{1,40}$')
       and jsonb_typeof(terminology) = 'object'
       and sort_order between 0 and 10000);
exception when duplicate_object then null; end $$;
drop trigger if exists trg_sports_updated on public.sports;
create trigger trg_sports_updated before update on public.sports
  for each row execute function public.set_updated_at();

alter table public.sports enable row level security;
drop policy if exists sports_select on public.sports;
create policy sports_select on public.sports for select using (org_id = public.current_org_id());
drop policy if exists sports_insert on public.sports;
create policy sports_insert on public.sports for insert with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists sports_update on public.sports;
create policy sports_update on public.sports for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists sports_delete on public.sports;
create policy sports_delete on public.sports for delete using (org_id = public.current_org_id() and public.is_admin());

-- sport_id on every table that already carries a free-text sport.
do $$
declare t text;
begin
  foreach t in array array['teams', 'programs', 'assessment_templates', 'exercises', 'training_plans'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists sport_id uuid references public.sports(id) on delete set null', t);
      execute format('create index if not exists %I on public.%I(sport_id) where sport_id is not null', 'idx_' || t || '_sport', t);
    end if;
  end loop;
end $$;

-- The sport of a row must belong to the row's club.
create or replace function public.sport_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sport_id is not null
     and not exists (select 1 from public.sports s where s.id = new.sport_id and s.org_id = new.org_id) then
    raise exception 'CROSS_ORG_REFERENCE: sport_id' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['teams', 'programs', 'assessment_templates', 'exercises', 'training_plans'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_sport_org', t);
      execute format('create trigger %I before insert or update of sport_id on public.%I
                        for each row execute function public.sport_same_org_guard()', 'trg_' || t || '_sport_org', t);
    end if;
  end loop;
end $$;

-- Backfill: the club's own sport becomes its first sport; rows whose
-- free-text sport equals a sport name get that sport_id.
insert into public.sports (org_id, name)
select o.id, initcap(btrim(o.sport))
  from public.organizations o
 where nullif(btrim(coalesce(o.sport, '')), '') is not null
   and length(btrim(o.sport)) <= 60
   and not exists (select 1 from public.sports s where s.org_id = o.id)
on conflict do nothing;

do $$
declare t text;
begin
  foreach t in array array['teams', 'assessment_templates', 'exercises', 'training_plans'] loop
    if to_regclass('public.' || t) is not null then
      execute format(
        'update public.%I x set sport_id = s.id
           from public.sports s
          where x.sport_id is null and x.sport is not null and s.org_id = x.org_id
            and public.search_fold(btrim(x.sport)) = public.search_fold(btrim(s.name))', t);
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 3) VENUES: map link + photo (locations admin)
-- ===========================================================================
alter table public.venues
  add column if not exists map_url    text,
  add column if not exists photo_path text;
do $$ begin
  alter table public.venues add constraint venues_map_url_chk
    check (map_url is null or (map_url ~ '^https://' and length(map_url) <= 500));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.venues add constraint venues_photo_path_chk
    check (photo_path is null or length(photo_path) <= 300);
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 4) PUBLIC MEDIA BUCKET (product + venue photos; never personal data)
--    Path: <org_id>/<products|venues>/<file>. Reads by public URL; only the
--    club's admins write in their club's folder.
-- ===========================================================================
create or replace function public.club_media_can_write(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public.is_admin()
     and split_part(coalesce(p_name, ''), '/', 1) = public.current_org_id()::text
     and split_part(coalesce(p_name, ''), '/', 2) in ('products', 'venues')
     and p_name !~ '\.\.';
$$;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('club-media', 'club-media', true)
      on conflict (id) do update set public = true;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 3145728 where id = 'club-media'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['image/jpeg','image/webp','image/png'] where id = 'club-media'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists club_media_select on storage.objects$p$;
    execute $p$create policy club_media_select on storage.objects for select to authenticated
      using (bucket_id = 'club-media' and public.club_media_can_write(name))$p$;
    execute $p$drop policy if exists club_media_insert on storage.objects$p$;
    execute $p$create policy club_media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'club-media' and public.club_media_can_write(name))$p$;
    execute $p$drop policy if exists club_media_update on storage.objects$p$;
    execute $p$create policy club_media_update on storage.objects for update to authenticated
      using (bucket_id = 'club-media' and public.club_media_can_write(name))
      with check (bucket_id = 'club-media' and public.club_media_can_write(name))$p$;
    execute $p$drop policy if exists club_media_delete on storage.objects$p$;
    execute $p$create policy club_media_delete on storage.objects for delete to authenticated
      using (bucket_id = 'club-media' and public.club_media_can_write(name))$p$;
  end if;
end $$;

-- ===========================================================================
-- 5) DISCOUNTS: 'shop' scope, 'shop' source, shared evaluator
-- ===========================================================================
alter table public.discounts drop constraint if exists discounts_scope_chk;
alter table public.discounts add constraint discounts_scope_chk
  check (scope in ('all', 'camps', 'training', 'program', 'service', 'shop')
     and (scope <> 'program' or scope_program_id is not null)
     and (scope <> 'service' or scope_service_id is not null));

alter table public.applied_discounts drop constraint if exists applied_discounts_chk;
alter table public.applied_discounts add constraint applied_discounts_chk
  check (amount > 0 and currency ~ '^[A-Z]{3}$'
     and source in ('registration', 'training_package', 'booking', 'shop', 'other')
     and coalesce(length(reason), 0) <= 500 and coalesce(length(void_reason), 0) <= 500);

-- Evaluate the club's discounts for one subject (list price in p_currency).
--   p_subject   'shop' | 'training' | 'camp' | 'program'
--   p_code      entered promo code (null = none)
--   p_family    family whose per-family promo limit counts
--   p_starts_on first day of what is sold (early bird "N days before")
--   p_manual    manual discounts picked by an admin (caller checks the role)
--   p_lock      lock promo discount rows (usage limits; call inside the
--               writing transaction)
-- Returns {discount_total, discount_ids, label, lines:[{discount_id, name,
-- rule, code, kind, value, amount}], promo: none|applied|<REJECTION>}.
-- Sibling discounts belong to registrations and are not evaluated here.
create or replace function public.discount_evaluate(
  p_org uuid, p_subject text, p_program uuid, p_service uuid, p_list numeric, p_currency text,
  p_code text, p_family uuid, p_starts_on date, p_manual uuid[], p_lock boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_cur    text := upper(coalesce(nullif(btrim(p_currency), ''), public.org_currency(p_org)));
  v_exp    int := public.currency_exponent(upper(coalesce(nullif(btrim(p_currency), ''), public.org_currency(p_org))));
  v_list   numeric;
  v_code   text := upper(nullif(btrim(coalesce(p_code, '')), ''));
  v_promo  text;
  d        public.discounts%rowtype;
  v_amt    numeric;
  v_used   int;
  v_cands  jsonb := '[]'::jsonb;
  v_stack  numeric := 0;
  v_solo   jsonb;
  v_chosen jsonb;
  v_left   numeric;
  v_take   numeric;
  v_lines  jsonb := '[]'::jsonb;
  v_ids    jsonb := '[]'::jsonb;
  v_label  text;
  c        jsonb;
begin
  v_list := round(greatest(coalesce(p_list, 0), 0), v_exp);
  v_promo := case when v_code is null then 'none' else 'UNKNOWN_CODE' end;

  for d in select * from public.discounts x
            where x.org_id = p_org and x.is_active and x.rule <> 'sibling'
            order by x.id
  loop
    -- scope
    if not (d.scope = 'all'
            or (d.scope = 'shop' and p_subject = 'shop')
            or (d.scope = 'training' and p_subject = 'training')
            or (d.scope = 'camps' and p_subject = 'camp')
            or (d.scope = 'program' and p_program is not null and d.scope_program_id = p_program)
            or (d.scope = 'service' and p_service is not null and d.scope_service_id = p_service)) then
      if d.rule = 'promo_code' and d.code = v_code then v_promo := 'OUT_OF_SCOPE'; end if;
      continue;
    end if;
    if d.valid_from is not null and now() < d.valid_from then
      if d.rule = 'promo_code' and d.code = v_code then v_promo := 'NOT_YET_VALID'; end if;
      continue;
    end if;
    if d.valid_until is not null and now() > d.valid_until then
      if d.rule = 'promo_code' and d.code = v_code then v_promo := 'EXPIRED'; end if;
      continue;
    end if;
    if d.kind = 'fixed_amount' and d.currency is distinct from v_cur then
      if d.rule = 'promo_code' and d.code = v_code then v_promo := 'CURRENCY_MISMATCH'; end if;
      continue;
    end if;

    if d.rule = 'early_bird' then
      if d.early_bird_days_before is not null
         and (p_starts_on is null or current_date > p_starts_on - d.early_bird_days_before) then
        continue;
      end if;
    elsif d.rule = 'manual' then
      if p_manual is null or not (d.id = any(p_manual)) then continue; end if;
    elsif d.rule = 'promo_code' then
      if v_code is null or d.code is distinct from v_code then continue; end if;
      if p_lock then perform 1 from public.discounts where id = d.id for update; end if;
      if d.max_redemptions is not null then
        select count(*) into v_used from public.applied_discounts where discount_id = d.id and voided_at is null;
        if v_used >= d.max_redemptions then v_promo := 'LIMIT_REACHED'; continue; end if;
      end if;
      if d.max_redemptions_per_family is not null and p_family is not null then
        select count(*) into v_used from public.applied_discounts
         where discount_id = d.id and family_id = p_family and voided_at is null;
        if v_used >= d.max_redemptions_per_family then v_promo := 'FAMILY_LIMIT_REACHED'; continue; end if;
      end if;
      v_promo := 'CANDIDATE';
    else
      continue;
    end if;

    v_amt := case when d.kind = 'percent' then round(v_list * least(d.value, 100) / 100, v_exp)
                  else least(round(d.value, v_exp), v_list) end;
    v_amt := least(greatest(v_amt, 0), v_list);
    if v_amt > 0 then
      v_cands := v_cands || jsonb_build_object(
        'discount_id', d.id, 'name', d.name, 'rule', d.rule,
        'code', case when d.rule = 'promo_code' then d.code end,
        'kind', d.kind, 'value', d.value, 'amount', v_amt, 'stackable', d.stackable,
        'ord', case d.rule when 'early_bird' then 0 when 'promo_code' then 2 else 3 end);
    end if;
  end loop;

  -- stackable ones add up; a non-stackable one wins alone when worth more
  select coalesce(sum((x->>'amount')::numeric), 0) into v_stack
    from jsonb_array_elements(v_cands) x where (x->>'stackable')::boolean;
  select x into v_solo from jsonb_array_elements(v_cands) x
   where not (x->>'stackable')::boolean order by (x->>'amount')::numeric desc, x->>'discount_id' limit 1;
  if v_solo is not null and (v_solo->>'amount')::numeric > v_stack then
    v_chosen := jsonb_build_array(v_solo);
  else
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_chosen from jsonb_array_elements(v_cands) x where (x->>'stackable')::boolean;
  end if;

  -- order as the TypeScript twin (rule, name, id) and cap at the list price
  v_left := v_list;
  for c in select x from jsonb_array_elements(v_chosen) x
            order by (x->>'ord')::int, x->>'name', x->>'discount_id'
  loop
    v_take := least((c->>'amount')::numeric, v_left);
    continue when v_take <= 0;
    v_left := v_left - v_take;
    v_lines := v_lines || jsonb_build_object(
      'discount_id', c->>'discount_id', 'name', c->>'name', 'rule', c->>'rule', 'code', c->'code',
      'kind', c->>'kind', 'value', (c->>'value')::numeric, 'amount', v_take);
    v_ids := v_ids || to_jsonb(c->>'discount_id');
    v_label := coalesce(v_label || ' + ', '') || (c->>'name');
  end loop;

  if v_promo = 'CANDIDATE' then
    v_promo := case when exists (select 1 from jsonb_array_elements(v_lines) l where l->>'rule' = 'promo_code')
                    then 'applied' else 'NOT_COMBINABLE' end;
  end if;

  return jsonb_build_object('discount_total', v_list - v_left, 'discount_ids', v_ids, 'label', v_label,
                            'lines', v_lines, 'promo', v_promo, 'currency', v_cur, 'list_amount', v_list);
end;
$$;

-- ===========================================================================
-- 6) SHOP
-- ===========================================================================
create table if not exists public.shop_products (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  name                 text not null,
  description          text,
  category             text,
  price                numeric(12,2) not null default 0,
  currency             text not null,
  images               text[] not null default '{}',     -- club-media paths
  visibility           text not null default 'public',   -- public | members
  is_active            boolean not null default true,
  pickup_available     boolean not null default true,
  pickup_venue_id      uuid references public.venues(id) on delete set null,
  shipping_available   boolean not null default false,
  shipping_fee         numeric(12,2) not null default 0,
  low_stock_threshold  integer not null default 3,
  sort_order           integer not null default 0,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_shop_products_org on public.shop_products(org_id, is_active, sort_order);
do $$ begin
  alter table public.shop_products add constraint shop_products_chk
    check (length(btrim(name)) between 1 and 120
       and coalesce(length(description), 0) <= 4000
       and coalesce(length(category), 0) <= 60
       and price >= 0 and price <= 1000000
       and currency ~ '^[A-Z]{3}$'
       and visibility in ('public', 'members')
       and (pickup_available or shipping_available)
       and shipping_fee >= 0 and shipping_fee <= 10000
       and low_stock_threshold between 0 and 100000
       and coalesce(array_length(images, 1), 0) <= 8
       and sort_order between 0 and 100000);
exception when duplicate_object then null; end $$;

create table if not exists public.shop_product_variants (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  product_id   uuid not null references public.shop_products(id) on delete cascade,
  sku          text,
  size         text,
  color        text,
  price        numeric(12,2),            -- null = product price
  stock        integer not null default 0,
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_shop_variants_org on public.shop_product_variants(org_id);
create index if not exists idx_shop_variants_product on public.shop_product_variants(product_id, sort_order);
create unique index if not exists shop_variants_sku_uidx on public.shop_product_variants(org_id, upper(sku)) where sku is not null;
do $$ begin
  alter table public.shop_product_variants add constraint shop_variants_stock_nonneg check (stock >= 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.shop_product_variants add constraint shop_variants_chk
    check ((sku is null or sku ~ '^[A-Za-z0-9._/-]{1,40}$')
       and coalesce(length(size), 0) <= 30 and coalesce(length(color), 0) <= 30
       and (price is null or (price >= 0 and price <= 1000000))
       and stock <= 10000000 and sort_order between 0 and 100000);
exception when duplicate_object then null; end $$;

create table if not exists public.shop_orders (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  number             text not null,
  status             text not null default 'pending_payment',
  family_id          uuid references public.families(id) on delete set null,
  profile_id         uuid references public.profiles(id) on delete set null,
  is_guest           boolean not null default false,
  buyer_name         text not null,
  buyer_email        citext not null,
  buyer_phone        text,
  fulfillment        text not null default 'pickup',       -- pickup | shipping
  pickup_venue_id    uuid references public.venues(id) on delete set null,
  shipping_address   text,
  currency           text not null,
  subtotal           numeric(12,2) not null default 0,
  discount_total     numeric(12,2) not null default 0,
  shipping_total     numeric(12,2) not null default 0,
  total              numeric(12,2) not null default 0,
  promo_code         text,
  invoice_id         uuid references public.invoices(id) on delete set null,
  access_token_hash  text,
  notes              text,
  paid_at            timestamptz,
  ready_at           timestamptz,
  fulfilled_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  refunded_at        timestamptz,
  stock_released_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, number)
);
create index if not exists idx_shop_orders_org on public.shop_orders(org_id, created_at desc);
create index if not exists idx_shop_orders_status on public.shop_orders(org_id, status);
create index if not exists idx_shop_orders_family on public.shop_orders(family_id);
create index if not exists idx_shop_orders_profile on public.shop_orders(profile_id);
create index if not exists idx_shop_orders_invoice on public.shop_orders(invoice_id);
create unique index if not exists shop_orders_token_uidx on public.shop_orders(access_token_hash) where access_token_hash is not null;
do $$ begin
  alter table public.shop_orders add constraint shop_orders_chk
    check (status in ('pending_payment', 'paid', 'ready_for_pickup', 'fulfilled', 'cancelled', 'refunded')
       and fulfillment in ('pickup', 'shipping')
       and (fulfillment <> 'shipping' or length(btrim(coalesce(shipping_address, ''))) between 5 and 500)
       and currency ~ '^[A-Z]{3}$'
       and subtotal >= 0 and discount_total >= 0 and shipping_total >= 0 and total >= 0
       and discount_total <= subtotal
       and length(btrim(buyer_name)) between 1 and 120
       and coalesce(length(buyer_phone), 0) <= 40
       and coalesce(length(notes), 0) <= 1000
       and coalesce(length(cancel_reason), 0) <= 500
       and (access_token_hash is null or access_token_hash ~ '^[0-9a-f]{64}$'));
exception when duplicate_object then null; end $$;

create table if not exists public.shop_order_items (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  order_id       uuid not null references public.shop_orders(id) on delete cascade,
  product_id     uuid references public.shop_products(id) on delete set null,
  variant_id     uuid references public.shop_product_variants(id) on delete set null,
  name           text not null,
  variant_label  text,
  sku            text,
  unit_price     numeric(12,2) not null,
  quantity       integer not null,
  line_total     numeric(12,2) not null,
  created_at     timestamptz not null default now()
);
create index if not exists idx_shop_order_items_org on public.shop_order_items(org_id);
create index if not exists idx_shop_order_items_order on public.shop_order_items(order_id);
do $$ begin
  alter table public.shop_order_items add constraint shop_order_items_chk
    check (quantity between 1 and 100 and unit_price >= 0 and line_total >= 0);
exception when duplicate_object then null; end $$;

create table if not exists public.shop_stock_movements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  variant_id   uuid not null references public.shop_product_variants(id) on delete cascade,
  product_id   uuid not null references public.shop_products(id) on delete cascade,
  kind         text not null,              -- sale | release | restock | adjustment
  quantity     integer not null,           -- signed change of stock
  stock_after  integer not null,
  reason       text,
  order_id     uuid references public.shop_orders(id) on delete set null,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists idx_shop_movements_org on public.shop_stock_movements(org_id, created_at desc);
create index if not exists idx_shop_movements_variant on public.shop_stock_movements(variant_id, created_at desc);
do $$ begin
  alter table public.shop_stock_movements add constraint shop_movements_chk
    check (kind in ('sale', 'release', 'restock', 'adjustment')
       and quantity <> 0 and stock_after >= 0
       and (kind <> 'adjustment' or length(btrim(coalesce(reason, ''))) between 1 and 500)
       and coalesce(length(reason), 0) <= 500);
exception when duplicate_object then null; end $$;

-- updated_at
do $$
declare t text;
begin
  foreach t in array array['shop_products', 'shop_product_variants', 'shop_orders'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'trg_' || t || '_updated', t);
  end loop;
end $$;

-- Same-club references
create or replace function public.shop_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_col text;
  v_id  uuid;
  v_tab text;
  v_ok  boolean;
begin
  foreach v_col in array tg_argv loop
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    v_tab := case v_col
      when 'product_id'      then 'shop_products'
      when 'variant_id'      then 'shop_product_variants'
      when 'order_id'        then 'shop_orders'
      when 'pickup_venue_id' then 'venues'
      when 'family_id'       then 'families'
      when 'invoice_id'      then 'invoices'
    end;
    if v_tab is null then raise exception 'shop_same_org_guard: unknown column %', v_col; end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab) into v_ok using v_id, v_org;
    if not v_ok then raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001'; end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_shop_products_same_org on public.shop_products;
create trigger trg_shop_products_same_org before insert or update on public.shop_products
  for each row execute function public.shop_same_org_guard('pickup_venue_id');
drop trigger if exists trg_shop_variants_same_org on public.shop_product_variants;
create trigger trg_shop_variants_same_org before insert or update on public.shop_product_variants
  for each row execute function public.shop_same_org_guard('product_id');
drop trigger if exists trg_shop_orders_same_org on public.shop_orders;
create trigger trg_shop_orders_same_org before insert or update on public.shop_orders
  for each row execute function public.shop_same_org_guard('family_id', 'pickup_venue_id', 'invoice_id');
drop trigger if exists trg_shop_items_same_org on public.shop_order_items;
create trigger trg_shop_items_same_org before insert or update on public.shop_order_items
  for each row execute function public.shop_same_org_guard('order_id', 'product_id', 'variant_id');
drop trigger if exists trg_shop_movements_same_org on public.shop_stock_movements;
create trigger trg_shop_movements_same_org before insert or update on public.shop_stock_movements
  for each row execute function public.shop_same_org_guard('variant_id', 'product_id', 'order_id');

-- Stock changes go through the RPCs (movement log). A direct update of the
-- stock column by a client is refused; RPCs flag their writes.
create or replace function public.shop_variant_stock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.stock is distinct from old.stock
     and coalesce(current_setting('app.shop_stock', true), '') <> 'on'
     and not public.is_service_caller() then
    raise exception 'STOCK_VIA_MOVEMENTS' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and new.stock <> 0
     and coalesce(current_setting('app.shop_stock', true), '') <> 'on'
     and not public.is_service_caller() then
    raise exception 'STOCK_VIA_MOVEMENTS' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shop_variants_stock_guard on public.shop_product_variants;
create trigger trg_shop_variants_stock_guard before insert or update on public.shop_product_variants
  for each row execute function public.shop_variant_stock_guard();

-- RLS ------------------------------------------------------------------------
alter table public.shop_products         enable row level security;
alter table public.shop_product_variants enable row level security;
alter table public.shop_orders           enable row level security;
alter table public.shop_order_items      enable row level security;
alter table public.shop_stock_movements  enable row level security;

-- Catalogue: staff see everything; members see active public + members-only
-- products. Anonymous visitors get the public shop through the server.
drop policy if exists shop_products_select on public.shop_products;
create policy shop_products_select on public.shop_products for select
  using (org_id = public.current_org_id() and (public.is_finance() or is_active));
drop policy if exists shop_products_insert on public.shop_products;
create policy shop_products_insert on public.shop_products for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists shop_products_update on public.shop_products;
create policy shop_products_update on public.shop_products for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists shop_products_delete on public.shop_products;
create policy shop_products_delete on public.shop_products for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists shop_variants_select on public.shop_product_variants;
create policy shop_variants_select on public.shop_product_variants for select
  using (org_id = public.current_org_id()
         and (public.is_finance()
              or (is_active and exists (select 1 from public.shop_products p where p.id = product_id and p.is_active))));
drop policy if exists shop_variants_insert on public.shop_product_variants;
create policy shop_variants_insert on public.shop_product_variants for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists shop_variants_update on public.shop_product_variants;
create policy shop_variants_update on public.shop_product_variants for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists shop_variants_delete on public.shop_product_variants;
create policy shop_variants_delete on public.shop_product_variants for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Orders: finance reads all; a member reads their own orders (placed by
-- them or for their family). Written by the RPCs only.
drop policy if exists shop_orders_select on public.shop_orders;
create policy shop_orders_select on public.shop_orders for select
  using (org_id = public.current_org_id()
         and (public.is_finance() or profile_id = auth.uid()
              or (family_id is not null and public.is_guardian_of_family(family_id))));
drop policy if exists shop_orders_no_insert on public.shop_orders;
create policy shop_orders_no_insert on public.shop_orders for insert with check (false);
drop policy if exists shop_orders_no_update on public.shop_orders;
create policy shop_orders_no_update on public.shop_orders for update using (false) with check (false);
drop policy if exists shop_orders_no_delete on public.shop_orders;
create policy shop_orders_no_delete on public.shop_orders for delete using (false);

drop policy if exists shop_order_items_select on public.shop_order_items;
create policy shop_order_items_select on public.shop_order_items for select
  using (org_id = public.current_org_id()
         and exists (select 1 from public.shop_orders o where o.id = order_id
                      and (public.is_finance() or o.profile_id = auth.uid()
                           or (o.family_id is not null and public.is_guardian_of_family(o.family_id)))));
drop policy if exists shop_order_items_no_insert on public.shop_order_items;
create policy shop_order_items_no_insert on public.shop_order_items for insert with check (false);
drop policy if exists shop_order_items_no_update on public.shop_order_items;
create policy shop_order_items_no_update on public.shop_order_items for update using (false) with check (false);
drop policy if exists shop_order_items_no_delete on public.shop_order_items;
create policy shop_order_items_no_delete on public.shop_order_items for delete using (false);

drop policy if exists shop_movements_select on public.shop_stock_movements;
create policy shop_movements_select on public.shop_stock_movements for select
  using (org_id = public.current_org_id() and public.is_finance());
drop policy if exists shop_movements_no_insert on public.shop_stock_movements;
create policy shop_movements_no_insert on public.shop_stock_movements for insert with check (false);
drop policy if exists shop_movements_no_update on public.shop_stock_movements;
create policy shop_movements_no_update on public.shop_stock_movements for update using (false) with check (false);
drop policy if exists shop_movements_no_delete on public.shop_stock_movements;
create policy shop_movements_no_delete on public.shop_stock_movements for delete using (false);

-- ===========================================================================
-- 9a) MEMBER CARDS (tables; functions below)
-- ===========================================================================
create table if not exists public.member_cards (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  athlete_id  uuid not null references public.athletes(id) on delete cascade,
  nonce       text not null,                 -- random, part of the signed token
  version     integer not null default 1,
  nfc_tag_id  text,                          -- bracelet / tag serial number (normalised)
  is_active   boolean not null default true,
  issued_at   timestamptz not null default now(),
  rotated_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (athlete_id)
);
create index if not exists idx_member_cards_org on public.member_cards(org_id);
create unique index if not exists member_cards_nonce_uidx on public.member_cards(nonce);
create unique index if not exists member_cards_tag_uidx on public.member_cards(org_id, nfc_tag_id) where nfc_tag_id is not null;
do $$ begin
  alter table public.member_cards add constraint member_cards_chk
    check (nonce ~ '^[0-9a-f]{32}$' and version between 1 and 100000
       and (nfc_tag_id is null or nfc_tag_id ~ '^[0-9A-F]{4,40}$'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_member_cards_updated on public.member_cards;
create trigger trg_member_cards_updated before update on public.member_cards
  for each row execute function public.set_updated_at();
drop trigger if exists trg_member_cards_same_org on public.member_cards;
create trigger trg_member_cards_same_org before insert or update on public.member_cards
  for each row execute function public.training_same_org_guard('athlete_id');

-- Per-club signing key. No policies: only the security-definer RPCs read it.
create table if not exists public.member_card_keys (
  org_id      uuid primary key references public.organizations(id) on delete cascade,
  secret      text not null,
  created_at  timestamptz not null default now()
);

alter table public.member_cards     enable row level security;
alter table public.member_card_keys enable row level security;

-- Cards: admins and the athlete's guardians read (the token itself is only
-- built by member_card_token()); coaches resolve through the RPC; writes via
-- the RPCs only.
drop policy if exists member_cards_select on public.member_cards;
create policy member_cards_select on public.member_cards for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists member_cards_no_insert on public.member_cards;
create policy member_cards_no_insert on public.member_cards for insert with check (false);
drop policy if exists member_cards_no_update on public.member_cards;
create policy member_cards_no_update on public.member_cards for update using (false) with check (false);
drop policy if exists member_cards_no_delete on public.member_cards;
create policy member_cards_no_delete on public.member_cards for delete using (false);

drop policy if exists member_card_keys_none on public.member_card_keys;
create policy member_card_keys_none on public.member_card_keys for all using (false) with check (false);

-- Tenant guards, grants, audit for every new table
do $$
declare t text;
begin
  foreach t in array array['sports', 'shop_products', 'shop_product_variants', 'shop_orders', 'shop_order_items',
                           'shop_stock_movements', 'member_cards', 'member_card_keys'] loop
    execute format('drop policy if exists platform_tenant_isolation on public.%I', t);
    execute format(
      'create policy platform_tenant_isolation on public.%I as restrictive for all
         using (org_id = (select public.current_org_id()))
         with check (org_id = (select public.current_org_id()))', t);
    execute format('drop policy if exists platform_suspension_guard on public.%I', t);
    execute format(
      'create policy platform_suspension_guard on public.%I as restrictive for all
         using (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))
         with check (not coalesce(org_id = any ((select public.suspended_org_ids())::uuid[]), false))', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on public.%I from anon', t);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      if t = 'member_card_keys' then
        execute format('revoke all on public.%I from authenticated', t);
      else
        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
      end if;
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant all on public.%I to service_role', t);
    end if;
  end loop;

  -- member_cards / member_card_keys hold credentials: explicit audit rows
  -- without the nonce instead of the row-image trigger.
  foreach t in array array['sports', 'shop_products', 'shop_product_variants', 'shop_orders', 'shop_stock_movements'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format('create trigger %I after insert or update or delete on public.%I
                      for each row execute function public.audit_trigger()', 'trg_audit_' || t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Shop RPCs
-- ---------------------------------------------------------------------------
-- Internal: give back the stock of an order once (cancel / refund before
-- fulfilment). Idempotent through stock_released_at.
create or replace function public.shop_release_order_stock(p_order uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  o  public.shop_orders;
  it record;
  v_after integer;
begin
  select * into o from public.shop_orders where id = p_order for update;
  if not found or o.stock_released_at is not null or o.fulfilled_at is not null then return; end if;
  perform set_config('app.shop_stock', 'on', true);
  for it in select variant_id, product_id, sum(quantity)::int as qty from public.shop_order_items
             where order_id = p_order and variant_id is not null group by variant_id, product_id order by variant_id loop
    update public.shop_product_variants set stock = stock + it.qty where id = it.variant_id returning stock into v_after;
    if found then
      insert into public.shop_stock_movements (org_id, variant_id, product_id, kind, quantity, stock_after, order_id, created_by, reason)
      values (o.org_id, it.variant_id, it.product_id, 'release', it.qty, v_after, p_order, p_actor, 'order ' || o.number);
    end if;
  end loop;
  perform set_config('app.shop_stock', 'off', true);
  update public.shop_orders set stock_released_at = now() where id = p_order;
end;
$$;

-- shop_place_order(payload) — service role only. The server resolved the
-- club (from the shop slug / host, or the signed-in member's org) and, for a
-- member, the profile and family; prices and stock come from the database.
-- payload = {
--   org_id, mode: 'guest' | 'member', profile_id, family_id,
--   buyer: {name, email, phone}, fulfillment: 'pickup' | 'shipping',
--   pickup_venue_id, shipping_address, notes, promo_code,
--   items: [{variant_id, quantity}], access_token_hash, expected_total,
--   labels: {invoice, shipping}   (translated by the server, club locale)
-- }
create or replace function public.shop_place_order(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid := nullif(p_payload->>'org_id', '')::uuid;
  v_mode     text := coalesce(p_payload->>'mode', 'guest');
  v_profile  uuid := nullif(p_payload->>'profile_id', '')::uuid;
  v_family   uuid := nullif(p_payload->>'family_id', '')::uuid;
  v_email    citext := nullif(btrim(coalesce(p_payload->'buyer'->>'email', '')), '');
  v_name     text := nullif(btrim(coalesce(p_payload->'buyer'->>'name', '')), '');
  v_phone    text := nullif(btrim(coalesce(p_payload->'buyer'->>'phone', '')), '');
  v_ful      text := coalesce(p_payload->>'fulfillment', 'pickup');
  v_venue    uuid := nullif(p_payload->>'pickup_venue_id', '')::uuid;
  v_addr     text := nullif(btrim(coalesce(p_payload->>'shipping_address', '')), '');
  v_items    jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_cur      text;
  v_exp      int;
  v_it       record;
  v_var      public.shop_product_variants%rowtype;
  v_prod     public.shop_products%rowtype;
  v_unit     numeric;
  v_sub      numeric := 0;
  v_ship     numeric := 0;
  v_disc     jsonb;
  v_dtotal   numeric := 0;
  v_total    numeric;
  v_order    uuid;
  v_number   text;
  v_seq      int;
  v_inv      uuid;
  v_invnum   text;
  v_item     uuid;
  v_line     jsonb;
  v_label    text;
  v_after    int;
  v_vlabel   text;
begin
  if not public.is_service_caller() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if v_org is null or not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'CLUB_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_mode not in ('guest', 'member') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
  if v_ful not in ('pickup', 'shipping') then raise exception 'INVALID_FULFILLMENT' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) < 1 then raise exception 'CART_EMPTY' using errcode = 'P0001'; end if;
  if jsonb_array_length(v_items) > 50 then raise exception 'CART_TOO_LARGE' using errcode = 'P0001'; end if;
  if v_name is null or length(v_name) > 120 then raise exception 'NAME_REQUIRED' using errcode = 'P0001'; end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'EMAIL_REQUIRED' using errcode = 'P0001';
  end if;

  if v_mode = 'member' then
    if v_profile is null or not exists (select 1 from public.profiles where id = v_profile and org_id = v_org) then
      raise exception 'NOT_A_MEMBER' using errcode = 'P0001';
    end if;
    if v_family is not null and not exists (
         select 1 from public.family_members fm join public.families f on f.id = fm.family_id
          where fm.family_id = v_family and fm.profile_id = v_profile and f.org_id = v_org) then
      raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    v_profile := null;
    v_family := null;
  end if;

  if v_ful = 'shipping' and (v_addr is null or length(v_addr) < 5 or length(v_addr) > 500) then
    raise exception 'ADDRESS_REQUIRED' using errcode = 'P0001';
  end if;
  if v_ful = 'pickup' and v_venue is not null
     and not exists (select 1 from public.venues where id = v_venue and org_id = v_org and is_active) then
    raise exception 'PICKUP_VENUE_INVALID' using errcode = 'P0001';
  end if;

  v_cur := public.org_currency(v_org);
  v_exp := public.currency_exponent(v_cur);

  -- Order header (number per club, serialised by an advisory lock)
  perform pg_advisory_xact_lock(hashtext('shop_order:' || v_org::text));
  select coalesce(max(nullif(regexp_replace(number, '^.*-', ''), '')::int), 0) + 1 into v_seq
    from public.shop_orders where org_id = v_org and number ~ ('^SO-' || to_char(now(), 'YYYY') || '-[0-9]+$');
  v_number := 'SO-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::text, 4, '0');

  insert into public.shop_orders (org_id, number, status, family_id, profile_id, is_guest, buyer_name, buyer_email, buyer_phone,
                                  fulfillment, pickup_venue_id, shipping_address, currency, promo_code, access_token_hash, notes)
  values (v_org, v_number, 'pending_payment', v_family, v_profile, v_mode = 'guest', v_name, v_email, v_phone,
          v_ful, case when v_ful = 'pickup' then v_venue end, case when v_ful = 'shipping' then v_addr end, v_cur,
          upper(nullif(btrim(coalesce(p_payload->>'promo_code', '')), '')),
          nullif(p_payload->>'access_token_hash', ''), left(nullif(btrim(coalesce(p_payload->>'notes', '')), ''), 1000))
  returning id into v_order;

  -- Lines: lock variants in a stable order (no deadlocks), check, reserve.
  perform set_config('app.shop_stock', 'on', true);
  for v_it in
    select (x->>'variant_id')::uuid as variant_id, sum((x->>'quantity')::int)::int as qty
      from jsonb_array_elements(v_items) x
     group by (x->>'variant_id')::uuid
     order by (x->>'variant_id')::uuid
  loop
    if v_it.qty is null or v_it.qty < 1 or v_it.qty > 100 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
    select * into v_var from public.shop_product_variants where id = v_it.variant_id and org_id = v_org for update;
    if not found or not v_var.is_active then raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0001'; end if;
    select * into v_prod from public.shop_products where id = v_var.product_id and org_id = v_org;
    if not found or not v_prod.is_active or (v_mode = 'guest' and v_prod.visibility <> 'public') then
      raise exception 'PRODUCT_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
    if v_prod.currency <> v_cur then raise exception 'CURRENCY_MISMATCH' using errcode = 'P0001'; end if;
    if (v_ful = 'pickup' and not v_prod.pickup_available) or (v_ful = 'shipping' and not v_prod.shipping_available) then
      raise exception 'FULFILLMENT_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
    if v_ful = 'pickup' and v_prod.pickup_venue_id is not null and v_venue is distinct from v_prod.pickup_venue_id then
      raise exception 'PICKUP_VENUE_INVALID' using errcode = 'P0001';
    end if;
    if v_var.stock < v_it.qty then raise exception 'OUT_OF_STOCK' using errcode = 'P0001'; end if;

    v_unit := round(coalesce(v_var.price, v_prod.price), v_exp);
    v_vlabel := nullif(concat_ws(' / ', nullif(v_var.size, ''), nullif(v_var.color, '')), '');
    insert into public.shop_order_items (org_id, order_id, product_id, variant_id, name, variant_label, sku, unit_price, quantity, line_total)
    values (v_org, v_order, v_prod.id, v_var.id, v_prod.name, v_vlabel, v_var.sku, v_unit, v_it.qty, v_unit * v_it.qty);
    v_sub := v_sub + v_unit * v_it.qty;
    if v_ful = 'shipping' then v_ship := greatest(v_ship, round(v_prod.shipping_fee, v_exp)); end if;

    update public.shop_product_variants set stock = stock - v_it.qty where id = v_var.id returning stock into v_after;
    insert into public.shop_stock_movements (org_id, variant_id, product_id, kind, quantity, stock_after, order_id, created_by, reason)
    values (v_org, v_var.id, v_prod.id, 'sale', -v_it.qty, v_after, v_order, v_profile, 'order ' || v_number);
  end loop;
  perform set_config('app.shop_stock', 'off', true);

  -- Discounts (shared model, scope all / shop; promo limits locked)
  v_disc := public.discount_evaluate(v_org, 'shop', null, null, v_sub, v_cur,
                                     p_payload->>'promo_code', v_family, null, null, true);
  if nullif(btrim(coalesce(p_payload->>'promo_code', '')), '') is not null and v_disc->>'promo' <> 'applied' then
    raise exception 'PROMO_%', v_disc->>'promo' using errcode = 'P0001';
  end if;
  v_dtotal := coalesce((v_disc->>'discount_total')::numeric, 0);
  v_total := v_sub - v_dtotal + v_ship;

  if nullif(p_payload->>'expected_total', '') is not null
     and round((p_payload->>'expected_total')::numeric, v_exp) <> round(v_total, v_exp) then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001';
  end if;

  -- Guest: a non-member family keyed by e-mail (like public camp sign-ups)
  if v_family is null then
    select id into v_family from public.families where org_id = v_org and contact_email = v_email
     order by created_at limit 1;
    if v_family is null then
      insert into public.families (org_id, name, phone, contact_name, contact_email, membership_status)
      values (v_org, v_name, v_phone, v_name, v_email, 'guest')
      returning id into v_family;
    end if;
  end if;

  -- Invoice (existing invoice logic: card / TWINT via Stripe when the club
  -- set it up, else QR-bill / bank transfer)
  if v_total > 0 then
    v_invnum := public.next_invoice_number(v_org);
    insert into public.invoices (org_id, number, family_id, description, currency, status, due_date, created_by)
    values (v_org, v_invnum, v_family,
            left(coalesce(nullif(btrim(p_payload->'labels'->>'invoice'), ''), 'Shop') || ' ' || v_number, 500),
            v_cur, 'sent', (now() + interval '14 days')::date, v_profile)
    returning id into v_inv;
    for v_it in select name, variant_label, unit_price, quantity, line_total from public.shop_order_items
                 where order_id = v_order order by created_at, name loop
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_inv, left(v_it.name || coalesce(' (' || v_it.variant_label || ')', ''), 500), v_it.quantity, v_it.unit_price, v_it.line_total);
    end loop;
    for v_line in select x from jsonb_array_elements(coalesce(v_disc->'lines', '[]'::jsonb)) x loop
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_inv, left(v_line->>'name', 500), 1, -(v_line->>'amount')::numeric, -(v_line->>'amount')::numeric)
      returning id into v_item;
      insert into public.applied_discounts (org_id, discount_id, invoice_id, invoice_item_id, source, source_id, family_id,
                                            rule, name, code, kind, value, amount, currency, created_by)
      values (v_org, (v_line->>'discount_id')::uuid, v_inv, v_item, 'shop', v_order, v_family,
              v_line->>'rule', v_line->>'name', nullif(v_line->>'code', ''), v_line->>'kind', (v_line->>'value')::numeric,
              (v_line->>'amount')::numeric, v_cur, v_profile);
    end loop;
    if v_ship > 0 then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_inv, left(coalesce(nullif(btrim(p_payload->'labels'->>'shipping'), ''), 'Shipping'), 500), 1, v_ship, v_ship);
    end if;
    update public.invoices set total_chf = v_total where id = v_inv;
  else
    for v_line in select x from jsonb_array_elements(coalesce(v_disc->'lines', '[]'::jsonb)) x loop
      insert into public.applied_discounts (org_id, discount_id, source, source_id, family_id,
                                            rule, name, code, kind, value, amount, currency, created_by)
      values (v_org, (v_line->>'discount_id')::uuid, 'shop', v_order, v_family,
              v_line->>'rule', v_line->>'name', nullif(v_line->>'code', ''), v_line->>'kind', (v_line->>'value')::numeric,
              (v_line->>'amount')::numeric, v_cur, v_profile);
    end loop;
  end if;

  update public.shop_orders
     set family_id = v_family, subtotal = v_sub, discount_total = v_dtotal, shipping_total = v_ship, total = v_total,
         invoice_id = v_inv,
         status = case when v_total > 0 then 'pending_payment' else 'paid' end,
         paid_at = case when v_total > 0 then null else now() end
   where id = v_order;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, v_profile, 'SHOP_ORDER_PLACED', 'shop_orders', v_order,
          jsonb_build_object('number', v_number, 'mode', v_mode, 'subtotal', v_sub, 'discount_total', v_dtotal,
                             'shipping_total', v_ship, 'total', v_total, 'currency', v_cur, 'invoice_id', v_inv,
                             'items', jsonb_array_length(v_items)));

  return jsonb_build_object('order_id', v_order, 'number', v_number, 'invoice_id', v_inv, 'invoice_number', v_invnum,
                            'subtotal', v_sub, 'discount_total', v_dtotal, 'shipping_total', v_ship, 'total', v_total,
                            'currency', v_cur, 'family_id', v_family,
                            'status', case when v_total > 0 then 'pending_payment' else 'paid' end);
end;
$$;

-- Admin: move an order along. Transitions:
--   paid -> ready_for_pickup -> fulfilled; paid -> fulfilled
--   pending_payment -> cancelled (unpaid invoice cancelled, stock released)
--   paid | ready_for_pickup | fulfilled -> refunded (reason; stock released
--   when not yet handed over)
create or replace function public.shop_set_order_status(p_order uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o        public.shop_orders;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into o from public.shop_orders where id = p_order and org_id = public.current_org_id() for update;
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;

  if p_status = 'ready_for_pickup' then
    if o.status <> 'paid' or o.fulfillment <> 'pickup' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.shop_orders set status = 'ready_for_pickup', ready_at = now() where id = p_order;
  elsif p_status = 'fulfilled' then
    if o.status not in ('paid', 'ready_for_pickup') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    update public.shop_orders set status = 'fulfilled', fulfilled_at = now() where id = p_order;
  elsif p_status = 'cancelled' then
    if o.status <> 'pending_payment' then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
    if o.invoice_id is not null and exists (select 1 from public.invoices i where i.id = o.invoice_id
                                             and i.status::text not in ('cancelled', 'void')) then
      if public.invoice_net_paid(o.invoice_id) <> 0 then raise exception 'HAS_PAYMENTS' using errcode = 'P0001'; end if;
      perform public.cancel_invoice(o.invoice_id, v_reason);  -- trigger below cancels the order too
    end if;
    update public.shop_orders set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()),
                                  cancel_reason = coalesce(cancel_reason, v_reason)
     where id = p_order and status <> 'cancelled';
    perform public.shop_release_order_stock(p_order, auth.uid());
  elsif p_status = 'refunded' then
    if o.status not in ('paid', 'ready_for_pickup', 'fulfilled') then raise exception 'INVALID_TRANSITION' using errcode = 'P0001'; end if;
    if v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
    update public.shop_orders set status = 'refunded', refunded_at = now(), cancel_reason = v_reason where id = p_order;
    perform public.shop_release_order_stock(p_order, auth.uid());
  else
    raise exception 'INVALID_STATUS' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (o.org_id, auth.uid(), 'SHOP_ORDER_STATUS', 'shop_orders', p_order,
          jsonb_build_object('status', o.status), jsonb_build_object('status', p_status, 'reason', v_reason));
  return jsonb_build_object('order_id', p_order, 'status', p_status);
end;
$$;

-- Admin: restock (+) or adjust (+/-, reason required). Stock never < 0.
create or replace function public.shop_adjust_stock(p_variant uuid, p_delta integer, p_kind text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        public.shop_product_variants;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_after  integer;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  if p_kind not in ('restock', 'adjustment') then raise exception 'INVALID_KIND' using errcode = 'P0001'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  if p_kind = 'restock' and p_delta < 0 then raise exception 'INVALID_QUANTITY' using errcode = 'P0001'; end if;
  if p_kind = 'adjustment' and v_reason is null then raise exception 'REASON_REQUIRED' using errcode = 'P0001'; end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'REASON_TOO_LONG' using errcode = 'P0001'; end if;
  select * into v from public.shop_product_variants where id = p_variant and org_id = public.current_org_id() for update;
  if not found then raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v.stock + p_delta < 0 then raise exception 'STOCK_NEGATIVE' using errcode = 'P0001'; end if;

  perform set_config('app.shop_stock', 'on', true);
  update public.shop_product_variants set stock = stock + p_delta where id = p_variant returning stock into v_after;
  perform set_config('app.shop_stock', 'off', true);
  insert into public.shop_stock_movements (org_id, variant_id, product_id, kind, quantity, stock_after, reason, created_by)
  values (v.org_id, v.id, v.product_id, p_kind, p_delta, v_after, v_reason, auth.uid());
  return jsonb_build_object('variant_id', p_variant, 'stock', v_after);
end;
$$;

-- Invoice status drives the order: paid -> paid; cancelled / void ->
-- cancelled (stock back); refunded -> refunded (stock back unless handed over).
create or replace function public.shop_order_on_invoice_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare o public.shop_orders;
begin
  for o in select * from public.shop_orders where invoice_id = new.id loop
    if new.status::text = 'paid' and o.status = 'pending_payment' then
      update public.shop_orders set status = 'paid', paid_at = now() where id = o.id;
    elsif new.status::text in ('cancelled', 'void') and o.status = 'pending_payment' then
      update public.shop_orders set status = 'cancelled', cancelled_at = now(),
                                    cancel_reason = coalesce(cancel_reason, 'invoice_cancelled')
       where id = o.id;
      perform public.shop_release_order_stock(o.id, auth.uid());
    elsif new.status::text = 'refunded' and o.status in ('paid', 'ready_for_pickup', 'fulfilled') then
      update public.shop_orders set status = 'refunded', refunded_at = now() where id = o.id;
      perform public.shop_release_order_stock(o.id, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_invoices_shop_order on public.invoices;
create trigger trg_invoices_shop_order
  after update of status on public.invoices
  for each row when (old.status is distinct from new.status)
  execute function public.shop_order_on_invoice_status();

-- ===========================================================================
-- 7) TRAINING DISCOUNTS
--   Promo code / manual discounts / booking date reach the hook through
--   transaction-local settings set by the RPCs below (never by clients:
--   PostgREST cannot set them).
-- ===========================================================================
create or replace function public.training_purchase_discount(
  p_org uuid, p_athlete uuid, p_service uuid, p_package uuid, p_amount numeric, p_currency text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_code   text := nullif(current_setting('app.discount_code', true), '');
  v_manual uuid[];
  v_start  date;
  v_res    jsonb;
begin
  select family_id into v_family from public.athletes where id = p_athlete and org_id = p_org;
  begin v_start := nullif(current_setting('app.discount_starts_on', true), '')::date; exception when others then v_start := null; end;
  if public.is_admin() then
    begin
      v_manual := nullif(current_setting('app.discount_manual', true), '')::uuid[];
    exception when others then v_manual := null; end;
  end if;
  v_res := public.discount_evaluate(p_org, 'training', null, p_service, p_amount, p_currency,
                                    v_code, v_family, v_start, v_manual, true);
  if v_code is not null and v_res->>'promo' <> 'applied' then
    raise exception 'PROMO_%', v_res->>'promo' using errcode = 'P0001';
  end if;
  return v_res;
end;
$$;

-- Internal: record the discount lines of a purchase / booking.
create or replace function public.training_record_discounts(
  p_org uuid, p_disc jsonb, p_source text, p_source_id uuid, p_invoice uuid, p_family uuid, p_athlete uuid,
  p_currency text, p_label_suffix text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_item uuid;
begin
  for v_line in select x from jsonb_array_elements(coalesce(p_disc->'lines', '[]'::jsonb)) x loop
    v_item := null;
    if p_invoice is not null then
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (p_org, p_invoice, left((v_line->>'name') || coalesce(' — ' || p_label_suffix, ''), 500), 1,
              -(v_line->>'amount')::numeric, -(v_line->>'amount')::numeric)
      returning id into v_item;
    end if;
    insert into public.applied_discounts (org_id, discount_id, invoice_id, invoice_item_id, source, source_id, family_id, athlete_id,
                                          rule, name, code, kind, value, amount, currency, created_by)
    values (p_org, (v_line->>'discount_id')::uuid, p_invoice, v_item, p_source, p_source_id, p_family, p_athlete,
            v_line->>'rule', v_line->>'name', nullif(v_line->>'code', ''), v_line->>'kind', (v_line->>'value')::numeric,
            (v_line->>'amount')::numeric, p_currency, auth.uid());
  end loop;
end;
$$;

-- training_create_purchase(): same contract; one negative invoice line per
-- discount and applied_discounts rows (source training_package).
create or replace function public.training_create_purchase(
  p_org uuid, p_athlete uuid, p_service uuid, p_package uuid, p_mode text, p_note text)
returns public.training_package_purchases
language plpgsql
security definer
set search_path = public
as $$
declare
  v_svc     public.training_services%rowtype;
  v_pkg     public.credit_packages%rowtype;
  v_ath     public.athletes%rowtype;
  v_cur     text;
  v_exp     integer;
  v_list    numeric;
  v_disc    jsonb := '{}'::jsonb;
  v_dtotal  numeric;
  v_amount  numeric;
  v_ids     uuid[];
  v_inv     uuid;
  v_sessions integer;
  v_validity integer;
  v_label   text;
  v_row     public.training_package_purchases;
begin
  select * into v_ath from public.athletes where id = p_athlete and org_id = p_org;
  if not found then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_svc from public.training_services where id = p_service and org_id = p_org;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_package is not null then
    select * into v_pkg from public.credit_packages
     where id = p_package and org_id = p_org and service_id = p_service and is_active;
    if not found then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
    v_sessions := v_pkg.credits;
    v_list     := v_pkg.price_chf;
    v_validity := v_pkg.validity_days;
    v_label    := v_svc.name || ' — ' || v_pkg.name;
  else
    v_sessions := 1;
    v_list     := v_svc.price_chf;
    v_validity := null;
    v_label    := v_svc.name;
  end if;

  v_cur := coalesce(v_svc.currency, public.training_org_currency(p_org));
  v_exp := public.currency_exponent(v_cur);
  v_list := round(coalesce(v_list, 0), v_exp);

  -- Discount hook (shared discounts model); a comp is free without discounts.
  if p_mode <> 'comp' then
    v_disc := coalesce(public.training_purchase_discount(p_org, p_athlete, p_service, p_package, v_list, v_cur), '{}'::jsonb);
  end if;
  v_dtotal := least(v_list, greatest(0, round(coalesce((v_disc->>'discount_total')::numeric, 0), v_exp)));
  select coalesce(array_agg(x::uuid), '{}') into v_ids
    from jsonb_array_elements_text(coalesce(v_disc->'discount_ids', '[]'::jsonb)) x;
  v_amount := case when p_mode = 'comp' then 0 else v_list - v_dtotal end;
  if p_mode = 'comp' then v_dtotal := v_list; end if;

  if p_mode in ('invoice', 'paid') and v_amount > 0 then
    insert into public.invoices (org_id, number, family_id, athlete_id, description, currency, status, due_date, created_by)
    values (p_org, public.next_invoice_number(p_org), v_ath.family_id, p_athlete,
            v_label || ' — ' || v_ath.first_name || ' ' || v_ath.last_name, v_cur, 'sent',
            (now() + interval '7 days')::date, auth.uid())
    returning id into v_inv;
    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (p_org, v_inv, v_label || ' — ' || v_ath.first_name || ' ' || v_ath.last_name, 1, v_list, v_list);
    update public.invoices set total_chf = v_amount where id = v_inv;
  end if;

  insert into public.training_package_purchases
    (org_id, athlete_id, family_id, service_id, package_id, sessions, list_price, discount_total, discount_ids,
     amount, currency, payment_mode, status, invoice_id, validity_days, granted_at, expires_at, notes, created_by)
  values
    (p_org, p_athlete, v_ath.family_id, p_service, p_package, v_sessions, v_list, v_dtotal, v_ids,
     v_amount, v_cur, p_mode,
     case when v_inv is null then 'active' else 'pending' end,
     v_inv, v_validity,
     case when v_inv is null then now() end,
     case when v_inv is null and v_validity is not null then now() + make_interval(days => v_validity) end,
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_row;

  if p_mode <> 'comp' then
    perform public.training_record_discounts(p_org, v_disc, 'training_package', v_row.id, v_inv, v_ath.family_id,
                                             p_athlete, v_cur, v_ath.first_name || ' ' || v_ath.last_name);
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (p_org, auth.uid(), 'TRAINING_PACKAGE_SOLD', 'training_package_purchases', v_row.id,
          jsonb_build_object('athlete_id', p_athlete, 'service_id', p_service, 'package_id', p_package,
                             'sessions', v_sessions, 'list_price', v_list, 'discount_total', v_dtotal,
                             'discount_ids', to_jsonb(v_ids),
                             'amount', v_amount, 'currency', v_cur, 'mode', p_mode, 'invoice_id', v_inv));

  if p_mode = 'paid' and v_inv is not null then
    perform public.record_offline_payment(v_inv, v_amount, 'manual', null, null, p_note);
    select * into v_row from public.training_package_purchases where id = v_row.id;
  end if;

  return v_row;
end;
$$;

-- Internal: set / clear the transaction-local discount inputs.
create or replace function public.training_discount_inputs(p_code text, p_manual uuid[], p_starts_on date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_code is not null and length(p_code) > 40 then raise exception 'PROMO_UNKNOWN_CODE' using errcode = 'P0001'; end if;
  perform set_config('app.discount_code', coalesce(upper(nullif(btrim(p_code), '')), ''), true);
  perform set_config('app.discount_manual', coalesce(p_manual::text, ''), true);
  perform set_config('app.discount_starts_on', coalesce(p_starts_on::text, ''), true);
end;
$$;

-- purchase_training_package(): + optional promo code / manual discounts.
drop function if exists public.purchase_training_package(uuid, uuid, uuid, text, text);
create or replace function public.purchase_training_package(
  p_athlete uuid, p_service uuid, p_package uuid default null, p_mode text default 'invoice', p_note text default null,
  p_promo_code text default null, p_manual_discounts uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org     uuid;
  v_admin   boolean := public.is_admin();
  v_enabled boolean;
  v_row     public.training_package_purchases;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_mode not in ('invoice', 'paid', 'comp') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
  if not v_admin then
    if not public.is_guardian_of_athlete(p_athlete) then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if p_mode <> 'invoice' then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if p_manual_discounts is not null and cardinality(p_manual_discounts) > 0 then
      raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
    end if;
    select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
      from public.app_settings where org_id = v_org;
    if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.training_services where id = p_service and org_id = v_org and is_active) then
      raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  if length(coalesce(p_note, '')) > 2000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;

  perform public.training_discount_inputs(p_promo_code, case when v_admin then p_manual_discounts end, null);
  v_row := public.training_create_purchase(v_org, p_athlete, p_service, p_package, p_mode, p_note);
  perform public.training_discount_inputs(null, null, null);
  return jsonb_build_object('purchase_id', v_row.id, 'invoice_id', v_row.invoice_id, 'status', v_row.status,
                            'sessions', v_row.sessions, 'amount', v_row.amount, 'currency', v_row.currency,
                            'list_price', v_row.list_price, 'discount_total', v_row.discount_total);
end;
$$;

-- book_training(): + optional promo code / manual discounts (package or
-- single-session invoice); the booking day feeds "N days before" early birds.
drop function if exists public.book_training(uuid, uuid, uuid, timestamptz, text, uuid, uuid, text, boolean, text);
create or replace function public.book_training(
  p_athlete uuid, p_service uuid, p_coach uuid, p_start timestamptz,
  p_pay_with text default 'credits', p_purchase uuid default null, p_package uuid default null,
  p_mode text default 'invoice', p_override boolean default false, p_notes text default null,
  p_promo_code text default null, p_manual_discounts uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_family   uuid;
  v_name     text;
  v_admin    boolean := public.is_admin();
  v_enabled  boolean;
  v_svc      public.training_services%rowtype;
  v_end      timestamptz;
  v_venue    uuid;
  v_lot      public.training_package_purchases;
  v_balance  integer;
  v_booking  uuid;
  v_invoice  uuid;
  v_price    numeric;
  v_cur      text;
  v_credits  integer := 0;
  v_purchase uuid;
  v_disc     jsonb := '{}'::jsonb;
  v_dtotal   numeric := 0;
  -- explicit code, else the code of the service-role guest checkout wrapper
  v_code     text := coalesce(nullif(btrim(coalesce(p_promo_code, '')), ''),
                              nullif(current_setting('app.guest_promo_code', true), ''));
begin
  select org_id, family_id, first_name || ' ' || last_name into v_org, v_family, v_name
    from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not (v_admin or public.is_guardian_of_athlete(p_athlete)) then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  if p_pay_with not in ('credits', 'package', 'invoice') then raise exception 'INVALID_PAYMENT' using errcode = 'P0001'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'NOTE_TOO_LONG' using errcode = 'P0001'; end if;
  if not v_admin and p_manual_discounts is not null and cardinality(p_manual_discounts) > 0 then
    raise exception 'NOT_AUTHORIZED' using errcode = 'P0001';
  end if;
  -- a code only means something when money is due now
  if v_code is not null and p_pay_with = 'credits' then raise exception 'PROMO_NOT_APPLICABLE' using errcode = 'P0001'; end if;

  if not v_admin then
    select coalesce((settings->>'bookings_enabled')::boolean, false) into v_enabled
      from public.app_settings where org_id = v_org;
    if not coalesce(v_enabled, false) then raise exception 'BOOKINGS_DISABLED' using errcode = 'P0001'; end if;
    if p_start <= now() then raise exception 'SLOT_IN_PAST' using errcode = 'P0001'; end if;
  end if;

  select * into v_svc from public.training_services where id = p_service and org_id = v_org and is_active;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_start is null then raise exception 'INVALID_TIME' using errcode = 'P0001'; end if;
  v_end := p_start + make_interval(mins => v_svc.duration_min);

  v_venue := public.training_check_slot(v_org, p_coach, v_svc, p_athlete, p_start, v_end,
                                        v_admin and coalesce(p_override, false), null);

  perform public.training_discount_inputs(v_code, case when v_admin then p_manual_discounts end,
                                          (p_start at time zone public.training_org_tz(v_org))::date);

  if p_pay_with = 'package' then
    if p_package is null then raise exception 'PACKAGE_NOT_FOUND' using errcode = 'P0002'; end if;
    if not v_admin and p_mode <> 'invoice' then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
    if p_mode not in ('invoice', 'paid', 'comp') then raise exception 'INVALID_MODE' using errcode = 'P0001'; end if;
    v_lot := public.training_create_purchase(v_org, p_athlete, p_service, p_package, p_mode, null);
    update public.training_package_purchases set sessions_used = sessions_used + 1 where id = v_lot.id;
    v_purchase := v_lot.id; v_credits := 1; v_price := 0; v_invoice := v_lot.invoice_id;

  elsif p_pay_with = 'credits' then
    if p_purchase is not null then
      select * into v_lot from public.training_package_purchases
       where id = p_purchase and org_id = v_org and athlete_id = p_athlete and service_id = p_service
         and sessions_used < sessions
         and (status = 'active' and (expires_at is null or expires_at > now())
              or (status = 'pending' and (created_by = auth.uid() or v_admin)))
       for update;
    else
      select * into v_lot from public.training_package_purchases
       where org_id = v_org and athlete_id = p_athlete and service_id = p_service
         and status = 'active' and (expires_at is null or expires_at > now()) and sessions_used < sessions
       order by expires_at nulls last, granted_at, created_at
       limit 1
       for update;
    end if;
    if v_lot.id is not null then
      update public.training_package_purchases set sessions_used = sessions_used + 1 where id = v_lot.id;
      v_purchase := v_lot.id; v_credits := 1; v_price := 0;
    elsif p_purchase is null and v_svc.credits_required > 0 then
      select (total_credits - used_credits) into v_balance from public.training_credits
       where athlete_id = p_athlete and credit_category = v_svc.credit_category for update;
      if coalesce(v_balance, 0) < v_svc.credits_required then
        raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
      end if;
      update public.training_credits set used_credits = used_credits + v_svc.credits_required, updated_at = now()
       where athlete_id = p_athlete and credit_category = v_svc.credit_category;
      v_credits := v_svc.credits_required; v_price := 0;
    else
      raise exception 'INSUFFICIENT_CREDITS' using errcode = 'P0001';
    end if;

  else -- single session invoice
    v_cur := coalesce(v_svc.currency, public.training_org_currency(v_org));
    v_price := round(v_svc.price_chf, public.currency_exponent(v_cur));
    v_disc := coalesce(public.training_purchase_discount(v_org, p_athlete, p_service, null, v_price, v_cur), '{}'::jsonb);
    v_dtotal := least(v_price, greatest(0, round(coalesce((v_disc->>'discount_total')::numeric, 0), public.currency_exponent(v_cur))));
    if v_price - v_dtotal > 0 then
      insert into public.invoices (org_id, number, family_id, athlete_id, description, currency, status, due_date, created_by)
      values (v_org, public.next_invoice_number(v_org), v_family, p_athlete, v_svc.name || ' — ' || v_name,
              v_cur, 'sent', (now() + interval '7 days')::date, auth.uid())
      returning id into v_invoice;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, v_svc.name || ' — ' || v_name, 1, v_price, v_price);
      update public.invoices set total_chf = v_price - v_dtotal where id = v_invoice;
    end if;
    v_price := v_price - v_dtotal;
  end if;

  perform public.training_discount_inputs(null, null, null);

  insert into public.training_bookings
    (org_id, athlete_id, service_id, coach_id, slot_start, slot_end, status, invoice_id,
     credits_used, price_chf, purchase_id, venue_id, location_text, notes, created_by)
  values
    (v_org, p_athlete, p_service, p_coach, p_start, v_end, 'booked',
     case when p_pay_with = 'invoice' then v_invoice end,
     v_credits, v_price, v_purchase, v_venue, v_svc.location_text,
     nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_booking;

  if p_pay_with = 'invoice' and v_dtotal > 0 then
    perform public.training_record_discounts(v_org, v_disc, 'booking', v_booking, v_invoice, v_family, p_athlete,
                                             upper(v_cur), v_name);
  end if;

  perform public.training_refresh_group(v_org, p_coach, p_service, p_start);

  return jsonb_build_object('booking_id', v_booking, 'purchase_id', v_purchase, 'invoice_id', v_invoice,
                            'credits_used', v_credits, 'price', v_price, 'slot_start', p_start, 'slot_end', v_end,
                            'venue_id', v_venue, 'pay_with', p_pay_with, 'discount_total', v_dtotal);
end;
$$;

-- Guest checkout with a promo code (service role): same as
-- training_guest_checkout(); the code applies to the package / session.
create or replace function public.training_guest_checkout_promo(p_slug text, p_user uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_res jsonb;
begin
  if auth.uid() is not null then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  perform set_config('app.guest_promo_code', coalesce(upper(nullif(btrim(p_payload->>'promo_code'), '')), ''), true);
  v_res := public.training_guest_checkout(p_slug, p_user, p_payload);
  perform set_config('app.guest_promo_code', '', true);
  return v_res;
end;
$$;

-- ===========================================================================
-- 8) GLOBAL SEARCH
-- ===========================================================================
-- Returns at most p_limit rows (kind, id, title, subtitle, score) visible to
-- the caller: athletes (staff of the club; coaches only their athletes;
-- guardians only their children), families (finance; guardians their own),
-- coaches (staff), programmes / camps (staff; members the published ones),
-- teams (staff; guardians their children's), invoices by number (finance;
-- guardians their family's), products (members: active ones). No medical
-- or contact data is ever returned.
create or replace function public.global_search(p_q text, p_kinds text[] default null, p_limit integer default 20)
returns table (kind text, id uuid, title text, subtitle text, score integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_fin    boolean := public.is_finance();
  v_admin  boolean := public.is_admin();
  v_coach  uuid := public.current_coach_id();
  v_staff  boolean := public.is_finance() or public.has_role('coach');
  v_q      text := public.search_fold(btrim(coalesce(p_q, '')));
  v_like   text;
  v_lim    int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_per    int := least(greatest(coalesce(p_limit, 20), 1), 50) / 2 + 1;
begin
  if auth.uid() is null or v_org is null or length(v_q) < 2 or length(v_q) > 80 then return; end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return query
  with
  ath as (
    select 'athlete'::text as kind, a.id, btrim(a.first_name || ' ' || a.last_name) as title, null::text as subtitle,
           public.search_fold(a.first_name || ' ' || a.last_name) as f
      from public.athletes a
     where (p_kinds is null or 'athlete' = any(p_kinds))
       and a.org_id = v_org
       and public.search_fold(a.first_name || ' ' || a.last_name) like v_like
       and (v_fin or (v_coach is not null and public.coach_can_access_athlete(a.id)) or public.is_guardian_of_athlete(a.id))
     limit v_per
  ),
  fam as (
    select 'family'::text, f.id, f.name, f.contact_name, public.search_fold(f.name || ' ' || coalesce(f.contact_name, ''))
      from public.families f
     where (p_kinds is null or 'family' = any(p_kinds))
       and f.org_id = v_org
       and public.search_fold(f.name || ' ' || coalesce(f.contact_name, '')) like v_like
       and (v_fin or public.is_guardian_of_family(f.id))
     limit v_per
  ),
  coa as (
    select 'coach'::text, c.id, c.display_name, c.role_title, public.search_fold(c.display_name)
      from public.coaches c
     where (p_kinds is null or 'coach' = any(p_kinds))
       and v_staff and c.org_id = v_org and c.is_active
       and public.search_fold(c.display_name) like v_like
     limit v_per
  ),
  prg as (
    select case when p.kind::text = 'camp' then 'camp' else 'program' end, p.id, p.name, p.kind::text, public.search_fold(p.name)
      from public.programs p
     where (p_kinds is null or 'program' = any(p_kinds) or 'camp' = any(p_kinds))
       and p.org_id = v_org
       and public.search_fold(p.name) like v_like
       and coalesce(p.status, 'published') <> 'archived'
       and (v_staff or (p.is_active and coalesce(p.status, 'published') = 'published'))
     limit v_per
  ),
  tea as (
    select 'team'::text, t.id, t.name, t.age_group, public.search_fold(t.name)
      from public.teams t
     where (p_kinds is null or 'team' = any(p_kinds))
       and t.org_id = v_org and t.is_active
       and public.search_fold(t.name) like v_like
       and (v_staff or exists (select 1 from public.team_memberships tm
                                where tm.team_id = t.id and public.is_guardian_of_athlete(tm.athlete_id)))
     limit v_per
  ),
  inv as (
    select 'invoice'::text, i.id, i.number, i.description, public.search_fold(i.number)
      from public.invoices i
     where (p_kinds is null or 'invoice' = any(p_kinds))
       and i.org_id = v_org
       and public.search_fold(i.number) like v_like
       and (v_fin or public.is_guardian_of_family(i.family_id))
     limit v_per
  ),
  prd as (
    select 'product'::text, p.id, p.name, p.category, public.search_fold(p.name || ' ' || coalesce(p.category, ''))
      from public.shop_products p
     where (p_kinds is null or 'product' = any(p_kinds))
       and p.org_id = v_org and (v_admin or v_fin or p.is_active)
       and public.search_fold(p.name || ' ' || coalesce(p.category, '')) like v_like
     limit v_per
  ),
  allr as (
    select * from ath union all select * from fam union all select * from coa union all select * from prg
    union all select * from tea union all select * from inv union all select * from prd
  )
  select r.kind, r.id, r.title, r.subtitle,
         (case when r.f like v_q || '%' then 300
               when r.f like '% ' || v_q || '%' then 200
               else 100 end - least(length(r.title), 99))::integer as score
    from allr r
   order by 5 desc, r.title
   limit v_lim;
end;
$$;

-- ===========================================================================
-- 9b) MEMBER CARD RPCs
--   Token "M1.<nonce 32 hex>.<sig 32 hex>"; sig = first 32 hex chars of
--   HMAC-SHA256(nonce || '.' || version, club key). No personal data; a
--   rotation issues a new nonce (old tokens stop working).
-- ===========================================================================
create or replace function public.member_card_sign(p_org uuid, p_nonce text, p_version integer)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare v_key text;
begin
  select secret into v_key from public.member_card_keys where org_id = p_org;
  if v_key is null then
    insert into public.member_card_keys (org_id, secret) values (p_org, encode(gen_random_bytes(32), 'hex'))
    on conflict (org_id) do nothing;
    select secret into v_key from public.member_card_keys where org_id = p_org;
  end if;
  return left(encode(hmac(p_nonce || '.' || p_version::text, v_key, 'sha256'), 'hex'), 32);
end;
$$;

-- Token of an athlete's card (issued on first use). Admin of the club or the
-- athlete's guardian.
create or replace function public.member_card_token(p_athlete uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid;
  c     public.member_cards;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or public.is_guardian_of_athlete(p_athlete)) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select * into c from public.member_cards where athlete_id = p_athlete;
  if not found then
    insert into public.member_cards (org_id, athlete_id, nonce) values (v_org, p_athlete, encode(gen_random_bytes(16), 'hex'))
    on conflict (athlete_id) do nothing;
    select * into c from public.member_cards where athlete_id = p_athlete;
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_org, auth.uid(), 'MEMBER_CARD_ISSUED', 'member_cards', c.id, jsonb_build_object('athlete_id', p_athlete));
  end if;
  if not c.is_active then raise exception 'CARD_INACTIVE' using errcode = 'P0001'; end if;
  return 'M1.' || c.nonce || '.' || public.member_card_sign(v_org, c.nonce, c.version);
end;
$$;

-- New nonce (lost card): admin or guardian.
create or replace function public.rotate_member_card(p_athlete uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid;
  c     public.member_cards;
begin
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (public.is_admin() or public.is_guardian_of_athlete(p_athlete)) then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  perform public.member_card_token(p_athlete);   -- make sure a card exists
  update public.member_cards set nonce = encode(gen_random_bytes(16), 'hex'), version = version + 1,
                                 rotated_at = now(), is_active = true
   where athlete_id = p_athlete returning * into c;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'MEMBER_CARD_ROTATED', 'member_cards', c.id, jsonb_build_object('athlete_id', p_athlete, 'version', c.version));
  return 'M1.' || c.nonce || '.' || public.member_card_sign(v_org, c.nonce, c.version);
end;
$$;

-- Admin: assign (or clear with null) the NFC bracelet / tag serial number.
create or replace function public.assign_member_tag(p_athlete uuid, p_tag text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org uuid;
  v_tag text := nullif(upper(regexp_replace(coalesce(p_tag, ''), '[^0-9A-Fa-f]', '', 'g')), '');
  c     public.member_cards;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED' using errcode = '42501'; end if;
  select org_id into v_org from public.athletes where id = p_athlete;
  if v_org is null or v_org is distinct from public.current_org_id() then raise exception 'ATHLETE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_tag is not null and (length(v_tag) < 4 or length(v_tag) > 40) then raise exception 'TAG_INVALID' using errcode = 'P0001'; end if;
  if v_tag is not null and exists (select 1 from public.member_cards where org_id = v_org and nfc_tag_id = v_tag and athlete_id <> p_athlete) then
    raise exception 'TAG_IN_USE' using errcode = 'P0001';
  end if;
  perform public.member_card_token(p_athlete);
  update public.member_cards set nfc_tag_id = v_tag where athlete_id = p_athlete returning * into c;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (v_org, auth.uid(), 'MEMBER_TAG_ASSIGNED', 'member_cards', c.id,
          jsonb_build_object('athlete_id', p_athlete, 'has_tag', v_tag is not null));
  return jsonb_build_object('athlete_id', p_athlete, 'nfc_tag_id', v_tag);
end;
$$;

-- Resolve a scanned QR token or NFC tag id to an athlete — only inside the
-- caller's club and only for athletes the caller may access (admin, or a
-- coach working with the athlete). Unknown, forged, rotated or foreign
-- tokens all return no row (no hint which).
create or replace function public.resolve_member_token(p_token text)
returns table (athlete_id uuid, first_name text, last_name text)
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_org   uuid := public.current_org_id();
  v_tok   text := btrim(coalesce(p_token, ''));
  v_parts text[];
  v_tag   text;
  c       public.member_cards;
begin
  if auth.uid() is null or v_org is null then return; end if;
  if not (public.is_admin() or public.has_role('coach')) then return; end if;
  if length(v_tok) > 200 then return; end if;

  if v_tok ~ '^M1\.[0-9a-f]{32}\.[0-9a-f]{32}$' then
    v_parts := string_to_array(v_tok, '.');
    select * into c from public.member_cards m where m.nonce = v_parts[2] and m.org_id = v_org and m.is_active;
    if not found then return; end if;
    if public.member_card_sign(v_org, c.nonce, c.version) <> v_parts[3] then return; end if;
  else
    v_tag := nullif(upper(regexp_replace(v_tok, '[^0-9A-Fa-f]', '', 'g')), '');
    if v_tag is null or length(v_tag) < 4 then return; end if;
    select * into c from public.member_cards m where m.nfc_tag_id = v_tag and m.org_id = v_org and m.is_active;
    if not found then return; end if;
  end if;

  if not (public.is_admin() or public.coach_can_access_athlete(c.athlete_id)) then return; end if;
  return query select a.id, a.first_name, a.last_name from public.athletes a where a.id = c.athlete_id and a.org_id = v_org;
end;
$$;

-- ===========================================================================
-- 10) EXECUTE grants: nothing for anon; service-role-only RPCs closed to
--     authenticated; internal helpers closed to everyone but the service.
-- ===========================================================================
do $$
declare f text;
begin
  -- signed-in members (the function checks the role itself)
  foreach f in array array[
    'public.shop_set_order_status(uuid, text, text)',
    'public.shop_adjust_stock(uuid, integer, text, text)',
    'public.purchase_training_package(uuid, uuid, uuid, text, text, text, uuid[])',
    'public.book_training(uuid, uuid, uuid, timestamptz, text, uuid, uuid, text, boolean, text, text, uuid[])',
    'public.global_search(text, text[], integer)',
    'public.member_card_token(uuid)',
    'public.rotate_member_card(uuid)',
    'public.assign_member_tag(uuid, text)',
    'public.resolve_member_token(text)',
    'public.club_media_can_write(text)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('grant execute on function %s to authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  -- service role only / internal
  foreach f in array array[
    'public.shop_place_order(jsonb)',
    'public.shop_release_order_stock(uuid, uuid)',
    'public.shop_order_on_invoice_status()',
    'public.shop_same_org_guard()',
    'public.shop_variant_stock_guard()',
    'public.sport_same_org_guard()',
    'public.discount_evaluate(uuid, text, uuid, uuid, numeric, text, text, uuid, date, uuid[], boolean)',
    'public.training_purchase_discount(uuid, uuid, uuid, uuid, numeric, text)',
    'public.training_record_discounts(uuid, jsonb, text, uuid, uuid, uuid, uuid, text, text)',
    'public.training_create_purchase(uuid, uuid, uuid, uuid, text, text)',
    'public.training_discount_inputs(text, uuid[], date)',
    'public.training_guest_checkout_promo(text, uuid, jsonb)',
    'public.member_card_sign(uuid, text, integer)'
  ] loop
    execute format('revoke all on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;

  execute 'grant execute on function public.search_fold(text) to public';
end $$;
