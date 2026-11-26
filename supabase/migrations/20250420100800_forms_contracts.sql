-- ============================================================================
-- Forms, contracts and the registration form editor.
--
--   * forms / form_versions: a form builder (sections + fields, conditional
--     visibility) for waivers, physical / medical forms, media consent and
--     custom forms. Admins edit forms.draft_schema; publishing appends an
--     immutable form_versions row (version 1, 2, ...). Submissions point at
--     the version they were made against, so publishing a new version never
--     changes an old submission.
--   * form_assignments: which members must complete a form (all members, a
--     programme or camp, a team, a training service), renewal period and due
--     date. form_reminders logs reminders sent to families (throttling).
--   * form_submissions: APPEND-ONLY consent records. Admins may only void one
--     (status + void columns); a renewal is a new row. valid_until is
--     computed in the database from the assignment's renewal period.
--   * form_safety_answers(): the only way coaches see form answers — the
--     fields an admin flagged "safety" (e.g. allergies, emergency contact) of
--     athletes they coach. Finance never reads submissions.
--   * registration_form_configs / registration_answers: per programme (camps
--     are programmes) which built-in fields are shown / required plus custom
--     questions; answers are stored with the registration.
--   * contract_templates / contracts: participation contracts per activity
--     type with merge fields, rendered server-side and accepted by a guardian
--     through sign_contract() (typed name, timestamp, IP hash, version). A
--     signed contract is immutable; it can only be voided (and reissued as a
--     new contract).
--   * Private buckets "form-files" (uploads, drawn signatures) and
--     "contracts" (signed PDFs), keys <org_id>/<family_id>/<file>.
--
-- Submissions, registration answers and contracts are personal data of
-- children: admins of the org and the child's guardians only. Additive and
-- idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------

-- Audit trigger that never copies the listed keys (answers, signatures,
-- contract bodies) into audit_logs; it records which of them changed.
create or replace function public.forms_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('UPDATE', 'INSERT') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_key text;
  v_changed text[] := '{}';
begin
  foreach v_key in array coalesce(tg_argv, array[]::text[]) loop
    if tg_op = 'UPDATE' and (v_old->v_key) is distinct from (v_new->v_key) then
      v_changed := v_changed || v_key;
    end if;
    v_old := v_old - v_key;
    v_new := v_new - v_key;
  end loop;
  if array_length(v_changed, 1) > 0 then
    v_new := v_new || jsonb_build_object('_changed_sensitive', to_jsonb(v_changed));
  end if;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values ((v_row->>'org_id')::uuid, auth.uid(), tg_op, tg_table_name, (v_row->>'id')::uuid, v_old, v_new);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Every "column:table" pair must point at a row of the same org as NEW.
create or replace function public.forms_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  jsonb := to_jsonb(new);
  v_org  uuid  := (v_row->>'org_id')::uuid;
  v_pair text;
  v_col  text;
  v_tab  text;
  v_id   uuid;
  v_ok   boolean;
begin
  foreach v_pair in array tg_argv loop
    v_col := split_part(v_pair, ':', 1);
    v_tab := split_part(v_pair, ':', 2);
    if v_tab not in ('forms', 'form_versions', 'form_assignments', 'athletes', 'families', 'programs', 'teams',
                     'training_services', 'registrations', 'contract_templates', 'contracts',
                     'training_package_purchases') then
      raise exception 'forms_same_org_guard: unknown table %', v_tab;
    end if;
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab) into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;


-- Columns an ON DELETE SET NULL foreign key may clear on an otherwise frozen
-- row. Unchanged or cleared columns are removed from OLD/NEW; a column set
-- from null to a value stays in both for the caller to judge; re-pointing a
-- column to another value sets bad.
create or replace function public.forms_strip_fk_clears(p_old jsonb, p_new jsonb, p_cols text[], out o jsonb, out n jsonb, out bad boolean)
language plpgsql immutable set search_path = public as $$
declare v_c text;
begin
  o := p_old; n := p_new; bad := false;
  foreach v_c in array p_cols loop
    if (p_old->v_c) is not distinct from (p_new->v_c) or jsonb_typeof(p_new->v_c) = 'null' then
      o := o - v_c; n := n - v_c;            -- unchanged, or cleared
    elsif jsonb_typeof(p_old->v_c) is distinct from 'null' then
      bad := true;                            -- re-pointed: never allowed
    end if;                                   -- null -> value: compared by the caller
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Forms + immutable versions
-- ---------------------------------------------------------------------------
create table if not exists public.forms (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  title               text not null check (length(btrim(title)) between 1 and 160),
  description         text check (description is null or length(description) <= 4000),
  form_type           text not null default 'custom' check (form_type in ('waiver', 'medical', 'media_consent', 'custom')),
  status              text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  draft_schema        jsonb not null default '{"sections": []}'::jsonb check (jsonb_typeof(draft_schema) = 'object'),
  current_version_id  uuid,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_forms_org on public.forms(org_id, status);
drop trigger if exists trg_forms_updated on public.forms;
create trigger trg_forms_updated before update on public.forms
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_forms on public.forms;
create trigger trg_audit_forms after insert or update or delete on public.forms
  for each row execute function public.forms_audit_trigger('draft_schema');

create table if not exists public.form_versions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  form_id       uuid not null references public.forms(id) on delete cascade,
  version       integer not null check (version >= 1),
  title         text not null,
  form_type     text not null check (form_type in ('waiver', 'medical', 'media_consent', 'custom')),
  schema        jsonb not null check (jsonb_typeof(schema) = 'object' and jsonb_typeof(schema->'sections') = 'array'),
  published_by  uuid references public.profiles(id) on delete set null,
  published_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (form_id, version)
);
create index if not exists idx_form_versions_org on public.form_versions(org_id);
drop trigger if exists trg_form_versions_same_org on public.form_versions;
create trigger trg_form_versions_same_org before insert on public.form_versions
  for each row execute function public.forms_same_org_guard('form_id:forms');

do $$ begin
  alter table public.forms add constraint forms_current_version_fk
    foreign key (current_version_id) references public.form_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- A published version never changes.
create or replace function public.form_versions_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'FORM_VERSION_IMMUTABLE' using errcode = 'P0001';
end $$;
drop trigger if exists trg_form_versions_immutable on public.form_versions;
create trigger trg_form_versions_immutable before update on public.form_versions
  for each row execute function public.form_versions_immutable();

-- current_version_id must be a version of the same form.
create or replace function public.forms_version_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_version_id is not null and not exists (
    select 1 from public.form_versions v where v.id = new.current_version_id and v.form_id = new.id and v.org_id = new.org_id
  ) then
    raise exception 'CROSS_ORG_REFERENCE: current_version_id' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_forms_version_guard on public.forms;
create trigger trg_forms_version_guard before insert or update on public.forms
  for each row execute function public.forms_version_guard();

alter table public.forms enable row level security;
drop policy if exists forms_select on public.forms;
create policy forms_select on public.forms for select
  using (org_id = public.current_org_id() and (public.is_admin() or status = 'published'));
drop policy if exists forms_insert on public.forms;
create policy forms_insert on public.forms for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists forms_update on public.forms;
create policy forms_update on public.forms for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
-- Only never-published drafts can be deleted (published forms are archived).
drop policy if exists forms_delete on public.forms;
create policy forms_delete on public.forms for delete
  using (org_id = public.current_org_id() and public.is_admin() and current_version_id is null
         and not exists (select 1 from public.form_versions v where v.form_id = forms.id));
grant select, insert, update, delete on public.forms to authenticated;
grant all on public.forms to service_role;

alter table public.form_versions enable row level security;
drop policy if exists form_versions_select on public.form_versions;
create policy form_versions_select on public.form_versions for select
  using (org_id = public.current_org_id());
drop policy if exists form_versions_insert on public.form_versions;
create policy form_versions_insert on public.form_versions for insert
  with check (org_id = public.current_org_id() and public.is_admin());
-- No update / delete policies: versions are append-only.
grant select, insert on public.form_versions to authenticated;
grant all on public.form_versions to service_role;

-- Publish the current draft as the next version (atomic; admins of the org).
create or replace function public.publish_form(p_form uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form public.forms%rowtype;
  v_next integer;
  v_id   uuid;
begin
  select * into v_form from public.forms where id = p_form for update;
  if not found or v_form.org_id is distinct from public.current_org_id() or not public.is_admin() then
    raise exception 'NOT_PERMITTED' using errcode = '42501';
  end if;
  if jsonb_typeof(v_form.draft_schema->'sections') <> 'array'
     or not exists (
       select 1 from jsonb_array_elements(v_form.draft_schema->'sections') s,
                     jsonb_array_elements(coalesce(s->'fields', '[]'::jsonb)) f
        where f->>'type' <> 'info'
     ) then
    raise exception 'FORM_EMPTY' using errcode = 'P0001';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.form_versions where form_id = p_form;
  insert into public.form_versions (org_id, form_id, version, title, form_type, schema, published_by)
  values (v_form.org_id, p_form, v_next, v_form.title, v_form.form_type, v_form.draft_schema, auth.uid())
  returning id into v_id;
  update public.forms set current_version_id = v_id, status = 'published' where id = p_form;
  return v_id;
end;
$$;
revoke all on function public.publish_form(uuid) from public, anon;
grant execute on function public.publish_form(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Assignments + reminder log
-- ---------------------------------------------------------------------------
create table if not exists public.form_assignments (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  form_id              uuid not null references public.forms(id) on delete cascade,
  scope                text not null check (scope in ('all_members', 'program', 'team', 'training_service')),
  program_id           uuid references public.programs(id) on delete cascade,
  team_id              uuid references public.teams(id) on delete cascade,
  training_service_id  uuid references public.training_services(id) on delete cascade,
  renewal              text not null default 'none' check (renewal in ('none', 'yearly', 'months')),
  renewal_months       smallint check (renewal_months is null or renewal_months between 1 and 60),
  due_date             date,
  is_required          boolean not null default true,
  is_active            boolean not null default true,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint form_assignments_target_chk check (
    (scope = 'all_members'      and program_id is null and team_id is null and training_service_id is null) or
    (scope = 'program'          and program_id is not null and team_id is null and training_service_id is null) or
    (scope = 'team'             and team_id is not null and program_id is null and training_service_id is null) or
    (scope = 'training_service' and training_service_id is not null and program_id is null and team_id is null)
  ),
  constraint form_assignments_renewal_chk check ((renewal = 'months') = (renewal_months is not null))
);
create index if not exists idx_form_assignments_org on public.form_assignments(org_id, is_active);
create index if not exists idx_form_assignments_form on public.form_assignments(form_id);
drop trigger if exists trg_form_assignments_updated on public.form_assignments;
create trigger trg_form_assignments_updated before update on public.form_assignments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_form_assignments_same_org on public.form_assignments;
create trigger trg_form_assignments_same_org before insert or update on public.form_assignments
  for each row execute function public.forms_same_org_guard(
    'form_id:forms', 'program_id:programs', 'team_id:teams', 'training_service_id:training_services');
drop trigger if exists trg_audit_form_assignments on public.form_assignments;
create trigger trg_audit_form_assignments after insert or update or delete on public.form_assignments
  for each row execute function public.forms_audit_trigger();

alter table public.form_assignments enable row level security;
drop policy if exists form_assignments_select on public.form_assignments;
create policy form_assignments_select on public.form_assignments for select
  using (org_id = public.current_org_id());
drop policy if exists form_assignments_insert on public.form_assignments;
create policy form_assignments_insert on public.form_assignments for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists form_assignments_update on public.form_assignments;
create policy form_assignments_update on public.form_assignments for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists form_assignments_delete on public.form_assignments;
create policy form_assignments_delete on public.form_assignments for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.form_assignments to authenticated;
grant all on public.form_assignments to service_role;

create table if not exists public.form_reminders (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  assignment_id  uuid not null references public.form_assignments(id) on delete cascade,
  family_id      uuid not null references public.families(id) on delete cascade,
  athlete_id     uuid references public.athletes(id) on delete cascade,
  sent_by        uuid references public.profiles(id) on delete set null,
  sent_at        timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_form_reminders_org on public.form_reminders(org_id, sent_at desc);
create index if not exists idx_form_reminders_lookup on public.form_reminders(assignment_id, family_id, sent_at desc);
drop trigger if exists trg_form_reminders_same_org on public.form_reminders;
create trigger trg_form_reminders_same_org before insert or update on public.form_reminders
  for each row execute function public.forms_same_org_guard('assignment_id:form_assignments', 'family_id:families', 'athlete_id:athletes');

alter table public.form_reminders enable row level security;
drop policy if exists form_reminders_select on public.form_reminders;
create policy form_reminders_select on public.form_reminders for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists form_reminders_insert on public.form_reminders;
create policy form_reminders_insert on public.form_reminders for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists form_reminders_update on public.form_reminders;
create policy form_reminders_update on public.form_reminders for update
  using (false) with check (false);
drop policy if exists form_reminders_delete on public.form_reminders;
create policy form_reminders_delete on public.form_reminders for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.form_reminders to authenticated;
grant all on public.form_reminders to service_role;

-- ---------------------------------------------------------------------------
-- 3) Submissions (append-only consent records)
-- ---------------------------------------------------------------------------
create table if not exists public.form_submissions (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  form_id          uuid not null references public.forms(id),
  form_version_id  uuid not null references public.form_versions(id),
  assignment_id    uuid references public.form_assignments(id) on delete set null,
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  family_id        uuid not null references public.families(id) on delete cascade,
  answers          jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  signer_name      text check (signer_name is null or length(btrim(signer_name)) between 1 and 160),
  signature_path   text check (signature_path is null or length(signature_path) <= 300),
  ip_hash          text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  submitted_by     uuid references public.profiles(id) on delete set null,
  submitted_at     timestamptz not null default now(),
  valid_until      date,
  status           text not null default 'submitted' check (status in ('submitted', 'voided')),
  voided_at        timestamptz,
  voided_by        uuid references public.profiles(id) on delete set null,
  void_reason      text check (void_reason is null or length(void_reason) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_form_submissions_org on public.form_submissions(org_id);
create index if not exists idx_form_submissions_athlete on public.form_submissions(athlete_id, form_id, submitted_at desc);
create index if not exists idx_form_submissions_family on public.form_submissions(family_id);
create index if not exists idx_form_submissions_version on public.form_submissions(form_version_id);

-- Insert: version must be the form's CURRENT published version, the family is
-- the athlete's own family, valid_until comes from the assignment renewal.
-- Update: only voiding (status + void columns); voided rows are frozen.
create or replace function public.form_submissions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_form  public.forms%rowtype;
  v_asg   public.form_assignments%rowtype;
  v_fam   uuid;
  v_o     jsonb;
  v_n     jsonb;
  v_bad   boolean;
begin
  if tg_op = 'INSERT' then
    select * into v_form from public.forms where id = new.form_id;
    if not found or v_form.org_id <> new.org_id then
      raise exception 'CROSS_ORG_REFERENCE: form_id' using errcode = 'P0001';
    end if;
    if v_form.status <> 'published' or v_form.current_version_id is distinct from new.form_version_id then
      raise exception 'FORM_VERSION_NOT_CURRENT' using errcode = 'P0001';
    end if;
    select family_id into v_fam from public.athletes where id = new.athlete_id and org_id = new.org_id;
    if v_fam is null then
      raise exception 'CROSS_ORG_REFERENCE: athlete_id' using errcode = 'P0001';
    end if;
    new.family_id := v_fam;
    new.status := 'submitted';
    new.voided_at := null; new.voided_by := null; new.void_reason := null;
    new.submitted_at := now();
    new.valid_until := null;
    if new.assignment_id is not null then
      select * into v_asg from public.form_assignments where id = new.assignment_id;
      if not found or v_asg.org_id <> new.org_id or v_asg.form_id <> new.form_id then
        raise exception 'CROSS_ORG_REFERENCE: assignment_id' using errcode = 'P0001';
      end if;
      new.valid_until := case v_asg.renewal
        when 'yearly' then (current_date + interval '1 year')::date
        when 'months' then (current_date + make_interval(months => v_asg.renewal_months))::date
        else null end;
    end if;
    return new;
  end if;

  -- UPDATE: strip FK clean-ups (ON DELETE SET NULL), then only voiding.
  select f.o, f.n, f.bad into v_o, v_n, v_bad
    from public.forms_strip_fk_clears(to_jsonb(old), to_jsonb(new), array['assignment_id','submitted_by','voided_by']) f;
  if v_bad then
    raise exception 'SUBMISSION_IMMUTABLE' using errcode = 'P0001';
  end if;
  v_o := v_o - 'updated_at'; v_n := v_n - 'updated_at';
  if v_o = v_n then
    return new; -- FK clean-up only
  end if;
  if old.status = 'voided' or new.status <> 'voided'
     or (v_n - array['status','voided_at','void_reason']) is distinct from (v_o - array['status','voided_at','void_reason']) then
    raise exception 'SUBMISSION_IMMUTABLE' using errcode = 'P0001';
  end if;
  new.voided_at := now();
  new.voided_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_form_submissions_guard on public.form_submissions;
create trigger trg_form_submissions_guard before insert or update on public.form_submissions
  for each row execute function public.form_submissions_guard();
drop trigger if exists trg_audit_form_submissions on public.form_submissions;
create trigger trg_audit_form_submissions after insert or update or delete on public.form_submissions
  for each row execute function public.forms_audit_trigger('answers', 'signature_path', 'signer_name', 'ip_hash');

alter table public.form_submissions enable row level security;
drop policy if exists form_submissions_select on public.form_submissions;
create policy form_submissions_select on public.form_submissions for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists form_submissions_insert on public.form_submissions;
create policy form_submissions_insert on public.form_submissions for insert
  with check (org_id = public.current_org_id() and submitted_by = auth.uid()
              and (public.is_admin() or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists form_submissions_update on public.form_submissions;
create policy form_submissions_update on public.form_submissions for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
-- No delete policy: consent records are never deleted by users (retention
-- jobs run with the service role).
grant select, insert, update on public.form_submissions to authenticated;
grant all on public.form_submissions to service_role;

-- Coaches: safety-flagged answers of athletes they coach (latest valid
-- submission per form). Admins may call it too. Finance and parents get none.
create or replace function public.form_safety_answers(p_athlete uuid)
returns table (form_id uuid, form_title text, field_label text, answer text, submitted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.athletes a where a.id = p_athlete and a.org_id = public.current_org_id()) then
    return;
  end if;
  if not (public.is_admin() or (public.has_role('coach') and public.coach_can_access_athlete(p_athlete))) then
    return;
  end if;
  return query
    with latest as (
      select distinct on (s.form_id) s.*
        from public.form_submissions s
       where s.athlete_id = p_athlete and s.status = 'submitted'
         and (s.valid_until is null or s.valid_until >= current_date)
       order by s.form_id, s.submitted_at desc
    )
    select l.form_id, v.title, fld->>'label',
           case jsonb_typeof(l.answers->(fld->>'id'))
             when 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(l.answers->(fld->>'id')) x)
             else l.answers->>(fld->>'id') end,
           l.submitted_at
      from latest l
      join public.form_versions v on v.id = l.form_version_id
      cross join lateral jsonb_array_elements(v.schema->'sections') sec
      cross join lateral jsonb_array_elements(coalesce(sec->'fields', '[]'::jsonb)) fld
     where coalesce((fld->>'safety')::boolean, false)
       and fld->>'type' not in ('signature', 'file', 'info')
       and l.answers ? (fld->>'id');
end;
$$;
revoke all on function public.form_safety_answers(uuid) from public, anon;
grant execute on function public.form_safety_answers(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Registration form editor
-- ---------------------------------------------------------------------------
create table if not exists public.registration_form_configs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  program_id  uuid not null references public.programs(id) on delete cascade,
  builtin     jsonb not null default '{}'::jsonb check (jsonb_typeof(builtin) = 'object'),
  questions   jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 40),
  updated_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (program_id)
);
create index if not exists idx_registration_form_configs_org on public.registration_form_configs(org_id);
drop trigger if exists trg_registration_form_configs_updated on public.registration_form_configs;
create trigger trg_registration_form_configs_updated before update on public.registration_form_configs
  for each row execute function public.set_updated_at();
drop trigger if exists trg_registration_form_configs_same_org on public.registration_form_configs;
create trigger trg_registration_form_configs_same_org before insert or update on public.registration_form_configs
  for each row execute function public.forms_same_org_guard('program_id:programs');
drop trigger if exists trg_audit_registration_form_configs on public.registration_form_configs;
create trigger trg_audit_registration_form_configs after insert or update or delete on public.registration_form_configs
  for each row execute function public.forms_audit_trigger();

alter table public.registration_form_configs enable row level security;
drop policy if exists registration_form_configs_select on public.registration_form_configs;
create policy registration_form_configs_select on public.registration_form_configs for select
  using (org_id = public.current_org_id());
drop policy if exists registration_form_configs_insert on public.registration_form_configs;
create policy registration_form_configs_insert on public.registration_form_configs for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists registration_form_configs_update on public.registration_form_configs;
create policy registration_form_configs_update on public.registration_form_configs for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists registration_form_configs_delete on public.registration_form_configs;
create policy registration_form_configs_delete on public.registration_form_configs for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.registration_form_configs to authenticated;
grant all on public.registration_form_configs to service_role;

create table if not exists public.registration_answers (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  registration_id  uuid not null references public.registrations(id) on delete cascade,
  athlete_id       uuid not null references public.athletes(id) on delete cascade,
  program_id       uuid not null references public.programs(id) on delete cascade,
  answers          jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  questions        jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (registration_id)
);
create index if not exists idx_registration_answers_org on public.registration_answers(org_id);
create index if not exists idx_registration_answers_program on public.registration_answers(program_id);
drop trigger if exists trg_registration_answers_updated on public.registration_answers;
create trigger trg_registration_answers_updated before update on public.registration_answers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_registration_answers_same_org on public.registration_answers;
create trigger trg_registration_answers_same_org before insert or update on public.registration_answers
  for each row execute function public.forms_same_org_guard('registration_id:registrations', 'athlete_id:athletes', 'program_id:programs');
drop trigger if exists trg_audit_registration_answers on public.registration_answers;
create trigger trg_audit_registration_answers after insert or update or delete on public.registration_answers
  for each row execute function public.forms_audit_trigger('answers');

alter table public.registration_answers enable row level security;
drop policy if exists registration_answers_select on public.registration_answers;
create policy registration_answers_select on public.registration_answers for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists registration_answers_insert on public.registration_answers;
create policy registration_answers_insert on public.registration_answers for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists registration_answers_update on public.registration_answers;
create policy registration_answers_update on public.registration_answers for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists registration_answers_delete on public.registration_answers;
create policy registration_answers_delete on public.registration_answers for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.registration_answers to authenticated;
grant all on public.registration_answers to service_role;

-- ---------------------------------------------------------------------------
-- 5) Contract templates + contracts
-- ---------------------------------------------------------------------------
create table if not exists public.contract_templates (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 160),
  activity_type  text not null check (activity_type in ('team_season', 'camp', 'training_package', 'other')),
  program_id     uuid references public.programs(id) on delete set null,
  title          text not null check (length(btrim(title)) between 1 and 200),
  body           text not null check (length(body) between 1 and 50000),
  version        integer not null default 1 check (version >= 1),
  status         text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  auto_issue     boolean not null default true,
  published_at   timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_contract_templates_org on public.contract_templates(org_id, activity_type, status);
drop trigger if exists trg_contract_templates_updated on public.contract_templates;
create trigger trg_contract_templates_updated before update on public.contract_templates
  for each row execute function public.set_updated_at();
drop trigger if exists trg_contract_templates_same_org on public.contract_templates;
create trigger trg_contract_templates_same_org before insert or update on public.contract_templates
  for each row execute function public.forms_same_org_guard('program_id:programs');
drop trigger if exists trg_audit_contract_templates on public.contract_templates;
create trigger trg_audit_contract_templates after insert or update or delete on public.contract_templates
  for each row execute function public.forms_audit_trigger('body');

alter table public.contract_templates enable row level security;
drop policy if exists contract_templates_select on public.contract_templates;
create policy contract_templates_select on public.contract_templates for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contract_templates_insert on public.contract_templates;
create policy contract_templates_insert on public.contract_templates for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contract_templates_update on public.contract_templates;
create policy contract_templates_update on public.contract_templates for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.contract_templates to authenticated;
grant all on public.contract_templates to service_role;

create table if not exists public.contracts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  template_id       uuid not null references public.contract_templates(id),
  template_version  integer not null check (template_version >= 1),
  family_id         uuid not null references public.families(id) on delete cascade,
  athlete_id        uuid references public.athletes(id) on delete set null,
  registration_id   uuid references public.registrations(id) on delete set null,
  purchase_id       uuid references public.training_package_purchases(id) on delete set null,
  program_id        uuid references public.programs(id) on delete set null,
  source            text not null default 'admin' check (source in ('registration', 'purchase', 'admin')),
  title             text not null check (length(btrim(title)) between 1 and 200),
  body              text not null check (length(body) between 1 and 60000),
  merge_data        jsonb not null default '{}'::jsonb check (jsonb_typeof(merge_data) = 'object'),
  status            text not null default 'issued' check (status in ('issued', 'signed', 'void')),
  issued_by         uuid references public.profiles(id) on delete set null,
  issued_at         timestamptz not null default now(),
  signed_at         timestamptz,
  signer_name       text check (signer_name is null or length(btrim(signer_name)) between 1 and 160),
  signer_profile_id uuid references public.profiles(id) on delete set null,
  ip_hash           text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  pdf_path          text check (pdf_path is null or length(pdf_path) <= 300),
  voided_at         timestamptz,
  voided_by         uuid references public.profiles(id) on delete set null,
  void_reason       text check (void_reason is null or length(void_reason) <= 500),
  reissued_from     uuid references public.contracts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint contracts_signed_chk check (status <> 'signed' or (signed_at is not null and signer_name is not null))
);
create index if not exists idx_contracts_org on public.contracts(org_id, status, issued_at desc);
create index if not exists idx_contracts_family on public.contracts(family_id);
create index if not exists idx_contracts_registration on public.contracts(registration_id);
create index if not exists idx_contracts_purchase on public.contracts(purchase_id);
drop trigger if exists trg_contracts_same_org on public.contracts;
create trigger trg_contracts_same_org before insert on public.contracts
  for each row execute function public.forms_same_org_guard(
    'template_id:contract_templates', 'family_id:families', 'athlete_id:athletes', 'registration_id:registrations',
    'purchase_id:training_package_purchases', 'program_id:programs', 'reissued_from:contracts');

-- Content never changes after issue. Issued -> signed (only via
-- sign_contract) or void. Signed -> void, or pdf_path set once. Void is final.
create or replace function public.contracts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sign text[] := array['status','signed_at','signer_name','signer_profile_id','ip_hash'];
  v_void text[] := array['status','voided_at','voided_by','void_reason'];
  v_o jsonb;
  v_n jsonb;
  v_bad boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'issued' then
      raise exception 'CONTRACT_IMMUTABLE' using errcode = 'P0001';
    end if;
    new.signed_at := null; new.signer_name := null; new.signer_profile_id := null; new.ip_hash := null;
    new.pdf_path := null; new.voided_at := null; new.voided_by := null; new.void_reason := null;
    new.issued_at := now();
    if new.athlete_id is not null
       and not exists (select 1 from public.athletes a where a.id = new.athlete_id and a.family_id = new.family_id) then
      raise exception 'CROSS_ORG_REFERENCE: athlete_id' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- FK clean-ups (ON DELETE SET NULL) are always allowed and set aside.
  select f.o, f.n, f.bad into v_o, v_n, v_bad
    from public.forms_strip_fk_clears(to_jsonb(old), to_jsonb(new),
         array['athlete_id','registration_id','purchase_id','program_id','reissued_from','issued_by','signer_profile_id','voided_by']) f;
  if v_bad then
    raise exception 'CONTRACT_IMMUTABLE' using errcode = 'P0001';
  end if;
  v_o := v_o - 'updated_at'; v_n := v_n - 'updated_at';
  new.updated_at := now();
  if v_o = v_n then
    return new;
  end if;
  if old.status = 'void' then
    raise exception 'CONTRACT_IMMUTABLE' using errcode = 'P0001';
  end if;

  -- issued|signed -> void
  if new.status = 'void' then
    if (v_n - v_void) is distinct from (v_o - v_void) then
      raise exception 'CONTRACT_IMMUTABLE' using errcode = 'P0001';
    end if;
    new.voided_at := now();
    new.voided_by := auth.uid();
    return new;
  end if;

  -- issued -> signed, only through sign_contract()
  if old.status = 'issued' and new.status = 'signed' then
    if current_setting('app.contract_signing', true) is distinct from 'on' then
      raise exception 'CONTRACT_SIGN_VIA_RPC' using errcode = 'P0001';
    end if;
    if (v_n - v_sign) is distinct from (v_o - v_sign) then
      raise exception 'CONTRACT_IMMUTABLE' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- signed: the PDF path may be recorded once.
  if old.status = 'signed' and new.status = 'signed' and old.pdf_path is null
     and (v_n - 'pdf_path') = (v_o - 'pdf_path') then
    return new;
  end if;

  raise exception 'CONTRACT_IMMUTABLE' using errcode = 'P0001';
end;
$$;
drop trigger if exists trg_contracts_guard on public.contracts;
create trigger trg_contracts_guard before insert or update on public.contracts
  for each row execute function public.contracts_guard();
drop trigger if exists trg_contracts_updated on public.contracts;
drop trigger if exists trg_audit_contracts on public.contracts;
create trigger trg_audit_contracts after insert or update or delete on public.contracts
  for each row execute function public.forms_audit_trigger('body', 'merge_data', 'ip_hash');

alter table public.contracts enable row level security;
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts for select
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_family(family_id)));
drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
-- No delete policy: contracts are voided, never deleted.
-- Templates can be deleted only while no contract was issued from them.
drop policy if exists contract_templates_delete on public.contract_templates;
create policy contract_templates_delete on public.contract_templates for delete
  using (org_id = public.current_org_id() and public.is_admin()
         and not exists (select 1 from public.contracts c where c.template_id = contract_templates.id));
grant select, insert, update on public.contracts to authenticated;
grant all on public.contracts to service_role;

-- A guardian of the family accepts an issued contract with their typed name.
create or replace function public.sign_contract(p_contract uuid, p_signer_name text, p_ip_hash text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c   public.contracts%rowtype;
  v_now timestamptz := now();
begin
  select * into v_c from public.contracts where id = p_contract for update;
  if not found or v_c.org_id is distinct from public.current_org_id() or not public.is_guardian_of_family(v_c.family_id) then
    raise exception 'NOT_PERMITTED' using errcode = '42501';
  end if;
  if v_c.status <> 'issued' then
    raise exception 'CONTRACT_NOT_SIGNABLE' using errcode = 'P0001';
  end if;
  if p_signer_name is null or length(btrim(p_signer_name)) not between 2 and 160 then
    raise exception 'SIGNER_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_IP_HASH' using errcode = 'P0001';
  end if;
  perform set_config('app.contract_signing', 'on', true);
  update public.contracts
     set status = 'signed', signed_at = v_now, signer_name = btrim(p_signer_name),
         signer_profile_id = auth.uid(), ip_hash = p_ip_hash
   where id = p_contract;
  perform set_config('app.contract_signing', 'off', true);
  return v_now;
end;
$$;
revoke all on function public.sign_contract(uuid, text, text) from public, anon;
grant execute on function public.sign_contract(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Private buckets: form-files (uploads, signatures), contracts (PDFs)
--    Keys: <org_id>/<family_id>/<file>.
-- ---------------------------------------------------------------------------
create or replace function public.forms_storage_access(p_bucket text, p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_fam uuid;
begin
  begin
    v_org := split_part(p_name, '/', 1)::uuid;
    v_fam := split_part(p_name, '/', 2)::uuid;
  exception when others then return false;
  end;
  if split_part(p_name, '/', 3) = '' or split_part(p_name, '/', 4) <> '' then return false; end if;
  if v_org is distinct from public.current_org_id() then return false; end if;
  if not exists (select 1 from public.families f where f.id = v_fam and f.org_id = v_org) then return false; end if;
  if p_bucket = 'contracts' then
    -- Contract PDFs are written by the server (service role) only.
    return not p_write and (public.is_admin() or public.is_guardian_of_family(v_fam));
  end if;
  return public.is_admin() or public.is_guardian_of_family(v_fam);
end $$;
revoke all on function public.forms_storage_access(text, text, boolean) from public, anon;
grant execute on function public.forms_storage_access(text, text, boolean) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('form-files', 'form-files', false)
      on conflict (id) do update set public = false;
    insert into storage.buckets (id, name, public) values ('contracts', 'contracts', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 10485760 where id in ('form-files', 'contracts')$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp','image/heic']
                 where id = 'form-files'$q$;
      execute $q$update storage.buckets set allowed_mime_types = array['application/pdf'] where id = 'contracts'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists form_files_select on storage.objects$p$;
    execute $p$create policy form_files_select on storage.objects for select to authenticated
      using (bucket_id = 'form-files' and public.forms_storage_access('form-files', name, false))$p$;
    execute $p$drop policy if exists form_files_insert on storage.objects$p$;
    execute $p$create policy form_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'form-files' and public.forms_storage_access('form-files', name, true))$p$;
    -- Uploaded evidence is append-only: no update / delete policies.
    execute $p$drop policy if exists form_files_update on storage.objects$p$;
    execute $p$drop policy if exists form_files_delete on storage.objects$p$;
    execute $p$drop policy if exists contracts_files_select on storage.objects$p$;
    execute $p$create policy contracts_files_select on storage.objects for select to authenticated
      using (bucket_id = 'contracts' and public.forms_storage_access('contracts', name, false))$p$;
    execute $p$drop policy if exists contracts_files_insert on storage.objects$p$;
    execute $p$drop policy if exists contracts_files_update on storage.objects$p$;
    execute $p$drop policy if exists contracts_files_delete on storage.objects$p$;
  end if;
end $$;
