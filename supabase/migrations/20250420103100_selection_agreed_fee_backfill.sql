-- Selection enrolments created before the fee-arrangement snapshot existed
-- (imports, earlier enrolments) show "Agreed fee: —". Backfill the snapshot from
-- the enrolment's invoice: the issued amount before adjustments is the fee that
-- was agreed. Data-only, idempotent (only rows still without a snapshot), all orgs.

update public.program_applications a
   set agreed_fee      = i.total_chf,
       agreed_currency = coalesce(a.agreed_currency, upper(i.currency)),
       agreed_at       = coalesce(a.agreed_at, i.created_at)
  from public.invoices i
 where i.id = a.invoice_id
   and i.org_id = a.org_id
   and a.agreed_fee is null
   and i.status not in ('draft', 'cancelled')
   and i.total_chf is not null
   and i.total_chf >= 0
   and upper(i.currency) ~ '^[A-Z]{3}$';
