-- ============================================================================
-- Club OS - The payer of an invoice may open and pay it (public booking and
-- finance, Nov 2026).
--
-- Gap: a person booking for another family's child ("someone else",
-- 20250420105900) is the invoice payer (payer_kind 'other', payer_profile_id
-- or billing_payers.profile_id) but invoice RLS was family-scoped, so the
-- booker saw the amount on "Bookings for others" and could not open the
-- invoice, its QR-bill or pay online.
--
-- Change: invoices, invoice_items and payments are also readable by the
-- invoice's payer (issued invoices only, same club). Nothing else is granted:
-- no family, athlete, medical, document or other invoice of that family.
-- Writes stay finance / system only. Additive and idempotent.
-- ============================================================================

-- The signed-in user is the payer of this issued invoice of their current club.
create or replace function public.is_invoice_payer(p_invoice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.invoices i
     where i.id = p_invoice
       and i.status <> 'draft'::public.invoice_status
       and i.org_id = public.current_org_id()
       and (i.payer_profile_id = auth.uid()
            or exists (select 1 from public.billing_payers bp where bp.id = i.payer_id and bp.profile_id = auth.uid())));
$$;
-- Used inside RLS policies that also apply to anon (returns false without a user).
revoke all on function public.is_invoice_payer(uuid) from public;
grant execute on function public.is_invoice_payer(uuid) to authenticated, anon;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices for select
  using (
    public.is_finance()
    or (status <> 'draft'::public.invoice_status
        and public.is_guardian_of_family(family_id)
        and (payer_profile_id = auth.uid()
             or (payer_profile_id is null and coalesce(payer_kind, 'family') not in ('sponsor', 'other'))))
    or public.is_invoice_payer(id)
  );

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items for select
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and (public.is_finance() or public.is_guardian_of_family(i.family_id))
  ) or public.is_invoice_payer(invoice_items.invoice_id));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select
  using (
    public.is_finance()
    or exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id and public.is_guardian_of_family(i.family_id)
    )
    or (payments.invoice_id is not null and public.is_invoice_payer(payments.invoice_id))
  );
