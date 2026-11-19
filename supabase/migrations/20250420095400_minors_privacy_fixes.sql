-- ============================================================================
-- Minors' privacy fixes (review of special-category data about children).
-- Additive and idempotent.
--
-- 1) Storage: the documents bucket policy let an admin of ANY club read,
--    overwrite or delete every club's objects. Objects are stored under
--    `<org_id>/...`; the policy now also requires the first path segment to
--    be the caller's org. (All app reads/writes go through the service role
--    and short-lived signed URLs; this is defence in depth for direct API use.)
-- 2) register_public no longer copies the child's medical notes into
--    registrations.notes (readable by finance and coaches); existing copies
--    are cleared. Medical notes live only in athlete_medical.
-- 3) COPPA gate: register_public refuses children under 13 for an org that
--    must obtain verifiable parental consent (US region and coppa_applies not
--    switched off), until a VPC flow exists. Error: VPC_REQUIRED.
-- 4) audit_trigger stores no special-category values: health columns of
--    athlete_medical and registrations.notes are replaced by "[redacted]",
--    and new_data._changed_sensitive lists which of them changed. Existing
--    audit rows are redacted the same way.
-- 5) anonymise_family also clears registrations.notes and attendance notes,
--    deletes the family's documents (returning their storage paths so the
--    caller removes the objects), and strips old_data/new_data from the audit
--    rows of the family's records, keeping only the action metadata.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Storage policy scoped to the caller's org folder
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists documents_objects_staff on storage.objects$p$;
    execute $p$create policy documents_objects_staff on storage.objects for all
      using (bucket_id = 'documents' and public.is_admin()
             and public.current_org_id() is not null
             and (storage.foldername(name))[1] = public.current_org_id()::text)
      with check (bucket_id = 'documents' and public.is_admin()
             and public.current_org_id() is not null
             and (storage.foldername(name))[1] = public.current_org_id()::text)$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Does this org have to obtain COPPA verifiable parental consent?
--    Mirrors src/lib/compliance/profile.ts: region = compliance_settings
--    .data_region, else derived from organizations.country; VPC is required
--    in the US unless coppa_applies is explicitly false.
-- ---------------------------------------------------------------------------
create or replace function public.org_requires_vpc(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select coalesce(cs.data_region,
                    case when upper(o.country) = 'US' then 'US' end) = 'US'
           and coalesce(cs.coppa_applies, true)
      from public.organizations o
      left join public.compliance_settings cs on cs.org_id = o.id
     where o.id = p_org
  ), false);
$$;
revoke all on function public.org_requires_vpc(uuid) from public, anon, authenticated;
grant execute on function public.org_requires_vpc(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) + 3) register_public: no medical notes in registrations, COPPA gate
-- ---------------------------------------------------------------------------
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
  v_vpc      boolean;
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

  -- COPPA gate: until the verifiable-parental-consent flow exists, a club
  -- that must obtain VPC does not take under-13s through online registration.
  v_vpc := public.org_requires_vpc(v_org);
  if v_vpc and exists (
    select 1 from jsonb_array_elements(v_children) c
     where nullif(c->>'dob', '')::date > (current_date - interval '13 years')
  ) then
    raise exception 'VPC_REQUIRED' using errcode = 'P0001';
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
  values (v_org, v_invnum, v_family, v_program.id, 'Registration — ' || v_program.name, 'sent', v_due)
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
    values (v_org, v_athlete, v_program.id, 'pending', null) -- medical notes live only in athlete_medical
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

-- Clear medical notes that were copied into registrations.notes.
update public.registrations r
   set notes = null
  from public.athlete_medical m
 where m.athlete_id = r.athlete_id
   and r.notes is not null
   and r.notes = m.notes;

-- ---------------------------------------------------------------------------
-- 4) Audit trail without special-category values
-- ---------------------------------------------------------------------------
create or replace function public.audit_sensitive_columns(p_table text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select case p_table
    when 'athlete_medical' then array['allergies','conditions','medications','insurance',
                                      'emergency_contact_name','emergency_contact_phone','notes']
    when 'registrations'   then array['notes']
    else array[]::text[]
  end;
$$;

create or replace function public.audit_redact(p_table text, p_row jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_col text;
  v_out jsonb := p_row;
begin
  if p_row is null then return null; end if;
  foreach v_col in array public.audit_sensitive_columns(p_table) loop
    if v_out ? v_col and jsonb_typeof(v_out->v_col) <> 'null' then
      v_out := jsonb_set(v_out, array[v_col], '"[redacted]"'::jsonb);
    end if;
  end loop;
  return v_out;
end;
$$;

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_old     jsonb;
  v_new     jsonb;
  v_org     uuid;
  v_id      uuid;
  v_changed text[];
begin
  v_old := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end;
  v_row := coalesce(v_new, v_old);
  v_org := (v_row->>'org_id')::uuid;
  v_id  := (v_row->>'id')::uuid;

  if tg_op = 'UPDATE' then
    select array_agg(c) into v_changed
      from unnest(public.audit_sensitive_columns(tg_table_name)) c
     where (v_old->c) is distinct from (v_new->c);
  end if;

  v_old := public.audit_redact(tg_table_name, v_old);
  v_new := public.audit_redact(tg_table_name, v_new);
  if v_changed is not null then
    v_new := v_new || jsonb_build_object('_changed_sensitive', to_jsonb(v_changed));
  end if;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (v_org, auth.uid(), tg_op, tg_table_name, v_id, v_old, v_new);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Redact what earlier audit rows already hold.
update public.audit_logs
   set old_data = public.audit_redact(target_table, old_data),
       new_data = public.audit_redact(target_table, new_data)
 where target_table in ('athlete_medical', 'registrations')
   and (old_data is distinct from public.audit_redact(target_table, old_data)
        or new_data is distinct from public.audit_redact(target_table, new_data));

-- ---------------------------------------------------------------------------
-- 5) anonymise_family: erase notes, documents and audit payloads too.
--    Keeps the org check from 20250420095200. Returns storage_paths: the
--    caller deletes those objects through the Storage API.
-- ---------------------------------------------------------------------------
create or replace function public.anonymise_family(p_family uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org       uuid;
  v_athletes  integer;
  v_profiles  integer;
  v_ath_ids   uuid[];
  v_med_ids   uuid[];
  v_reg_ids   uuid[];
  v_doc_ids   uuid[];
  v_paths     text[];
  v_audit     integer;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select org_id into v_org from public.families where id = p_family;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND';
  end if;

  select coalesce(array_agg(id), '{}') into v_ath_ids
    from public.athletes where family_id = p_family and org_id = v_org;
  select coalesce(array_agg(id), '{}') into v_med_ids
    from public.athlete_medical where athlete_id = any(v_ath_ids);
  select coalesce(array_agg(id), '{}') into v_reg_ids
    from public.registrations where athlete_id = any(v_ath_ids);

  update public.families
    set name = '[deleted]', address = null, phone = null, contact_name = null, contact_email = null
    where id = p_family;

  update public.athletes
    set first_name = 'Redacted', last_name = 'Athlete', dob = '1900-01-01', nationality = null,
        school = null, notes = null, status = 'inactive'
    where id = any(v_ath_ids);
  get diagnostics v_athletes = row_count;

  update public.athlete_medical
    set allergies = null, conditions = null, medications = null, insurance = null,
        emergency_contact_name = null, emergency_contact_phone = null, notes = null
    where id = any(v_med_ids);

  update public.registrations set notes = null
    where id = any(v_reg_ids) and notes is not null;

  update public.attendance_marks set notes = null
    where athlete_id = any(v_ath_ids) and notes is not null;

  -- Documents (medical forms, insurance cards, ...): delete the rows and
  -- hand the storage paths back so the objects are removed too.
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(storage_path) filter (where storage_path is not null), '{}')
    into v_doc_ids, v_paths
    from public.documents
   where org_id = v_org and (family_id = p_family or athlete_id = any(v_ath_ids));
  delete from public.documents where id = any(v_doc_ids);

  -- Only guardians who belong to the same club are anonymised.
  update public.profiles p
    set full_name = '[deleted]', email = 'deleted-' || p.id || '@deleted.invalid',
        phone = null, is_active = false
    where p.id in (select profile_id from public.family_members where family_id = p_family)
      and p.org_id = v_org;
  get diagnostics v_profiles = row_count;

  -- Last, so it also covers the audit rows written by the statements above:
  -- keep who/what/when, drop the row images.
  update public.audit_logs
     set old_data = null,
         new_data = jsonb_build_object('redacted', 'erasure')
   where org_id = v_org
     and (   (target_table = 'families'        and target_id = p_family)
          or (target_table = 'athletes'        and target_id = any(v_ath_ids))
          or (target_table = 'athlete_medical' and target_id = any(v_med_ids))
          or (target_table = 'registrations'   and target_id = any(v_reg_ids))
          or (target_table = 'documents'       and target_id = any(v_doc_ids)));
  get diagnostics v_audit = row_count;

  return jsonb_build_object(
    'family_id', p_family,
    'athletes_anonymised', v_athletes,
    'profiles_anonymised', v_profiles,
    'documents_deleted', coalesce(array_length(v_doc_ids, 1), 0),
    'audit_rows_redacted', v_audit,
    'storage_paths', to_jsonb(v_paths)
  );
end $$;

revoke all on function public.anonymise_family(uuid) from public, anon;
grant execute on function public.anonymise_family(uuid) to authenticated, service_role;
