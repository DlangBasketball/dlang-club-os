-- ============================================================================
-- Regional payments (migration 20250420091800) — SQL assertions.
-- Run against a THROWAWAY database with all migrations applied (plain Postgres
-- needs minimal auth/roles stubs; on Supabase run in the SQL editor of a
-- scratch project). Everything runs in a transaction and is rolled back.
--   psql -v ON_ERROR_STOP=1 -f testing/regional_payments_test.sql
-- ============================================================================
begin;

do $$
declare
  ch_org  uuid := '00000000-0000-0000-0000-000000000001';
  de_org  uuid := gen_random_uuid();
  fin     uuid := gen_random_uuid();
  fam_ch  uuid;
  fam_de  uuid;
  inv     uuid;
  inv2    uuid;
  inv_de  uuid;
  r       record;
  j       jsonb;
  n       int;
  s       numeric;
begin
  -- Fixtures ------------------------------------------------------------------
  insert into public.organizations (id, name, slug, country, currency, payment_settings)
  values (de_org, 'FC Beispiel', 'fc-beispiel-' || left(de_org::text, 6), 'DE', 'EUR',
          '{"enabled_methods":["card","sepa_debit","bank_transfer"],"tax":{"rate":19,"inclusive":false,"label":"USt"},"plan_code":"club"}');
  insert into public.app_settings (org_id, currency) values (de_org, 'EUR') on conflict do nothing;

  insert into auth.users (id, email) values (fin, 'finance@example.test');
  insert into public.profiles (id, org_id, email, full_name) values (fin, ch_org, 'finance@example.test', 'Fin')
    on conflict (id) do update set org_id = excluded.org_id;
  insert into public.staff_roles (org_id, profile_id, role) values (ch_org, fin, 'finance');

  insert into public.families (org_id, name) values (ch_org, 'Muster') returning id into fam_ch;
  insert into public.families (org_id, name) values (de_org, 'Mustermann') returning id into fam_de;

  -- Currency defaults from org + QRR preserved for CH ----------------------------
  insert into public.invoices (org_id, number, family_id, status) values (ch_org, 'T-CH-1', fam_ch, 'sent') returning id into inv;
  select * into r from public.invoices where id = inv;
  assert r.currency = 'CHF', 'CH invoice currency should default to CHF';
  assert length(r.payment_reference) = 27 and public.qrr_check_digit(left(r.payment_reference, 26)) = right(r.payment_reference, 1),
    'CH invoice keeps a valid 27-digit QRR reference';

  -- EU org: EUR + RF reference + exclusive 19% tax --------------------------------
  insert into public.invoices (org_id, number, family_id, status) values (de_org, 'INV-2026-0001', fam_de, 'sent') returning id into inv_de;
  update public.invoices set total_chf = 100 where id = inv_de;
  select * into r from public.invoices where id = inv_de;
  assert r.currency = 'EUR', 'DE invoice currency should be EUR';
  assert r.payment_reference = public.scor_reference('INV-2026-0001') and r.payment_reference like 'RF%', 'DE invoice gets RF ref';
  assert r.subtotal_amount = 100 and r.tax_amount = 19 and r.total_chf = 119 and r.tax_label = 'USt',
    format('exclusive tax: got net %s tax %s total %s', r.subtotal_amount, r.tax_amount, r.total_chf);
  -- status-only update must not re-apply tax
  update public.invoices set status = 'overdue' where id = inv_de;
  select * into r from public.invoices where id = inv_de;
  assert r.total_chf = 119, 'tax must not compound on unrelated updates';
  -- reverse charge zeroes tax
  update public.invoices set reverse_charge = true where id = inv_de;
  select * into r from public.invoices where id = inv_de;
  assert r.tax_amount = 0 and r.total_chf = 100, 'reverse charge -> no tax';
  assert public.find_invoice_by_reference(de_org, lower(r.payment_reference)) = inv_de, 'RF lookup is case-insensitive';

  -- Inclusive tax (CH, 8.1%) ---------------------------------------------------
  update public.invoices set tax_rate = 8.1, tax_inclusive = true, total_chf = 108.10 where id = inv;
  select * into r from public.invoices where id = inv;
  assert r.tax_amount = 8.10 and r.subtotal_amount = 100.00 and r.total_chf = 108.10, 'inclusive extraction';
  update public.invoices set tax_rate = 0 where id = inv;

  -- RF reference check digits (ISO 11649 example) --------------------------------
  assert public.scor_reference('539007547034') = 'RF18539007547034', 'ISO 11649 reference example';

  -- Stripe payment: idempotent, currency/account checks ---------------------------
  update public.organizations set payment_settings = jsonb_set(payment_settings, '{stripe}', '{"account_id":"acct_ch"}') where id = ch_org;
  update public.invoices set total_chf = 200 where id = inv;
  j := public.apply_stripe_payment(inv, 50, 'pi_1', 'ch_1', 'twint', 'chf', 'acct_ch', 1.5);
  assert (j->>'status') = 'partially_paid', 'partial payment';
  j := public.apply_stripe_payment(inv, 50, 'pi_1', 'ch_1', 'twint', 'chf', 'acct_ch', 1.5);
  assert (j->>'duplicate')::boolean, 'duplicate PI is ignored';
  select count(*) into n from public.payments where invoice_id = inv;
  assert n = 1, 'only one payment row';
  select * into r from public.payments where invoice_id = inv;
  assert r.currency = 'CHF' and r.method::text = 'twint' and r.stripe_account_id = 'acct_ch', 'payment metadata stored';
  begin
    perform public.apply_stripe_payment(inv, 10, 'pi_x', null, 'card', 'eur', 'acct_ch');
    raise exception 'expected CURRENCY_MISMATCH';
  exception when others then assert sqlerrm like 'CURRENCY_MISMATCH%', sqlerrm; end;
  begin
    perform public.apply_stripe_payment(inv, 10, 'pi_y', null, 'card', 'chf', 'acct_other');
    raise exception 'expected ACCOUNT_MISMATCH';
  exception when others then assert sqlerrm like 'ACCOUNT_MISMATCH%', sqlerrm; end;
  -- legacy 4-arg call shape still works
  j := public.apply_stripe_payment(inv, 150, 'pi_2', null);
  assert (j->>'status') = 'paid', 'legacy call shape pays the invoice';

  -- Payments stay immutable ---------------------------------------------------
  begin
    update public.payments set amount_chf = 1 where invoice_id = inv;
    raise exception 'expected immutability error';
  exception when others then assert sqlerrm like 'payments are append-only%', sqlerrm; end;

  -- Tax locked once paid
  begin
    update public.invoices set tax_rate = 7.7 where id = inv;
    raise exception 'expected TAX_LOCKED';
  exception when others then assert sqlerrm like 'TAX_LOCKED%', sqlerrm; end;

  -- Refund: idempotent negative row, invoice back to partially_paid ------------------
  j := public.apply_stripe_refund('pi_2', 're_1', 150, 'chf', 'acct_ch');
  assert (j->>'status') = 'partially_paid', format('after refund: %s', j);
  j := public.apply_stripe_refund('pi_2', 're_1', 150, 'chf', 'acct_ch');
  assert (j->>'duplicate')::boolean, 'duplicate refund ignored';
  assert public.invoice_net_paid(inv) = 50, 'net paid after refund';

  -- Webhook event claim ---------------------------------------------------------
  assert public.claim_stripe_event('evt_1', 'payment_intent.succeeded', 'acct_ch', false), 'first claim';
  perform public.finish_stripe_event('evt_1', 'processed');
  assert not public.claim_stripe_event('evt_1', 'payment_intent.succeeded', 'acct_ch', false), 'processed event not re-claimed';
  assert public.org_for_stripe_account('acct_ch') = ch_org, 'account -> org lookup';

  -- Application fee resolution ------------------------------------------------
  assert public.resolve_application_fee(de_org, 10000) = 100, 'club plan 1% of 100.00';
  assert public.resolve_application_fee(ch_org, 10000) = 0, 'founding plan: no fee';

  -- Installment schedule (pure) --------------------------------------------------
  select sum(amount), count(*) into s, n from public.installment_schedule(100, 3, date '2026-01-31', 'monthly', 'CHF');
  assert s = 100 and n = 3, 'installments sum exactly';
  select amount into s from public.installment_schedule(100, 3, date '2026-01-31', 'monthly', 'CHF') where seq = 1;
  assert s = 33.34, 'remainder goes to first installment';
  select due_date into r from public.installment_schedule(100, 3, date '2026-01-31', 'monthly', 'CHF') where seq = 2;
  assert r.due_date = date '2026-02-28', 'month-end clamps';
  select sum(amount) into s from public.installment_schedule(1000, 7, date '2026-01-01', 'monthly', 'JPY');
  assert s = 1000, 'zero-decimal currency';

  -- Installment plan via RPC as finance user ---------------------------------------
  perform set_config('request.jwt.claim.sub', fin::text, true);
  insert into public.invoices (org_id, number, family_id, status) values (ch_org, 'T-CH-2', fam_ch, 'sent') returning id into inv2;
  update public.invoices set total_chf = 900 where id = inv2;
  j := public.create_installment_plan(inv2, 3, date '2026-09-01', 'termly');
  assert jsonb_array_length(j->'installments') = 3, 'three installments';
  assert (select due_date from public.invoices where id = inv2) = date '2027-05-01', 'invoice due = last installment';
  perform public.apply_stripe_payment(inv2, 300, 'pi_inst_1');
  select count(*) into n from public.payment_plan_installments where invoice_id = inv2 and status = 'paid';
  assert n = 1, 'first installment marked paid';
  select count(*) into n from public.installments_due(ch_org, date '2027-01-02');
  assert n = 1, 'second installment due';

  -- Recurring membership ---------------------------------------------------------
  j := public.create_recurring_plan(jsonb_build_object('family_id', fam_ch, 'amount_per_period', 60,
         'frequency', 'monthly', 'start_date', '2026-08-01', 'end_date', '2026-10-31', 'description', 'U14 membership'));
  n := public.run_recurring_billing(ch_org, date '2026-09-15');
  assert n = 2, format('two periods invoiced, got %s', n);
  n := public.run_recurring_billing(ch_org, date '2026-09-15');
  assert n = 0, 'idempotent re-run';
  n := public.run_recurring_billing(ch_org, date '2027-01-01');
  assert n = 1, 'last period then completes';
  assert (select status from public.payment_plans where id = (j->>'plan_id')::uuid) = 'completed', 'plan completed';

  -- Admin settings RPC: cannot touch Stripe/plan keys; mirrors legacy settings ----
  insert into public.staff_roles (org_id, profile_id, role) values (ch_org, fin, 'admin');
  j := public.update_payment_settings('{"stripe":{"account_id":"acct_evil"},"plan_code":"pro","iban":"CH9300762011623852957","sepa_enabled":true,"tax":{"rate":8.1,"inclusive":true,"label":"MWST"}}');
  assert (select payment_settings->'stripe'->>'account_id' from public.organizations where id = ch_org) = 'acct_ch', 'stripe account protected';
  assert (select payment_settings->>'plan_code' from public.organizations where id = ch_org) = 'founding', 'plan protected';
  assert (select settings->'payments'->>'iban' from public.app_settings where org_id = ch_org) = 'CH9300762011623852957', 'iban mirrored';
  assert (select (settings->'tax'->>'vat_rate')::numeric from public.app_settings where org_id = ch_org) = 8.1, 'tax mirrored';
  begin
    perform public.update_payment_settings('{"enabled_methods":["card","bitcoin"]}');
    raise exception 'expected INVALID_METHOD';
  exception when others then assert sqlerrm like 'INVALID_METHOD%', sqlerrm; end;

  raise notice 'regional payments: all assertions passed';
end;
$$;

rollback;
