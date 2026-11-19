-- ============================================================================
-- Money & booking logic — integration tests against the real SQL functions.
-- Covers: QRR reference + check digit (parity with src/lib/swiss-payments.ts),
-- invoice numbering, manual invoices, manual + Stripe payments (status
-- transitions, idempotency, immutability), overdue flagging, training credits
-- and the cancellation-policy window.
--
-- Fixture identities (seed): org …0001, admin …f1, finance …f2, coach …f3,
-- parent Carla …f4 (guardian of the Lopes family …061, child Mateo …071),
-- Rossi family …063 (Giulia …074). Services: 1-on-1 PT …021 (CHF 75).
-- Every assertion prints PASS/FAIL; known bugs print XFAIL until fixed.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema t;
grant usage on schema t to authenticated, anon;

create function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

-- Known bug: assertion is expected to fail today. Prints XFAIL while broken,
-- XPASS (non-blocking) once fixed so the marker can be removed.
create function t.known(p_cond boolean, p_msg text, p_bug text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'XPASS — ' || p_msg || ' (fixed? turn into t.ok)' else 'XFAIL — ' || p_msg || ' [known: ' || p_bug || ']' end;
end $$;

create function t.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  execute 'set local role authenticated';
end $$;

create function t.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Run p_sql as user p and return the error code ('' when it succeeded).
create function t.err_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text;
begin
  begin
    perform t.as_user(p);
    execute p_sql;
    perform t.as_super();
    return '';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform t.as_super();
    return coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema t to authenticated;

-- ---------------------------------------------------------------------------
-- 1. QRR reference + check digit
-- ---------------------------------------------------------------------------
do $$
declare v_ref text;
begin
  perform t.ok(public.qrr_check_digit('21000000000313947143000901') = '7', 'SQL qrr_check_digit matches SIX sample (…9017)');
  perform t.ok(public.qrr_check_digit('210000000003139471430009017') = '0', 'full valid QRR self-checks to 0');
  perform t.ok(public.qrr_check_digit('21 00000 00003 13947 14300 0901') = '7', 'qrr_check_digit ignores spaces');
  perform t.ok(public.qrr_check_digit(null) = '0', 'qrr_check_digit(null) is defined');

  v_ref := public.gen_qr_reference('00000000-0000-0000-0000-000000000001', 'INV-2026-0211');
  perform t.ok(v_ref ~ '^\d{27}$', 'gen_qr_reference yields 27 digits (' || v_ref || ')');
  perform t.ok(v_ref = lpad('2120260211', 26, '0') || public.qrr_check_digit(lpad('2120260211', 26, '0')), 'reference = org prefix 21 + invoice digits, zero-padded, + check digit');
  perform t.ok(public.qrr_check_digit(v_ref) = '0', 'generated reference passes mod-10 recursive validation');
  perform t.ok(public.gen_qr_reference('00000000-0000-0000-0000-000000000001', 'INV-2026-0212') <> v_ref, 'consecutive invoices get distinct references');
  perform t.ok(length(public.gen_qr_reference('00000000-0000-0000-0000-000000000001', repeat('9', 40))) = 27, 'over-long seeds are truncated to 27 digits');
end $$;

-- payment_reference trigger + reconciliation lookup
do $$
declare v_id uuid; v_ref text;
begin
  select id, payment_reference into v_id, v_ref from public.invoices where number = 'INV-2026-0211';
  perform t.ok(v_ref is not null and public.qrr_check_digit(v_ref) = '0', 'seeded invoice has a valid payment_reference (backfill)');
  perform t.ok(public.find_invoice_by_reference('00000000-0000-0000-0000-000000000001',
               regexp_replace(v_ref, '(\d{2})(\d{5})(\d{5})(\d{5})(\d{5})(\d{5})', '\1 \2 \3 \4 \5 \6')) = v_id,
               'find_invoice_by_reference matches a space-formatted reference');
  perform t.ok(public.find_invoice_by_reference('00000000-0000-0000-0000-000000000001', '000') is null, 'unknown reference returns null');
end $$;

-- ---------------------------------------------------------------------------
-- 2. Invoice numbering
-- ---------------------------------------------------------------------------
begin;
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v1 text; v2 text; v_yyyy text := to_char(now(), 'YYYY');
begin
  update public.app_settings set invoice_counter = 211 where org_id = v_org;
  v1 := public.next_invoice_number(v_org);
  v2 := public.next_invoice_number(v_org);
  perform t.ok(v1 = 'INV-' || v_yyyy || '-0212', 'next number follows INV-{YYYY}-{####} (' || v1 || ')');
  perform t.ok(v2 = 'INV-' || v_yyyy || '-0213', 'numbers are consecutive / monotonic');

  update public.app_settings set invoice_pattern = '{YY}{MM}-{####}', invoice_counter = 0 where org_id = v_org;
  perform t.ok(public.next_invoice_number(v_org) = to_char(now(), 'YYMM') || '-0001', 'custom pattern tokens {YY}{MM} are honoured');

  update public.app_settings set invoice_pattern = 'INV-{YYYY}-{####}', invoice_counter = 9999 where org_id = v_org;
  v1 := public.next_invoice_number(v_org);
  -- fixed in 20250420095100_integration_fixes.sql (lpad only when shorter)
  perform t.ok(v1 = 'INV-' || v_yyyy || '-10000', 'counter past 9999 keeps all digits (got ' || v1 || ')');

  begin
    perform public.next_invoice_number('00000000-0000-0000-0000-00000000dead');
    perform t.ok(false, 'next_invoice_number fails for an org without settings');
  exception when others then perform t.ok(true, 'next_invoice_number fails for an org without settings');
  end;
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 3. Manual invoice + payments (finance), immutability, Stripe idempotency
-- ---------------------------------------------------------------------------
create table t.ctx (k text primary key, v text);
grant all on t.ctx to authenticated;

do $$
declare v jsonb; v_inv uuid; v_total numeric; v_status text; v_items int; v_sum numeric;
begin
  perform t.as_user('00000000-0000-0000-0000-0000000000f2');  -- finance
  v := public.create_manual_invoice(jsonb_build_object(
         'family_id', '00000000-0000-0000-0000-000000000061',
         'description', 'Spring term',
         'due_date', (current_date + 30)::text,
         'items', jsonb_build_array(
            jsonb_build_object('description', 'Team fee', 'quantity', 2, 'unit_price_chf', 150),
            jsonb_build_object('description', 'Jersey',   'quantity', 1, 'unit_price_chf', 90.505)),
         'discount_chf', 40, 'discount_label', 'Sibling discount'));
  perform t.as_super();
  v_inv := (v->>'invoice_id')::uuid;
  insert into t.ctx values ('inv', v_inv::text);
  select total_chf, status::text into v_total, v_status from public.invoices where id = v_inv;
  select count(*), sum(amount_chf) into v_items, v_sum from public.invoice_items where invoice_id = v_inv;
  perform t.ok(v_total = 350.51, 'manual invoice total = 2×150 + round(90.505,2) − 40 = 350.51 (got ' || v_total || ')');
  perform t.ok(v_sum = v_total, 'invoice total equals the sum of its line items');
  perform t.ok(v_items = 3, 'discount is stored as its own negative line item');
  perform t.ok(v_status = 'draft', 'manual invoices start as draft');
  perform t.ok((v->>'number') ~ '^INV-\d{4}-\d{4,}$', 'manual invoice gets a pattern number (' || (v->>'number') || ')');
  perform t.ok((select payment_reference from public.invoices where id = v_inv) ~ '^\d{27}$', 'new invoice gets a QRR payment_reference automatically');
end $$;

do $$
declare v_err text;
begin
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4',
    $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","items":[]}'::jsonb)$q$);
  perform t.ok(v_err like '%NOT_AUTHORIZED%', 'parent cannot create invoices (' || v_err || ')');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f3',
    $q$select public.create_manual_invoice('{"family_id":"00000000-0000-0000-0000-000000000061","items":[]}'::jsonb)$q$);
  perform t.ok(v_err like '%NOT_AUTHORIZED%', 'coach cannot create invoices');
end $$;

do $$
declare v_inv uuid := (select v::uuid from t.ctx where k = 'inv'); v jsonb; v_err text; v_status text; v_n int;
begin
  update public.invoices set status = 'sent' where id = v_inv;

  perform t.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.record_manual_payment(v_inv, 100, 'twint', 'TW-1', 'partial');
  perform t.as_super();
  perform t.ok(v->>'status' = 'partially_paid', 'partial manual payment -> partially_paid');

  perform t.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.record_manual_payment(v_inv, 250.51, 'bank_transfer');
  perform t.as_super();
  perform t.ok(v->>'status' = 'paid', 'sum of payments == total -> paid');
  perform t.ok((select paid_at is not null from public.invoices where id = v_inv), 'paid invoice has paid_at set');
  perform t.ok((select count(*) from public.audit_logs where action = 'PAYMENT_RECORDED' and new_data->>'invoice_id' = v_inv::text) = 2,
               'each manual payment writes an audit row');

  v_err := t.err_as('00000000-0000-0000-0000-0000000000f2', format('select public.record_manual_payment(%L, 0, %L)', v_inv, 'twint'));
  perform t.ok(v_err like '%INVALID_AMOUNT%', 'zero amount rejected');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f2', format('select public.record_manual_payment(%L, -5, %L)', v_inv, 'twint'));
  perform t.ok(v_err like '%INVALID_AMOUNT%', 'negative amount rejected');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f2', format('select public.record_manual_payment(%L, 5, %L)', v_inv, 'bitcoin'));
  perform t.ok(v_err like '%INVALID_METHOD%', 'unknown payment method rejected');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.record_manual_payment(%L, 5, %L)', v_inv, 'twint'));
  perform t.ok(v_err like '%NOT_AUTHORIZED%', 'parent cannot record payments');

  -- immutability (even for the superuser path the trigger blocks it)
  begin update public.payments set amount_chf = 1 where invoice_id = v_inv; perform t.ok(false, 'payments cannot be updated');
  exception when others then perform t.ok(true, 'payments cannot be updated (append-only trigger)'); end;
  begin delete from public.payments where invoice_id = v_inv; perform t.ok(false, 'payments cannot be deleted');
  exception when others then perform t.ok(true, 'payments cannot be deleted (append-only trigger)'); end;

  -- cancelled invoices refuse payments
  update public.invoices set status = 'cancelled' where id = (select id from public.invoices where number = 'INV-2026-0182');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f2',
                    format('select public.record_manual_payment(%L, 5, %L)', (select id from public.invoices where number = 'INV-2026-0182'), 'twint'));
  perform t.ok(v_err like '%INVOICE_CANCELLED%', 'payment against a cancelled invoice is rejected');
end $$;

-- Stripe: idempotent on duplicate webhook delivery, overpayment visibility
do $$
declare v_inv uuid; v1 jsonb; v2 jsonb; v_n int; v_paid numeric;
begin
  select id into v_inv from public.invoices where number = 'INV-2026-0211';  -- CHF 1490, sent
  v1 := public.apply_stripe_payment(v_inv, 1490, 'pi_test_dup_1', 'ch_1');
  v2 := public.apply_stripe_payment(v_inv, 1490, 'pi_test_dup_1', 'ch_1');
  select count(*) into v_n from public.payments where stripe_payment_intent_id = 'pi_test_dup_1';
  perform t.ok(v1->>'status' = 'paid' and (v1->>'duplicate')::boolean = false, 'Stripe payment marks invoice paid');
  perform t.ok((v2->>'duplicate')::boolean and v_n = 1, 'duplicate webhook delivery is idempotent (1 payment row)');
  perform t.ok((select stripe_payment_intent_id from public.invoices where id = v_inv) = 'pi_test_dup_1', 'payment_intent id stored on the invoice for reconciliation');

  -- overpayment: second, different intent on an already-paid invoice
  perform public.apply_stripe_payment(v_inv, 10, 'pi_test_over_1');
  select sum(amount_chf) into v_paid from public.payments where invoice_id = v_inv and status = 'succeeded';
  perform t.ok((select status::text from public.invoices where id = v_inv) = 'paid', 'overpaid invoice stays paid');
  -- fixed in 20250420095900_money_editing.sql (recompute_invoice flags it)
  perform t.ok(exists (select 1 from public.audit_logs where target_table = 'invoices' and action ilike '%overpa%'),
               format('overpayment (paid %s on 1490) is flagged for follow-up', v_paid));
end $$;

-- Overdue flagging
begin;
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_n int; v_inv uuid; v_future uuid;
begin
  insert into public.invoices (org_id, number, family_id, status, due_date, total_chf)
    values (v_org, 'T-OVERDUE-1', '00000000-0000-0000-0000-000000000063', 'sent', current_date - 1, 50) returning id into v_inv;
  insert into public.invoices (org_id, number, family_id, status, due_date, total_chf)
    values (v_org, 'T-FUTURE-1', '00000000-0000-0000-0000-000000000063', 'sent', current_date, 50) returning id into v_future;
  v_n := public.flag_overdue_invoices(v_org);
  perform t.ok((select status::text from public.invoices where id = v_inv) = 'overdue', 'past-due sent invoice -> overdue');
  perform t.ok((select status::text from public.invoices where id = v_future) = 'sent', 'invoice due today is not overdue yet');
  perform t.ok((select count(*) from public.invoices where status = 'overdue' and status::text <> 'paid' and number = 'INV-2026-0211') = 0,
               'paid invoices are never flagged overdue');
  perform t.ok(public.flag_overdue_invoices(v_org) = 0, 'flag_overdue_invoices is idempotent');
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 4. Training credits + cancellation-policy window
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_mateo uuid := '00000000-0000-0000-0000-000000000071';
  v_pt uuid := '00000000-0000-0000-0000-000000000021';
  v_coach uuid := '00000000-0000-0000-0000-000000000012';  -- Coach Michael (no seeded slots)
  s_far uuid; s_near uuid; s_edge_in uuid; s_edge_out uuid; s_inv uuid;
  v jsonb; b1 uuid; v_bal int; v_err text;
begin
  update public.app_settings
     set settings = settings || '{"bookings_enabled": true, "booking": {"cancellation_hours": 24, "refund_credits_on_cancel": true}}'::jsonb
   where org_id = v_org;
  update public.training_services set credits_required = 1 where id = v_pt;
  delete from public.training_credits where athlete_id = v_mateo;

  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at) values
    (v_org, v_coach, now() + interval '5 days',                       now() + interval '5 days 1 hour')   returning id into s_far;
  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at) values
    (v_org, v_coach, now() + interval '2 hours',                      now() + interval '3 hours')         returning id into s_near;
  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at) values
    (v_org, v_coach, now() + interval '24 hours 5 minutes',           now() + interval '24 hours 50 minutes') returning id into s_edge_in;
  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at) values
    (v_org, v_coach, now() + interval '23 hours 55 minutes',          now() + interval '23 hours 59 minutes') returning id into s_edge_out;
  insert into public.coach_availability (org_id, coach_id, starts_at, ends_at) values
    (v_org, v_coach, now() + interval '7 days',                       now() + interval '7 days 1 hour')   returning id into s_inv;

  -- grant credits (admin only)
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.grant_training_credits(%L, %L, 3)', v_mateo, 'personal'));
  perform t.ok(v_err like '%NOT_AUTHORIZED%', 'parent cannot grant credits');
  perform t.as_user('00000000-0000-0000-0000-0000000000f1');
  v := public.grant_training_credits(v_mateo, 'personal', 2);
  perform t.ok((v->>'balance')::int = 2, 'admin grants 2 credits -> balance 2');
  v := public.grant_training_credits(v_mateo, 'personal', 1);
  perform t.ok((v->>'total')::int = 3 and (v->>'balance')::int = 3, 'grants accumulate (total 3)');
  perform t.as_super();

  -- book with credits (parent)
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  v := public.book_training_session(v_mateo, v_pt, s_far, 'credits');
  perform t.as_super();
  b1 := (v->>'booking_id')::uuid;
  select total_credits - used_credits into v_bal from public.training_credits where athlete_id = v_mateo and credit_category = 'personal';
  perform t.ok((v->>'credits_used')::int = 1 and v_bal = 2, 'credit booking deducts 1 credit (balance 3 -> 2)');
  perform t.ok((v->>'invoice_id') is null and (v->>'price_chf')::numeric = 0, 'credit booking issues no invoice');
  perform t.ok((select is_booked from public.coach_availability where id = s_far), 'booked slot is marked taken');

  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.book_training_session(%L, %L, %L, %L)', v_mateo, v_pt, s_far, 'credits'));
  perform t.ok(v_err like '%SLOT_TAKEN%', 'double booking the same slot is rejected');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.book_training_session(%L, %L, %L, %L)', '00000000-0000-0000-0000-000000000074', v_pt, s_inv, 'invoice'));
  perform t.ok(v_err like '%NOT_AUTHORIZED%', 'parent cannot book for another family''s child');

  -- cancel > 24h before: within policy -> credits refunded
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  v := public.cancel_training_booking(b1);
  perform t.as_super();
  select total_credits - used_credits into v_bal from public.training_credits where athlete_id = v_mateo and credit_category = 'personal';
  perform t.ok((v->>'within_policy')::boolean and (v->>'credits_refunded')::boolean and v_bal = 3, 'cancel 5 days out: within policy, credit refunded (balance 3)');
  perform t.ok(not (select is_booked from public.coach_availability where id = s_far), 'cancelled slot is released');
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.cancel_training_booking(%L)', b1));
  perform t.ok(v_err like '%NOT_CANCELLABLE%', 'a booking cannot be cancelled twice (no double refund)');

  -- cancel < 24h before (parent): outside policy -> no refund
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  v := public.book_training_session(v_mateo, v_pt, s_near, 'credits');
  v := public.cancel_training_booking((v->>'booking_id')::uuid);
  perform t.as_super();
  select total_credits - used_credits into v_bal from public.training_credits where athlete_id = v_mateo and credit_category = 'personal';
  perform t.ok(not (v->>'within_policy')::boolean and not (v->>'credits_refunded')::boolean and v_bal = 2, 'cancel 2h out by parent: outside policy, credit forfeited (balance 2)');

  -- window boundaries (24h policy)
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  v := public.book_training_session(v_mateo, v_pt, s_edge_in, 'credits');
  v := public.cancel_training_booking((v->>'booking_id')::uuid);
  perform t.ok((v->>'within_policy')::boolean, 'cancel at 24h05 before start is within a 24h policy');
  v := public.book_training_session(v_mateo, v_pt, s_edge_out, 'credits');
  v := public.cancel_training_booking((v->>'booking_id')::uuid);
  perform t.ok(not (v->>'within_policy')::boolean, 'cancel at 23h55 before start is outside a 24h policy');
  perform t.as_super();

  -- staff override refunds even outside the window
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  v := public.book_training_session(v_mateo, v_pt, s_near, 'credits');
  perform t.as_super();
  select total_credits - used_credits into v_bal from public.training_credits where athlete_id = v_mateo and credit_category = 'personal';
  perform t.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.cancel_training_booking((v->>'booking_id')::uuid);
  perform t.as_super();
  perform t.ok((v->>'credits_refunded')::boolean
               and (select total_credits - used_credits from public.training_credits where athlete_id = v_mateo and credit_category = 'personal') = v_bal + 1,
               'staff cancellation inside 24h still refunds (override)');

  -- insufficient credits
  update public.training_credits set used_credits = total_credits where athlete_id = v_mateo;
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.book_training_session(%L, %L, %L, %L)', v_mateo, v_pt, s_far, 'credits'));
  perform t.ok(v_err like '%INSUFFICIENT_CREDITS%', 'booking with zero balance is rejected');
  perform t.ok((select used_credits <= total_credits from public.training_credits where athlete_id = v_mateo and credit_category = 'personal'),
               'credit balance never goes negative');

  -- invoice path + void on in-policy cancel
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  v := public.book_training_session(v_mateo, v_pt, s_inv, 'invoice');
  perform t.as_super();
  perform t.ok((v->>'price_chf')::numeric = 75 and (select total_chf from public.invoices where id = (v->>'invoice_id')::uuid) = 75,
               'invoice booking issues a CHF 75 invoice');
  perform t.ok((select status::text from public.invoices where id = (v->>'invoice_id')::uuid) = 'sent', 'booking invoice is sent');
  perform t.as_user('00000000-0000-0000-0000-0000000000f4');
  perform public.cancel_training_booking((v->>'booking_id')::uuid);
  perform t.as_super();
  perform t.ok((select status::text from public.invoices where id = (v->>'invoice_id')::uuid) = 'cancelled', 'in-policy cancel voids the unpaid booking invoice');

  -- bookings disabled
  update public.app_settings set settings = settings || '{"bookings_enabled": false}'::jsonb where org_id = v_org;
  v_err := t.err_as('00000000-0000-0000-0000-0000000000f4', format('select public.book_training_session(%L, %L, %L, %L)', v_mateo, v_pt, s_far, 'invoice'));
  perform t.ok(v_err like '%BOOKINGS_DISABLED%', 'bookings can be switched off per org');
end $$;
