-- Service instalments follow-up: a package booked through a staff order is
-- billed on the package purchase invoice, not on the booking. The booking
-- pages (admin + parent) read the plan through booking_instalment_choice(),
-- so it now also returns that package invoice (id + number).
-- Same access rule as before: finance/admin of the org or a guardian of the
-- athlete. Additive and idempotent (create or replace, same signature).

create or replace function public.booking_instalment_choice(p_booking uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('booking_id', b.id, 'order_id', b.order_id,
                            'instalments', coalesce(o.instalment_count, b.instalment_count),
                            'instalment_dates', to_jsonb(o.instalment_dates),
                            'invoice_id', coalesce(b.invoice_id, pk.invoice_id),
                            'invoice_number', (select i.number from public.invoices i
                                                where i.id = coalesce(b.invoice_id, pk.invoice_id) and i.org_id = b.org_id))
    from public.training_bookings b
    left join public.booking_orders o on o.id = b.order_id and o.org_id = b.org_id
    left join lateral (
      select tp.invoice_id
        from public.training_package_purchases tp
       where tp.id = o.purchase_id and tp.org_id = b.org_id and o.option_kind = 'package'
    ) pk on true
   where b.id = p_booking and b.org_id = public.current_org_id()
     and (public.is_finance() or public.is_guardian_of_athlete(b.athlete_id));
$$;

revoke all on function public.booking_instalment_choice(uuid) from public, anon;
grant execute on function public.booking_instalment_choice(uuid) to authenticated, service_role;
