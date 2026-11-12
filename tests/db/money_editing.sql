-- ============================================================================
-- Money editing (migration 20250420095900): draft edits, safe edits, credit /
-- debit notes, write-offs, cancel + reopen, manual payment void / edit /
-- re-allocation, overpayment -> family credit, training-credit ledger, RLS on
-- the new tables and cross-tenant denial.
--
-- Fixture identities (seed): org A …0001 (admin …f1, finance …f2, coach …f3,
-- parent …f4 = guardian of family …061), families …061-063, athletes
-- …071-074 (…072 has 2 personal credits, 1 used), invoice …091 (CHF 1490,
-- 'sent', family …061), invoice …093 (CHF 290, paid, family …062).
-- Org B = Riverside 10000000-…0002; its admin+finance user is created here.
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

-- Run p_sql as user p (null = anon): 'OK:<first column>' or 'ERR:<message>'.
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

-- Org B admin + finance
insert into auth.users (id, email) values ('b0000000-0000-0000-0000-0000000000b1', 'admin@riverside.test')
on conflict do nothing;
update public.profiles set org_id = '10000000-0000-0000-0000-000000000002'
 where id = 'b0000000-0000-0000-0000-0000000000b1';
insert into public.staff_roles (org_id, profile_id, role) values
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-0000000000b1', 'finance')
on conflict do nothing;

-- ===========================================================================
-- 1. Draft invoice: free edits, stable reference, audit
-- ===========================================================================
do $$
declare v jsonb; v_inv uuid; v_ref text; r public.invoices; v_n int; v_err text;
begin
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.create_manual_invoice(jsonb_build_object(
         'family_id', '00000000-0000-0000-0000-000000000061', 'description', 'Draft',
         'items', jsonb_build_array(jsonb_build_object('description', 'Fee', 'quantity', 1, 'unit_price_chf', 100))));
  perform me.as_super();
  v_inv := (v->>'invoice_id')::uuid;
  insert into me.ctx values ('draft', v_inv::text);
  select payment_reference into v_ref from public.invoices where id = v_inv;

  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  v := public.update_draft_invoice(v_inv, jsonb_build_object(
         'family_id', '00000000-0000-0000-0000-000000000063',
         'description', 'Spring term (edited)', 'due_date', (current_date + 20)::text,
         'notes', 'Thank you', 'locale', 'fr',
         'items', jsonb_build_array(
            jsonb_build_object('description', 'Team fee', 'quantity', 3, 'unit_price', 120.10),
            jsonb_build_object('description', 'Jersey', 'quantity', 1, 'unit_price', 45.555)),
         'discount', 20.5, 'discount_label', 'Loyalty'));
  perform me.as_super();
  select * into r from public.invoices where id = v_inv;
  select count(*) into v_n from public.invoice_items where invoice_id = v_inv;
  perform me.ok(r.total_chf = 385.36, 'draft edit total = 3×120.10 + round(45.555) − 20.50 = 385.36 (got ' || r.total_chf || ')');
  perform me.ok(v_n = 3, 'draft edit replaces the line items (2 lines + discount)');
  perform me.ok(r.family_id = '00000000-0000-0000-0000-000000000063', 'draft edit can change the recipient family');
  perform me.ok(r.athlete_id is null, 'athlete link dropped when it does not belong to the new family');
  perform me.ok(r.notes = 'Thank you' and r.locale = 'fr' and r.due_date = current_date + 20, 'notes, language and due date saved');
  perform me.ok(r.payment_reference = v_ref, 'payment reference unchanged by a draft edit');
  perform me.ok(r.status::text = 'draft', 'still a draft');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'INVOICE_EDITED' and target_id = v_inv
                         and (old_data->'invoice'->>'total')::numeric = 100 and (new_data->'invoice'->>'total')::numeric = 385.36),
               'INVOICE_EDITED audit row carries before/after totals');

  v_err := me.run_as('00000000-0000-0000-0000-0000000000f4',
    format($q$select public.update_draft_invoice(%L, '{"items":[{"description":"x","quantity":1,"unit_price":1}]}')::text$q$, v_inv));
  perform me.ok(v_err like 'ERR:%NOT_AUTHORIZED%', 'parent cannot edit invoices');
  v_err := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.update_draft_invoice(%L, '{"items":[{"description":"x","quantity":1,"unit_price":-5}]}')::text$q$, v_inv));
  perform me.ok(v_err like 'ERR:%INVALID_TOTAL%', 'negative invoice total rejected');
  v_err := me.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$select public.update_draft_invoice('00000000-0000-0000-0000-000000000091', '{"items":[{"description":"x","quantity":1,"unit_price":1}]}')::text$q$);
  perform me.ok(v_err like 'ERR:%INVOICE_NOT_DRAFT%', 'issued invoice cannot be edited freely');
end $$;

-- ===========================================================================
-- 2. Safe edits on an issued invoice
-- ===========================================================================
do $$
declare v_inv uuid := '00000000-0000-0000-0000-000000000091'; v text;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.update_invoice_details(%L, jsonb_build_object('due_date', (current_date - 3)::text, 'reminders_paused', true, 'notes', 'Called parent'))->>'status'$q$, v_inv));
  perform me.ok(v = 'OK:overdue', 'past due date on a sent invoice -> overdue (' || v || ')');
  perform me.ok((select reminders_paused and notes = 'Called parent' from public.invoices where id = v_inv), 'reminder pause + notes saved');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.update_invoice_details(%L, jsonb_build_object('due_date', (current_date + 10)::text, 'reminders_paused', false))->>'status'$q$, v_inv));
  perform me.ok(v = 'OK:sent', 'moving the due date forward clears overdue (' || v || ')');
  perform me.ok((select total_chf = 1490 from public.invoices where id = v_inv), 'safe edits never touch the amount');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'INVOICE_DETAILS_EDITED' and target_id = v_inv
                         and old_data->>'reminders_paused' = 'true' and new_data->>'reminders_paused' = 'false'),
               'INVOICE_DETAILS_EDITED audit row has before/after');
end $$;

-- ===========================================================================
-- 3. Credit / debit notes on an issued invoice
-- ===========================================================================
do $$
declare v_inv uuid := '00000000-0000-0000-0000-000000000091'; v_ref text; v text; r public.invoices;
begin
  select payment_reference into v_ref from public.invoices where id = v_inv;
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 200.004, 'Missed two sessions')->>'number'$q$, v_inv));
  perform me.ok(v = 'OK:INV-2026-0211-CN1', 'credit note numbered after the invoice (' || v || ')');
  select * into r from public.invoices where id = v_inv;
  perform me.ok(r.total_chf = 1490 and r.adjustments_total = -200, 'issued total stays 1490; adjustments_total −200');
  perform me.ok(public.invoice_amount_due(v_inv) = 1290, 'amount due 1290 after the credit note');
  perform me.ok(r.payment_reference = v_ref, 'QR reference stable after a credit note');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'INVOICE_ADJUSTMENT_ISSUED' and target_id = v_inv
                         and (old_data->>'amount_due')::numeric = 1490 and (new_data->>'amount_due')::numeric = 1290),
               'adjustment audit row: amount due 1490 -> 1290');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'debit_note', 50, 'Extra jersey')->>'number'$q$, v_inv));
  perform me.ok(public.invoice_amount_due(v_inv) = 1340, 'debit note raises the amount due to 1340');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 5000, 'too much')::text$q$, v_inv));
  perform me.ok(v like 'ERR:%CREDIT_EXCEEDS_AMOUNT_DUE%', 'credit note above the amount due rejected');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 1340, 'all')::text$q$, v_inv));
  perform me.ok(v like 'ERR:%USE_CANCEL%', 'crediting an unpaid invoice to zero must be a cancellation');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 10, '  ')::text$q$, v_inv));
  perform me.ok(v like 'ERR:%REASON_REQUIRED%', 'a reason is required');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 10, 'x')::text$q$, me.get('draft')));
  perform me.ok(v like 'ERR:%INVOICE_IS_DRAFT%', 'drafts are edited, not credited');

  -- adjustments are immutable for everyone, including finance
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$with u as (update public.invoice_adjustments set amount = 1 where invoice_id = %L returning 1) select count(*)::text from u$q$, v_inv));
  perform me.ok(v = 'OK:0' or v like 'ERR:%', 'finance cannot update an adjustment directly (' || v || ')');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$insert into public.invoice_adjustments (org_id, invoice_id, number, kind, amount, currency, reason) values ('00000000-0000-0000-0000-000000000001', %L, 'X', 'credit_note', 1, 'CHF', 'x') returning 1$q$, v_inv));
  perform me.ok(v like 'ERR:%', 'finance cannot insert an adjustment directly (RPC only)');

  -- the issued amount cannot be changed silently through the table API
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$with u as (update public.invoices set total_chf = 1 where id = %L returning 1) select count(*)::text from u$q$, v_inv));
  perform me.ok(v like 'ERR:%INVOICE_LOCKED%', 'finance cannot overwrite an issued total directly (' || left(v, 60) || ')');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$with u as (update public.invoices set adjustments_total = 0 where id = %L returning 1) select count(*)::text from u$q$, v_inv));
  perform me.ok(v like 'ERR:%INVOICE_LOCKED%', 'finance cannot overwrite adjustments_total directly');
  perform me.ok(public.invoice_amount_due(v_inv) = 1340, 'amount due unchanged after the direct-update attempts');
  begin
    delete from public.invoice_adjustments where invoice_id = v_inv;
    perform me.ok(false, 'adjustments cannot be deleted');
  exception when others then perform me.ok(true, 'adjustments cannot be deleted (guard trigger)');
  end;
end $$;

-- ===========================================================================
-- 4. Payments, overpayment flag, transfer to family credit, apply credit
-- ===========================================================================
do $$
declare v_inv uuid := '00000000-0000-0000-0000-000000000091'; v text; v2 uuid; j jsonb;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.record_offline_payment(%L, 1340, 'bank_transfer', current_date - 2, 'REF-1', 'bank')->>'status'$q$, v_inv));
  perform me.ok(v = 'OK:paid', 'paying the adjusted amount due (1340) marks the invoice paid (' || v || ')');
  perform me.ok((select (paid_at at time zone 'UTC')::date = current_date - 2 from public.payments
                  where invoice_id = v_inv and qr_reference = 'REF-1'), 'payment keeps its real date');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.record_offline_payment(%L, 10, 'twint', current_date + 1)::text$q$, v_inv));
  perform me.ok(v like 'ERR:%INVALID_DATE%', 'future payment date rejected');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.record_offline_payment(%L, 60, 'manual')->>'overpaid'$q$, v_inv));
  perform me.ok(v = 'OK:60.00', 'second cash payment reports 60 overpaid (' || v || ')');
  perform me.ok((select status::text from public.invoices where id = v_inv) = 'paid', 'overpaid invoice stays paid');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'INVOICE_OVERPAID' and target_id = v_inv
                         and (new_data->>'overpaid')::numeric = 60), 'overpayment flagged in audit_logs (INVOICE_OVERPAID 60)');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.transfer_overpayment_to_credit(%L, 80)::text$q$, v_inv));
  perform me.ok(v like 'ERR:%AMOUNT_EXCEEDS_OVERPAYMENT%', 'cannot move more than the overpayment');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.transfer_overpayment_to_credit(%L, null, 'Paid twice')->>'family_credit'$q$, v_inv));
  perform me.ok(v = 'OK:60.00', 'overpayment moved to family credit (balance ' || v || ')');
  perform me.ok(public.invoice_net_paid(v_inv) = public.invoice_amount_due(v_inv), 'invoice net paid now equals the amount due');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.transfer_overpayment_to_credit(%L)::text$q$, v_inv));
  perform me.ok(v like 'ERR:%NO_OVERPAYMENT%', 'nothing left to transfer');

  -- New invoice for the same family, paid from the credit.
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  j := public.create_manual_invoice(jsonb_build_object('family_id', '00000000-0000-0000-0000-000000000061',
         'items', jsonb_build_array(jsonb_build_object('description', 'Clinic', 'quantity', 1, 'unit_price_chf', 100))));
  perform me.as_super();
  v2 := (j->>'invoice_id')::uuid;
  insert into me.ctx values ('inv2', v2::text);
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.apply_family_credit(%L)::text$q$, v2));
  perform me.ok(v like 'ERR:%INVOICE_NOT_PAYABLE%', 'credit cannot pay a draft');
  update public.invoices set status = 'sent' where id = v2;
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.apply_family_credit(%L, null, 'Use credit')->>'amount'$q$, v2));
  perform me.ok(v = 'OK:60.00', 'credit applied: 60 of 100 (' || v || ')');
  perform me.ok((select status::text from public.invoices where id = v2) = 'partially_paid', 'invoice partially paid by credit');
  perform me.ok(public.family_credit_balance('00000000-0000-0000-0000-000000000061', 'CHF') = 0, 'family credit used up');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.apply_family_credit(%L)::text$q$, v2));
  perform me.ok(v like 'ERR:%NO_CREDIT%', 'no credit left to apply');

  -- Voiding the original overpayment transfer is refused once the credit is spent.
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.void_payment((select id from public.payments where invoice_id = %L and method_detail = 'to_family_credit'), 'undo')::text$q$, v_inv));
  perform me.ok(v like 'ERR:%CREDIT_ALREADY_USED%', 'cannot reverse a credit transfer whose credit was spent');

  -- Manual credit correction never goes below zero.
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$select public.adjust_family_credit('00000000-0000-0000-0000-000000000061', 'CHF', -1, 'payout')::text$q$);
  perform me.ok(v like 'ERR:%CREDIT_NEGATIVE%', 'family credit cannot go negative');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$select public.adjust_family_credit('00000000-0000-0000-0000-000000000061', 'chf', 25, 'Goodwill')->>'balance'$q$);
  perform me.ok(v = 'OK:25.00', 'goodwill credit added (' || v || ')');
  begin
    update public.family_credit_entries set amount = 1;
    perform me.ok(false, 'credit ledger is append-only');
  exception when others then perform me.ok(true, 'credit ledger is append-only (update blocked)');
  end;
end $$;

-- ===========================================================================
-- 5. Void / edit / re-allocate manual payments; Stripe rows locked
-- ===========================================================================
do $$
declare v_inv2 uuid := me.get('inv2'); v_pay uuid; v_new uuid; v text; v_target uuid; j jsonb;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select (public.record_offline_payment(%L, 30, 'twint', null, 'TW-9'))->>'payment_id'$q$, v_inv2));
  v_pay := substr(v, 4)::uuid;
  perform me.ok((select status::text from public.invoices where id = v_inv2) = 'partially_paid', '60 + 30 of 100 -> partially paid');

  -- edit: amount 30 -> 40 settles the invoice
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.edit_manual_payment(%L, '{"amount": 40, "method": "bank_transfer"}', 'Typo in amount')->>'payment_id'$q$, v_pay));
  v_new := substr(v, 4)::uuid;
  perform me.ok((select voided_at is not null and replaced_by_payment_id = v_new from public.payments where id = v_pay),
               'edited payment is voided and linked to its replacement');
  perform me.ok((select amount_chf = -30 from public.payments where reverses_payment_id = v_pay), 'a reversing row (−30) keeps the ledger append-only');
  perform me.ok((select amount_chf = 40 and method::text = 'bank_transfer' from public.payments where id = v_new), 'replacement row carries the new values');
  perform me.ok((select status::text from public.invoices where id = v_inv2) = 'paid', 'invoice recomputed: paid');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'PAYMENT_EDITED' and target_id = v_pay
                         and (old_data->>'amount_chf')::numeric = 30 and (new_data->>'amount_chf')::numeric = 40),
               'PAYMENT_EDITED audit row 30 -> 40');

  -- re-allocate the 40 to another invoice of family …063
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  j := public.create_manual_invoice(jsonb_build_object('family_id', '00000000-0000-0000-0000-000000000063',
         'items', jsonb_build_array(jsonb_build_object('description', 'Camp', 'quantity', 1, 'unit_price_chf', 40))));
  perform me.as_super();
  v_target := (j->>'invoice_id')::uuid;
  update public.invoices set status = 'sent' where id = v_target;
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.edit_manual_payment(%L, jsonb_build_object('invoice_id', %L), 'Wrong reference used')->>'invoice_id'$q$, v_new, v_target));
  perform me.ok(v = 'OK:' || v_target, 'payment re-allocated to another invoice');
  perform me.ok((select status::text from public.invoices where id = v_target) = 'paid', 'target invoice paid');
  perform me.ok((select status::text from public.invoices where id = v_inv2) = 'partially_paid', 'source invoice back to partially paid');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'PAYMENT_REALLOCATED' and target_id = v_new), 'PAYMENT_REALLOCATED audited');

  -- void with reason
  select id into v_pay from public.payments where invoice_id = v_target and voided_at is null and amount_chf > 0;
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.void_payment(%L, 'Bounced')->>'status'$q$, v_pay));
  perform me.ok(v = 'OK:sent', 'voiding the only payment puts the invoice back to sent (' || v || ')');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.void_payment(%L, 'again')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%ALREADY_VOIDED%', 'cannot void twice');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.void_payment((select id from public.payments where reverses_payment_id = %L), 'x')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%STRIPE_PAYMENT_LOCKED%' or v like 'ERR:%', 'a reversal row cannot itself be voided');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'PAYMENT_VOIDED' and target_id = v_pay
                         and old_data->>'status' = 'paid' and new_data->>'status' = 'sent' and new_data->>'reason' = 'Bounced'),
               'PAYMENT_VOIDED audit row with before/after status and reason');

  -- direct tampering is still blocked
  begin
    update public.payments set voided_at = null where id = v_pay;
    perform me.ok(false, 'cannot un-void a payment directly');
  exception when others then perform me.ok(true, 'un-voiding / editing payments directly is blocked (append-only trigger)');
  end;

  -- Stripe payment: annotate only
  perform public.apply_stripe_payment(v_target, 40, 'pi_money_edit_1', 'ch_me_1');
  select id into v_pay from public.payments where stripe_payment_intent_id = 'pi_money_edit_1';
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.void_payment(%L, 'x')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%STRIPE_PAYMENT_LOCKED%', 'Stripe payments cannot be voided here');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.edit_manual_payment(%L, '{"amount": 1}', 'x')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%STRIPE_PAYMENT_LOCKED%', 'Stripe payments cannot be edited');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.annotate_payment(%L, 'Parent paid by card at desk')::text$q$, v_pay));
  perform me.ok(v like 'OK:%' and (select admin_note = 'Parent paid by card at desk' and amount_chf = 40 from public.payments where id = v_pay),
               'Stripe payments can be annotated (amount untouched)');
end $$;

-- ===========================================================================
-- 6. Write-off and its reversal
-- ===========================================================================
do $$
declare v_inv2 uuid := me.get('inv2'); v text;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'write_off', null, 'Family moved away')->>'amount'$q$, v_inv2));
  perform me.ok(v = 'OK:40.00', 'write-off covers the open balance (' || v || ')');
  perform me.ok((select status::text = 'written_off' and written_off_at is not null from public.invoices where id = v_inv2), 'status written_off');
  perform me.ok(public.invoice_net_paid(v_inv2) = public.invoice_amount_due(v_inv2), 'nothing left to collect');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.issue_invoice_adjustment(%L, 'credit_note', 5, 'x')::text$q$, v_inv2));
  perform me.ok(v like 'ERR:%INVOICE_WRITTEN_OFF%', 'no further adjustments while written off');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    format($q$select public.void_invoice_adjustment((select id from public.invoice_adjustments where invoice_id = %L and kind = 'write_off'), 'Money arrived')->>'status'$q$, v_inv2));
  perform me.ok(v = 'OK:partially_paid', 'voiding the write-off reopens the balance (' || v || ')');
end $$;

-- ===========================================================================
-- 7. Cancel and reopen
-- ===========================================================================
do $$
declare v_inv uuid; j jsonb; v text;
begin
  perform me.as_user('00000000-0000-0000-0000-0000000000f2');
  j := public.create_manual_invoice(jsonb_build_object('family_id', '00000000-0000-0000-0000-000000000062',
         'items', jsonb_build_array(jsonb_build_object('description', 'Kit', 'quantity', 2, 'unit_price_chf', 35))));
  perform me.as_super();
  v_inv := (j->>'invoice_id')::uuid;
  update public.invoices set status = 'sent' where id = v_inv;

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.cancel_invoice(%L, 'Duplicate')->>'status'$q$, v_inv));
  perform me.ok(v = 'OK:cancelled', 'unpaid issued invoice cancelled');
  perform me.ok((select count(*) = 1 and sum(amount) = 70 from public.invoice_adjustments where invoice_id = v_inv and kind = 'cancellation'),
               'cancellation document for the full 70');
  perform me.ok(public.invoice_amount_due(v_inv) = 0, 'cancelled invoice owes nothing');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.record_offline_payment(%L, 5, 'manual')::text$q$, v_inv));
  perform me.ok(v like 'ERR:%INVOICE_CANCELLED%', 'no payments on a cancelled invoice');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.reopen_invoice(%L, 'Not a duplicate')->>'status'$q$, v_inv));
  perform me.ok(v = 'OK:sent', 'reopened issued invoice is sent again (' || v || ')');
  perform me.ok(public.invoice_amount_due(v_inv) = 70, 'amount due restored to 70');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.cancel_invoice(%L, 'x')::text$q$, '00000000-0000-0000-0000-000000000093'));
  perform me.ok(v like 'ERR:%CANNOT_CANCEL%', 'a paid invoice cannot be cancelled');
  update public.invoices set status = 'cancelled' where id = '00000000-0000-0000-0000-000000000093';
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.reopen_invoice(%L, 'x')::text$q$, '00000000-0000-0000-0000-000000000093'));
  perform me.ok(v like 'ERR:%WAS_PAID%', 'an invoice that received money cannot be reopened');

  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.cancel_invoice(%L, 'Drop draft')->>'status'$q$, me.get('draft')));
  perform me.ok(v = 'OK:cancelled' and not exists (select 1 from public.invoice_adjustments where invoice_id = me.get('draft')),
               'a draft is cancelled without a cancellation document');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', format($q$select public.reopen_invoice(%L, 'Needed after all')->>'status'$q$, me.get('draft')));
  perform me.ok(v = 'OK:draft', 'a reopened draft is a draft again');
end $$;

-- ===========================================================================
-- 8. Training credits ledger
-- ===========================================================================
do $$
declare v text;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$select public.adjust_training_credits('00000000-0000-0000-0000-000000000072', 'personal', 3, null, 'Bought 3-pack')->>'total'$q$);
  perform me.ok(v = 'OK:5', 'finance grants 3 credits (2 -> 5)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f1',
    $q$select public.adjust_training_credits('00000000-0000-0000-0000-000000000072', 'personal', null, 0, 'Mistake')::text$q$);
  perform me.ok(v like 'ERR:%BELOW_USED%', 'cannot set the total below the credits already used');
  v := me.run_as('00000000-0000-0000-0000-0000000000f1',
    $q$select public.adjust_training_credits('00000000-0000-0000-0000-000000000072', 'personal', null, 1, 'Revoke unused')->>'balance'$q$);
  perform me.ok(v = 'OK:0', 'admin revokes unused credits (total 1, used 1, balance 0)');
  perform me.ok((select count(*) = 2 and bool_and(reason is not null) from public.training_credit_adjustments
                  where athlete_id = '00000000-0000-0000-0000-000000000072'), 'ledger keeps both changes with reasons');
  perform me.ok(exists (select 1 from public.audit_logs where action = 'CREDITS_ADJUSTED'
                         and (old_data->>'total')::int = 5 and (new_data->>'total')::int = 1), 'CREDITS_ADJUSTED audit row 5 -> 1');
  v := me.run_as('00000000-0000-0000-0000-0000000000f3',
    $q$select public.adjust_training_credits('00000000-0000-0000-0000-000000000072', 'personal', 1, null, 'x')::text$q$);
  perform me.ok(v like 'ERR:%NOT_AUTHORIZED%', 'coach cannot adjust credits');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$select public.adjust_training_credits('00000000-0000-0000-0000-000000000072', 'personal', 1, null, '')::text$q$);
  perform me.ok(v like 'ERR:%REASON_REQUIRED%', 'credit change needs a reason');
end $$;

-- ===========================================================================
-- 9. RLS on the new tables
-- ===========================================================================
do $$
declare v text;
begin
  v := me.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select count(*)::text from public.invoice_adjustments where invoice_id = '00000000-0000-0000-0000-000000000091'$q$);
  perform me.ok(v = 'OK:2', 'guardian sees the credit/debit notes of their own invoice (' || v || ')');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select count(*)::text from public.invoice_adjustments i join public.invoices x on x.id = i.invoice_id where x.family_id <> '00000000-0000-0000-0000-000000000061'$q$);
  perform me.ok(v = 'OK:0', 'guardian sees no other family''s adjustments');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4',
    $q$select count(*)::text from public.family_credit_entries where family_id <> '00000000-0000-0000-0000-000000000061'$q$);
  perform me.ok(v = 'OK:0', 'guardian sees only their family''s credit entries');
  v := me.run_as('00000000-0000-0000-0000-0000000000f4', $q$select count(*)::text from public.training_credit_adjustments$q$);
  perform me.ok(v = 'OK:0', 'guardian cannot read the credit ledger (internal reasons)');
  v := me.run_as('00000000-0000-0000-0000-0000000000f3', $q$select count(*)::text from public.invoice_adjustments$q$);
  perform me.ok(v = 'OK:0', 'coach sees no adjustments');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2', $q$select (count(*) > 0)::text from public.family_credit_entries$q$);
  perform me.ok(v = 'OK:true', 'finance reads the family credit ledger');
  v := me.run_as(null, $q$select count(*)::text from public.invoice_adjustments$q$);
  perform me.ok(v like 'ERR:%' or v = 'OK:0', 'anon reads nothing');
  v := me.run_as(null, $q$select public.void_payment('00000000-0000-0000-0000-000000000000', 'x')::text$q$);
  perform me.ok(v like 'ERR:%', 'anon cannot call money RPCs');
  v := me.run_as('00000000-0000-0000-0000-0000000000f2',
    $q$insert into public.family_credit_entries (org_id, family_id, amount, currency, kind, reason) values ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 1000, 'CHF', 'manual', 'free money') returning 1$q$);
  perform me.ok(v like 'ERR:%', 'finance cannot insert credit directly (RPC only)');
end $$;

-- ===========================================================================
-- 10. Cross-tenant denial (org B admin+finance vs org A ids)
-- ===========================================================================
do $$
declare
  b constant uuid := 'b0000000-0000-0000-0000-0000000000b1';
  v text;
  v_pay uuid;
  v_before jsonb;
begin
  select id into v_pay from public.payments where invoice_id = '00000000-0000-0000-0000-000000000091' and qr_reference = 'REF-1';
  v_before := public.invoice_money_snapshot('00000000-0000-0000-0000-000000000091');

  v := me.run_as(b, $q$select count(*)::text from public.invoice_adjustments$q$);
  perform me.ok(v = 'OK:0', 'org B finance reads none of org A''s adjustments');
  v := me.run_as(b, $q$select count(*)::text from public.family_credit_entries$q$);
  perform me.ok(v = 'OK:0', 'org B finance reads none of org A''s family credit');
  v := me.run_as(b, $q$select count(*)::text from public.training_credit_adjustments$q$);
  perform me.ok(v = 'OK:0', 'org B finance reads none of org A''s credit ledger');

  v := me.run_as(b, $q$select public.issue_invoice_adjustment('00000000-0000-0000-0000-000000000091', 'credit_note', 1, 'x')::text$q$);
  perform me.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B cannot credit an org A invoice');
  v := me.run_as(b, $q$select public.update_invoice_details('00000000-0000-0000-0000-000000000091', '{"notes":"pwned"}')::text$q$);
  perform me.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B cannot edit an org A invoice');
  v := me.run_as(b, $q$select public.cancel_invoice('00000000-0000-0000-0000-000000000091', 'x')::text$q$);
  perform me.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B cannot cancel an org A invoice');
  v := me.run_as(b, $q$select public.record_offline_payment('00000000-0000-0000-0000-000000000091', 1, 'manual')::text$q$);
  perform me.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B cannot record a payment on an org A invoice');
  v := me.run_as(b, format($q$select public.void_payment(%L, 'x')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%PAYMENT_NOT_FOUND%', 'org B cannot void an org A payment');
  v := me.run_as(b, format($q$select public.edit_manual_payment(%L, '{"amount": 1}', 'x')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%PAYMENT_NOT_FOUND%', 'org B cannot edit an org A payment');
  v := me.run_as(b, format($q$select public.annotate_payment(%L, 'x')::text$q$, v_pay));
  perform me.ok(v like 'ERR:%PAYMENT_NOT_FOUND%', 'org B cannot annotate an org A payment');
  v := me.run_as(b, $q$select public.adjust_family_credit('00000000-0000-0000-0000-000000000061', 'CHF', 100, 'x')::text$q$);
  perform me.ok(v like 'ERR:%FAMILY_NOT_FOUND%', 'org B cannot grant credit to an org A family');
  v := me.run_as(b, $q$select public.apply_family_credit('00000000-0000-0000-0000-000000000091')::text$q$);
  perform me.ok(v like 'ERR:%INVOICE_NOT_FOUND%', 'org B cannot apply credit to an org A invoice');
  v := me.run_as(b, $q$select public.adjust_training_credits('00000000-0000-0000-0000-000000000072', 'personal', 5, null, 'x')::text$q$);
  perform me.ok(v like 'ERR:%ATHLETE_NOT_FOUND%', 'org B cannot change org A training credits');

  perform me.ok(public.invoice_money_snapshot('00000000-0000-0000-0000-000000000091') = v_before, 'org A invoice money unchanged after org B attempts');
  perform me.ok((select voided_at is null from public.payments where id = v_pay), 'org A payment still active');
end $$;

-- Internal helpers are not callable by signed-in users.
do $$
declare f text;
begin
  foreach f in array array[
    'public.money_invoice_for_update(uuid)', 'public.refresh_invoice_adjustments(uuid)',
    'public.money_audit(uuid, text, text, uuid, jsonb, jsonb)', 'public.recompute_invoice(uuid)',
    'public.money_void_payment(public.payments, text)'
  ] loop
    perform me.ok(not has_function_privilege('authenticated', f::regprocedure, 'execute')
              and not has_function_privilege('anon', f::regprocedure, 'execute'), 'internal only: ' || f);
  end loop;
end $$;
