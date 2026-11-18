-- ============================================================================
-- Accounting (migration 20250420101300): period locks, chart + journal RPCs,
-- bank-file import (idempotent per bank entry), refund policies + requests
-- (IBAN restricted to finance), dunning, family support, reimbursements.
-- Cross-tenant denial for every new table and RPC.
--
-- Fixtures (seed): org A …0001 (admin …f1, finance …f2, coach …f3, parent …f4
-- = guardian of family …061), families …061/…062, athletes …071 (fam 061),
-- …072 (fam 062), invoice …091 (issued 2026-05-07). Org B = 10000000-…0002;
-- its admin + finance user …b1 is created here. Synthetic data only.
-- Every assertion prints PASS/FAIL.
-- ============================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema me;
grant usage on schema me to authenticated, anon;

create function me.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  raise notice '%', case when coalesce(p_cond, false) then 'PASS — ' else 'FAIL — ' end || p_msg;
end $$;

create function me.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), true);
  if p is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;

create function me.as_super() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Run p_sql as user p: 'OK:<first column>' or 'ERR:<message>'.
create function me.run_as(p uuid, p_sql text) returns text language plpgsql as $$
declare v_msg text; v_res text;
begin
  begin
    perform me.as_user(p);
    execute p_sql into v_res;
    perform me.as_super();
    return 'OK:' || coalesce(v_res, '<null>');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    perform me.as_super();
    return 'ERR:' || coalesce(v_msg, 'error');
  end;
end $$;
grant execute on all functions in schema me to authenticated, anon;

create table me.ctx (k text primary key, v text);
grant all on me.ctx to authenticated;
create function me.get(p text) returns uuid language sql as $$ select v::uuid from me.ctx where k = p $$;
grant execute on function me.get(text) to authenticated, anon;

-- Issued invoice helper (superuser; the reference trigger fills payment_reference).
create function me.invoice(p_family uuid, p_total numeric, p_due date, p_number text, p_issued timestamptz default now())
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.invoices (org_id, number, family_id, description, currency, total_chf, status, due_date, issued_at)
  values ('00000000-0000-0000-0000-000000000001', p_number, p_family, 'Test ' || p_number, 'CHF', p_total, 'sent', p_due, p_issued)
  returning id into v;
  return v;
end $$;

-- Org B admin + finance
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test') on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002' where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance')
on conflict do nothing;

-- ===========================================================================
-- 1. Chart of accounts + mappings
-- ===========================================================================
do $$
declare v text; n int;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.accounting_seed_chart(
         '[{"number":"1020","name":"Bank","type":"asset"},{"number":"1100","name":"Debtors","type":"asset"},{"number":"3400","name":"Camps","type":"income"}]',
         '[{"key":"bank","account_number":"1020"},{"key":"receivables","account_number":"1100"},{"key":"income.camp","account_number":"3400"},{"key":"vat.8.1","vat_code":"UN81"}]')::text$q$);
  perform me.ok(v like 'OK:%"accounts": 3%' and v like '%"mappings": 4%', 'finance seeds the chart (3 accounts, 4 mappings): ' || v);
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.accounting_seed_chart('[{"number":"1020","name":"Other","type":"asset"}]', '[]')::text$q$);
  perform me.ok(v like '%"accounts": 0%', 'seeding again never overwrites');
  v := me.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.accounting_seed_chart('[]', '[]')::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach cannot seed the chart');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.accounting_mappings (org_id, key, account_number) values ('00000000-0000-0000-0000-000000000001', 'not.a.key', '1') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'mapping keys are validated');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.accounting_accounts set name = 'Bank CHF' where number = '1020' returning name$q$);
  perform me.ok(v = 'OK:Bank CHF', 'finance edits an account');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.accounting_accounts$q$);
  perform me.ok(v = 'OK:0', 'parent sees no chart of accounts');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.accounting_journal_source(current_date - 30, current_date)::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'parent cannot read the journal source');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select jsonb_array_length(public.accounting_journal_source('2026-05-01', '2026-05-31')->'invoices')::text$q$);
  perform me.ok(v = 'OK:1', 'journal source lists the May invoice (…091): ' || v);
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.accounting_open_items(current_date) where invoice_id = '00000000-0000-0000-0000-000000000091'$q$);
  perform me.ok(v = 'OK:1', 'open items at today include the unpaid invoice …091');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select count(*)::text from public.accounting_open_items('2026-05-01') where invoice_id = '00000000-0000-0000-0000-000000000091'$q$);
  perform me.ok(v = 'OK:0', 'open items before the issue date do not include it');
end $$;

-- ===========================================================================
-- 2. Bank import: reference match + auto-book, suggestion, idempotency
-- ===========================================================================
do $$
declare v_a uuid; v_b uuid; v_ref text; v jsonb; v_txt text; v_e uuid; v_pay uuid; n int;
begin
  v_a := me.invoice('00000000-0000-0000-0000-000000000061', 500, current_date + 10, 'ACC-T-001');
  v_b := me.invoice('00000000-0000-0000-0000-000000000062', 300, current_date + 10, 'ACC-T-002');
  insert into me.ctx values ('inv_a', v_a::text), ('inv_b', v_b::text);
  select payment_reference into v_ref from public.invoices where id = v_a;
  perform me.ok(v_ref is not null, 'issued invoice has a structured reference');
  insert into me.ctx values ('ref_a', v_ref);

  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.bank_import(
    jsonb_build_object('file_name', 'nov.xml', 'file_sha256', repeat('a', 64), 'format', 'camt.054', 'account_last4', '9012'),
    jsonb_build_array(
      jsonb_build_object('bank_ref', 'T:R1', 'amount', 500, 'currency', 'CHF', 'value_date', current_date, 'reference', v_ref, 'reference_type', 'QRR', 'debtor_name', 'Test Payer'),
      jsonb_build_object('bank_ref', 'T:R2', 'amount', 300, 'currency', 'CHF', 'value_date', current_date, 'suggested_invoice_id', v_b, 'score', 70),
      jsonb_build_object('bank_ref', 'T:R3', 'amount', 12.5, 'currency', 'CHF', 'value_date', current_date),
      jsonb_build_object('bank_ref', 'T:R1', 'amount', 500, 'currency', 'CHF', 'value_date', current_date, 'reference', v_ref)),
    true);
  perform me.as_super();
  insert into me.ctx values ('import1', v->>'import_id');
  perform me.ok((v->>'entries')::int = 3 and (v->>'duplicates')::int = 1, 'import: 3 new entries, duplicate bank ref inside the file ignored: ' || v::text);
  perform me.ok((v->>'matched')::int = 2 and (v->>'booked')::int = 1, 'reference match auto-booked, heuristic only suggested');
  perform me.ok((select status::text from public.invoices where id = v_a) = 'paid', 'reference-matched invoice is paid');
  perform me.ok((select count(*) from public.payments where invoice_id = v_a and method = 'qr_bill') = 1, 'payment recorded as qr_bill through the payment RPC');
  perform me.ok((select status from public.bank_entries where bank_ref = 'T:R2') = 'suggested'
                and (select invoice_id from public.bank_entries where bank_ref = 'T:R2') = v_b, 'heuristic suggestion stored, not booked');
  perform me.ok((select status from public.bank_entries where bank_ref = 'T:R3') = 'unmatched', 'unmatched entry listed for manual assignment');

  -- same file again -> recognised; same entries in another file -> all duplicates
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.bank_import(jsonb_build_object('file_name', 'nov.xml', 'file_sha256', repeat('a', 64), 'format', 'camt.054'), '[]'::jsonb, true);
  perform me.as_super();
  perform me.ok((v->>'duplicate_file')::boolean, 'the same file is recognised by its hash');
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.bank_import(jsonb_build_object('file_name', 'stmt.xml', 'file_sha256', repeat('b', 64), 'format', 'camt.053'),
    jsonb_build_array(jsonb_build_object('bank_ref', 'T:R1', 'amount', 500, 'currency', 'CHF', 'reference', v_ref),
                      jsonb_build_object('bank_ref', 'T:R2', 'amount', 300, 'currency', 'CHF')), true);
  perform me.as_super();
  perform me.ok((v->>'entries')::int = 0 and (v->>'duplicates')::int = 2, 'overlapping statement: entries already imported are skipped');
  perform me.ok((select count(*) from public.payments where invoice_id = v_a and amount_chf > 0) = 1, 'no double booking from re-imports');

  -- one-click confirm, twice -> one payment
  select id into v_e from public.bank_entries where bank_ref = 'T:R2';
  insert into me.ctx values ('entry_r2', v_e::text);
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.bank_entry_confirm(%L)::text', v_e));
  perform me.ok(v_txt like 'OK:%payment_id%', 'confirm books the suggestion');
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.bank_entry_confirm(%L)::text', v_e));
  perform me.ok(v_txt like 'OK:%', 'confirming again is a no-op');
  perform me.ok((select count(*) from public.payments where invoice_id = v_b and amount_chf > 0) = 1, 'idempotent per bank entry: one payment');
  perform me.ok((select method::text from public.payments where invoice_id = v_b and amount_chf > 0) = 'bank_transfer', 'unstructured credit booked as bank_transfer');

  -- manual assignment of the unmatched entry, then undo
  select id into v_e from public.bank_entries where bank_ref = 'T:R3';
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.bank_entry_confirm(%L, %L)::text', v_e, '00000000-0000-0000-0000-000000000091'));
  perform me.ok(v_txt like 'OK:%' and (select match_kind from public.bank_entries where id = v_e) = 'manual', 'manual assignment books on the chosen invoice');
  select payment_id into v_pay from public.bank_entries where id = v_e;
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.bank_entry_reopen(%L, %L)::text', v_e, 'wrong invoice'));
  perform me.ok(v_txt like 'OK:%' and (select status from public.bank_entries where id = v_e) = 'unmatched', 'undo re-opens the entry');
  perform me.ok((select voided_at is not null from public.payments where id = v_pay)
                and exists (select 1 from public.payments where reverses_payment_id = v_pay), 'undo voids the payment with a reversal row (no delete)');
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.bank_entry_ignore(%L, %L)::text', v_e, 'own transfer'));
  perform me.ok(v_txt like 'OK:%' and (select status from public.bank_entries where id = v_e) = 'ignored', 'entry can be ignored with a reason');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'BANK_FILE_IMPORTED') and exists (select 1 from public.audit_logs where action = 'BANK_ENTRY_BOOKED'),
                'imports and bookings are audit-logged');

  -- currency mismatch / client cannot write
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$insert into public.bank_entries (org_id, import_id, bank_ref, amount, currency) values ('00000000-0000-0000-0000-000000000001', %L, 'X', 1, 'CHF') returning id::text$q$, me.get('import1')));
  perform me.ok(v_txt like 'ERR:%', 'bank entries cannot be inserted directly');
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.bank_entries$q$);
  perform me.ok(v_txt = 'OK:0', 'parent sees no bank entries');
  v_txt := me.run_as('00000000-0000-0000-0000-0000000000f3', $q$select public.bank_import('{"file_sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","format":"camt.054"}', '[]', false)::text$q$);
  perform me.ok(v_txt like 'ERR:%NOT_AUTHORIZED%', 'coach cannot import bank files');
end $$;

-- ===========================================================================
-- 3. Period locks
-- ===========================================================================
do $$
declare v text; v_cat uuid;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.accounting_close_period('2026-05-15')::text$q$);
  perform me.ok(v like 'OK:%"already_closed": false%', 'finance closes May 2026');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.accounting_close_period('2026-05-01')::text$q$);
  perform me.ok(v like 'OK:%"already_closed": true%', 'closing again is idempotent');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.accounting_close_period(current_date)::text$q$);
  perform me.ok(v like 'ERR:%PERIOD_NOT_ENDED%', 'the current month cannot be closed');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.invoices set description = 'edited' where id = '00000000-0000-0000-0000-000000000091' returning id::text$q$);
  perform me.ok(v like 'ERR:%PERIOD_CLOSED%', 'invoice dated in a closed month cannot be edited');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.invoice_items set description = 'x' where invoice_id = '00000000-0000-0000-0000-000000000091' returning id::text$q$);
  perform me.ok(v like 'ERR:%PERIOD_CLOSED%', 'its lines are frozen');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.record_offline_payment('00000000-0000-0000-0000-000000000091', 10, 'bank_transfer', '2026-05-20')::text$q$);
  perform me.ok(v like 'ERR:%PERIOD_CLOSED%', 'no payment can be dated in a closed month');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.record_offline_payment('00000000-0000-0000-0000-000000000091', 10, 'bank_transfer')::text$q$);
  perform me.ok(v like 'OK:%', 'a payment dated today on the same invoice still works');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.expenses (org_id, expense_date, amount, currency) values ('00000000-0000-0000-0000-000000000001', '2026-05-10', 20, 'CHF') returning id::text$q$);
  perform me.ok(v like 'ERR:%PERIOD_CLOSED%', 'no expense can be added in a closed month');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.accounting_reopen_period('2026-05-01', 'correction')::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'finance (not admin) cannot reopen');
  v := me.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.accounting_reopen_period('2026-05-01', '  ')::text$q$);
  perform me.ok(v like 'ERR:%REASON_REQUIRED%', 'reopening needs a reason');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.accounting_reopen_period('2026-05-01', 'hack')::text$q$);
  perform me.ok(v like 'ERR:%PERIOD_NOT_CLOSED%', 'another club cannot reopen this club''s month');
  v := me.run_as('00000000-0000-0000-0000-0000000000f1', $q$select public.accounting_reopen_period('2026-05-01', 'late supplier invoice')::text$q$);
  perform me.ok(v like 'OK:%', 'admin reopens with a reason');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'PERIOD_REOPENED' and new_data->>'reason' = 'late supplier invoice'), 'reopen is audit-logged with the reason');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.invoices set description = 'edited after reopen' where id = '00000000-0000-0000-0000-000000000091' returning description$q$);
  perform me.ok(v = 'OK:edited after reopen', 'after reopening the invoice can be edited again');
  perform me.ok((select count(*) from public.accounting_period_locks where period_start = '2026-05-01') = 1, 'lock history is kept (reopened row stays)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$delete from public.accounting_period_locks returning id::text$q$);
  perform me.ok((v = 'OK:<null>' or v like 'ERR:%') and (select count(*) from public.accounting_period_locks) = 1, 'locks cannot be deleted by clients');
end $$;

-- ===========================================================================
-- 4. Refund policies and requests; IBAN restricted to finance
-- ===========================================================================
do $$
declare v_prog uuid; v_reg uuid; v_inv uuid; v text; q jsonb; v_req uuid;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.refund_policies (org_id, product_type, full_until_days, partial_percent, partial_until_days, medical_mode, medical_percent)
        values ('00000000-0000-0000-0000-000000000001', 'camp', 30, 50, 14, 'credit', 100) returning id::text$q$);
  perform me.ok(v like 'OK:%', 'finance saves the camp refund policy');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.refund_policies where product_type = 'camp'$q$);
  perform me.ok(v = 'OK:1', 'parents read the policy (shown before cancelling)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$update public.refund_policies set partial_percent = 100 returning id::text$q$);
  perform me.ok(v = 'OK:<null>', 'parents cannot change the policy');

  insert into public.programs (org_id, slug, name, kind, price_chf, starts_on, ends_on, is_active)
  values ('00000000-0000-0000-0000-000000000001', 'acct-test-camp', 'Test camp', 'camp', 400, current_date + 20, current_date + 24, true)
  returning id into v_prog;
  insert into public.registrations (org_id, athlete_id, program_id, status)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', v_prog, 'confirmed')
  returning id into v_reg;
  v_inv := me.invoice('00000000-0000-0000-0000-000000000061', 400, current_date + 5, 'ACC-T-010');
  update public.invoices set registration_id = v_reg, program_id = v_prog where id = v_inv;
  insert into me.ctx values ('reg', v_reg::text), ('reg_inv', v_inv::text), ('camp', v_prog::text);
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  perform public.record_offline_payment(v_inv, 400, 'bank_transfer');
  perform me.as_super();

  v := me.run_as('00000000-0000-0000-0000-0000000000f4', format('select public.refund_quote(%L)::text', v_reg));
  q := substr(v, 4)::jsonb;
  perform me.ok((q->>'percent')::int = 50 and (q->>'refund')::numeric = 200 and (q->>'payout')::numeric = 200 and (q->>'days_before')::int = 20,
                'parent sees the computed refund before cancelling (20 days -> 50% = 200): ' || v);
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', format('select (public.refund_quote(%L, null, null, true)->>%L)', v_reg, 'percent'));
  perform me.ok(v = 'OK:100', 'medical cancellation: 100%');
  v := me.run_as('00000000-0000-0000-0000-0000000000f3', format('select public.refund_quote(%L)::text', v_reg));
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach cannot quote a family''s refund');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.refund_quote(%L)::text', v_reg));
  perform me.ok(v like 'ERR:%SUBJECT_NOT_FOUND%', 'another club cannot quote this registration');

  v := me.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.refund_request_create('{"registration_id":"%s","preference":"bank_refund","iban":"CH93 0076 2011 6238 5295 8","account_holder":"Test Parent"}')::text$q$, v_reg));
  perform me.ok(v like 'ERR:%INVALID_IBAN%', 'invalid IBAN rejected');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.refund_request_create('{"registration_id":"%s","preference":"bank_refund","iban":"CH93 0076 2011 6238 5295 7","account_holder":"Test Parent","reason":"moved"}')::text$q$, v_reg));
  perform me.ok(v like 'OK:%request_id%', 'parent cancels and requests a bank refund');
  v_req := (substr(v, 4)::jsonb->>'request_id')::uuid;
  insert into me.ctx values ('req', v_req::text);
  perform me.ok((select status::text from public.registrations where id = v_reg) = 'cancelled', 'the registration is cancelled');
  perform me.ok((select iban_last4 from public.refund_requests where id = v_req) = '2957', 'request keeps only the last 4 IBAN characters');
  perform me.ok(not exists (select 1 from public.audit_logs where new_data::text like '%CH9300762011623852957%' or old_data::text like '%CH9300762011623852957%'),
                'the full IBAN never lands in audit_logs');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.refund_request_create('{"registration_id":"%s"}')::text$q$, v_reg));
  perform me.ok(v like 'ERR:%', 'a second request for the same registration is refused');

  -- IBAN column hidden from coach and parent
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.refund_bank_details$q$);
  perform me.ok(v = 'OK:0', 'parent cannot read the stored IBAN (not even their own)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.refund_bank_details$q$);
  perform me.ok(v = 'OK:0', 'coach cannot read IBANs');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.refund_bank_details$q$);
  perform me.ok(v = 'OK:0', 'another club''s finance cannot read IBANs');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select iban from public.refund_bank_details limit 1$q$);
  perform me.ok(v = 'OK:CH9300762011623852957', 'finance of the club reads the IBAN to pay the refund');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.refund_requests$q$);
  perform me.ok(v = 'OK:1', 'parent sees their own request');
  v := me.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.refund_requests$q$);
  perform me.ok(v = 'OK:0', 'coach sees no refund requests');

  -- processing
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', format($q$select public.refund_request_process(%L, 'bank_refund')::text$q$, v_req));
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'parent cannot process refunds');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.refund_request_process(%L, 'bank_refund', 250)::text$q$, v_req));
  perform me.ok(v like 'ERR:%OVERRIDE_REASON_REQUIRED%', 'overriding the policy amount needs a reason');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$select public.refund_request_process(%L, 'bank_refund')::text$q$, v_req));
  perform me.ok(v like 'ERR:%REQUEST_NOT_FOUND%', 'another club cannot process this request');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.refund_request_process(%L, 'bank_refund')::text$q$, v_req));
  perform me.ok(v like 'OK:%"payout": 200%' and v like '%completed%', 'finance processes the bank refund (payout 200)');
  perform me.ok(exists (select 1 from public.invoice_adjustments where invoice_id = v_inv and kind = 'credit_note' and amount = 200), 'credit note of 200 issued');
  perform me.ok(exists (select 1 from public.payments where invoice_id = v_inv and amount_chf = -200 and method_detail = 'bank_refund'), 'outgoing bank refund recorded as a negative payment');
  perform me.ok((select status::text from public.invoices where id = v_inv) = 'paid' and public.invoice_net_paid(v_inv) = 200, 'invoice settled at the retained 200');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.refund_request_process(%L, 'bank_refund')::text$q$, v_req));
  perform me.ok(v like 'ERR:%REQUEST_CLOSED%', 'a processed request cannot be paid twice');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.refund_requests (org_id, family_id, product_type, currency) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'camp', 'CHF') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'refund requests cannot be inserted directly');
end $$;

-- Medical cancellation -> family credit
do $$
declare v_reg uuid; v_inv uuid; v text; v_req uuid;
begin
  insert into public.registrations (org_id, athlete_id, program_id, status)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000072', me.get('camp'), 'confirmed')
  returning id into v_reg;
  v_inv := me.invoice('00000000-0000-0000-0000-000000000062', 400, current_date + 5, 'ACC-T-011');
  update public.invoices set registration_id = v_reg, program_id = me.get('camp') where id = v_inv;
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  perform public.record_offline_payment(v_inv, 400, 'bank_transfer');
  perform me.as_super();
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.refund_request_create('{"registration_id":"%s","medical":true,"preference":"bank_refund","iban":"CH9300762011623852957","account_holder":"X"}')::text$q$, v_reg));
  v_req := (substr(v, 4)::jsonb->>'request_id')::uuid;
  perform me.ok((select preference from public.refund_requests where id = v_req) = 'family_credit', 'medical + credit policy forces the family-credit preference');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.refund_request_process(%L, 'bank_refund')::text$q$, v_req));
  perform me.ok(v like 'ERR:%OVERRIDE_REASON_REQUIRED%', 'paying a medical credit out needs an override reason');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.refund_request_process(%L, 'family_credit')::text$q$, v_req));
  perform me.ok(v like 'OK:%"payout": 400%', 'medical cancellation credited in full');
  perform me.ok(public.family_credit_balance('00000000-0000-0000-0000-000000000062', 'CHF') = 400, 'family credit balance is 400');
end $$;

-- ===========================================================================
-- 5. Dunning
-- ===========================================================================
do $$
declare v text; v_inv uuid; v_inv2 uuid; v_inv3 uuid; v_plan uuid; r jsonb;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.dunning_settings (org_id, enabled, level1_days, level2_days, level2_fee, level3_days, level3_fee, collection_days)
        values ('00000000-0000-0000-0000-000000000001', true, 10, 30, 20, 50, 30, 80) returning org_id::text$q$);
  perform me.ok(v like 'OK:%', 'finance enables dunning');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.dunning_settings set level2_days = 5 returning org_id::text$q$);
  perform me.ok(v like 'ERR:%', 'inconsistent thresholds are rejected');

  -- other open invoices of org A must not interfere: pause them
  update public.invoices set reminders_paused = true
   where org_id = '00000000-0000-0000-0000-000000000001' and number not like 'ACC-D-%';
  v_inv := me.invoice('00000000-0000-0000-0000-000000000061', 100, current_date - 35, 'ACC-D-001', now() - interval '40 days');
  insert into me.ctx values ('dun_inv', v_inv::text);

  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date);
  perform me.ok((r->>'created')::int = 1 and (select level from public.dunning_cases where invoice_id = v_inv) = 1, 'run 1: friendly reminder first (35 days late)');
  perform me.ok(jsonb_array_length(r->'notices') = 1 and (r->'notices'->0->>'level')::int = 1, 'unsent notice returned for e-mailing');
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date);
  perform me.ok((select level from public.dunning_cases where invoice_id = v_inv) = 2
                and exists (select 1 from public.invoice_adjustments where invoice_id = v_inv and kind = 'debit_note' and amount = 20 and reason = 'dunning_fee:2'),
                'run 2: reminder 2 with a 20 fee as a debit note');
  perform me.ok(public.invoice_amount_due(v_inv) = 120, 'amount due includes the fee');
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date);
  perform me.ok((r->>'created')::int = 0 and (select count(*) from public.dunning_notices where invoice_id = v_inv) = 2, 'run 3 the same day: nothing new (idempotent)');
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date + 20);
  perform me.ok((select level from public.dunning_cases where invoice_id = v_inv) = 3 and public.invoice_amount_due(v_inv) = 150, 'final notice adds the level-3 fee');
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date + 50);
  perform me.ok((select status from public.dunning_cases where invoice_id = v_inv) = 'collection', 'then flagged for collection (no external call)');
  perform public.dunning_mark_sent((select id from public.dunning_notices where invoice_id = v_inv and level = 1), '00000000-0000-0000-0000-000000000001', true);
  perform me.ok((select sent_at is not null from public.dunning_notices where invoice_id = v_inv and level = 1), 'notice marked sent');

  -- family pause
  v_inv2 := me.invoice('00000000-0000-0000-0000-000000000062', 80, current_date - 15, 'ACC-D-002', now() - interval '20 days');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.dunning_family_pauses (org_id, family_id, reason) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'payment agreement') returning id::text$q$);
  perform me.ok(v like 'OK:%', 'finance pauses dunning for a family');
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date);
  perform me.ok(not exists (select 1 from public.dunning_cases where invoice_id = v_inv2), 'paused family is not dunned');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$insert into public.dunning_family_pauses (org_id, family_id, reason) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000061', 'x') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'another club cannot pause this club''s family');
  delete from public.dunning_family_pauses;

  -- instalment plan whose overdue instalment autopay is still charging -> skipped
  v_inv3 := me.invoice('00000000-0000-0000-0000-000000000062', 200, current_date + 60, 'ACC-D-003', now() - interval '60 days');
  insert into public.payment_plans (org_id, family_id, invoice_id, kind, currency, amount_total, installment_count, start_date, status, autopay)
  values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', v_inv3, 'installments', 'CHF', 200, 2, current_date - 60, 'active', true)
  returning id into v_plan;
  insert into public.payment_plan_installments (org_id, plan_id, seq, due_date, amount, currency, status, autopay_status) values
    ('00000000-0000-0000-0000-000000000001', v_plan, 1, current_date - 40, 100, 'CHF', 'scheduled', 'processing'),
    ('00000000-0000-0000-0000-000000000001', v_plan, 2, current_date + 20, 100, 'CHF', 'scheduled', null);
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date);
  perform me.ok(not exists (select 1 from public.dunning_cases where invoice_id = v_inv3) and (r->>'skipped_autopay')::int >= 1,
                'an instalment autopay is still charging is not dunned');
  update public.payment_plan_installments set autopay_status = 'fallback' where plan_id = v_plan and seq = 1;
  r := public.dunning_run('00000000-0000-0000-0000-000000000001', current_date);
  perform me.ok((select balance from public.dunning_notices where invoice_id = v_inv3 and level = 1) = 100,
                'after the autopay fallback only the overdue instalment (100 of 200) is dunned');

  -- the paused invoice 080 family 062 (ACC-D-002) still open: resolve by hand
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.dunning_resolve_case((select id from public.dunning_cases where invoice_id = %L), 'agreed')::text$q$, v_inv3));
  perform me.ok(v like 'OK:%resolved%', 'finance resolves a case by hand');

  -- cross-tenant / roles
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.dunning_run('00000000-0000-0000-0000-000000000001')::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'another club cannot run this club''s dunning');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select public.dunning_run('00000000-0000-0000-0000-000000000001')::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'parent cannot run dunning');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select (public.dunning_run('00000000-0000-0000-0000-000000000001', current_date, true)->>'dry_run')$q$);
  perform me.ok(v = 'OK:true', 'finance "run now" preview (dry run)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.dunning_cases$q$);
  perform me.ok(v = 'OK:0', 'parent sees no dunning cases');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.dunning_mark_exported(array(select id from public.dunning_cases))::text$q$);
  perform me.ok(v = 'OK:0', 'another club cannot mark this club''s cases exported');
end $$;

-- ===========================================================================
-- 6. Family support + reimbursements
-- ===========================================================================
do $$
declare v text; v_disc uuid; v_inv uuid; r jsonb;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.discounts (org_id, name, kind, value, scope, rule, scope_family_id, max_amount, support_reason)
        values ('00000000-0000-0000-0000-000000000001', 'Scholarship', 'percent', 50, 'all', 'family_support', '00000000-0000-0000-0000-000000000062', 100, 'scholarship') returning id::text$q$);
  perform me.ok(v like 'OK:%', 'finance creates a family support discount');
  v_disc := nullif(substr(v, 4), '')::uuid;
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$update public.discounts set rule = 'manual', scope_family_id = null where id = %L returning id::text$q$, v_disc));
  perform me.ok(v like 'ERR:%' or v = 'OK:<null>', 'finance cannot turn a support discount into a general one');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.discounts (org_id, name, kind, value, scope, rule) values ('00000000-0000-0000-0000-000000000001', 'General', 'percent', 5, 'all', 'manual') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'general discounts stay admin-only');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$insert into public.discounts (org_id, name, kind, value, scope, rule)
        values ('00000000-0000-0000-0000-000000000001', 'No family', 'percent', 50, 'all', 'family_support') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'a family support discount needs its family');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$insert into public.discounts (org_id, name, kind, value, scope, rule, scope_family_id)
        values ('10000000-0000-0000-0000-000000000002', 'Steal', 'percent', 50, 'all', 'family_support', '00000000-0000-0000-0000-000000000062') returning id::text$q$);
  perform me.ok(v like 'ERR:%CROSS_TENANT%', 'another club cannot target this club''s family');

  v_inv := me.invoice('00000000-0000-0000-0000-000000000062', 300, current_date + 30, 'ACC-S-001');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.family_support_apply(%L)::text', v_inv));
  perform me.ok(v like 'OK:%"amount": 100%', 'support applied as a credit note, capped at 100 (50% would be 150)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format('select public.family_support_apply(%L)::text', v_inv));
  perform me.ok(v like 'OK:%"amount": 0%', 'applying again adds nothing');
  perform me.ok(exists (select 1 from public.applied_discounts where discount_id = v_disc and invoice_id = v_inv and source = 'family_support' and amount = 100),
                'applied_discounts row records the support');
  perform me.ok(public.invoice_amount_due(v_inv) = 200, 'invoice due reduced to 200');
  r := public.family_support_sweep('00000000-0000-0000-0000-000000000001');
  perform me.ok((select coalesce(sum(amount), 0) from public.applied_discounts where discount_id = v_disc) = 100, 'the cap holds across invoices (sweep adds nothing)');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.family_support_apply(%L)::text', v_inv));
  perform me.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'another club cannot apply support to this invoice');
  begin
    insert into public.applied_discounts (org_id, discount_id, source, family_id, rule, name, kind, value, amount, currency)
    values ('00000000-0000-0000-0000-000000000001', v_disc, 'registration', '00000000-0000-0000-0000-000000000062', 'family_support', 'x', 'percent', 50, 10, 'CHF');
    perform me.ok(false, 'family support cannot be booked through another flow');
  exception when others then
    perform me.ok(sqlerrm like '%DISCOUNT_NOT_AVAILABLE%', 'family support cannot be booked through another flow');
  end;

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$insert into public.external_reimbursements (org_id, funder_kind, funder_name, family_id, invoice_id, amount_expected, currency, status)
        values ('00000000-0000-0000-0000-000000000001', 'city', 'City sports office', '00000000-0000-0000-0000-000000000062', %L, 100, 'CHF', 'requested') returning id::text$q$, v_inv));
  perform me.ok(v like 'OK:%', 'finance tracks an expected reimbursement');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.external_reimbursements set status = 'received' returning id::text$q$);
  perform me.ok(v like 'ERR:%', '"received" needs the date and amount');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$update public.external_reimbursements set status = 'received', received_on = current_date, amount_received = 100 returning status$q$);
  perform me.ok(v = 'OK:received', 'marked received');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$insert into public.external_reimbursements (org_id, funder_kind, funder_name, invoice_id, amount_expected, currency)
        values ('10000000-0000-0000-0000-000000000002', 'city', 'x', %L, 1, 'USD') returning id::text$q$, v_inv));
  perform me.ok(v like 'ERR:%CROSS_TENANT%', 'another club cannot link this club''s invoice');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.external_reimbursements$q$);
  perform me.ok(v = 'OK:0', 'parent sees no reimbursements');
end $$;

-- ===========================================================================
-- 7. Cross-tenant denial: every new table, read and write, as org B finance
-- ===========================================================================
do $$
declare t text; v text;
begin
  foreach t in array array['accounting_period_locks', 'accounting_accounts', 'accounting_mappings', 'bank_statement_imports',
                           'bank_entries', 'refund_policies', 'refund_requests', 'refund_bank_details', 'dunning_settings',
                           'dunning_family_pauses', 'dunning_cases', 'dunning_notices', 'external_reimbursements'] loop
    perform me.ok((select count(*) from pg_class where relname = t and relrowsecurity and relforcerowsecurity) = 1, t || ': RLS enabled and forced');
    perform me.ok((select count(distinct cmd) from pg_policies where tablename = t and permissive = 'PERMISSIVE') = 4, t || ': a permissive policy for every verb');
    v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$select count(*)::text from public.%I where org_id = '00000000-0000-0000-0000-000000000001'$q$, t));
    perform me.ok(v = 'OK:0', t || ': org B finance reads nothing of org A');
    v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$update public.%I set org_id = org_id where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$, t));
    perform me.ok(v = 'OK:<null>' or v like 'ERR:%', t || ': org B finance updates nothing of org A');
    v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$delete from public.%I where org_id = '00000000-0000-0000-0000-000000000001' returning org_id::text$q$, t));
    perform me.ok(v = 'OK:<null>' or v like 'ERR:%', t || ': org B finance deletes nothing of org A');
    v := me.run_as(null, format('select count(*)::text from public.%I', t));
    perform me.ok(v like 'ERR:%' or v = 'OK:0', t || ': anon reads nothing');
  end loop;

  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$insert into public.accounting_accounts (org_id, number, name, type) values ('00000000-0000-0000-0000-000000000001', '9999', 'x', 'asset') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'org B cannot insert accounts into org A');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$insert into public.refund_policies (org_id, product_type) values ('00000000-0000-0000-0000-000000000001', 'shop') returning id::text$q$);
  perform me.ok(v like 'ERR:%', 'org B cannot insert a refund policy into org A');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$insert into public.dunning_settings (org_id) values ('00000000-0000-0000-0000-000000000001') returning org_id::text$q$);
  perform me.ok(v like 'ERR:%', 'org B cannot write org A dunning settings');

  -- RPCs on org A objects as org B finance
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.bank_entry_confirm(%L)::text', me.get('entry_r2')));
  perform me.ok(v like 'ERR:%ENTRY_NOT_FOUND%', 'bank_entry_confirm: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.bank_entry_ignore(%L, %L)::text', me.get('entry_r2'), 'x'));
  perform me.ok(v like 'ERR:%ENTRY_NOT_FOUND%', 'bank_entry_ignore: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.bank_entry_reopen(%L, %L)::text', me.get('entry_r2'), 'x'));
  perform me.ok(v like 'ERR:%ENTRY_NOT_FOUND%', 'bank_entry_reopen: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.refund_request_reject(%L, %L)::text', me.get('req'), 'x'));
  perform me.ok(v like 'ERR:%REQUEST_NOT_FOUND%', 'refund_request_reject: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format('select public.refund_request_stripe_params(%L)::text', me.get('req')));
  perform me.ok(v like 'ERR:%REQUEST_NOT_FOUND%', 'refund_request_stripe_params: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', format($q$select public.refund_request_create('{"invoice_id":"%s"}')::text$q$, me.get('inv_a')));
  perform me.ok(v like 'ERR:%SUBJECT_NOT_FOUND%', 'refund_request_create: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.family_support_sweep('00000000-0000-0000-0000-000000000001')::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'family_support_sweep: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select count(*)::text from public.accounting_open_items(current_date) where number like 'ACC-%'$q$);
  perform me.ok(v = 'OK:0', 'accounting_open_items: only the caller''s club');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select jsonb_array_length(public.accounting_journal_source(current_date - 30, current_date)->'invoices')::text$q$);
  perform me.ok(v = 'OK:0', 'accounting_journal_source: only the caller''s club');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.dunning_resolve_case((select id from public.dunning_cases limit 1), 'x')::text$q$);
  perform me.ok(v like 'ERR:%CASE_NOT_FOUND%', 'dunning_resolve_case: cross-tenant denied');
  v := me.run_as('b0000000-0000-0000-0000-0000000000b1', $q$select public.dunning_mark_sent((select id from public.dunning_notices limit 1), '00000000-0000-0000-0000-000000000001', true)::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'dunning_mark_sent: cross-tenant denied');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select public.refund_request_stripe_result(null, null, null)::text$q$);
  perform me.ok(v like 'ERR:%', 'refund_request_stripe_result is service-only');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.bank_entry_book_internal(%L, %L, 'manual')::text$q$, me.get('entry_r2'), me.get('inv_b')));
  perform me.ok(v like 'ERR:%permission denied%', 'internal booking helper is not callable by clients');
end $$;
