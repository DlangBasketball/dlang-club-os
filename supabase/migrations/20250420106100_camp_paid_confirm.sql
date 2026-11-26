-- Camp places: a fully paid camp invoice confirms its reserved places.
--
-- A camp week is reserved ('pending') until its invoice is paid. Until now
-- only two paths confirmed a camp place on payment: age-approved places
-- (20250420105100, invoices_camp_approval_confirm) and places booked by
-- another adult after guardian consent (20250420105900). An ordinary place
-- (child 8+, booked by the family) stayed 'pending' after payment, which the
-- confirmed-only attendance rosters (20250420105800) would show as "not yet
-- confirmed". This trigger confirms those places when their invoice becomes
-- 'paid'. It never touches a place that is awaiting age approval
-- (approval_status set: handled by its own trigger) or guardian consent
-- (guardian_consent_status set: handled by the consent trigger).
--
-- Backfill: ordinary camp places whose invoice is already paid are
-- confirmed once (idempotent). Additive; existing triggers unchanged.

create or replace function public.invoices_camp_paid_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  for r in select id, org_id from public.registrations
            where invoice_id = new.id and org_id = new.org_id
              and camp_edition_id is not null and status = 'pending'
              and approval_status is null and guardian_consent_status is null
  loop
    perform set_config('app.camp_approval', 'on', true);
    update public.registrations set status = 'confirmed' where id = r.id;
    perform set_config('app.camp_approval', 'off', true);
    perform public.ca_audit(r.org_id, 'camp.confirmed_on_payment', 'registrations', r.id,
                            jsonb_build_object('invoice_id', new.id));
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_invoices_camp_paid_confirm on public.invoices;
create trigger trg_invoices_camp_paid_confirm
  after update of status on public.invoices
  for each row
  when (new.status::text = 'paid' and old.status is distinct from new.status)
  execute function public.invoices_camp_paid_confirm();
revoke all on function public.invoices_camp_paid_confirm() from public, anon, authenticated;

-- Backfill (idempotent): ordinary camp places already paid in full.
do $$
declare r record;
begin
  for r in select g.id, g.org_id, g.invoice_id from public.registrations g
             join public.invoices i on i.id = g.invoice_id and i.org_id = g.org_id
            where g.camp_edition_id is not null and g.status = 'pending'
              and g.approval_status is null and g.guardian_consent_status is null
              and i.status::text = 'paid'
  loop
    perform set_config('app.camp_approval', 'on', true);
    update public.registrations set status = 'confirmed' where id = r.id;
    perform set_config('app.camp_approval', 'off', true);
    perform public.ca_audit(r.org_id, 'camp.confirmed_on_payment', 'registrations', r.id,
                            jsonb_build_object('invoice_id', r.invoice_id, 'backfill', true));
  end loop;
end $$;
