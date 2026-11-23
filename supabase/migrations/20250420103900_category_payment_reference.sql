-- QR payment references must be unique per invoice. Since each revenue category has
-- its own number series, "DL CLUB-2026-0001" and "DL EYBL-2026-0001" had the same
-- digits and therefore the same QR reference. Numbers that belong to a configured
-- series now carry a category digit in the reference seed (club 1, selection 2,
-- training 3, shop 4, camp 5, other 9). Numbers outside any series (all historical
-- invoices) keep exactly the previous rule, so existing references never change.
-- Idempotent: replaces one function.

create or replace function public.billing_reference_for(p_org uuid, p_number text)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_country text; v_code text;
begin
  select case s.category when 'club_membership' then '1' when 'selection' then '2' when 'training' then '3'
                         when 'shop' then '4' when 'camp' then '5' else '9' end
    into v_code
    from public.invoice_number_series s
   where s.org_id = p_org and p_number like s.prefix || '-%'
   order by length(s.prefix) desc limit 1;
  select upper(coalesce(country, 'CH')) into v_country from public.organizations where id = p_org;
  if coalesce(v_country, 'CH') in ('CH', 'LI') then
    return public.gen_qr_reference(p_org, coalesce(v_code, '') || p_number);
  end if;
  return public.scor_reference(p_number);
end $$;
