-- ============================================================================
-- Shop, training discounts, sports & locations, global search, member cards
-- (migration 20250420100900_shop_search_sports_rollcall.sql)
--
--   A. Migration re-run is idempotent; sports backfill from the club sport
--   B. sports: RLS per verb, cross-tenant denial, sport_id same-club guard
--   C. shop catalogue: RLS per verb, cross-tenant denial, stock only via
--      movements, stock can never go negative
--   D. shop_place_order(): service role only, guest + member, stock reserved,
--      invoice lines, promo limits, out of stock rolls back, members-only
--      products, order RLS, invoice paid / cancelled drives the order,
--      admin transitions, cross-tenant denial on every RPC
--   E. training discounts: early bird + promo code (limits) on purchases and
--      bookings, applied_discounts recorded, manual discounts admin-only
--   F. global_search(): role-aware, accent-insensitive, tenant-scoped
--   G. member cards: token issue / rotate / resolve (coach access only, own
--      club only), NFC tag, key table closed, HMAC vector matches TS
--   H. club-media bucket: admins write in their own club folder only
--   I. audit rows
--
-- Fixtures (seed.sql): org A …0001 (admin …f1, finance …f2, coach …f3 =
-- coach …011, guardian …f4 of family …061 / athlete Mateo …071); Lucas …072
-- and Sophia …073 (family …062) attended a session of coach …011. Org B =
-- 10000000-…-0002; its admin is created here. SYNTHETIC DATA ONLY.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema ss;
grant usage on schema ss to authenticated, anon, service_role;

create function ss.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function ss.run_as(p uuid, p_sql text) returns text language plpgsql as $$
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

-- As the service (no user): same result convention.
create function ss.run_svc(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    execute 'reset role';
    perform set_config('request.jwt.claim.sub', '', true);
    execute p_sql into v_res;
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema ss to authenticated, anon, service_role;

create table ss.ctx (k text primary key, v text);
grant all on ss.ctx to authenticated, anon, service_role;
create function ss.get(p text) returns text language sql as $$ select v from ss.ctx where k = p $$;
grant execute on function ss.get(text) to authenticated, anon, service_role;

-- Org B admin + a family / athlete in org B
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test') on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'coach')
on conflict do nothing;
insert into public.families (id, org_id, name) values ('b0000000-0000-0000-0000-000000000061', '10000000-0000-0000-0000-000000000002', 'Synthetic B family') on conflict do nothing;
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status)
values ('b0000000-0000-0000-0000-000000000071', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000061', 'Zoé', 'Synthetic', '2015-01-01', 'active')
on conflict do nothing;
-- An org A athlete nobody coaches (coach …011 has no link to her)
insert into public.athletes (id, org_id, family_id, first_name, last_name, dob, status)
values ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Élodie', 'Unlinked', '2014-05-05', 'active')
on conflict do nothing;

-- ===========================================================================
-- A. Re-run + backfill
-- ===========================================================================
\i supabase/migrations/20250420100900_shop_search_sports_rollcall.sql
\i supabase/migrations/20250420100900_shop_search_sports_rollcall.sql

do $$
begin
  perform ss.ok(true, 'migration applies twice more (idempotent)');
  perform ss.ok((select count(*) from public.sports where org_id = '00000000-0000-0000-0000-000000000001' and lower(name) = 'basketball') = 1,
                'backfill: the club sport became one sport row (no duplicate on re-run)');
  perform ss.ok(not exists (select 1 from public.teams t join public.sports s on s.org_id = t.org_id
                             where t.sport_id is null and t.sport is not null
                               and public.search_fold(t.sport) = public.search_fold(s.name)),
                'backfill: every team whose text sport matches a sport has sport_id');
  perform ss.ok(public.search_fold('Élodie Müller-Ça') = 'elodie muller-ca', 'search_fold strips accents and case');
  perform ss.ok((select public from storage.buckets where id = 'club-media'), 'club-media bucket exists and is public (no personal data)');
end $$;

-- ===========================================================================
-- B. Sports
-- ===========================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; fin uuid := '00000000-0000-0000-0000-0000000000f2';
  co uuid := '00000000-0000-0000-0000-0000000000f3'; pa uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1'; v text; v_sport uuid; v_bsport uuid;
begin
  v := ss.run_as(a, $q$insert into public.sports (org_id, name, icon, terminology) values ('00000000-0000-0000-0000-000000000001', 'Volleyball', 'volleyball', '{"athlete":"player"}') returning id::text$q$);
  perform ss.ok(v like 'OK:%', 'sports: admin inserts (' || v || ')');
  v_sport := substr(v, 4)::uuid;
  insert into ss.ctx values ('sport', v_sport::text);
  perform ss.ok(ss.run_as(fin, $q$insert into public.sports (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Tennis') returning id::text$q$) like 'ERR:%', 'sports: finance cannot insert');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.sports where name = 'Volleyball'$q$) = 'OK:1', 'sports: members read their club''s sports');
  perform ss.ok(ss.run_as(co, format($q$with u as (update public.sports set name = 'X' where id = %L returning 1) select count(*)::text from u$q$, v_sport)) = 'OK:0', 'sports: coach cannot update');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.sports where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'sports: org B reads none of org A');
  perform ss.ok(ss.run_as(b, $q$insert into public.sports (org_id, name) values ('00000000-0000-0000-0000-000000000001', 'Hack') returning id::text$q$) like 'ERR:%', 'sports: org B cannot insert into org A');
  perform ss.ok(ss.run_as(b, format($q$with u as (update public.sports set name = 'Hack' where id = %L returning 1) select count(*)::text from u$q$, v_sport)) = 'OK:0', 'sports: org B cannot update org A');
  perform ss.ok(ss.run_as(b, format($q$with d as (delete from public.sports where id = %L returning 1) select count(*)::text from d$q$, v_sport)) = 'OK:0', 'sports: org B cannot delete org A');
  perform ss.ok(ss.run_as(null, $q$select count(*)::text from public.sports$q$) like 'ERR:%', 'sports: anon has no access');

  v := ss.run_as(b, $q$insert into public.sports (org_id, name) values ('10000000-0000-0000-0000-000000000002', 'Rowing') returning id::text$q$);
  v_bsport := substr(v, 4)::uuid;
  perform ss.ok(ss.run_svc(format($q$update public.programs set sport_id = %L where org_id = '00000000-0000-0000-0000-000000000001' returning id::text$q$, v_bsport)) like 'ERR:%CROSS_ORG%',
                'sports: a programme cannot point at another club''s sport');
  perform ss.ok(ss.run_as(a, format($q$with u as (update public.programs set sport_id = %L where org_id = '00000000-0000-0000-0000-000000000001' returning 1) select count(*)::text from u$q$, v_sport)) not like 'ERR:%',
                'sports: admin tags programmes with a club sport');
  v := ss.run_as(a, format($q$with d as (delete from public.sports where id = %L returning 1) select count(*)::text from d$q$, v_sport));
  perform ss.ok(v = 'OK:1' and not exists (select 1 from public.programs where sport_id = v_sport),
                'sports: admin deletes; tagged rows fall back to no sport (' || v || ')');
end $$;

-- ===========================================================================
-- C. Catalogue + stock
-- ===========================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; fin uuid := '00000000-0000-0000-0000-0000000000f2';
  pa uuid := '00000000-0000-0000-0000-0000000000f4'; b uuid := 'b0000000-0000-0000-0000-0000000000b1';
  v text; v_p uuid; v_m uuid; v_h uuid; v_s uuid; v_l uuid; v_x uuid;
begin
  v := ss.run_as(a, $q$insert into public.shop_products (org_id, name, price, currency, category, visibility, pickup_available, shipping_available, shipping_fee)
                      values ('00000000-0000-0000-0000-000000000001', 'Club T-shirt', 30, 'CHF', 'Apparel', 'public', true, true, 8) returning id::text$q$);
  perform ss.ok(v like 'OK:%', 'products: admin inserts (' || v || ')');
  v_p := substr(v, 4)::uuid;
  v := ss.run_as(a, $q$insert into public.shop_products (org_id, name, price, currency, visibility, shipping_available, shipping_fee) values ('00000000-0000-0000-0000-000000000001', 'Members hoodie', 60, 'CHF', 'members', true, 5) returning id::text$q$);
  v_m := substr(v, 4)::uuid;
  v := ss.run_as(a, $q$insert into public.shop_products (org_id, name, price, currency, is_active) values ('00000000-0000-0000-0000-000000000001', 'Hidden draft', 10, 'CHF', false) returning id::text$q$);
  v_h := substr(v, 4)::uuid;
  perform ss.ok(ss.run_as(fin, $q$insert into public.shop_products (org_id, name, price, currency) values ('00000000-0000-0000-0000-000000000001', 'x', 1, 'CHF') returning id::text$q$) like 'ERR:%', 'products: finance cannot insert');
  perform ss.ok(ss.run_as(pa, $q$insert into public.shop_products (org_id, name, price, currency) values ('00000000-0000-0000-0000-000000000001', 'x', 1, 'CHF') returning id::text$q$) like 'ERR:%', 'products: parent cannot insert');

  v := ss.run_as(a, format($q$insert into public.shop_product_variants (org_id, product_id, sku, size) values ('00000000-0000-0000-0000-000000000001', %L, 'TS-S', 'S') returning id::text$q$, v_p));
  v_s := substr(v, 4)::uuid;
  v := ss.run_as(a, format($q$insert into public.shop_product_variants (org_id, product_id, sku, size) values ('00000000-0000-0000-0000-000000000001', %L, 'TS-L', 'L') returning id::text$q$, v_p));
  v_l := substr(v, 4)::uuid;
  v := ss.run_as(a, format($q$insert into public.shop_product_variants (org_id, product_id, sku, size) values ('00000000-0000-0000-0000-000000000001', %L, 'HD-M', 'M') returning id::text$q$, v_m));
  v_x := substr(v, 4)::uuid;
  perform ss.ok(v_s is not null and v_l is not null and v_x is not null, 'variants: admin inserts variants with SKU');
  perform ss.ok(ss.run_as(a, format($q$insert into public.shop_product_variants (org_id, product_id, sku, stock) values ('00000000-0000-0000-0000-000000000001', %L, 'TS-XL', 50) returning id::text$q$, v_p)) like 'ERR:%STOCK_VIA_MOVEMENTS%',
                'variants: initial stock only through a restock movement');
  perform ss.ok(ss.run_as(a, format($q$insert into public.shop_product_variants (org_id, product_id, sku) values ('00000000-0000-0000-0000-000000000001', %L, 'ts-s') returning id::text$q$, v_p)) like 'ERR:%',
                'variants: SKU unique per club (case-insensitive)');
  insert into ss.ctx values ('p', v_p::text), ('m', v_m::text), ('h', v_h::text), ('s', v_s::text), ('l', v_l::text), ('x', v_x::text);

  -- stock via movements
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_adjust_stock(%L, 5, 'restock', null))->>'stock'$q$, v_s)) = 'OK:5', 'stock: restock +5');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_adjust_stock(%L, 3, 'restock', null))->>'stock'$q$, v_l)) = 'OK:3', 'stock: restock L +3');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_adjust_stock(%L, 2, 'restock', null))->>'stock'$q$, v_x)) = 'OK:2', 'stock: restock hoodie +2');
  perform ss.ok(ss.run_as(a, format($q$select public.shop_adjust_stock(%L, -10, 'adjustment', 'count')::text$q$, v_s)) like 'ERR:%STOCK_NEGATIVE%', 'stock: an adjustment below zero is refused');
  perform ss.ok(ss.run_as(a, format($q$select public.shop_adjust_stock(%L, -1, 'adjustment', null)::text$q$, v_s)) like 'ERR:%REASON_REQUIRED%', 'stock: an adjustment needs a reason');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_adjust_stock(%L, -1, 'adjustment', 'damaged'))->>'stock'$q$, v_s)) = 'OK:4', 'stock: adjustment with reason -1');
  perform ss.ok(ss.run_as(a, format($q$with u as (update public.shop_product_variants set stock = 99 where id = %L returning 1) select count(*)::text from u$q$, v_s)) like 'ERR:%STOCK_VIA_MOVEMENTS%',
                'stock: a direct stock update is refused');
  perform ss.ok(ss.run_svc(format($q$update public.shop_product_variants set stock = -1 where id = %L returning id::text$q$, v_s)) like 'ERR:%shop_variants_stock_nonneg%',
                'stock: the database never stores negative stock (even for the service)');
  perform ss.ok((select string_agg(kind || ':' || quantity || '>' || stock_after, ',' order by quantity desc) from public.shop_stock_movements where variant_id = v_s) = 'restock:5>5,adjustment:-1>4',
                'stock: movements log restock and adjustment with stock after');
  perform ss.ok(ss.run_as(fin, format($q$select public.shop_adjust_stock(%L, 1, 'restock', null)::text$q$, v_s)) like 'ERR:%NOT_AUTHORIZED%', 'stock: finance cannot adjust');
  perform ss.ok(ss.run_as(b, format($q$select public.shop_adjust_stock(%L, 1, 'restock', null)::text$q$, v_s)) like 'ERR:%VARIANT_NOT_FOUND%', 'stock: org B cannot adjust org A stock');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.shop_stock_movements where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'movements: org B reads none of org A');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.shop_stock_movements$q$) = 'OK:0', 'movements: parents read none');
  perform ss.ok(ss.run_as(a, format($q$insert into public.shop_stock_movements (org_id, variant_id, product_id, kind, quantity, stock_after) values ('00000000-0000-0000-0000-000000000001', %L, %L, 'restock', 1, 1) returning id::text$q$, v_s, v_p)) like 'ERR:%',
                'movements: no direct insert');

  -- reads
  perform ss.ok(ss.run_as(pa, format($q$select count(*)::text from public.shop_products where id in (%L, %L, %L)$q$, v_p, v_m, v_h)) = 'OK:2', 'products: members see active products, not inactive ones');
  perform ss.ok(ss.run_as(a, format($q$select count(*)::text from public.shop_products where id in (%L, %L, %L)$q$, v_p, v_m, v_h)) = 'OK:3', 'products: admin sees all');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.shop_products where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'products: org B reads none of org A');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.shop_product_variants where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'variants: org B reads none of org A');
  perform ss.ok(ss.run_as(b, format($q$with u as (update public.shop_products set price = 1 where id = %L returning 1) select count(*)::text from u$q$, v_p)) = 'OK:0', 'products: org B cannot update org A');
  perform ss.ok(ss.run_as(b, format($q$with d as (delete from public.shop_products where id = %L returning 1) select count(*)::text from d$q$, v_h)) = 'OK:0', 'products: org B cannot delete org A');
  perform ss.ok(ss.run_as(b, format($q$with d as (delete from public.shop_product_variants where id = %L returning 1) select count(*)::text from d$q$, v_s)) = 'OK:0', 'variants: org B cannot delete org A');
  perform ss.ok(ss.run_as(b, format($q$insert into public.shop_product_variants (org_id, product_id) values ('10000000-0000-0000-0000-000000000002', %L) returning id::text$q$, v_p)) like 'ERR:%',
                'variants: org B cannot hang a variant on an org A product');
  perform ss.ok(ss.run_as(null, $q$select count(*)::text from public.shop_products$q$) like 'ERR:%', 'products: anon has no table access (public shop goes through the server)');
end $$;

-- ===========================================================================
-- D. Orders
-- ===========================================================================
-- promo codes for the shop
insert into public.discounts (org_id, name, kind, value, scope, rule, code, max_redemptions)
values ('00000000-0000-0000-0000-000000000001', 'Shop launch', 'percent', 10, 'shop', 'promo_code', 'SHOP10', 1),
       ('00000000-0000-0000-0000-000000000001', 'Camp only', 'percent', 50, 'camps', 'promo_code', 'CAMP50', null);

create function ss.order_payload(p_mode text, p_items jsonb, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('org_id', '00000000-0000-0000-0000-000000000001', 'mode', p_mode,
                            'buyer', jsonb_build_object('name', 'Guest Buyer', 'email', 'guest.buyer@example.test'),
                            'fulfillment', 'pickup', 'items', p_items,
                            'access_token_hash', encode(sha256(gen_random_uuid()::text::bytea), 'hex')) || p_extra;
$$;
grant execute on function ss.order_payload(text, jsonb, jsonb) to authenticated, anon, service_role;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; fin uuid := '00000000-0000-0000-0000-0000000000f2';
  pa uuid := '00000000-0000-0000-0000-0000000000f4'; b uuid := 'b0000000-0000-0000-0000-0000000000b1';
  v_s uuid := ss.get('s')::uuid; v_l uuid := ss.get('l')::uuid; v_x uuid := ss.get('x')::uuid;
  v text; r jsonb; v_o uuid; v_o2 uuid; v_inv uuid;
begin
  perform ss.ok(ss.run_as(a, format($q$select public.shop_place_order(%L::jsonb)::text$q$,
                ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1))))) like 'ERR:%',
                'place_order: signed-in users cannot call it (service role only)');
  perform ss.ok(ss.run_as(null, format($q$select public.shop_place_order(%L::jsonb)::text$q$,
                ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1))))) like 'ERR:%',
                'place_order: anon cannot call it');

  -- guest order: 2 x S + 1 x L, promo SHOP10
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 2), jsonb_build_object('variant_id', v_l, 'quantity', 1)),
                          '{"promo_code": "shop10", "labels": {"invoice": "Boutique", "shipping": "Livraison"}}'::jsonb)));
  perform ss.ok(v like 'OK:%', 'place_order: guest order placed (' || left(v, 200) || ')');
  r := substr(v, 4)::jsonb;
  v_o := (r->>'order_id')::uuid; v_inv := (r->>'invoice_id')::uuid;
  insert into ss.ctx values ('o', v_o::text), ('inv', v_inv::text);
  perform ss.ok((r->>'subtotal')::numeric = 90 and (r->>'discount_total')::numeric = 9 and (r->>'total')::numeric = 81 and r->>'currency' = 'CHF',
                'place_order: prices from the database, 10% promo on the subtotal');
  perform ss.ok((select stock from public.shop_product_variants where id = v_s) = 2 and (select stock from public.shop_product_variants where id = v_l) = 2,
                'place_order: stock reserved (S 4 -> 2, L 3 -> 2)');
  perform ss.ok((select count(*) from public.shop_stock_movements where order_id = v_o and kind = 'sale') = 2, 'place_order: sale movements logged');
  perform ss.ok((select total_chf = 81 and status::text = 'sent' and description like 'Boutique SO-%' from public.invoices where id = v_inv)
            and (select count(*) from public.invoice_items where invoice_id = v_inv) = 3
            and (select sum(amount_chf) from public.invoice_items where invoice_id = v_inv) = 81,
                'place_order: invoice with product lines and a negative discount line, label from the server');
  perform ss.ok((select membership_status = 'guest' from public.families f join public.shop_orders o on o.family_id = f.id where o.id = v_o),
                'place_order: guest buyer gets a non-member family');
  perform ss.ok((select count(*) from public.applied_discounts where source = 'shop' and source_id = v_o and amount = 9 and code = 'SHOP10') = 1,
                'place_order: applied discount recorded (source shop)');
  perform ss.ok((select status from public.shop_orders where id = v_o) = 'pending_payment', 'place_order: order waits for payment');

  -- promo usage limit (max 1)
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)), '{"promo_code": "SHOP10"}'::jsonb)));
  perform ss.ok(v like 'ERR:%PROMO_LIMIT_REACHED%', 'place_order: promo usage limit enforced (' || v || ')');
  perform ss.ok((select stock from public.shop_product_variants where id = v_s) = 2, 'place_order: a refused order leaves stock untouched');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)), '{"promo_code": "CAMP50"}'::jsonb)));
  perform ss.ok(v like 'ERR:%PROMO_OUT_OF_SCOPE%', 'place_order: a camps-only code does not apply to the shop');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 3)))));
  perform ss.ok(v like 'ERR:%OUT_OF_STOCK%', 'place_order: cannot order more than the stock');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_x, 'quantity', 1)))));
  perform ss.ok(v like 'ERR:%PRODUCT_NOT_AVAILABLE%', 'place_order: guests cannot buy members-only products');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)), '{"org_id": "10000000-0000-0000-0000-000000000002"}'::jsonb)));
  perform ss.ok(v like 'ERR:%PRODUCT_NOT_AVAILABLE%', 'place_order: a variant of another club is not sold');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)), '{"fulfillment": "shipping"}'::jsonb)));
  perform ss.ok(v like 'ERR:%ADDRESS_REQUIRED%', 'place_order: shipping needs an address');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)), '{"expected_total": 1}'::jsonb)));
  perform ss.ok(v like 'ERR:%PRICE_CHANGED%', 'place_order: price integrity check');

  -- member order (guardian …f4, family …061): members-only hoodie, shipped
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('member', jsonb_build_array(jsonb_build_object('variant_id', v_x, 'quantity', 1)),
           jsonb_build_object('profile_id', pa, 'family_id', '00000000-0000-0000-0000-000000000061', 'fulfillment', 'shipping',
                              'shipping_address', 'Rue de Test 1, 1000 Lausanne'))));
  perform ss.ok(v like 'OK:%', 'place_order: member order for members-only product (' || left(v, 120) || ')');
  r := substr(v, 4)::jsonb;
  perform ss.ok((r->>'shipping_total')::numeric = 5 and (r->>'total')::numeric = 65, 'place_order: shipping fee added once');
  v_o2 := (r->>'order_id')::uuid;
  insert into ss.ctx values ('o2', v_o2::text);
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('member', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)),
           jsonb_build_object('profile_id', 'b0000000-0000-0000-0000-0000000000b1'))));
  perform ss.ok(v like 'ERR:%NOT_A_MEMBER%', 'place_order: a member of another club is not a member here');
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('member', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1)),
           jsonb_build_object('profile_id', pa, 'family_id', '00000000-0000-0000-0000-000000000062'))));
  perform ss.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'place_order: a member cannot charge another family');

  -- order RLS
  perform ss.ok(ss.run_as(pa, format($q$select count(*)::text from public.shop_orders where id in (%L, %L)$q$, v_o, v_o2)) = 'OK:1', 'orders: guardian sees own order, not a guest''s');
  perform ss.ok(ss.run_as(pa, format($q$select count(*)::text from public.shop_order_items where order_id = %L$q$, v_o)) = 'OK:0', 'order items: guardian does not see others'' items');
  perform ss.ok(ss.run_as(fin, format($q$select count(*)::text from public.shop_orders where id in (%L, %L)$q$, v_o, v_o2)) = 'OK:2', 'orders: finance sees all orders');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.shop_orders where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'orders: org B reads none of org A');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.shop_order_items where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'order items: org B reads none of org A');
  perform ss.ok(ss.run_as(a, format($q$with u as (update public.shop_orders set total = 0 where id = %L returning 1) select count(*)::text from u$q$, v_o)) = 'OK:0', 'orders: no direct update (RPCs only)');
  perform ss.ok(ss.run_as(a, format($q$with d as (delete from public.shop_orders where id = %L returning 1) select count(*)::text from d$q$, v_o)) = 'OK:0', 'orders: no direct delete');
  perform ss.ok(ss.run_as(pa, $q$insert into public.shop_orders (org_id, number, buyer_name, buyer_email, currency) values ('00000000-0000-0000-0000-000000000001', 'X', 'x', 'x@x.test', 'CHF') returning id::text$q$) like 'ERR:%',
                'orders: no direct insert');

  -- transitions
  perform ss.ok(ss.run_as(a, format($q$select public.shop_set_order_status(%L, 'fulfilled')::text$q$, v_o)) like 'ERR:%INVALID_TRANSITION%', 'status: an unpaid order cannot be fulfilled');
  perform ss.ok(ss.run_as(b, format($q$select public.shop_set_order_status(%L, 'cancelled', 'x')::text$q$, v_o)) like 'ERR:%ORDER_NOT_FOUND%', 'status: org B cannot touch org A orders');
  perform ss.ok(ss.run_as(fin, format($q$select public.shop_set_order_status(%L, 'cancelled', 'x')::text$q$, v_o)) like 'ERR:%NOT_AUTHORIZED%', 'status: finance cannot change order status');
  update public.invoices set status = 'paid', paid_at = now() where id = v_inv;
  perform ss.ok((select status = 'paid' and paid_at is not null from public.shop_orders where id = v_o), 'invoice paid -> order paid');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_set_order_status(%L, 'ready_for_pickup'))->>'status'$q$, v_o)) = 'OK:ready_for_pickup', 'status: paid -> ready for pickup');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_set_order_status(%L, 'fulfilled'))->>'status'$q$, v_o)) = 'OK:fulfilled', 'status: ready -> fulfilled');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_set_order_status(%L, 'refunded', 'returned'))->>'status'$q$, v_o)) = 'OK:refunded'
            and (select stock from public.shop_product_variants where id = v_s) = 2,
                'status: a refund after hand-over keeps stock as is (admin restocks returns)');

  -- cancel an unpaid order: invoice cancelled, stock released once
  perform ss.ok(ss.run_as(a, format($q$select public.shop_set_order_status(%L, 'cancelled', null)::text$q$, v_o2)) like 'ERR:%REASON_REQUIRED%', 'status: cancelling needs a reason');
  perform ss.ok(ss.run_as(a, format($q$select (public.shop_set_order_status(%L, 'cancelled', 'customer changed mind'))->>'status'$q$, v_o2)) = 'OK:cancelled', 'status: pending -> cancelled');
  perform ss.ok((select i.status::text from public.invoices i join public.shop_orders o on o.invoice_id = i.id where o.id = v_o2) = 'cancelled', 'cancel: the unpaid invoice is cancelled');
  perform ss.ok((select stock from public.shop_product_variants where id = v_x) = 2
            and (select count(*) from public.shop_stock_movements where order_id = v_o2 and kind = 'release') = 1,
                'cancel: stock released exactly once');
end $$;

-- An order whose invoice is cancelled from the invoices screen is cancelled too.
do $$
declare v text; r jsonb; v_s uuid := ss.get('s')::uuid;
begin
  v := ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 2)))));
  r := substr(v, 4)::jsonb;
  perform ss.ok((select stock from public.shop_product_variants where id = v_s) = 0, 'reserve: last two units reserved');
  perform ss.ok(ss.run_svc(format($q$select public.shop_place_order(%L::jsonb)::text$q$,
         ss.order_payload('guest', jsonb_build_array(jsonb_build_object('variant_id', v_s, 'quantity', 1))))) like 'ERR:%OUT_OF_STOCK%',
                'reserve: nothing left to sell');
  perform ss.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.cancel_invoice(%L, 'duplicate')::text$q$, r->>'invoice_id'));
  perform ss.ok((select status from public.shop_orders where id = (r->>'order_id')::uuid) = 'cancelled'
            and (select stock from public.shop_product_variants where id = v_s) = 2,
                'invoice cancelled -> order cancelled, stock back');
end $$;

-- ===========================================================================
-- E. Training discounts
-- ===========================================================================
update public.app_settings
   set settings = coalesce(settings, '{}'::jsonb) || '{"bookings_enabled": true}'::jsonb
 where org_id = '00000000-0000-0000-0000-000000000001';
insert into public.training_services (id, org_id, slug, name, duration_min, price_chf, session_type, max_participants, min_participants)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000001', 'ss-shooting', 'SS Shooting', 60, 100, 'individual', 1, 1)
on conflict do nothing;
insert into public.credit_packages (id, org_id, service_id, name, credit_category, credits, price_chf)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'SS 5 pack', 'personal', 5, 400)
on conflict do nothing;
insert into public.discounts (id, org_id, name, kind, value, scope, rule, valid_until)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000001', 'Autumn early bird', 'fixed_amount', 20, 'training', 'early_bird', now() + interval '30 days');
update public.discounts set currency = 'CHF' where id = '00000000-0000-0000-0000-0000000000d3';
insert into public.discounts (id, org_id, name, kind, value, scope, scope_service_id, rule, code, max_redemptions_per_family)
values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-000000000001', 'Coach friend', 'percent', 10, 'service', '00000000-0000-0000-0000-0000000000d1', 'promo_code', 'FRIEND10', 1);
insert into public.discounts (id, org_id, name, kind, value, scope, rule)
values ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-000000000001', 'Staff kid', 'percent', 50, 'all', 'manual');

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; pa uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1'; v text; r jsonb;
begin
  -- early bird applies automatically (fixed 20 off 400)
  v := ss.run_as(pa, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2')::text$q$);
  perform ss.ok(v like 'OK:%', 'training: guardian buys a package (' || left(v, 160) || ')');
  r := substr(v, 4)::jsonb;
  perform ss.ok((r->>'discount_total')::numeric = 20 and (r->>'amount')::numeric = 380, 'training: early bird applied (400 - 20)');
  perform ss.ok((select discount_ids = array['00000000-0000-0000-0000-0000000000d3'::uuid] from public.training_package_purchases where id = (r->>'purchase_id')::uuid),
                'training: discount ids stored on the purchase');
  perform ss.ok((select count(*) from public.applied_discounts where source = 'training_package' and source_id = (r->>'purchase_id')::uuid
                   and amount = 20 and invoice_item_id is not null) = 1,
                'training: applied_discounts row (source training_package) linked to its invoice line');
  perform ss.ok((select total_chf from public.invoices where id = (r->>'invoice_id')::uuid) = 380, 'training: invoice total is the discounted amount');

  -- promo code: 10% of 400 = 40 + early bird 20
  v := ss.run_as(pa, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'invoice', null, 'friend10')::text$q$);
  r := substr(v, 4)::jsonb;
  perform ss.ok((r->>'discount_total')::numeric = 60 and (r->>'amount')::numeric = 340, 'training: promo code stacks with the early bird (' || left(v, 120) || ')');
  v := ss.run_as(pa, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'invoice', null, 'FRIEND10')::text$q$);
  perform ss.ok(v like 'ERR:%PROMO_FAMILY_LIMIT_REACHED%', 'training: per-family promo limit (' || v || ')');
  v := ss.run_as(pa, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'invoice', null, 'NOPE')::text$q$);
  perform ss.ok(v like 'ERR:%PROMO_UNKNOWN_CODE%', 'training: unknown code refused');
  v := ss.run_as(pa, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'invoice', null, null, array['00000000-0000-0000-0000-0000000000d5'::uuid])::text$q$);
  perform ss.ok(v like 'ERR:%NOT_AUTHORIZED%', 'training: guardians cannot pick manual discounts');
  v := ss.run_as(a, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000072', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', 'invoice', null, null, array['00000000-0000-0000-0000-0000000000d5'::uuid])::text$q$);
  r := substr(v, 4)::jsonb;
  perform ss.ok((r->>'discount_total')::numeric = 220 and (r->>'amount')::numeric = 180, 'training: admin applies a manual discount (50% + early bird) (' || left(v, 120) || ')');
  v := ss.run_as(b, $q$select public.purchase_training_package('00000000-0000-0000-0000-000000000071', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2')::text$q$);
  perform ss.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'training: org B cannot buy for an org A athlete');
  perform ss.ok(current_setting('app.discount_code', true) is null or current_setting('app.discount_code', true) = '', 'training: discount inputs cleared after the call');

  -- booking a single session by invoice applies discounts, source booking
  update public.discounts set is_active = false where id = '00000000-0000-0000-0000-0000000000d5';
  perform ss.ok(public.discount_evaluate('00000000-0000-0000-0000-000000000001', 'training', null, '00000000-0000-0000-0000-0000000000d1', 100, 'CHF', null, null, null, null, false)->>'discount_total' = '20.00',
                'evaluator: single session 100 - early bird 20');
  perform ss.ok(public.discount_evaluate('00000000-0000-0000-0000-000000000001', 'shop', null, null, 100, 'CHF', null, null, null, null, false)->>'discount_total' = '0.00',
                'evaluator: a training discount does not apply to the shop');
  perform ss.ok(public.discount_evaluate('10000000-0000-0000-0000-000000000002', 'training', null, '00000000-0000-0000-0000-0000000000d1', 100, 'CHF', 'FRIEND10', null, null, null, false)->>'promo' = 'UNKNOWN_CODE',
                'evaluator: another club''s code is unknown');
end $$;

-- ===========================================================================
-- F. Global search
-- ===========================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; fin uuid := '00000000-0000-0000-0000-0000000000f2';
  co uuid := '00000000-0000-0000-0000-0000000000f3'; pa uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1';
begin
  perform ss.ok(ss.run_as(a, $q$select count(*)::text from public.global_search('lucas muller') where kind = 'athlete'$q$) = 'OK:1', 'search: accent-insensitive (muller finds Müller)');
  perform ss.ok(ss.run_as(a, $q$select count(*)::text from public.global_search('ELODIE') where kind = 'athlete'$q$) = 'OK:1', 'search: case-insensitive');
  perform ss.ok(ss.run_as(fin, $q$select count(*)::text from public.global_search('lucas') where kind = 'athlete'$q$) = 'OK:1', 'search: finance finds athletes (names only)');
  perform ss.ok(ss.run_as(co, $q$select count(*)::text from public.global_search('lucas') where kind = 'athlete'$q$) = 'OK:1', 'search: coach finds an athlete they coach');
  perform ss.ok(ss.run_as(co, $q$select count(*)::text from public.global_search('elodie') where kind = 'athlete'$q$) = 'OK:0', 'search: coach does not find athletes they do not coach');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.global_search('mateo') where kind = 'athlete'$q$) = 'OK:1', 'search: guardian finds own child');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.global_search('lucas') where kind = 'athlete'$q$) = 'OK:0', 'search: guardian does not find other children');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.global_search('INV-2026') where kind = 'invoice' and title = 'INV-2026-0182'$q$) = 'OK:0'
            and ss.run_as(pa, $q$select count(*)::text from public.global_search('INV-2026-0211') where kind = 'invoice'$q$) = 'OK:1',
                'search: guardian finds own family invoices by number only');
  perform ss.ok(ss.run_as(fin, $q$select count(*)::text from public.global_search('INV-2026-0182') where kind = 'invoice'$q$) = 'OK:1', 'search: finance finds any invoice by number');
  perform ss.ok(ss.run_as(co, $q$select count(*)::text from public.global_search('INV-2026') where kind = 'invoice'$q$) = 'OK:0', 'search: coaches get no invoices');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.global_search('t-shirt') where kind = 'product'$q$) = 'OK:1', 'search: members find shop products');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.global_search('hidden draft') where kind = 'product'$q$) = 'OK:0', 'search: inactive products hidden from members');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.global_search('lucas')$q$) = 'OK:0'
            and ss.run_as(b, $q$select count(*)::text from public.global_search('t-shirt')$q$) = 'OK:0',
                'search: org B finds nothing of org A');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.global_search('zoe') where kind = 'athlete'$q$) = 'OK:1', 'search: org B finds its own athlete');
  perform ss.ok(ss.run_as(null, $q$select count(*)::text from public.global_search('lucas')$q$) like 'ERR:%', 'search: anon cannot search');
  perform ss.ok(ss.run_as(a, $q$select count(*)::text from public.global_search('l')$q$) = 'OK:0', 'search: one character returns nothing');
  perform ss.ok(ss.run_as(a, $q$select count(*)::text from public.global_search('%')$q$) = 'OK:0', 'search: wildcards are literal');
  perform ss.ok(ss.run_as(a, $q$select (count(*) <= 3)::text from public.global_search('a', null, 3)$q$) = 'OK:true', 'search: limited results');
  perform ss.ok(ss.run_as(a, $q$select kind from public.global_search('lucas') order by score desc limit 1$q$) = 'OK:athlete', 'search: prefix match ranks first');
end $$;

-- ===========================================================================
-- G. Member cards
-- ===========================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; fin uuid := '00000000-0000-0000-0000-0000000000f2';
  co uuid := '00000000-0000-0000-0000-0000000000f3'; pa uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1'; v text; t72 text; t71 text; tc9 text; tb text; t72b text;
begin
  perform ss.ok(left(encode(hmac('0123456789abcdef0123456789abcdef.1', '00112233', 'sha256'), 'hex'), 32) = 'a74be9e8ca6189f3f8cef3d728898d5a',
                'cards: SQL HMAC matches the TypeScript test vector');
  v := ss.run_as(pa, $q$select public.member_card_token('00000000-0000-0000-0000-000000000071')$q$);
  perform ss.ok(v ~ '^OK:M1\.[0-9a-f]{32}\.[0-9a-f]{32}$', 'cards: guardian gets own child''s token (' || v || ')');
  t71 := substr(v, 4);
  perform ss.ok(ss.run_as(pa, $q$select public.member_card_token('00000000-0000-0000-0000-000000000072')$q$) like 'ERR:%NOT_AUTHORIZED%', 'cards: guardian cannot get another child''s token');
  perform ss.ok(ss.run_as(pa, $q$select public.member_card_token('00000000-0000-0000-0000-000000000071')$q$) = 'OK:' || t71, 'cards: token is stable until rotated');
  perform ss.ok(position('Mateo' in t71) = 0 and position('071' in t71) = 0, 'cards: token carries no personal data');
  t72 := substr(ss.run_as(a, $q$select public.member_card_token('00000000-0000-0000-0000-000000000072')$q$), 4);
  tc9 := substr(ss.run_as(a, $q$select public.member_card_token('00000000-0000-0000-0000-0000000000c9')$q$), 4);
  tb := substr(ss.run_as(b, $q$select public.member_card_token('b0000000-0000-0000-0000-000000000071')$q$), 4);
  perform ss.ok(ss.run_as(b, $q$select public.member_card_token('00000000-0000-0000-0000-000000000072')$q$) like 'ERR:%ATHLETE_NOT_FOUND%', 'cards: org B cannot issue an org A card');
  perform ss.ok(ss.run_as(fin, $q$select public.member_card_token('00000000-0000-0000-0000-000000000072')$q$) like 'ERR:%NOT_AUTHORIZED%', 'cards: finance cannot issue cards');

  perform ss.ok(ss.run_as(co, format($q$select athlete_id::text from public.resolve_member_token(%L)$q$, t72)) = 'OK:00000000-0000-0000-0000-000000000072', 'cards: coach resolves a coached athlete''s token');
  perform ss.ok(ss.run_as(co, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, tc9)) = 'OK:0', 'cards: coach cannot resolve an athlete they do not coach');
  perform ss.ok(ss.run_as(co, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, tb)) = 'OK:0', 'cards: coach cannot resolve another club''s token');
  perform ss.ok(ss.run_as(b, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, t72)) = 'OK:0', 'cards: org B admin/coach cannot resolve org A tokens');
  perform ss.ok(ss.run_as(pa, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, t71)) = 'OK:0', 'cards: guardians cannot resolve tokens');
  perform ss.ok(ss.run_as(null, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, t72)) like 'ERR:%', 'cards: anon cannot resolve');
  perform ss.ok(ss.run_as(co, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, left(t72, 40) || repeat('0', 32))) = 'OK:0', 'cards: forged signature resolves nothing');
  perform ss.ok(ss.run_as(a, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, tc9)) = 'OK:1', 'cards: admin resolves any athlete of the club');

  t72b := substr(ss.run_as(a, $q$select public.rotate_member_card('00000000-0000-0000-0000-000000000072')$q$), 4);
  perform ss.ok(t72b <> t72 and t72b like 'M1.%', 'cards: rotation issues a new token');
  perform ss.ok(ss.run_as(co, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, t72)) = 'OK:0', 'cards: rotated (old) token no longer resolves');
  perform ss.ok(ss.run_as(co, format($q$select count(*)::text from public.resolve_member_token(%L)$q$, t72b)) = 'OK:1', 'cards: new token resolves');

  -- NFC tags
  perform ss.ok(ss.run_as(a, $q$select (public.assign_member_tag('00000000-0000-0000-0000-000000000072', '04:a2:2b:1c:5d:80'))->>'nfc_tag_id'$q$) = 'OK:04A22B1C5D80', 'tags: admin assigns a bracelet (normalised)');
  perform ss.ok(ss.run_as(co, $q$select athlete_id::text from public.resolve_member_token('04:A2:2B:1C:5D:80')$q$) = 'OK:00000000-0000-0000-0000-000000000072', 'tags: coach resolves the bracelet');
  perform ss.ok(ss.run_as(a, $q$select public.assign_member_tag('00000000-0000-0000-0000-0000000000c9', '04A22B1C5D80')::text$q$) like 'ERR:%TAG_IN_USE%', 'tags: one bracelet per athlete');
  perform ss.ok(ss.run_as(pa, $q$select public.assign_member_tag('00000000-0000-0000-0000-000000000071', 'AABBCCDD')::text$q$) like 'ERR:%NOT_AUTHORIZED%', 'tags: guardians cannot assign tags');
  perform ss.ok(ss.run_as(b, $q$select public.assign_member_tag('00000000-0000-0000-0000-000000000072', 'AABBCCDD')::text$q$) like 'ERR:%ATHLETE_NOT_FOUND%', 'tags: org B cannot assign on org A');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.resolve_member_token('04A22B1C5D80')$q$) = 'OK:0', 'tags: org B cannot resolve org A bracelets');

  -- tables
  perform ss.ok(ss.run_as(a, $q$select count(*)::text from public.member_card_keys$q$) like 'ERR:%' , 'keys: signing keys unreadable by admins');
  perform ss.ok(ss.run_as(pa, $q$select count(*)::text from public.member_cards$q$) = 'OK:1', 'cards: guardian sees own child''s card row only');
  perform ss.ok(ss.run_as(co, $q$select count(*)::text from public.member_cards$q$) = 'OK:0', 'cards: coaches do not read card rows');
  perform ss.ok(ss.run_as(b, $q$select count(*)::text from public.member_cards where org_id = '00000000-0000-0000-0000-000000000001'$q$) = 'OK:0', 'cards: org B reads none of org A');
  perform ss.ok(ss.run_as(a, $q$insert into public.member_cards (org_id, athlete_id, nonce) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', '0123456789abcdef0123456789abcdef') returning id::text$q$) like 'ERR:%',
                'cards: no direct insert');
  perform ss.ok(ss.run_as(a, $q$with u as (update public.member_cards set is_active = false returning 1) select count(*)::text from u$q$) = 'OK:0', 'cards: no direct update');
  perform ss.ok(ss.run_as(a, $q$with d as (delete from public.member_cards returning 1) select count(*)::text from d$q$) = 'OK:0', 'cards: no direct delete');
end $$;

-- ===========================================================================
-- H. club-media bucket
-- ===========================================================================
do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000000f1'; pa uuid := '00000000-0000-0000-0000-0000000000f4';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1';
begin
  perform ss.ok(ss.run_as(a, $q$insert into storage.objects (bucket_id, name) values ('club-media', '00000000-0000-0000-0000-000000000001/products/tee.jpg') returning name$q$) like 'OK:%',
                'media: admin uploads into own club folder');
  perform ss.ok(ss.run_as(a, $q$insert into storage.objects (bucket_id, name) values ('club-media', '10000000-0000-0000-0000-000000000002/products/x.jpg') returning name$q$) like 'ERR:%',
                'media: admin cannot upload into another club''s folder');
  perform ss.ok(ss.run_as(a, $q$insert into storage.objects (bucket_id, name) values ('club-media', '00000000-0000-0000-0000-000000000001/athletes/x.jpg') returning name$q$) like 'ERR:%',
                'media: only product / venue folders');
  perform ss.ok(ss.run_as(pa, $q$insert into storage.objects (bucket_id, name) values ('club-media', '00000000-0000-0000-0000-000000000001/products/p.jpg') returning name$q$) like 'ERR:%',
                'media: parents cannot upload');
  perform ss.ok(ss.run_as(b, $q$insert into storage.objects (bucket_id, name) values ('club-media', '00000000-0000-0000-0000-000000000001/products/b.jpg') returning name$q$) like 'ERR:%',
                'media: org B cannot upload into org A folder');
  perform ss.ok(ss.run_as(b, $q$with d as (delete from storage.objects where bucket_id = 'club-media' and name like '00000000-0000-0000-0000-000000000001/%' returning 1) select count(*)::text from d$q$) = 'OK:0',
                'media: org B cannot delete org A images');
  perform ss.ok(ss.run_as(a, $q$with d as (delete from storage.objects where bucket_id = 'club-media' and name = '00000000-0000-0000-0000-000000000001/products/tee.jpg' returning 1) select count(*)::text from d$q$) = 'OK:1',
                'media: admin deletes own image');
end $$;

-- ===========================================================================
-- I. Grants + audit
-- ===========================================================================
do $$
begin
  perform ss.ok(not has_function_privilege('anon', 'public.shop_place_order(jsonb)', 'execute')
            and not has_function_privilege('authenticated', 'public.shop_place_order(jsonb)', 'execute')
            and not has_function_privilege('authenticated', 'public.discount_evaluate(uuid, text, uuid, uuid, numeric, text, text, uuid, date, uuid[], boolean)', 'execute')
            and not has_function_privilege('authenticated', 'public.member_card_sign(uuid, text, integer)', 'execute')
            and not has_function_privilege('anon', 'public.resolve_member_token(text)', 'execute'),
                'grants: service-only RPCs closed to clients; nothing for anon');
  perform ss.ok(exists (select 1 from public.audit_logs where action = 'SHOP_ORDER_PLACED')
            and exists (select 1 from public.audit_logs where action = 'SHOP_ORDER_STATUS')
            and exists (select 1 from public.audit_logs where action = 'MEMBER_CARD_ROTATED')
            and exists (select 1 from public.audit_logs where action = 'MEMBER_TAG_ASSIGNED')
            and exists (select 1 from public.audit_logs where target_table = 'shop_products'),
                'audit: orders, status changes, cards, tags and catalogue edits are logged');
  perform ss.ok(not exists (select 1 from public.audit_logs where target_table = 'member_cards' and new_data::text ~ '[0-9a-f]{32}'),
                'audit: card audit rows never contain the token nonce');
end $$;
