-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 06 · Public program / camp registration
--
-- A public (unauthenticated) parent submits a registration. The whole write is
-- performed by ONE SECURITY DEFINER function so it is atomic — either every
-- record (family, athletes, medical, registrations, invoice + items, consents,
-- parent invitation) is created, or nothing is. The server action calls this
-- with the service-role client after validating input.
-- ============================================================================

-- Parent contact on the household (no auth account exists yet at registration).
alter table public.families add column if not exists contact_name  text;
alter table public.families add column if not exists contact_email citext;
create index if not exists families_contact_email_idx on public.families (org_id, contact_email);

-- Privacy-policy consent form (the seed shipped media/transport/health/terms/liability).
-- Founding-club data: skipped on an empty database (new white-label project).
insert into public.consent_forms (id, org_id, key, title, version, locale, is_required)
select '00000000-0000-0000-0000-000000000036','00000000-0000-0000-0000-000000000001','privacy','Privacy policy', 1, 'en', true
 where exists (select 1 from public.organizations where id = '00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- register_public(payload jsonb) -> jsonb
--   payload = {
--     program_id, family_name?,
--     parent:   { name, email, phone, address, emergency_name, emergency_phone },
--     children: [ { first_name, last_name, dob, gender, allergies, conditions, medical_notes } ],
--     consents: [ "liability", "terms", "privacy", "media", ... ],
--     ip?
--   }
-- ----------------------------------------------------------------------------
create or replace function public.register_public(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_program  public.programs%rowtype;
  v_org      uuid;
  v_pct      numeric;
  v_price    numeric;
  v_email    citext;
  v_family   uuid;
  v_invoice  uuid;
  v_invnum   text;
  v_total    numeric := 0;
  v_child    jsonb;
  v_athlete  uuid;
  v_reg      uuid;
  v_idx      int := 0;
  v_disc     numeric;
  v_consent  text;
  v_form     record;
  v_ip       inet;
  v_reg_ids  uuid[] := '{}';
  v_ath_ids  uuid[] := '{}';
  v_children jsonb := coalesce(p_payload->'children', '[]'::jsonb);
  v_due      date := (now() + interval '14 days')::date;
begin
  -- Resolve + guard the program
  select * into v_program from public.programs where id = (p_payload->>'program_id')::uuid;
  if not found then raise exception 'PROGRAM_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (v_program.is_public and v_program.is_active) then
    raise exception 'PROGRAM_NOT_OPEN' using errcode = 'P0001';
  end if;
  v_org   := v_program.org_id;
  v_price := v_program.price_chf;

  if jsonb_array_length(v_children) < 1 then
    raise exception 'NO_CHILDREN' using errcode = 'P0001';
  end if;

  v_email := nullif(p_payload->'parent'->>'email', '');
  if v_email is null then raise exception 'EMAIL_REQUIRED' using errcode = 'P0001'; end if;

  begin v_ip := nullif(p_payload->>'ip', '')::inet; exception when others then v_ip := null; end;

  -- Sibling-discount percentage (org setting; default 10%)
  select coalesce((settings->>'sibling_discount_pct')::numeric, 10)
    into v_pct from public.app_settings where org_id = v_org;
  v_pct := coalesce(v_pct, 10);

  -- Find-or-create the family by contact email (lets a returning parent add a child)
  select id into v_family from public.families
    where org_id = v_org and contact_email = v_email limit 1;
  if v_family is null then
    insert into public.families (org_id, name, address, phone, contact_name, contact_email)
    values (
      v_org,
      coalesce(nullif(p_payload->>'family_name', ''), (p_payload->'parent'->>'name') || ' family'),
      nullif(p_payload->'parent'->>'address', ''),
      nullif(p_payload->'parent'->>'phone', ''),
      nullif(p_payload->'parent'->>'name', ''),
      v_email
    ) returning id into v_family;
  else
    update public.families set
      phone        = coalesce(nullif(p_payload->'parent'->>'phone', ''), phone),
      address      = coalesce(nullif(p_payload->'parent'->>'address', ''), address),
      contact_name = coalesce(nullif(p_payload->'parent'->>'name', ''), contact_name)
    where id = v_family;
  end if;

  -- Invoice header (total filled after line items)
  v_invnum := public.next_invoice_number(v_org);
  insert into public.invoices (org_id, number, family_id, program_id, description, status, due_date)
  values (v_org, v_invnum, v_family, v_program.id, 'Registration — ' || v_program.name, 'pending', v_due)
  returning id into v_invoice;

  -- One athlete + medical + registration + fee line per child
  for v_child in select * from jsonb_array_elements(v_children)
  loop
    insert into public.athletes (org_id, family_id, first_name, last_name, dob, gender, status)
    values (v_org, v_family, v_child->>'first_name', v_child->>'last_name',
            (v_child->>'dob')::date, nullif(v_child->>'gender', ''), 'active')
    returning id into v_athlete;

    insert into public.athlete_medical (org_id, athlete_id, allergies, conditions, notes,
                                        emergency_contact_name, emergency_contact_phone)
    values (v_org, v_athlete, nullif(v_child->>'allergies', ''), nullif(v_child->>'conditions', ''),
            nullif(v_child->>'medical_notes', ''),
            nullif(p_payload->'parent'->>'emergency_name', ''),
            nullif(p_payload->'parent'->>'emergency_phone', ''))
    on conflict (athlete_id) do nothing;

    insert into public.registrations (org_id, athlete_id, program_id, status, notes)
    values (v_org, v_athlete, v_program.id, 'pending', nullif(v_child->>'medical_notes', ''))
    returning id into v_reg;

    insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
    values (v_org, v_invoice,
            v_program.name || ' — ' || (v_child->>'first_name') || ' ' || (v_child->>'last_name'),
            1, v_price, v_price);
    v_total := v_total + v_price;

    if v_idx >= 1 and v_pct > 0 then
      v_disc := round(v_price * v_pct / 100.0, 2);
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (v_org, v_invoice, 'Sibling discount (' || v_pct || '%) — ' || (v_child->>'first_name'),
              1, -v_disc, -v_disc);
      v_total := v_total - v_disc;
    end if;

    v_reg_ids := v_reg_ids || v_reg;
    v_ath_ids := v_ath_ids || v_athlete;
    v_idx := v_idx + 1;
  end loop;

  update public.invoices set total_chf = v_total where id = v_invoice;

  -- Consent acceptances: each accepted key × each athlete (immutable audit row)
  if jsonb_typeof(p_payload->'consents') = 'array' then
    for v_consent in select jsonb_array_elements_text(p_payload->'consents')
    loop
      select id, version into v_form
        from public.consent_forms
        where org_id = v_org and key = v_consent and is_active
        order by version desc limit 1;
      if found then
        for v_athlete in select unnest(v_ath_ids)
        loop
          insert into public.consent_acceptances
            (org_id, athlete_id, consent_form_id, accepted_version, status, program_id, ip_address)
          values (v_org, v_athlete, v_form.id, v_form.version, 'accepted', v_program.id, v_ip);
        end loop;
      end if;
    end loop;
  end if;

  -- Pending parent invitation so they can later claim the account & become guardian
  if not exists (
    select 1 from public.invitations
    where org_id = v_org and email = v_email and status = 'pending'
  ) then
    insert into public.invitations (org_id, email, role, family_id, status, expires_at)
    values (v_org, v_email, 'parent', v_family, 'pending', now() + interval '30 days');
  end if;

  return jsonb_build_object(
    'family_id', v_family,
    'invoice_id', v_invoice,
    'invoice_number', v_invnum,
    'total_chf', v_total,
    'child_count', jsonb_array_length(v_children),
    'registration_ids', to_jsonb(v_reg_ids),
    'athlete_ids', to_jsonb(v_ath_ids)
  );
end;
$$;

-- Only the server (service role) and signed-in users may call it; not anon.
revoke all on function public.register_public(jsonb) from public;
grant execute on function public.register_public(jsonb) to service_role, authenticated;
