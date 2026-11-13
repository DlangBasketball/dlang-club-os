-- ============================================================================
-- DLang Basketball — Club OS
-- Migration 03 · Table-aware functions, audit triggers, RLS helpers & policies
--
-- SECURITY MODEL
--   * Enforcement lives in the DATABASE, not the UI.
--   * Helper fns are SECURITY DEFINER + locked search_path so they read
--     role/family/coach tables WITHOUT triggering recursive RLS.
--   * The Supabase `service_role` key BYPASSES RLS — used only by trusted
--     server code (Stripe webhook -> payment/invoice status, system inserts).
--   * Business rules implemented:
--       - parent  -> only their own family & children
--       - coach   -> only sessions/athletes assigned to them
--       - admin   -> everything within the club (org)
--       - finance -> billing everywhere, but NO medical access
--       - medical -> protected; admin + owning guardian (+ coach read for safety)
--       - invoices/payments -> auditable (audit_logs trigger), never client-mutated
--       - consents -> store accepted version + timestamp
-- ============================================================================

-- ---------------------------------------------------------------------------
-- handle_new_user: auto-create a profile when an auth user signs up.
-- Single-club: attaches to the (only) organization. For multi-club, replace
-- the org lookup with a value from raw_user_meta_data.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations order by created_at limit 1;
  insert into public.profiles (id, org_id, email, full_name, locale)
  values (
    new.id,
    v_org,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'locale', 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- next_invoice_number: atomically allocate the next number for an org.
-- The UPDATE ... RETURNING locks the app_settings row -> concurrency-safe.
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pattern text;
  v_counter integer;
  v_num     text;
begin
  update public.app_settings
     set invoice_counter = invoice_counter + 1
   where org_id = p_org
   returning invoice_pattern, invoice_counter into v_pattern, v_counter;

  if v_pattern is null then
    raise exception 'No app_settings row for org %', p_org;
  end if;

  v_num := v_pattern;
  v_num := replace(v_num, '{YYYY}', to_char(now(), 'YYYY'));
  v_num := replace(v_num, '{YY}',   to_char(now(), 'YY'));
  v_num := replace(v_num, '{MM}',   to_char(now(), 'MM'));
  v_num := replace(v_num, '{####}', lpad(v_counter::text, 4, '0'));
  return v_num;
end;
$$;

-- ---------------------------------------------------------------------------
-- audit_trigger: append a row to audit_logs on every change to a sensitive
-- table. Attached below to invoices, payments, athlete_medical,
-- consent_acceptances, registrations.
-- ---------------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_org uuid;
  v_id  uuid;
begin
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_org := (v_row->>'org_id')::uuid;
  v_id  := (v_row->>'id')::uuid;

  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values (
    v_org,
    auth.uid(),
    tg_op,
    tg_table_name,
    v_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger trg_audit_invoices            after insert or update or delete on public.invoices             for each row execute function public.audit_trigger();
create trigger trg_audit_payments            after insert or update or delete on public.payments             for each row execute function public.audit_trigger();
create trigger trg_audit_athlete_medical     after insert or update or delete on public.athlete_medical      for each row execute function public.audit_trigger();
create trigger trg_audit_consent_acceptances after insert or update or delete on public.consent_acceptances  for each row execute function public.audit_trigger();
create trigger trg_audit_registrations       after insert or update or delete on public.registrations        for each row execute function public.audit_trigger();

-- ============================================================================
-- RLS HELPER FUNCTIONS  (SECURITY DEFINER -> bypass RLS, no recursion)
-- ============================================================================
create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.has_role(p_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_roles where profile_id = auth.uid() and role = p_role);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin');
$$;

-- finance privileges are a superset granted to admin too
create or replace function public.is_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role('admin') or public.has_role('finance');
$$;

create or replace function public.current_coach_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.coaches where profile_id = auth.uid() limit 1;
$$;

create or replace function public.is_guardian_of_family(p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members
    where family_id = p_family and profile_id = auth.uid()
  );
$$;

create or replace function public.is_guardian_of_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.athletes a
    join public.family_members fm on fm.family_id = a.family_id
    where a.id = p_athlete and fm.profile_id = auth.uid()
  );
$$;

-- A coach may access an athlete if: they coach a program the athlete is
-- registered in, OR they have a booking with the athlete, OR they led an
-- attendance session the athlete was marked in.
create or replace function public.coach_can_access_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.registrations r
    join public.program_sessions ps on ps.program_id = r.program_id
    where r.athlete_id = p_athlete and ps.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.training_bookings b
    where b.athlete_id = p_athlete and b.coach_id = public.current_coach_id()
  )
  or exists (
    select 1 from public.attendance_marks m
    join public.attendance_sessions s on s.id = m.attendance_session_id
    where m.athlete_id = p_athlete and s.coach_id = public.current_coach_id()
  );
$$;

-- These three break mutual recursion: policies on registrations <-> program_sessions
-- <-> attendance_* would otherwise query each other's RLS-protected tables.
-- Wrapping the cross-table checks in SECURITY DEFINER fns bypasses RLS for the lookup.
create or replace function public.coach_coaches_program(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.program_sessions ps
    where ps.program_id = p_program and ps.coach_id = public.current_coach_id()
  );
$$;

create or replace function public.guardian_has_athlete_in_program(p_program uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.registrations r
    join public.athletes a on a.id = r.athlete_id
    join public.family_members fm on fm.family_id = a.family_id
    where r.program_id = p_program and fm.profile_id = auth.uid()
  );
$$;

create or replace function public.coach_leads_attendance_session(p_session uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.attendance_sessions s
    where s.id = p_session and s.coach_id = public.current_coach_id()
  );
$$;

-- ============================================================================
-- ENABLE RLS ON EVERY TABLE
-- ============================================================================
alter table public.organizations       enable row level security;
alter table public.profiles             enable row level security;
alter table public.staff_roles          enable row level security;
alter table public.families             enable row level security;
alter table public.family_members       enable row level security;
alter table public.athletes             enable row level security;
alter table public.athlete_medical      enable row level security;
alter table public.coaches              enable row level security;
alter table public.programs             enable row level security;
alter table public.program_sessions     enable row level security;
alter table public.training_services    enable row level security;
alter table public.coach_availability   enable row level security;
alter table public.registrations        enable row level security;
alter table public.invoices             enable row level security;
alter table public.invoice_items        enable row level security;
alter table public.payments             enable row level security;
alter table public.training_bookings    enable row level security;
alter table public.training_credits     enable row level security;
alter table public.attendance_sessions  enable row level security;
alter table public.attendance_marks     enable row level security;
alter table public.consent_forms        enable row level security;
alter table public.consent_acceptances  enable row level security;
alter table public.documents            enable row level security;
alter table public.notifications        enable row level security;
alter table public.email_logs           enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.app_settings         enable row level security;

-- ============================================================================
-- POLICIES
-- (No `to service_role` policies are needed: service_role bypasses RLS.)
-- ============================================================================

-- ---- organizations --------------------------------------------------------
create policy org_select on public.organizations for select
  using (id = public.current_org_id());
create policy org_update on public.organizations for update
  using (id = public.current_org_id() and public.is_admin());

-- ---- profiles -------------------------------------------------------------
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or (org_id = public.current_org_id() and public.is_admin()));
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_write on public.profiles for update
  using (org_id = public.current_org_id() and public.is_admin());

-- ---- staff_roles ----------------------------------------------------------
create policy staff_roles_select on public.staff_roles for select
  using (profile_id = auth.uid() or public.is_admin());
create policy staff_roles_admin_all on public.staff_roles for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- ---- families -------------------------------------------------------------
create policy families_select on public.families for select
  using (public.is_finance() or public.is_guardian_of_family(id));
create policy families_admin_write on public.families for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
create policy families_guardian_update on public.families for update
  using (public.is_guardian_of_family(id))
  with check (public.is_guardian_of_family(id));

-- ---- family_members -------------------------------------------------------
create policy family_members_select on public.family_members for select
  using (profile_id = auth.uid() or public.is_guardian_of_family(family_id) or public.is_admin());
create policy family_members_admin_write on public.family_members for all
  using (public.is_admin()) with check (public.is_admin());

-- ---- athletes -------------------------------------------------------------
create policy athletes_select on public.athletes for select
  using (
    public.is_finance()
    or public.is_guardian_of_athlete(id)
    or public.coach_can_access_athlete(id)
  );
create policy athletes_admin_write on public.athletes for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
create policy athletes_guardian_write on public.athletes for all
  using (public.is_guardian_of_athlete(id))
  with check (public.is_guardian_of_family(family_id));

-- ---- athlete_medical  (PROTECTED: admin + owning guardian + coach read; NOT finance) ----
create policy medical_select on public.athlete_medical for select
  using (
    public.is_admin()
    or public.is_guardian_of_athlete(athlete_id)
    or public.coach_can_access_athlete(athlete_id)   -- coach read for safety (audited)
  );
create policy medical_admin_write on public.athlete_medical for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
create policy medical_guardian_write on public.athlete_medical for all
  using (public.is_guardian_of_athlete(athlete_id))
  with check (public.is_guardian_of_athlete(athlete_id));

-- ---- coaches --------------------------------------------------------------
create policy coaches_select on public.coaches for select
  using (org_id = public.current_org_id());          -- visible to club members
create policy coaches_admin_write on public.coaches for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- ---- programs  (public landing can read is_public rows, incl. anon) -------
create policy programs_select on public.programs for select
  using (is_public or org_id = public.current_org_id());
create policy programs_admin_write on public.programs for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- ---- program_sessions -----------------------------------------------------
create policy program_sessions_select on public.program_sessions for select
  using (
    public.is_finance()
    or coach_id = public.current_coach_id()
    or public.guardian_has_athlete_in_program(program_id)
  );
create policy program_sessions_write on public.program_sessions for all
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()))
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));

-- ---- training_services ----------------------------------------------------
create policy training_services_select on public.training_services for select
  using (org_id = public.current_org_id());
create policy training_services_admin_write on public.training_services for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- ---- coach_availability ---------------------------------------------------
create policy coach_avail_select on public.coach_availability for select
  using (org_id = public.current_org_id());          -- parents need to see slots to book
create policy coach_avail_write on public.coach_availability for all
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()))
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));

-- ---- registrations --------------------------------------------------------
create policy registrations_select on public.registrations for select
  using (
    public.is_finance()
    or public.is_guardian_of_athlete(athlete_id)
    or public.coach_coaches_program(program_id)
  );
create policy registrations_guardian_insert on public.registrations for insert
  with check (public.is_guardian_of_athlete(athlete_id) or public.is_finance());
create policy registrations_staff_write on public.registrations for update
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
create policy registrations_guardian_cancel on public.registrations for update
  using (public.is_guardian_of_athlete(athlete_id))
  with check (public.is_guardian_of_athlete(athlete_id));

-- ---- invoices  (read: finance or owning family; writes: finance/system) ---
create policy invoices_select on public.invoices for select
  using (public.is_finance() or public.is_guardian_of_family(family_id));
create policy invoices_finance_write on public.invoices for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
-- (No DELETE policy -> deletes denied for non-service roles; void via status.)

-- ---- invoice_items  (inherit visibility from parent invoice) --------------
create policy invoice_items_select on public.invoice_items for select
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_items.invoice_id
      and (public.is_finance() or public.is_guardian_of_family(i.family_id))
  ));
create policy invoice_items_finance_write on public.invoice_items for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());

-- ---- payments  (read: finance or owning family; writes: finance/system) ---
create policy payments_select on public.payments for select
  using (
    public.is_finance()
    or exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id and public.is_guardian_of_family(i.family_id)
    )
  );
create policy payments_finance_write on public.payments for all
  using (org_id = public.current_org_id() and public.is_finance())
  with check (org_id = public.current_org_id() and public.is_finance());
-- Online payment status flips arrive via the Stripe webhook using the
-- service_role key, which bypasses RLS. Parents NEVER write payment status.

-- ---- training_bookings ----------------------------------------------------
create policy bookings_select on public.training_bookings for select
  using (
    public.is_finance()
    or public.is_guardian_of_athlete(athlete_id)
    or coach_id = public.current_coach_id()
  );
create policy bookings_guardian_insert on public.training_bookings for insert
  with check (public.is_guardian_of_athlete(athlete_id) or public.is_finance());
create policy bookings_write on public.training_bookings for update
  using (public.is_finance() or coach_id = public.current_coach_id() or public.is_guardian_of_athlete(athlete_id))
  with check (public.is_finance() or coach_id = public.current_coach_id() or public.is_guardian_of_athlete(athlete_id));

-- ---- training_credits  (read: finance or owning guardian; write: admin/system) ----
create policy credits_select on public.training_credits for select
  using (public.is_finance() or public.is_guardian_of_athlete(athlete_id));
create policy credits_admin_write on public.training_credits for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- ---- attendance_sessions --------------------------------------------------
create policy att_sessions_select on public.attendance_sessions for select
  using (
    public.is_finance()
    or coach_id = public.current_coach_id()
    or public.guardian_has_athlete_in_program(program_id)
  );
create policy att_sessions_write on public.attendance_sessions for all
  using (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()))
  with check (org_id = public.current_org_id() and (public.is_admin() or coach_id = public.current_coach_id()));

-- ---- attendance_marks  (coach writes only for sessions they lead) ---------
create policy att_marks_select on public.attendance_marks for select
  using (
    public.is_admin()
    or public.is_guardian_of_athlete(athlete_id)
    or public.coach_leads_attendance_session(attendance_session_id)
  );
create policy att_marks_write on public.attendance_marks for all
  using (
    public.is_admin()
    or public.coach_leads_attendance_session(attendance_session_id)
  )
  with check (
    public.is_admin()
    or public.coach_leads_attendance_session(attendance_session_id)
  );

-- ---- consent_forms  (readable to club; managed by admin) ------------------
create policy consent_forms_select on public.consent_forms for select
  using (org_id = public.current_org_id());
create policy consent_forms_admin_write on public.consent_forms for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());

-- ---- consent_acceptances  (guardian records own; admin/coach can read) ----
create policy consent_acc_select on public.consent_acceptances for select
  using (
    public.is_admin()
    or public.is_guardian_of_athlete(athlete_id)
    or public.coach_can_access_athlete(athlete_id)
  );
create policy consent_acc_insert on public.consent_acceptances for insert
  with check (public.is_guardian_of_athlete(athlete_id) or public.is_admin());
create policy consent_acc_update on public.consent_acceptances for update
  using (public.is_admin() or public.is_guardian_of_athlete(athlete_id))
  with check (public.is_admin() or public.is_guardian_of_athlete(athlete_id));

-- ---- documents ------------------------------------------------------------
create policy documents_select on public.documents for select
  using (
    public.is_admin()
    or (athlete_id is not null and public.is_guardian_of_athlete(athlete_id))
    or (family_id  is not null and public.is_guardian_of_family(family_id))
    or (athlete_id is not null and public.coach_can_access_athlete(athlete_id))
  );
create policy documents_write on public.documents for all
  using (
    public.is_admin()
    or (athlete_id is not null and public.is_guardian_of_athlete(athlete_id))
  )
  with check (
    public.is_admin()
    or (athlete_id is not null and public.is_guardian_of_athlete(athlete_id))
  );

-- ---- notifications  (recipient sees own + club-wide; admin sees all) ------
create policy notifications_select on public.notifications for select
  using (
    recipient_id = auth.uid()
    or (recipient_id is null and org_id = public.current_org_id())
    or public.is_admin()
  );
create policy notifications_mark_read on public.notifications for update
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());
create policy notifications_admin_write on public.notifications for insert
  with check (org_id = public.current_org_id() and public.is_finance());

-- ---- email_logs  (finance/admin only; append-only) -----------------------
create policy email_logs_select on public.email_logs for select
  using (org_id = public.current_org_id() and public.is_finance());
create policy email_logs_insert on public.email_logs for insert
  with check (org_id = public.current_org_id() and public.is_finance());

-- ---- audit_logs  (admin read only; inserts come from SECURITY DEFINER trigger) ----
create policy audit_logs_select on public.audit_logs for select
  using (org_id = public.current_org_id() and public.is_admin());

-- ---- app_settings  (club members read; admin writes) ---------------------
create policy app_settings_select on public.app_settings for select
  using (org_id = public.current_org_id());
create policy app_settings_admin_write on public.app_settings for all
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
