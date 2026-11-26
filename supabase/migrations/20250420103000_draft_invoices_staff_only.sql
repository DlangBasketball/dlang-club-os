-- ============================================================================
-- Draft invoices are staff-only.
--
-- A manual invoice is created as 'draft' (create_manual_invoice) so finance
-- can review and edit its lines before sending it. invoices_select let the
-- family's guardians read every invoice of the family, drafts included, so a
-- draft appeared in the parent app as an open bill (with its lines,
-- adjustments and QR / card payment) before it was sent, and could still
-- change afterwards. record_payment already refuses drafts
-- (INVOICE_NOT_PAYABLE); the parent app now never sees them.
--
-- Guardians see an invoice once it is issued (sent, partially paid, paid,
-- overdue, cancelled, ...). Admin / finance keep seeing everything. Child
-- tables (invoice_items, invoice_adjustments, payments) check visibility via
-- a sub-select on public.invoices, which is subject to this policy, so their
-- draft rows are hidden from guardians too.
--
-- Additive and idempotent: replaces one policy, no data changes.
-- ============================================================================

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (
    public.is_finance()
    or (status <> 'draft'::public.invoice_status and public.is_guardian_of_family(family_id))
  );
