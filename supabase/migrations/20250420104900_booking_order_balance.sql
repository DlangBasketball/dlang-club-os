-- Booking orders: the order balance summed every payer's invoice balance, so one payer's
-- credit (e.g. after a credit note) reduced another payer's open amount. Balance is now
-- the sum of open amounts only; credits owed to payers are reported separately. Replaces
-- one read function; idempotent.

create or replace function public.booking_order_detail(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare o public.booking_orders; v_tz text; tp public.training_package_purchases; v_inv jsonb; v_cur text;
begin
  if not public.bk_is_staff() then raise exception 'NOT_AUTHORIZED' using errcode = 'P0001'; end if;
  select * into o from public.booking_orders where id = p_order and org_id = public.current_org_id();
  if not found then raise exception 'ORDER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_tz := public.ta_tz(o.org_id);
  v_cur := o.currency;
  select * into tp from public.training_package_purchases where id = o.purchase_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'invoice_id', i.id, 'number', i.number, 'status', i.status, 'payer_name', i.payer_name, 'payer_kind', i.payer_kind,
           'currency', i.currency, 'total', i.total_chf, 'adjustments', i.adjustments_total,
           'due', i.total_chf + i.adjustments_total, 'paid', public.invoice_net_paid(i.id),
           'balance', case when i.status::text in ('cancelled', 'void', 'draft') then 0
                           else i.total_chf + i.adjustments_total - public.invoice_net_paid(i.id) end,
           'issued_at', i.issued_at, 'due_date', i.due_date, 'activity', i.activity,
           'other_orders', exists (select 1 from public.training_bookings x where x.invoice_id = i.id and x.order_id is distinct from o.id))
           order by i.created_at), '[]'::jsonb)
    into v_inv
    from public.invoices i
   where i.id in (select b.invoice_id from public.training_bookings b where b.order_id = o.id and b.invoice_id is not null
                  union select tp.invoice_id where o.option_kind = 'package' and tp.invoice_id is not null);

  return jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id, 'kind', o.kind, 'option_kind', o.option_kind, 'status', o.status, 'currency', o.currency,
      'service', (select jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind, 'billing_category', s.billing_category,
                                            'short_description', s.short_description, 'duration_min', s.duration_min)
                    from public.training_services s where s.id = o.service_id),
      'coach', (select jsonb_build_object('id', c.id, 'display_name', c.display_name) from public.coaches c where c.id = o.coach_id),
      'venue_space_id', o.venue_space_id,
      'package_id', o.package_id, 'package_name', (select name from public.credit_packages where id = o.package_id),
      'option_sessions', o.option_sessions, 'list_total', o.list_total, 'agreed_total', o.agreed_total,
      'list_rate', o.list_rate, 'group_rate', o.group_rate, 'pricing_basis', o.pricing_basis,
      'price_override_reason', o.price_override_reason, 'billing_category', o.billing_category,
      'description', o.description, 'internal_notes', o.internal_notes, 'received_on', o.received_on,
      'created_at', o.created_at, 'created_by_name', (select full_name from public.profiles where id = o.created_by),
      'purchase_id', o.purchase_id, 'timezone', v_tz,
      'setup_missing', to_jsonb(public.bko_setup_missing(o.org_id, o.billing_category))),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'participant_id', bp.id, 'status', bp.status, 'rate', bp.rate, 'payer_id', bp.payer_id,
               'athlete', jsonb_build_object('id', a.id, 'first_name', a.first_name, 'last_name', a.last_name, 'family_id', a.family_id),
               'payer', public.bk_payer_snapshot(o.org_id, bp.payer_id, a.family_id),
               'sessions_booked', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status = 'booked'),
               'sessions_requested', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status::text = 'requested'),
               'sessions_completed', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status in ('completed', 'no_show')),
               'sessions_cancelled', (select count(*) from public.training_bookings b where b.order_participant_id = bp.id and b.status = 'cancelled'),
               'charge', case when o.option_kind = 'package' then coalesce(tp.amount, 0)
                              when o.option_kind = 'existing_package' then 0
                              else coalesce((select sum(b.price_chf) from public.training_bookings b
                                              where b.order_participant_id = bp.id and b.billing_mode = 'invoice'
                                                and b.status in ('booked', 'completed', 'no_show')), 0) end,
               'invoiced', case when o.option_kind = 'package' then case when tp.invoice_id is not null then coalesce(tp.amount, 0) else 0 end
                                else coalesce((select sum(b.price_chf) from public.training_bookings b
                                                where b.order_participant_id = bp.id and b.invoice_id is not null
                                                  and b.status in ('booked', 'completed', 'no_show')), 0) end)
             order by a.last_name, a.first_name)
        from public.booking_order_participants bp join public.athletes a on a.id = bp.athlete_id
       where bp.order_id = o.id), '[]'::jsonb),
    'dates', coalesce((
      select jsonb_agg(d order by d->>'starts_at') from (
        select jsonb_build_object(
                 'session_id', b.session_id, 'starts_at', min(b.slot_start), 'ends_at', max(b.slot_end),
                 'coach_name', (select c.display_name from public.coaches c where c.id = min(b.coach_id::text)::uuid),
                 'session_status', (select s.status from public.training_sessions s where s.id = b.session_id),
                 'event_id', (select s.event_id from public.training_sessions s where s.id = b.session_id),
                 'capacity', (select s.capacity from public.training_sessions s where s.id = b.session_id),
                 'participants_count', case when b.session_id is not null then public.bk_session_count(b.session_id) end,
                 'location', min(coalesce((select v.name from public.venues v where v.id = b.venue_id), b.location_text)),
                 'bookings', jsonb_agg(jsonb_build_object(
                     'booking_id', b.id, 'participant_id', b.order_participant_id, 'athlete_id', b.athlete_id,
                     'first_name', a.first_name, 'last_name', a.last_name, 'status', b.status, 'starts_at', b.slot_start,
                     'billing_status', public.booking_billing_status(b.id), 'billing_mode', b.billing_mode, 'price', b.price_chf,
                     'invoice_id', b.invoice_id, 'invoice_number', (select number from public.invoices where id = b.invoice_id),
                     'cancel_reason', b.cancel_reason)
                   order by a.last_name, a.first_name)) d
          from public.training_bookings b join public.athletes a on a.id = b.athlete_id
         where b.order_id = o.id
         group by b.session_id, case when b.session_id is null then b.id end) q), '[]'::jsonb),
    'package', case when tp.id is not null then jsonb_build_object(
      'purchase_id', tp.id, 'sessions', tp.sessions, 'sessions_used', tp.sessions_used, 'status', tp.status,
      'expires_at', tp.expires_at, 'amount', tp.amount, 'invoice_id', tp.invoice_id, 'owned', o.option_kind = 'package',
      'invoice_number', (select number from public.invoices where id = tp.invoice_id),
      'booked', (select count(*) from public.training_bookings b where b.purchase_id = tp.id and b.status::text in ('booked', 'requested')),
      'completed', (select count(*) from public.training_bookings b where b.purchase_id = tp.id and b.status in ('completed', 'no_show')),
      'available', greatest(0, tp.sessions - tp.sessions_used)) end,
    'invoices', v_inv,
    'totals', jsonb_build_object(
      'currency', v_cur,
      'charged', case when o.option_kind = 'package' then coalesce(tp.amount, 0)
                      when o.option_kind = 'existing_package' then 0
                      else coalesce((select sum(b.price_chf) from public.training_bookings b
                                      where b.order_id = o.id and b.billing_mode = 'invoice' and b.status in ('booked', 'completed', 'no_show')), 0) end,
      'uninvoiced', case when o.option_kind = 'package' then case when tp.invoice_id is null then coalesce(tp.amount, 0) else 0 end
                         else coalesce((select sum(b.price_chf) from public.training_bookings b
                                         where b.order_id = o.id and b.billing_mode = 'invoice' and b.invoice_id is null
                                           and b.status in ('booked', 'completed', 'no_show')), 0) end,
      'invoiced', coalesce((select sum((j->>'due')::numeric) from jsonb_array_elements(v_inv) j where j->>'status' not in ('cancelled', 'void')), 0),
      'paid', coalesce((select sum((j->>'paid')::numeric) from jsonb_array_elements(v_inv) j), 0),
      -- Open amounts and credits are per payer: never net one payer's credit against another payer's debt.
      'balance', coalesce((select sum(greatest((j->>'balance')::numeric, 0)) from jsonb_array_elements(v_inv) j
                            where j->>'status' not in ('cancelled', 'void', 'draft')), 0),
      'credit', coalesce((select sum(greatest(-(j->>'balance')::numeric, 0)) from jsonb_array_elements(v_inv) j
                           where j->>'status' not in ('cancelled', 'void')), 0)),
    'can_add_dates', o.status = 'active' and o.option_kind in ('package', 'existing_package', 'group')
                     and (o.option_kind = 'group' or (tp.id is not null and tp.sessions > tp.sessions_used)));
end $$;
