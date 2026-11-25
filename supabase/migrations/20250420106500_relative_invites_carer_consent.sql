-- ============================================================================
-- Relatives for one child: e-mail invitations, carer consent, club messages
--
--   1. athlete_link_invitations: a family guardian of a child invites a
--      relative / friend by e-mail for THAT child only (relation + per-child
--      permissions). Hashed single-use token, 14-day expiry, cap of 10 pending
--      invitations per child and 20 new invitations per inviter per day.
--      Accepting (signed in, confirmed sign-in e-mail = invited e-mail)
--      creates the athlete_guardian_links row exactly like an approved
--      "This child only" link request (booker sync, audit). RLS on every verb
--      (read: inviter, the child's family guardians, admins; writes: RPCs).
--   2. Club setting app_settings.settings.privacy.carers_may_consent (default
--      OFF). New per-child permission can_consent (default false; grantable
--      only while the setting is ON). While ON, a linker with can_consent can
--      accept the activity consents of their own booking for the child
--      (linker_consent_accept): no guardian request is e-mailed, the consents
--      are recorded with accepted_by = linker and accepted_relation. Health /
--      medical forms need can_see_medical as well; COPPA (US, under 13) always
--      needs the family. OFF (or no can_consent): unchanged, the consent
--      request goes to the family's primary guardian. Turning the setting OFF
--      grants nothing: stored can_consent flags are ignored while OFF.
--   3. Club messages about one child reach active per-child linkers with
--      receives_emails: athlete_linked_recipients() is the single audience
--      helper (deduplicated against the child's family). Used by
--      bk_enqueue_notifications (training booking confirmations, reschedules,
--      cancellations), club_alert_recipients / club_alert_for_me (team,
--      programme, camp-week announcements; never 'all' / 'parents') and the
--      server-side notices (event changes, camp decisions, invoices to them).
--
-- Additive and idempotent. SYNTHETIC test data only (tests/db/relative_invites.sql).
-- ============================================================================

-- ===========================================================================
-- 1) Columns
-- ===========================================================================
alter table public.athlete_guardian_links add column if not exists can_consent boolean not null default false;

alter table public.guardian_consent_requests add column if not exists accepted_via text;
alter table public.guardian_consent_requests add column if not exists accepted_relation text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'guardian_consent_requests_accepted_via_chk') then
    alter table public.guardian_consent_requests add constraint guardian_consent_requests_accepted_via_chk
      check (accepted_via is null or accepted_via in ('guardian', 'linker'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'guardian_consent_requests_accepted_relation_chk') then
    alter table public.guardian_consent_requests add constraint guardian_consent_requests_accepted_relation_chk
      check (accepted_relation is null or accepted_relation in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer'));
  end if;
end $$;

-- Who consented when it was not a family guardian (null = family guardian / staff).
alter table public.consent_acceptances add column if not exists accepted_relation text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'consent_acceptances_accepted_relation_chk') then
    alter table public.consent_acceptances add constraint consent_acceptances_accepted_relation_chk
      check (accepted_relation is null or accepted_relation in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer'));
  end if;
end $$;

-- Booking notices to a per-child linker.
alter table public.booking_notifications drop constraint if exists booking_notifications_recipient_chk;
alter table public.booking_notifications add constraint booking_notifications_recipient_chk
  check (recipient_kind in ('payer', 'guardian', 'family', 'coach', 'player', 'admin', 'linked'));

-- ===========================================================================
-- 2) Invitations
-- ===========================================================================
create table if not exists public.athlete_link_invitations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  invited_by    uuid references public.profiles(id) on delete set null,
  email         citext not null,
  relation      text not null default 'other_carer',
  permissions   jsonb not null default '{}'::jsonb,
  token_hash    text,
  expires_at    timestamptz not null,
  status        text not null default 'pending',
  sent_count    integer not null default 1,
  last_sent_at  timestamptz not null default now(),
  accepted_by   uuid references public.profiles(id) on delete set null,
  accepted_at   timestamptz,
  link_id       uuid references public.athlete_guardian_links(id) on delete set null,
  revoked_by    uuid references public.profiles(id) on delete set null,
  revoked_at    timestamptz,
  request_id    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint athlete_link_invitations_status_chk check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint athlete_link_invitations_relation_chk check (relation in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer')),
  constraint athlete_link_invitations_email_chk check (length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint athlete_link_invitations_token_chk check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint athlete_link_invitations_perm_chk check (jsonb_typeof(permissions) = 'object')
);
create index if not exists idx_athlete_link_invitations_org on public.athlete_link_invitations(org_id);
create index if not exists idx_athlete_link_invitations_athlete on public.athlete_link_invitations(athlete_id, status);
create index if not exists idx_athlete_link_invitations_inviter on public.athlete_link_invitations(invited_by, created_at);
create unique index if not exists athlete_link_invitations_token_uidx on public.athlete_link_invitations(token_hash) where token_hash is not null;
create unique index if not exists athlete_link_invitations_pending_uidx
  on public.athlete_link_invitations(athlete_id, email) where status = 'pending';

drop trigger if exists trg_athlete_link_invitations_updated on public.athlete_link_invitations;
create trigger trg_athlete_link_invitations_updated before update on public.athlete_link_invitations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_athlete_link_invitations on public.athlete_link_invitations;
create trigger trg_audit_athlete_link_invitations after insert or update or delete on public.athlete_link_invitations
  for each row execute function public.ca_audit_trigger('token_hash');

alter table public.athlete_link_invitations enable row level security;
alter table public.athlete_link_invitations force row level security;
drop policy if exists platform_tenant_isolation on public.athlete_link_invitations;
create policy platform_tenant_isolation on public.athlete_link_invitations as restrictive for all
  using (org_id = (select public.current_org_id())) with check (org_id = (select public.current_org_id()));
drop policy if exists athlete_link_invitations_select on public.athlete_link_invitations;
create policy athlete_link_invitations_select on public.athlete_link_invitations for select
  using (invited_by = auth.uid()
         or public.is_guardian_of_athlete(athlete_id)
         or (org_id = public.current_org_id() and public.is_admin()));
drop policy if exists athlete_link_invitations_insert on public.athlete_link_invitations;
create policy athlete_link_invitations_insert on public.athlete_link_invitations for insert with check (false);
drop policy if exists athlete_link_invitations_update on public.athlete_link_invitations;
create policy athlete_link_invitations_update on public.athlete_link_invitations for update using (false) with check (false);
drop policy if exists athlete_link_invitations_delete on public.athlete_link_invitations;
create policy athlete_link_invitations_delete on public.athlete_link_invitations for delete using (false);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.athlete_link_invitations from anon;
    -- Column-level: the token hash is never readable through the API.
    revoke all on public.athlete_link_invitations from authenticated;
    grant select (id, org_id, athlete_id, invited_by, email, relation, permissions, expires_at, status, sent_count,
                  last_sent_at, accepted_by, accepted_at, link_id, revoked_by, revoked_at, created_at, updated_at)
      on public.athlete_link_invitations to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.athlete_link_invitations to service_role;
  end if;
end $$;

alter table public.athlete_guardian_links add column if not exists invitation_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'athlete_guardian_links_invitation_fk') then
    alter table public.athlete_guardian_links add constraint athlete_guardian_links_invitation_fk
      foreign key (invitation_id) references public.athlete_link_invitations(id) on delete set null;
  end if;
end $$;

-- ===========================================================================
-- 3) Helpers
-- ===========================================================================
-- Club setting: linked relatives may give activity consent (default OFF).
create or replace function public.org_carer_consent_enabled(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(s.settings->'privacy'->'carers_may_consent') = 'boolean'
                               then (s.settings->'privacy'->>'carers_may_consent')::boolean end
                     from public.app_settings s where s.org_id = p_org), false);
$$;

-- p_permission adds 'consent': can_consent counts only while the club setting is ON.
create or replace function public.athlete_link_can(p_athlete uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_athlete is not null and auth.uid() is not null and exists (
    select 1 from public.athlete_guardian_links l
      join public.athletes a on a.id = l.athlete_id
     where l.athlete_id = p_athlete and l.profile_id = auth.uid() and l.status = 'active'
       and l.org_id = public.current_org_id() and a.org_id = l.org_id
       and a.archived_at is null and a.merged_into_id is null and a.status not in ('erased', 'archived')
       and case p_permission
             when 'view' then true
             when 'register' then l.can_register
             when 'pay' then l.can_pay
             when 'medical' then l.can_see_medical
             when 'emails' then l.receives_emails
             when 'edit_profile' then l.can_edit_profile
             when 'consent' then l.can_consent and public.org_carer_consent_enabled(l.org_id)
             else false end);
$$;

-- A health / medical declaration (needs the family, or a linker with can_see_medical).
create or replace function public.gc_is_health_form(p_key text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(lower(p_key) ~ '(health|medical|medic|sante|gesundheit|salute)', false);
$$;

-- New value of can_consent for a grant / change: a NEW grant needs the setting ON.
create or replace function public.athlete_link_consent_value(p_org uuid, p_requested boolean, p_current boolean)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(p_requested, false) and not coalesce(p_current, false) and not public.org_carer_consent_enabled(p_org) then
    raise exception 'CARER_CONSENT_DISABLED' using errcode = 'P0001';
  end if;
  return coalesce(p_requested, p_current, false);
end $$;

-- Recipients of club messages about these children who are NOT in the child's
-- family: active per-child linkers with receives_emails, login active, not
-- suspended in the club, child live. Server / definer callers only.
create or replace function public.athlete_linked_recipients(p_org uuid, p_athletes uuid[])
returns table (athlete_id uuid, profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select distinct on (l.athlete_id, l.profile_id) l.athlete_id, l.profile_id, pf.email::text, pf.full_name
    from public.athlete_guardian_links l
    join public.athletes a on a.id = l.athlete_id and a.org_id = l.org_id
    join public.profiles pf on pf.id = l.profile_id and pf.is_active
   where l.org_id = p_org and l.athlete_id = any(coalesce(p_athletes, '{}'))
     and l.status = 'active' and l.receives_emails
     and a.archived_at is null and a.merged_into_id is null and a.status not in ('erased', 'archived')
     and not exists (select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = l.profile_id)
     and not exists (select 1 from public.org_memberships om
                      where om.profile_id = l.profile_id and om.org_id = l.org_id and om.status <> 'active')
   order by l.athlete_id, l.profile_id;
$$;

-- Service role: the same, for the server-side notices (event changes, camp decisions).
create or replace function public.athlete_linked_recipients_for(p_org uuid, p_athletes uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_service_caller() then raise exception 'NOT_ALLOWED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('athlete_id', r.athlete_id, 'profile_id', r.profile_id,
                                                       'email', r.email, 'name', r.full_name))
                     from public.athlete_linked_recipients(p_org, p_athletes) r), '[]'::jsonb);
end $$;

-- ===========================================================================
-- 4) Link decisions / updates / lists: can_consent
-- ===========================================================================
create or replace function public.participant_link_decide(p_request uuid, p_decision text, p_permissions jsonb default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r       public.athlete_link_requests%rowtype;
  v_staff boolean;
  v_guard boolean;
  v_fam   uuid;
  v_perm  jsonb;
  v_status text;
  v_scope text := coalesce(nullif(p_permissions->>'scope', ''), 'family');
  v_rel   text;
  v_link  uuid;
  v_cur   boolean;
begin
  select * into r from public.athlete_link_requests where id = p_request for update;
  if not found or r.org_id is distinct from public.current_org_id() then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  v_staff := public.is_admin();
  v_guard := public.is_guardian_of_athlete(r.athlete_id) and auth.uid() <> r.requester_profile_id;
  if not (v_staff or v_guard) then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if p_decision not in ('approve', 'decline') then raise exception 'INVALID_DECISION' using errcode = 'P0001'; end if;
  if v_scope not in ('family', 'athlete') then raise exception 'INVALID_SCOPE' using errcode = 'P0001'; end if;
  if p_note is not null and length(p_note) > 1000 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  select family_id into v_fam from public.athletes where id = r.athlete_id;
  if r.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', r.status, 'replayed', true, 'requester_profile_id', r.requester_profile_id);
  end if;
  if r.expires_at <= now() then
    update public.athlete_link_requests set status = 'expired' where id = r.id;
    return jsonb_build_object('ok', false, 'code', 'EXPIRED', 'status', 'expired');
  end if;

  if p_decision = 'approve' and v_scope = 'family' then
    v_perm := jsonb_build_object(
      'scope', 'family',
      'can_pay', coalesce((p_permissions->>'can_pay')::boolean, false),
      'can_see_medical', coalesce((p_permissions->>'can_see_medical')::boolean, false),
      'receives_emails', coalesce((p_permissions->>'receives_emails')::boolean, true));
    insert into public.family_members (family_id, profile_id, relation, is_primary, can_pay, can_see_medical, receives_emails)
    values (v_fam, r.requester_profile_id, case when r.relation in ('mother', 'father', 'guardian', 'grandparent') then r.relation when r.relation = 'other' then 'guardian' else 'other' end, false,
            (v_perm->>'can_pay')::boolean, (v_perm->>'can_see_medical')::boolean, (v_perm->>'receives_emails')::boolean)
    on conflict (family_id, profile_id) do nothing;
    for v_link in select id from public.athlete_guardian_links
                   where org_id = r.org_id and profile_id = r.requester_profile_id and status = 'active'
                     and athlete_id in (select id from public.athletes where family_id = v_fam) loop
      update public.athlete_guardian_links
         set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), revoke_reason = 'superseded by family access'
       where id = v_link;
      perform public.athlete_link_sync_booker(v_link);
    end loop;
    v_status := 'approved';
  elsif p_decision = 'approve' then
    v_rel := coalesce(nullif(p_permissions->>'relation', ''),
                      case when r.relation in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend') then r.relation else 'other_carer' end);
    if v_rel not in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer') then
      raise exception 'INVALID_RELATION' using errcode = 'P0001';
    end if;
    select id, can_consent into v_link, v_cur from public.athlete_guardian_links
     where athlete_id = r.athlete_id and profile_id = r.requester_profile_id and status = 'active';
    v_perm := jsonb_build_object(
      'scope', 'athlete', 'relation', v_rel,
      'can_register', coalesce((p_permissions->>'can_register')::boolean, true),
      'can_pay', coalesce((p_permissions->>'can_pay')::boolean, true),
      'can_see_medical', coalesce((p_permissions->>'can_see_medical')::boolean, false),
      'receives_emails', coalesce((p_permissions->>'receives_emails')::boolean, true),
      'can_edit_profile', coalesce((p_permissions->>'can_edit_profile')::boolean, false),
      'can_consent', public.athlete_link_consent_value(r.org_id, (p_permissions->>'can_consent')::boolean, coalesce(v_cur, false)));
    if (v_perm->>'can_register')::boolean and not (v_perm->>'can_pay')::boolean then
      raise exception 'REGISTER_NEEDS_PAY' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.family_members where family_id = v_fam and profile_id = r.requester_profile_id) then
      if v_link is null then
        insert into public.athlete_guardian_links
          (org_id, athlete_id, profile_id, relation, can_register, can_pay, can_see_medical, receives_emails, can_edit_profile,
           can_consent, granted_by, link_request_id)
        values (r.org_id, r.athlete_id, r.requester_profile_id, v_rel, (v_perm->>'can_register')::boolean,
                (v_perm->>'can_pay')::boolean, (v_perm->>'can_see_medical')::boolean, (v_perm->>'receives_emails')::boolean,
                (v_perm->>'can_edit_profile')::boolean, (v_perm->>'can_consent')::boolean, auth.uid(), r.id)
        returning id into v_link;
      else
        update public.athlete_guardian_links
           set relation = v_rel, can_register = (v_perm->>'can_register')::boolean, can_pay = (v_perm->>'can_pay')::boolean,
               can_see_medical = (v_perm->>'can_see_medical')::boolean, receives_emails = (v_perm->>'receives_emails')::boolean,
               can_edit_profile = (v_perm->>'can_edit_profile')::boolean, can_consent = (v_perm->>'can_consent')::boolean,
               link_request_id = r.id
         where id = v_link;
      end if;
      perform public.athlete_link_sync_booker(v_link);
    end if;
    v_status := 'approved';
  else
    v_status := 'declined';
  end if;
  update public.athlete_link_requests
     set status = v_status, decided_by = auth.uid(), decided_at = now(),
         decided_via = case when v_guard then 'guardian' else 'staff' end,
         granted_permissions = v_perm, decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  update public.data_review_flags set resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_status
   where org_id = r.org_id and entity_table = 'athlete_link_requests' and entity_id = r.id and resolved_at is null;
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
  values (r.org_id, auth.uid(), 'participant.link.' || v_status, 'athlete_link_requests', r.id,
          jsonb_build_object('athlete_id', r.athlete_id, 'family_id', v_fam, 'requester_profile_id', r.requester_profile_id,
                             'permissions', v_perm, 'scope', v_scope, 'link_id', v_link,
                             'via', case when v_guard then 'guardian' else 'staff' end));
  return jsonb_build_object('ok', true, 'status', v_status, 'replayed', false, 'scope', v_scope,
                            'requester_profile_id', r.requester_profile_id);
end $$;

create or replace function public.athlete_link_update(p_link uuid, p_permissions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare l public.athlete_guardian_links%rowtype; v_new public.athlete_guardian_links%rowtype; v_rel text; v_consent boolean;
begin
  select * into l from public.athlete_guardian_links where id = p_link for update;
  if not found or l.org_id is distinct from public.current_org_id()
     or not (public.is_admin() or public.is_guardian_of_athlete(l.athlete_id)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if l.status <> 'active' then raise exception 'LINK_NOT_ACTIVE' using errcode = 'P0001'; end if;
  v_rel := coalesce(nullif(p_permissions->>'relation', ''), l.relation);
  if v_rel not in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer') then
    raise exception 'INVALID_RELATION' using errcode = 'P0001';
  end if;
  if coalesce((p_permissions->>'can_register')::boolean, l.can_register)
     and not coalesce((p_permissions->>'can_pay')::boolean, l.can_pay) then
    raise exception 'REGISTER_NEEDS_PAY' using errcode = 'P0001';
  end if;
  v_consent := public.athlete_link_consent_value(l.org_id, (p_permissions->>'can_consent')::boolean, l.can_consent);
  update public.athlete_guardian_links
     set relation = v_rel,
         can_register = coalesce((p_permissions->>'can_register')::boolean, can_register),
         can_pay = coalesce((p_permissions->>'can_pay')::boolean, can_pay),
         can_see_medical = coalesce((p_permissions->>'can_see_medical')::boolean, can_see_medical),
         receives_emails = coalesce((p_permissions->>'receives_emails')::boolean, receives_emails),
         can_edit_profile = coalesce((p_permissions->>'can_edit_profile')::boolean, can_edit_profile),
         can_consent = v_consent
   where id = l.id
  returning * into v_new;
  perform public.athlete_link_sync_booker(l.id);
  perform public.ca_audit(l.org_id, 'participant.link.permissions', 'athlete_guardian_links', l.id,
    jsonb_build_object('athlete_id', l.athlete_id, 'profile_id', l.profile_id,
      'before', jsonb_build_object('relation', l.relation, 'can_register', l.can_register, 'can_pay', l.can_pay,
                                   'can_see_medical', l.can_see_medical, 'receives_emails', l.receives_emails,
                                   'can_edit_profile', l.can_edit_profile, 'can_consent', l.can_consent),
      'after', jsonb_build_object('relation', v_new.relation, 'can_register', v_new.can_register, 'can_pay', v_new.can_pay,
                                  'can_see_medical', v_new.can_see_medical, 'receives_emails', v_new.receives_emails,
                                  'can_edit_profile', v_new.can_edit_profile, 'can_consent', v_new.can_consent)));
  return jsonb_build_object('ok', true, 'id', l.id);
end $$;

create or replace function public.athlete_links_for(p_athlete uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null
     or not exists (select 1 from public.athletes where id = p_athlete and org_id = v_org)
     or not (public.is_admin() or public.is_guardian_of_athlete(p_athlete)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'athlete_id', l.athlete_id, 'profile_id', l.profile_id, 'name', p.full_name, 'email', p.email,
             'relation', l.relation, 'status', l.status, 'can_register', l.can_register, 'can_pay', l.can_pay,
             'can_see_medical', l.can_see_medical, 'receives_emails', l.receives_emails, 'can_edit_profile', l.can_edit_profile,
             'can_consent', l.can_consent, 'via_invitation', l.invitation_id is not null,
             'granted_at', l.granted_at, 'revoked_at', l.revoked_at) order by l.status, l.granted_at desc)
      from public.athlete_guardian_links l join public.profiles p on p.id = l.profile_id
     where l.athlete_id = p_athlete and l.org_id = v_org), '[]'::jsonb);
end $$;

create or replace function public.athlete_links_mine_to_manage()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'athlete_id', l.athlete_id, 'athlete_first_name', a.first_name, 'name', p.full_name, 'email', p.email,
           'relation', l.relation, 'can_register', l.can_register, 'can_pay', l.can_pay, 'can_see_medical', l.can_see_medical,
           'receives_emails', l.receives_emails, 'can_edit_profile', l.can_edit_profile, 'can_consent', l.can_consent,
           'via_invitation', l.invitation_id is not null, 'granted_at', l.granted_at)
           order by a.first_name, l.granted_at), '[]'::jsonb)
    from public.athlete_guardian_links l
    join public.athletes a on a.id = l.athlete_id
    join public.profiles p on p.id = l.profile_id
   where l.org_id = public.current_org_id() and l.status = 'active'
     and public.is_guardian_of_athlete(l.athlete_id);
$$;

-- Whether the club lets linked relatives consent (for the forms; no data).
create or replace function public.carer_consent_setting()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and public.current_org_id() is not null and public.org_carer_consent_enabled(public.current_org_id());
$$;

-- ===========================================================================
-- 5) Invitation RPCs
-- ===========================================================================
-- Lazy expiry of one invitation (or all due ones).
create or replace function public.ali_expire_due(p_invitation uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.athlete_link_invitations set status = 'expired'
   where status = 'pending' and expires_at <= now() and (p_invitation is null or id = p_invitation);
  get diagnostics n = row_count;
  return n;
end $$;

-- payload = { email, relation, can_register?, can_pay?, can_see_medical?,
--             receives_emails?, can_edit_profile?, can_consent? }
-- A pending invitation of the same child + e-mail is re-sent (new token).
create or replace function public.athlete_link_invite_create(p_athlete uuid, p_payload jsonb, p_token_hash text, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  a       public.athletes%rowtype;
  v_email citext := lower(btrim(coalesce(p_payload->>'email', '')))::citext;
  v_rel   text := coalesce(nullif(btrim(coalesce(p_payload->>'relation', '')), ''), 'other_carer');
  v_perm  jsonb;
  v_id    uuid;
  v_res   jsonb;
  v_resent boolean := false;
begin
  if v_me is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'link_invite');
  if v_rep is not null then return v_rep; end if;
  select * into a from public.athletes where id = p_athlete and org_id = v_org;
  if not found or a.archived_at is not null or a.merged_into_id is not null or a.status in ('erased', 'archived')
     or not public.is_guardian_of_athlete(p_athlete) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'TOKEN_REQUIRED' using errcode = 'P0001'; end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL' using errcode = 'P0001'; end if;
  if v_rel not in ('aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend', 'other_carer') then
    raise exception 'INVALID_RELATION' using errcode = 'P0001';
  end if;
  if v_email = public.gc_auth_email() or v_email = (select lower(email::text)::citext from public.profiles where id = v_me) then
    raise exception 'CANNOT_INVITE_SELF' using errcode = 'P0001';
  end if;
  -- Already in the child's family, or already linked to this child.
  if exists (select 1 from public.family_members fm
               join public.profiles p on p.id = fm.profile_id
               left join auth.users u on u.id = p.id
              where fm.family_id = a.family_id
                and (lower(p.email::text) = v_email::text or lower(u.email::text) = v_email::text)) then
    raise exception 'ALREADY_GUARDIAN' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.athlete_guardian_links l
               join public.profiles p on p.id = l.profile_id
               left join auth.users u on u.id = p.id
              where l.athlete_id = a.id and l.status = 'active'
                and (lower(p.email::text) = v_email::text or lower(u.email::text) = v_email::text)) then
    raise exception 'ALREADY_LINKED' using errcode = 'P0001';
  end if;

  v_perm := jsonb_build_object(
    'can_register', coalesce((p_payload->>'can_register')::boolean, true),
    'can_pay', coalesce((p_payload->>'can_pay')::boolean, true),
    'can_see_medical', coalesce((p_payload->>'can_see_medical')::boolean, false),
    'receives_emails', coalesce((p_payload->>'receives_emails')::boolean, true),
    'can_edit_profile', coalesce((p_payload->>'can_edit_profile')::boolean, false),
    'can_consent', public.athlete_link_consent_value(v_org, (p_payload->>'can_consent')::boolean, false));
  if (v_perm->>'can_register')::boolean and not (v_perm->>'can_pay')::boolean then
    raise exception 'REGISTER_NEEDS_PAY' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(a.id::text || ':link_invite', 0));
  perform public.ali_expire_due(null);
  select id into v_id from public.athlete_link_invitations
   where athlete_id = a.id and email = v_email and status = 'pending' for update;
  if v_id is not null then
    update public.athlete_link_invitations
       set token_hash = p_token_hash, relation = v_rel, permissions = v_perm, invited_by = v_me,
           expires_at = now() + interval '14 days', sent_count = sent_count + 1, last_sent_at = now()
     where id = v_id;
    v_resent := true;
  else
    if (select count(*) from public.athlete_link_invitations where athlete_id = a.id and status = 'pending') >= 10 then
      raise exception 'INVITE_LIMIT' using errcode = 'P0001';
    end if;
    if (select count(*) from public.athlete_link_invitations
         where invited_by = v_me and org_id = v_org and created_at > now() - interval '1 day') >= 20 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
    insert into public.athlete_link_invitations (org_id, athlete_id, invited_by, email, relation, permissions, token_hash,
                                                 expires_at, request_id)
    values (v_org, a.id, v_me, v_email, v_rel, v_perm, p_token_hash, now() + interval '14 days', p_request_id)
    returning id into v_id;
  end if;
  perform public.ca_audit(v_org, case when v_resent then 'participant.link.invite_resent' else 'participant.link.invite_created' end,
                          'athlete_link_invitations', v_id,
                          jsonb_build_object('athlete_id', a.id, 'relation', v_rel, 'permissions', v_perm,
                                             'email_hint', public.gc_mask_email(v_email)));
  v_res := jsonb_build_object('ok', true, 'invitation_id', v_id, 'resent', v_resent,
                              'expires_at', (select expires_at from public.athlete_link_invitations where id = v_id));
  return public.bk_remember(p_request_id, 'link_invite', v_res);
end $$;

-- Revoke a pending invitation: the inviter, a family guardian of the child, or an admin.
create or replace function public.athlete_link_invite_revoke(p_invitation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare i public.athlete_link_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into i from public.athlete_link_invitations where id = p_invitation for update;
  if not found or i.org_id is distinct from public.current_org_id()
     or not (i.invited_by = auth.uid() or public.is_guardian_of_athlete(i.athlete_id) or public.is_admin()) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.ali_expire_due(i.id);
  select * into i from public.athlete_link_invitations where id = i.id;
  if i.status = 'revoked' then return jsonb_build_object('ok', true, 'status', 'revoked', 'replayed', true); end if;
  if i.status <> 'pending' then raise exception 'INVITE_NOT_PENDING' using errcode = 'P0001'; end if;
  update public.athlete_link_invitations
     set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), token_hash = null
   where id = i.id;
  perform public.ca_audit(i.org_id, 'participant.link.invite_revoked', 'athlete_link_invitations', i.id,
    jsonb_build_object('athlete_id', i.athlete_id,
                       'via', case when public.is_guardian_of_athlete(i.athlete_id) or i.invited_by = auth.uid() then 'guardian' else 'staff' end));
  return jsonb_build_object('ok', true, 'status', 'revoked', 'replayed', false);
end $$;

-- Invitations of one child (family guardians of the child, admins): recent first.
create or replace function public.athlete_link_invites_for(p_athlete uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_org uuid := public.current_org_id();
begin
  if auth.uid() is null or v_org is null
     or not exists (select 1 from public.athletes where id = p_athlete and org_id = v_org)
     or not (public.is_admin() or public.is_guardian_of_athlete(p_athlete)) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public.ali_expire_due(null);
  return coalesce((
    select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object(
               'id', i.id, 'athlete_id', i.athlete_id, 'email', i.email, 'relation', i.relation, 'permissions', i.permissions,
               'status', i.status, 'expires_at', i.expires_at, 'created_at', i.created_at, 'last_sent_at', i.last_sent_at,
               'invited_by_name', (select full_name from public.profiles where id = i.invited_by),
               'accepted_at', i.accepted_at) x
        from public.athlete_link_invitations i
       where i.athlete_id = p_athlete and i.org_id = v_org
       order by i.created_at desc limit 50) t), '[]'::jsonb);
end $$;

-- Pending invitations over every child the caller guards (parent family page).
create or replace function public.athlete_link_invites_mine_to_manage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.current_org_id() is null then return '[]'::jsonb; end if;
  perform public.ali_expire_due(null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'athlete_id', i.athlete_id, 'athlete_first_name', a.first_name, 'email', i.email,
             'relation', i.relation, 'permissions', i.permissions, 'status', i.status, 'expires_at', i.expires_at,
             'created_at', i.created_at, 'invited_by_name', (select full_name from public.profiles where id = i.invited_by))
             order by a.first_name, i.created_at desc)
      from public.athlete_link_invitations i join public.athletes a on a.id = i.athlete_id
     where i.org_id = public.current_org_id() and i.status = 'pending'
       and public.is_guardian_of_athlete(i.athlete_id)), '[]'::jsonb);
end $$;

-- What the invitation page shows to the holder of the link: club, the
-- child's FIRST name, relation, inviter's name, permissions, masked e-mail.
-- Signed in, or the server with the service role after hashing the token.
create or replace function public.athlete_link_invite_view(p_token_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare i public.athlete_link_invitations%rowtype; o public.organizations%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('found', false); end if;
  select * into i from public.athlete_link_invitations where token_hash = p_token_hash;
  if not found then return jsonb_build_object('found', false); end if;
  perform public.ali_expire_due(i.id);
  select * into i from public.athlete_link_invitations where id = i.id;
  select * into o from public.organizations where id = i.org_id;
  return jsonb_build_object(
    'found', true, 'status', i.status, 'expires_at', i.expires_at,
    'club', jsonb_build_object('name', o.name, 'slug', o.slug),
    'child_first_name', (select first_name from public.athletes where id = i.athlete_id),
    'relation', i.relation,
    'inviter_name', (select full_name from public.profiles where id = i.invited_by),
    'permissions', i.permissions - case when public.org_carer_consent_enabled(i.org_id) then '' else 'can_consent' end,
    'email_hint', public.gc_mask_email(i.email),
    'accepted_by_me', i.status = 'accepted' and i.accepted_by is not null and i.accepted_by = auth.uid());
end $$;

-- Accept (signed in). The caller's CONFIRMED sign-in e-mail must be the
-- invited e-mail. Creates (or refreshes) the per-child link with the chosen
-- permissions; single use; expired / revoked refused; idempotent replay.
create or replace function public.athlete_link_invite_accept(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  i      public.athlete_link_invitations%rowtype;
  a      public.athletes%rowtype;
  v_link uuid;
  v_perm jsonb;
  v_consent boolean;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  select * into i from public.athlete_link_invitations where token_hash = p_token_hash for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.ali_expire_due(i.id);
  select * into i from public.athlete_link_invitations where id = i.id;
  if i.status = 'accepted' then
    if i.accepted_by = v_me then
      return jsonb_build_object('ok', true, 'replayed', true, 'status', 'accepted', 'org_id', i.org_id,
                                'athlete_id', i.athlete_id, 'link_id', i.link_id,
                                'club_slug', (select slug from public.organizations where id = i.org_id),
                                'is_current_org', (select org_id from public.profiles where id = v_me) = i.org_id);
    end if;
    raise exception 'INVITE_USED' using errcode = 'P0001';
  end if;
  if i.status = 'expired' then raise exception 'EXPIRED' using errcode = 'P0001'; end if;
  if i.status <> 'pending' then raise exception 'INVITE_NOT_PENDING' using errcode = 'P0001'; end if;
  if public.gc_auth_email() is distinct from i.email then raise exception 'EMAIL_MISMATCH' using errcode = '42501'; end if;
  if v_me = i.invited_by then raise exception 'CANNOT_INVITE_SELF' using errcode = 'P0001'; end if;
  select * into a from public.athletes where id = i.athlete_id and org_id = i.org_id;
  if not found or a.archived_at is not null or a.merged_into_id is not null or a.status in ('erased', 'archived') then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.family_members where family_id = a.family_id and profile_id = v_me) then
    raise exception 'ALREADY_GUARDIAN' using errcode = 'P0001';
  end if;

  -- A login of the club (guest family when the relative has none: same as /join).
  perform public.gc_family_bootstrap(v_me, i.org_id);

  v_perm := i.permissions;
  -- can_consent is a new grant: only while the club setting is ON.
  v_consent := coalesce((v_perm->>'can_consent')::boolean, false) and public.org_carer_consent_enabled(i.org_id);
  select id into v_link from public.athlete_guardian_links
   where athlete_id = a.id and profile_id = v_me and status = 'active' for update;
  if v_link is null then
    insert into public.athlete_guardian_links
      (org_id, athlete_id, profile_id, relation, can_register, can_pay, can_see_medical, receives_emails, can_edit_profile,
       can_consent, granted_by, invitation_id)
    values (i.org_id, a.id, v_me, i.relation, coalesce((v_perm->>'can_register')::boolean, true),
            coalesce((v_perm->>'can_pay')::boolean, true), coalesce((v_perm->>'can_see_medical')::boolean, false),
            coalesce((v_perm->>'receives_emails')::boolean, true), coalesce((v_perm->>'can_edit_profile')::boolean, false),
            v_consent, i.invited_by, i.id)
    returning id into v_link;
  else
    update public.athlete_guardian_links
       set relation = i.relation, can_register = coalesce((v_perm->>'can_register')::boolean, true),
           can_pay = coalesce((v_perm->>'can_pay')::boolean, true),
           can_see_medical = coalesce((v_perm->>'can_see_medical')::boolean, false),
           receives_emails = coalesce((v_perm->>'receives_emails')::boolean, true),
           can_edit_profile = coalesce((v_perm->>'can_edit_profile')::boolean, false),
           can_consent = v_consent, invitation_id = i.id
     where id = v_link;
  end if;
  perform public.athlete_link_sync_booker(v_link);

  update public.athlete_link_invitations
     set status = 'accepted', accepted_by = v_me, accepted_at = now(), link_id = v_link, token_hash = null
   where id = i.id;
  perform public.ca_audit(i.org_id, 'participant.link.invite_accepted', 'athlete_link_invitations', i.id,
    jsonb_build_object('athlete_id', a.id, 'profile_id', v_me, 'link_id', v_link, 'relation', i.relation,
                       'permissions', v_perm || jsonb_build_object('can_consent', v_consent), 'invited_by', i.invited_by));
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'accepted', 'org_id', i.org_id, 'athlete_id', a.id,
                            'link_id', v_link, 'club_slug', (select slug from public.organizations where id = i.org_id),
                            'is_current_org', (select org_id from public.profiles where id = v_me) = i.org_id);
end $$;

-- ===========================================================================
-- 6) Carer consent
-- ===========================================================================
-- Can this adult (a per-child linker of the athlete) consent to these forms?
-- { allowed, reason, can_medical, relation }. reason: NOT_LINKED |
-- CARER_CONSENT_DISABLED | NO_CONSENT_PERMISSION | COPPA_GUARDIAN_REQUIRED |
-- HEALTH_NEEDS_GUARDIAN.
create or replace function public.lc_eval(p_org uuid, p_athlete uuid, p_profile uuid, p_forms jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.athlete_guardian_links%rowtype; a public.athletes%rowtype;
begin
  select * into a from public.athletes where id = p_athlete and org_id = p_org;
  select * into l from public.athlete_guardian_links
   where org_id = p_org and athlete_id = p_athlete and profile_id = p_profile and status = 'active';
  if l.id is null or a.id is null or a.archived_at is not null or a.merged_into_id is not null or a.status in ('erased', 'archived')
     or exists (select 1 from public.family_members fm where fm.family_id = a.family_id and fm.profile_id = p_profile) then
    return jsonb_build_object('allowed', false, 'reason', 'NOT_LINKED');
  end if;
  if not public.org_carer_consent_enabled(p_org) then
    return jsonb_build_object('allowed', false, 'reason', 'CARER_CONSENT_DISABLED');
  end if;
  if not l.can_consent then
    return jsonb_build_object('allowed', false, 'reason', 'NO_CONSENT_PERMISSION');
  end if;
  if public.org_requires_vpc(p_org) and (a.dob is null or a.dob > (current_date - interval '13 years')) then
    return jsonb_build_object('allowed', false, 'reason', 'COPPA_GUARDIAN_REQUIRED');
  end if;
  if not l.can_see_medical and exists (select 1 from jsonb_array_elements(coalesce(p_forms, '[]'::jsonb)) f
                                        where (f->>'required')::boolean and public.gc_is_health_form(f->>'key')) then
    return jsonb_build_object('allowed', false, 'reason', 'HEALTH_NEEDS_GUARDIAN', 'can_medical', false, 'relation', l.relation);
  end if;
  return jsonb_build_object('allowed', true, 'can_medical', l.can_see_medical, 'relation', l.relation);
end $$;

-- Forms with per-form flags for the linker's consent UI.
create or replace function public.lc_forms(p_forms jsonb, p_can_medical boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', f->>'key', 'title', f->>'title', 'version', (f->>'version')::int,
                                               'required', (f->>'required')::boolean,
                                               'health', public.gc_is_health_form(f->>'key'),
                                               'allowed', coalesce(p_can_medical, false) or not public.gc_is_health_form(f->>'key'),
                                               'body', (select cf.body from public.consent_forms cf where cf.id = (f->>'id')::uuid))
                            order by f->>'key'), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_forms, '[]'::jsonb)) f;
$$;

-- Before booking: may the signed-in linker consent for this child? (current club's forms)
create or replace function public.linker_consent_status(p_athlete uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); v_forms jsonb; e jsonb;
begin
  if auth.uid() is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  v_forms := public.gc_consent_forms(v_org);
  e := public.lc_eval(v_org, p_athlete, auth.uid(), v_forms);
  return jsonb_build_object('enabled', public.org_carer_consent_enabled(v_org), 'can_consent', (e->>'allowed')::boolean,
                            'reason', e->>'reason',
                            'forms', case when (e->>'allowed')::boolean then public.lc_forms(v_forms, (e->>'can_medical')::boolean) else '[]'::jsonb end);
end $$;

-- The caller's pending requests they may consent to themselves.
create or replace function public.linker_consent_pending()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_org_id(); r record; e jsonb; v_out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or v_org is null then return '[]'::jsonb; end if;
  perform public.gc_expire_due(null);
  for r in select * from public.guardian_consent_requests
            where org_id = v_org and booker_profile_id = auth.uid() and status = 'pending' and existing_child
              and (cardinality(registration_ids) > 0 or cardinality(booking_ids) > 0) loop
    e := public.lc_eval(v_org, r.athlete_id, auth.uid(), r.consent_forms);
    if (e->>'allowed')::boolean then
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'request_id', r.id, 'expires_at', r.expires_at,
        'forms', public.lc_forms(r.consent_forms, (e->>'can_medical')::boolean)));
    end if;
  end loop;
  return v_out;
end $$;

-- The linker accepts the consents of their own held booking for the child.
-- Same effects as guardian_consent_accept for an existing child (consents
-- recorded, held places proceed, invoice to the linker), with accepted_by =
-- linker and accepted_relation. payload = { accepted_keys: [key] }.
create or replace function public.linker_consent_accept(p_request uuid, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  r       public.guardian_consent_requests%rowtype;
  a       public.athletes%rowtype;
  e       jsonb;
  v_rel   text;
  v_keys  text[];
  f       jsonb;
  g       public.registrations%rowtype;
  v_prog  public.programs%rowtype;
  v_ed    public.camp_editions%rowtype;
  v_band  text;
  v_age   int;
  v_inv   uuid;
  v_invnum text;
  v_desc  text;
  v_payer uuid;
  v_bname text;
  v_first_program uuid;
  b       record;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  select * into r from public.guardian_consent_requests
   where id = p_request and booker_profile_id = v_me and org_id = public.current_org_id() for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.gc_expire_due(r.id);
  select * into r from public.guardian_consent_requests where id = r.id;
  if r.status = 'accepted' and r.accepted_by = v_me then
    return jsonb_build_object('ok', true, 'replayed', true, 'status', 'accepted', 'request_id', r.id, 'items', public.gc_items(r));
  end if;
  if r.status = 'expired' then raise exception 'EXPIRED' using errcode = 'P0001'; end if;
  if r.status <> 'pending' then raise exception 'CONSENT_NOT_PENDING' using errcode = 'P0001'; end if;
  if not r.existing_child then raise exception 'NOT_LINKED' using errcode = '42501'; end if;
  e := public.lc_eval(r.org_id, r.athlete_id, v_me, r.consent_forms);
  if not (e->>'allowed')::boolean then raise exception '%', e->>'reason' using errcode = '42501'; end if;
  v_rel := e->>'relation';

  select coalesce(array_agg(distinct k), '{}') into v_keys
    from jsonb_array_elements_text(coalesce(p_payload->'accepted_keys', '[]'::jsonb)) k;
  -- Only forms of the request count.
  select coalesce(array_agg(k), '{}') into v_keys from unnest(v_keys) k
   where exists (select 1 from jsonb_array_elements(r.consent_forms) f2 where f2->>'key' = k);
  if exists (select 1 from jsonb_array_elements(r.consent_forms) f2
              where (f2->>'required')::boolean and not ((f2->>'key') = any(v_keys))) then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001';
  end if;
  if not coalesce((e->>'can_medical')::boolean, false) and exists (select 1 from unnest(v_keys) k where public.gc_is_health_form(k)) then
    raise exception 'HEALTH_NEEDS_GUARDIAN' using errcode = '42501';
  end if;

  select * into a from public.athletes where id = r.athlete_id and org_id = r.org_id;
  select program_id into v_first_program from public.registrations where id = any(r.registration_ids) order by created_at limit 1;
  for f in select * from jsonb_array_elements(r.consent_forms) loop
    if (f->>'key') = any(v_keys) then
      insert into public.consent_acceptances (org_id, athlete_id, consent_form_id, accepted_version, status, program_id,
                                              accepted_by, accepted_relation)
      values (r.org_id, a.id, (f->>'id')::uuid, (f->>'version')::int, 'accepted', v_first_program, v_me, v_rel);
    end if;
  end loop;

  -- The held bookings proceed under the existing rules (as guardian_consent_accept).
  v_payer := public.gc_booker_payer(r.org_id, r.booker_profile_id);
  select full_name into v_bname from public.profiles where id = r.booker_profile_id;
  perform set_config('app.gc_internal', 'on', true);
  perform set_config('app.camp_pricing', 'on', true);
  perform set_config('app.camp_approval', 'on', true);
  for g in select * from public.registrations
            where id = any(r.registration_ids) and org_id = r.org_id and guardian_consent_status = 'awaiting'
              and status = 'pending' for update loop
    select * into v_prog from public.programs where id = g.program_id;
    select * into v_ed from public.camp_editions where id = g.camp_edition_id;
    v_age := public.camp_age_on_start(a.dob, v_ed.starts_on);
    v_band := public.camp_age_band(v_age, v_prog.min_age, v_prog.max_age, v_prog.approval_age_min, v_prog.approval_age_max);
    if v_band = 'approval' then
      update public.registrations
         set status = 'pending_approval', approval_status = 'pending', approval_request_id = gen_random_uuid(),
             approval_requested_at = now(), approval_age = v_age, guardian_consent_status = 'accepted'
       where id = g.id;
    elsif v_band in ('too_young', 'too_old') then
      update public.registrations
         set status = 'cancelled', cancelled_at = now(), cancellation_reason = 'AGE_OUT_OF_RANGE', guardian_consent_status = 'accepted'
       where id = g.id;
    elsif coalesce(g.price_amount, 0) > 0 then
      v_invnum := public.next_invoice_number(r.org_id);
      insert into public.invoices (org_id, number, family_id, athlete_id, program_id, registration_id, description, status,
                                   due_date, currency, total_chf, payer_id, payer_kind, payer_profile_id, payer_name)
      values (r.org_id, v_invnum, a.family_id, a.id, g.program_id, g.id, left(v_prog.name, 500), 'sent',
              public.ca_org_today(r.org_id) + 14, g.price_currency, g.price_amount, v_payer, 'other', r.booker_profile_id,
              left(v_bname, 140))
      returning id into v_inv;
      v_desc := v_prog.name || coalesce(' — ' || (g.price_snapshot->>'option_label'), '') || ' — ' || a.first_name || ' ' || a.last_name;
      insert into public.invoice_items (org_id, invoice_id, description, quantity, unit_price_chf, amount_chf)
      values (r.org_id, v_inv, left(v_desc, 500), 1, g.price_list_amount, g.price_list_amount);
      update public.registrations set invoice_id = v_inv, guardian_consent_status = 'accepted' where id = g.id;
    else
      update public.registrations set status = 'confirmed', guardian_consent_status = 'accepted' where id = g.id;
    end if;
  end loop;
  perform set_config('app.camp_approval', 'off', true);
  perform set_config('app.camp_pricing', 'off', true);
  perform set_config('app.bk_internal', 'on', true);
  for b in select id from public.training_bookings
            where id = any(r.booking_ids) and org_id = r.org_id and guardian_consent_status = 'awaiting' loop
    update public.training_bookings set guardian_consent_status = 'accepted' where id = b.id;
    perform public.bk_enqueue_notifications(b.id, 'requested');
  end loop;
  perform set_config('app.bk_internal', '', true);
  perform set_config('app.gc_internal', '', true);

  update public.guardian_consent_requests
     set status = 'accepted', accepted_by = v_me, accepted_at = now(), accepted_keys = v_keys,
         accepted_via = 'linker', accepted_relation = v_rel, token_hash = null, outcome_notified_at = now()
   where id = r.id;
  perform public.ca_audit(r.org_id, 'guardian_consent.accepted_by_carer', 'guardian_consent_requests', r.id,
                          jsonb_build_object('athlete_id', a.id, 'keys', to_jsonb(v_keys), 'relation', v_rel, 'carer_profile_id', v_me));
  select * into r from public.guardian_consent_requests where id = r.id;
  return jsonb_build_object('ok', true, 'replayed', false, 'status', 'accepted', 'request_id', r.id,
                            'athlete_id', a.id, 'relation', v_rel, 'items', public.gc_items(r));
end $$;

-- The linker asks the family after all (a new e-mailed token for the pending request).
create or replace function public.linker_consent_ask_family(p_request uuid, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.guardian_consent_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'TOKEN_REQUIRED' using errcode = 'P0001'; end if;
  select * into r from public.guardian_consent_requests
   where id = p_request and booker_profile_id = auth.uid() and org_id = public.current_org_id() for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  perform public.gc_expire_due(r.id);
  select * into r from public.guardian_consent_requests where id = r.id;
  if r.status <> 'pending' then raise exception 'CONSENT_NOT_PENDING' using errcode = 'P0001'; end if;
  update public.guardian_consent_requests set token_hash = p_token_hash, token_issued_at = now() where id = r.id;
  perform public.ca_audit(r.org_id, 'guardian_consent.asked_family', 'guardian_consent_requests', r.id, null);
  return jsonb_build_object('ok', true, 'request_id', r.id);
end $$;

-- ===========================================================================
-- 7) Club messages: linked relatives of the children concerned
-- ===========================================================================
-- Children in a team / programme / camp week (same rule as the alert audience).
create or replace function public.msg_scope_athletes(p_org uuid, p_team uuid, p_program uuid, p_edition uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select a.id from public.athletes a
   where a.org_id = p_org and (
     (p_team is not null and exists (select 1 from public.team_memberships tm where tm.team_id = p_team and tm.athlete_id = a.id and tm.status <> 'inactive'))
     or (p_program is not null and exists (select 1 from public.registrations r where r.program_id = p_program and r.athlete_id = a.id and r.status <> 'cancelled'))
     or (p_edition is not null and exists (select 1 from public.registrations r where r.camp_edition_id = p_edition and r.athlete_id = a.id and r.status <> 'cancelled')));
$$;

-- The signed-in adult is a receiving linker of a child in that scope.
create or replace function public.msg_scope_linker(p_team uuid, p_program uuid, p_edition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.athlete_linked_recipients(
             public.current_org_id(),
             array(select public.msg_scope_athletes(public.current_org_id(), p_team, p_program, p_edition))) r
     where r.profile_id = auth.uid());
$$;

create or replace function public.club_alert_for_me(p_audience text, p_team uuid, p_program uuid, p_edition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_audience
    when 'all'     then public.is_staff() or public.msg_profile_is_guardian(public.current_org_id(), auth.uid())
    when 'staff'   then public.is_staff()
    when 'parents' then public.msg_profile_is_guardian(public.current_org_id(), auth.uid())
    else public.msg_scope_staff(p_team, p_program, p_edition) or public.msg_scope_guardian(p_team, p_program, p_edition)
         or public.msg_scope_linker(p_team, p_program, p_edition)
  end;
$$;

create or replace function public.club_alert_recipients(p_alert uuid)
returns table (profile_id uuid)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_a public.club_alerts%rowtype;
begin
  if not public.staff_is_service_caller() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  select * into v_a from public.club_alerts where id = p_alert;
  if not found then return; end if;
  return query
    with staff as (select distinct sr.profile_id from public.staff_roles sr where sr.org_id = v_a.org_id),
    guardians as (
      select distinct fm.profile_id from public.family_members fm join public.families f on f.id = fm.family_id
       where f.org_id = v_a.org_id),
    scoped_staff as (
      select distinct co.profile_id from public.coaches co
       where co.org_id = v_a.org_id and co.profile_id is not null and (
         (v_a.team_id is not null and exists (select 1 from public.team_coaches tc where tc.team_id = v_a.team_id and tc.coach_id = co.id))
         or (v_a.program_id is not null and exists (select 1 from public.program_sessions ps where ps.program_id = v_a.program_id and ps.coach_id = co.id))
         or (v_a.camp_edition_id is not null and exists (
               select 1 from public.program_sessions ps join public.camp_editions e on e.program_id = ps.program_id
                where e.id = v_a.camp_edition_id and ps.coach_id = co.id)))),
    scoped_athletes as (
      select s as athlete_id from public.msg_scope_athletes(v_a.org_id, v_a.team_id, v_a.program_id, v_a.camp_edition_id) s),
    scoped_guardians as (
      select distinct fm.profile_id from public.athletes a join public.family_members fm on fm.family_id = a.family_id
       where a.id in (select sa.athlete_id from scoped_athletes sa)),
    -- Per-child linkers (receives_emails) of the children in scope; never for 'all' / 'parents'.
    scoped_linkers as (
      select distinct lr.profile_id
        from public.athlete_linked_recipients(v_a.org_id, array(select sa.athlete_id from scoped_athletes sa)) lr)
    select distinct x.profile_id from (
      select s.profile_id from staff s where v_a.audience in ('all', 'staff')
      union select g.profile_id from guardians g where v_a.audience in ('all', 'parents')
      union select ss.profile_id from scoped_staff ss where v_a.audience in ('team', 'program', 'camp_edition')
      union select sg.profile_id from scoped_guardians sg where v_a.audience in ('team', 'program', 'camp_edition')
      union select sl.profile_id from scoped_linkers sl where v_a.audience in ('team', 'program', 'camp_edition')
    ) x
    join public.profiles p on p.id = x.profile_id and p.org_id = v_a.org_id and p.is_active;
end $$;

-- Training booking notices (20250420104700) + per-child linkers of the child
-- (recipient_kind 'linked'). A linker who is also the payer gets one copy
-- (same recipient key); family guardians are never repeated.
create or replace function public.bk_enqueue_notifications(p_booking uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.training_bookings; a public.athletes; f public.families; p public.billing_payers;
  v_n integer := 0; v_k integer; v_contact boolean := false;
  v_family boolean := p_kind in ('confirmed', 'rescheduled', 'cancelled', 'request_confirmed', 'request_declined');
  v_coach  boolean;
  v_admins boolean;
  v_coach_profile uuid;
begin
  select * into b from public.training_bookings where id = p_booking;
  if not found then return 0; end if;
  select * into a from public.athletes where id = b.athlete_id;
  select * into f from public.families where id = a.family_id;
  select c.profile_id into v_coach_profile from public.coaches c where c.id = b.coach_id;
  v_coach := p_kind in ('confirmed', 'rescheduled', 'cancelled', 'requested', 'request_withdrawn')
             or (p_kind in ('request_confirmed', 'request_declined') and v_coach_profile is distinct from auth.uid());
  v_admins := p_kind = 'requested' and b.request_source = 'family';

  if v_family then
    if b.payer_id is not null then
      select * into p from public.billing_payers where id = b.payer_id;
      if p.id is not null and (p.profile_id is not null or p.email is not null) then
        insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                                  recipient_profile_id, recipient_email, recipient_name)
        values (b.org_id, b.id, p_kind, b.change_seq, 'payer',
                coalesce('p:' || p.profile_id::text, 'e:' || lower(p.email::text)), p.profile_id,
                coalesce(p.email::text, (select pf.email from public.profiles pf where pf.id = p.profile_id)), p.name)
        on conflict do nothing;
        get diagnostics v_k = row_count; v_n := v_n + v_k; v_contact := true;
      end if;
    end if;

    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select b.org_id, b.id, p_kind, b.change_seq, 'guardian', 'p:' || r.profile_id::text, r.profile_id,
           case when coalesce(fm.receives_emails, true) then pf.email end, pf.full_name
      from public.ta_alert_recipients(b.athlete_id) r
      join public.profiles pf on pf.id = r.profile_id
      left join public.family_members fm on fm.family_id = a.family_id and fm.profile_id = r.profile_id
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
    if exists (select 1 from public.ta_alert_recipients(b.athlete_id)) then v_contact := true; end if;

    if not v_contact and f.contact_email is not null and public.ta_plausible_email(f.contact_email::text) then
      insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                                recipient_email, recipient_name)
      values (b.org_id, b.id, p_kind, b.change_seq, 'family', 'e:' || lower(f.contact_email::text), f.contact_email::text,
              coalesce(f.contact_name, f.name))
      on conflict do nothing;
      get diagnostics v_k = row_count; v_n := v_n + v_k; v_contact := true;
    end if;

    if a.player_profile_id is not null then
      insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                                recipient_profile_id, recipient_email, recipient_name)
      select b.org_id, b.id, p_kind, b.change_seq, 'player', 'p:' || pf.id::text, pf.id, null, pf.full_name
        from public.profiles pf where pf.id = a.player_profile_id
      on conflict do nothing;
      get diagnostics v_k = row_count; v_n := v_n + v_k;
    end if;

    -- Per-child linkers of this child who receive the club's e-mails.
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select b.org_id, b.id, p_kind, b.change_seq, 'linked', 'p:' || lr.profile_id::text, lr.profile_id, lr.email, lr.full_name
      from public.athlete_linked_recipients(b.org_id, array[b.athlete_id]) lr
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;

    if not v_contact then
      insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key, status)
      values (b.org_id, b.id, p_kind, b.change_seq, 'family', 'none', 'no_contact')
      on conflict do nothing;
    end if;
  end if;

  if v_coach then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select b.org_id, b.id, p_kind, b.change_seq, 'coach', 'p:' || c.profile_id::text, c.profile_id, pf.email, c.display_name
      from public.coaches c join public.profiles pf on pf.id = c.profile_id
     where c.id = b.coach_id and c.profile_id is not null
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  if v_admins then
    insert into public.booking_notifications (org_id, booking_id, kind, change_seq, recipient_kind, recipient_key,
                                              recipient_profile_id, recipient_email, recipient_name)
    select distinct on (pf.id) b.org_id, b.id, p_kind, b.change_seq, 'admin', 'p:' || pf.id::text, pf.id, pf.email, pf.full_name
      from public.staff_roles sr
      join public.profiles pf on pf.id = sr.profile_id and pf.is_active
     where sr.org_id = b.org_id and sr.role = 'admin'
       and not exists (select 1 from public.org_memberships om
                        where om.profile_id = pf.id and om.org_id = b.org_id and om.status <> 'active')
    on conflict do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;
  return v_n;
end $$;

-- ===========================================================================
-- 8) Reserved site paths: the invitation page
-- ===========================================================================
create or replace function public.site_path_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select split_part(ltrim(coalesce(p, ''), '/'), '/', 1) in (
    'admin', 'coach', 'parent', 'player', 'platform', 'login', 'auth', 'register', 'book', 'shop', 'club', 'embed',
    'embed.js', 'api', 'board', 'scout', 'waitlist', 'onboarding', 'signup', 'legal', 'offline', 'pwa',
    'sw.js', 'manifest.webmanifest', '_next', 'favicon.ico', 'sitemap.xml', 'robots.txt', 'icon',
    'apple-icon', 'opengraph-image', 'monitoring', 'join', 'consent', 'link-invite');
$$;

-- ===========================================================================
-- 9) Grants
-- ===========================================================================
do $$
declare f text;
begin
  -- Internal helpers: definer callers only.
  foreach f in array array[
    'athlete_linked_recipients(uuid, uuid[])', 'athlete_link_consent_value(uuid, boolean, boolean)', 'ali_expire_due(uuid)',
    'lc_eval(uuid, uuid, uuid, jsonb)', 'lc_forms(jsonb, boolean)', 'msg_scope_athletes(uuid, uuid, uuid, uuid)',
    'org_carer_consent_enabled(uuid)', 'bk_enqueue_notifications(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- Service role only (server-side notices).
  foreach f in array array['athlete_linked_recipients_for(uuid, uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
  -- Signed-in callers (each checks the caller and the club in SQL); the
  -- token-based view is also called by the server with the service role.
  foreach f in array array[
    'athlete_link_can(uuid, text)', 'gc_is_health_form(text)', 'participant_link_decide(uuid, text, jsonb, text)',
    'athlete_link_update(uuid, jsonb)', 'athlete_links_for(uuid)', 'athlete_links_mine_to_manage()', 'carer_consent_setting()',
    'athlete_link_invite_create(uuid, jsonb, text, uuid)', 'athlete_link_invite_revoke(uuid)', 'athlete_link_invites_for(uuid)',
    'athlete_link_invites_mine_to_manage()', 'athlete_link_invite_view(text)', 'athlete_link_invite_accept(text)',
    'linker_consent_status(uuid)', 'linker_consent_pending()', 'linker_consent_accept(uuid, jsonb)',
    'linker_consent_ask_family(uuid, text)', 'msg_scope_linker(uuid, uuid, uuid)', 'club_alert_for_me(text, uuid, uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function public.%s to authenticated, service_role', f);
    end if;
  end loop;
  -- Alert recipients: service role (re-checked inside).
  execute 'revoke all on function public.club_alert_recipients(uuid) from public, anon';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.club_alert_recipients(uuid) to service_role';
  end if;
end $$;
