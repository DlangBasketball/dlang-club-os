-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 08 · Swiss payments (TWINT / bank transfer / QR-bill groundwork)
--
-- Adds a stable structured payment reference per invoice (Swiss QRR, the
-- 27-digit mod-10 recursive reference), club creditor/payment settings, and a
-- reference -> invoice lookup for reconciliation. Stripe stays the automated
-- path; TWINT and bank transfer are manual at MVP. The compliant QR-bill
-- payment-part layout is rendered in the app PDF and finalised later.
-- ============================================================================

-- 1) Per-invoice structured reference -----------------------------------------
alter table public.invoices add column if not exists payment_reference text;
create index if not exists invoices_payment_reference_idx on public.invoices (org_id, payment_reference);

-- 2) Club creditor + payment settings (merged into existing settings jsonb) ----
update public.app_settings
   set settings = settings || jsonb_build_object('payments', jsonb_build_object(
         'creditor_name',     'DLang Basketball',
         'creditor_street',   'Rue du Stade',
         'creditor_building', '12',
         'creditor_zip',      '1200',
         'creditor_city',     'Genève',
         'creditor_country',  'CH',
         'iban',              'CH9300762011623852957',     -- placeholder; club replaces
         'qr_iban',           'CH4431999123000889012',     -- placeholder QR-IBAN (QRR)
         'twint_number',      '+41 79 000 00 00',          -- placeholder
         'reference_type',    'QRR',
         'reference_prefix',  '21'
       ))
 where org_id = '00000000-0000-0000-0000-000000000001'
   and not (settings ? 'payments');

-- 3) QRR mod-10 recursive check digit (Swiss ESR/QR reference) -----------------
create or replace function public.qrr_check_digit(p_ref text)
returns text
language plpgsql
immutable
as $$
declare
  tbl   int[] := array[0,9,4,6,8,2,7,1,3,5];
  carry int := 0;
  ch    text;
begin
  for ch in select regexp_split_to_table(regexp_replace(coalesce(p_ref,''), '\D', '', 'g'), '') loop
    if ch <> '' then
      carry := tbl[((carry + ch::int) % 10) + 1];  -- pg arrays are 1-indexed
    end if;
  end loop;
  return ((10 - carry) % 10)::text;
end;
$$;

-- 4) Build a 27-digit QRR reference from the org prefix + a numeric seed --------
create or replace function public.gen_qr_reference(p_org uuid, p_seed text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_digits text;
  v_base   text;
begin
  v_digits := regexp_replace(coalesce(p_seed, ''), '\D', '', 'g');
  select coalesce(settings->'payments'->>'reference_prefix', '21') into v_prefix
    from public.app_settings where org_id = p_org;
  v_prefix := regexp_replace(coalesce(v_prefix, '21'), '\D', '', 'g');

  v_base := v_prefix || v_digits;
  if length(v_base) > 26 then
    v_base := right(v_base, 26);
  else
    v_base := lpad(v_base, 26, '0');
  end if;
  return v_base || public.qrr_check_digit(v_base);
end;
$$;

-- 5) Auto-populate payment_reference on every invoice insert -------------------
create or replace function public.set_invoice_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_reference is null then
    new.payment_reference := public.gen_qr_reference(new.org_id, new.number);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoice_reference on public.invoices;
create trigger trg_invoice_reference
  before insert on public.invoices
  for each row execute function public.set_invoice_payment_reference();

-- Backfill existing invoices
update public.invoices
   set payment_reference = public.gen_qr_reference(org_id, number)
 where payment_reference is null;

-- 6) Reconciliation lookup: reference -> invoice -------------------------------
create or replace function public.find_invoice_by_reference(p_org uuid, p_reference text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.invoices
   where org_id = p_org
     and replace(payment_reference, ' ', '') = regexp_replace(coalesce(p_reference, ''), '\D', '', 'g')
   limit 1;
$$;

-- 7) Grants --------------------------------------------------------------------
grant execute on function public.qrr_check_digit(text)                 to authenticated, service_role;
grant execute on function public.gen_qr_reference(uuid, text)          to authenticated, service_role;
grant execute on function public.find_invoice_by_reference(uuid, text) to authenticated, service_role;
