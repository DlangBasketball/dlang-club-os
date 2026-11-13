-- ============================================================================
-- DLang OS — Communication: message board, alerts, new-contact leads
--
--   1. Message board (in-app messaging)
--        messaging_settings      per club: who may start threads, parent
--                                replies in channels, read receipts, quiet
--                                hours, email notifications
--        msg_conversations       direct threads (staff <-> family, staff <->
--                                staff, family -> club office) and channels
--                                (team / programme / camp edition)
--        msg_participants        explicit members of direct threads
--        msg_messages            messages (admins hide, never hard-delete)
--        msg_attachments         files in the private "message-attachments"
--                                bucket (key <org>/<conversation>/<file>)
--        msg_read_state          per-user read position (unread counts and
--                                optional read receipts)
--        msg_reports             "report abuse" queue for admins
--      Contact details (email, phone) are never exposed: the people of a
--      thread are listed by msg_people(), which returns display names only,
--      and profiles keep their existing self/admin-only RLS.
--      Safeguarding: participants are staff or guardians only (athletes have
--      no messaging identity; their messages go through guardians); parents
--      can never message other parents; admins can read every staff <-> family
--      thread (the UI says so).
--
--   2. Notification preferences (notification_preferences): per user, per
--      category in-app / email switches and quiet hours.
--
--   3. Alerts (club_alerts + club_alert_dismissals): audience, severity,
--      schedule, expiry; admins for any audience, coaches for their teams.
--
--   4. New contacts (contact_leads + contact_lead_replies): public "Questions?
--      Contact us" form, written only through contact_lead_submit() by server
--      code (honeypot + per-IP-hash rate limit), admin inbox.
--
-- Additive and idempotent. Every new table: org_id + index, RLS with a policy
-- per verb, created_at/updated_at, audit trigger where it holds personal data
-- (message bodies and lead details are redacted from the audit trail).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Notification types + helpers
-- ---------------------------------------------------------------------------
alter type public.notification_type add value if not exists 'message';
alter type public.notification_type add value if not exists 'alert';
alter type public.notification_type add value if not exists 'new_contact';

-- Audit trigger that strips the columns named in the trigger arguments
-- (free-text bodies, contact details) before writing audit_logs.
create or replace function public.msg_audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) end;
  v_row jsonb;
  v_col text;
begin
  foreach v_col in array coalesce(tg_argv, '{}'::text[]) loop
    if v_old ? v_col and jsonb_typeof(v_old->v_col) <> 'null' then v_old := jsonb_set(v_old, array[v_col], '"[redacted]"'); end if;
    if v_new ? v_col and jsonb_typeof(v_new->v_col) <> 'null' then v_new := jsonb_set(v_new, array[v_col], '"[redacted]"'); end if;
  end loop;
  v_row := coalesce(v_new, v_old);
  insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, old_data, new_data)
  values ((v_row->>'org_id')::uuid, auth.uid(), tg_op, tg_table_name, (v_row->>'id')::uuid, v_old, v_new);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Is p_profile a staff member (any role) of p_org?
create or replace function public.msg_profile_is_staff(p_org uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_roles where org_id = p_org and profile_id = p_profile);
$$;

-- Is p_profile an office member (admin or finance) of p_org?
create or replace function public.msg_profile_is_office(p_org uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff_roles where org_id = p_org and profile_id = p_profile and role in ('admin', 'finance'));
$$;

-- Is p_profile a guardian of a family in p_org?
create or replace function public.msg_profile_is_guardian(p_org uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.family_members fm join public.families f on f.id = fm.family_id
     where f.org_id = p_org and fm.profile_id = p_profile);
$$;

-- Does the coach with login p_profile coach an athlete of family p_family
-- (programme session, team, or a training booking)?
create or replace function public.msg_coach_serves_family(p_profile uuid, p_family uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with c as (
    select co.id from public.coaches co join public.families f on f.org_id = co.org_id
     where co.profile_id = p_profile and f.id = p_family
  )
  select exists (
    select 1 from public.athletes a
      join public.registrations r on r.athlete_id = a.id and r.status <> 'cancelled'
      join public.program_sessions ps on ps.program_id = r.program_id
     where a.family_id = p_family and ps.coach_id in (select id from c))
  or exists (
    select 1 from public.athletes a
      join public.team_memberships tm on tm.athlete_id = a.id and tm.status <> 'inactive'
      join public.team_coaches tc on tc.team_id = tm.team_id
     where a.family_id = p_family and tc.coach_id in (select id from c))
  or exists (
    select 1 from public.athletes a
      join public.training_bookings b on b.athlete_id = a.id
     where a.family_id = p_family and b.coach_id in (select id from c));
$$;

-- Caller coaches the channel scope (team / programme / camp edition)?
create or replace function public.msg_scope_staff(p_team uuid, p_program uuid, p_edition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team is not null and public.coach_coaches_team(p_team))
      or (p_program is not null and public.coach_coaches_program(p_program))
      or (p_edition is not null and exists (
            select 1 from public.camp_editions e
             where e.id = p_edition and e.org_id = public.current_org_id()
               and public.coach_coaches_program(e.program_id)));
$$;

-- Caller is a guardian of an athlete in the channel scope?
create or replace function public.msg_scope_guardian(p_team uuid, p_program uuid, p_edition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (p_team is not null and public.guardian_has_athlete_on_team(p_team))
      or (p_program is not null and exists (
            select 1 from public.registrations r
              join public.athletes a on a.id = r.athlete_id
              join public.family_members fm on fm.family_id = a.family_id
             where r.program_id = p_program and r.status <> 'cancelled' and fm.profile_id = auth.uid()
               and r.org_id = public.current_org_id()))
      or (p_edition is not null and exists (
            select 1 from public.registrations r
              join public.athletes a on a.id = r.athlete_id
              join public.family_members fm on fm.family_id = a.family_id
             where r.camp_edition_id = p_edition and r.status <> 'cancelled' and fm.profile_id = auth.uid()
               and r.org_id = public.current_org_id()));
$$;

-- Same-org guard for every foreign key named in the trigger arguments.
create or replace function public.msg_same_org_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_org uuid  := (v_row->>'org_id')::uuid;
  v_col text;
  v_id  uuid;
  v_tab text;
  v_ok  boolean;
begin
  foreach v_col in array coalesce(tg_argv, '{}'::text[]) loop
    v_id := nullif(v_row->>v_col, '')::uuid;
    continue when v_id is null;
    v_tab := case v_col
      when 'profile_id'      then 'profiles'
      when 'sender_id'       then 'profiles'
      when 'created_by'      then 'profiles'
      when 'reporter_id'     then 'profiles'
      when 'author_id'       then 'profiles'
      when 'family_id'       then 'families'
      when 'team_id'         then 'teams'
      when 'program_id'      then 'programs'
      when 'camp_edition_id' then 'camp_editions'
      when 'conversation_id' then 'msg_conversations'
      when 'message_id'      then 'msg_messages'
      when 'alert_id'        then 'club_alerts'
      when 'lead_id'         then 'contact_leads'
    end;
    if v_tab is null then raise exception 'msg_same_org_guard: unknown column %', v_col; end if;
    execute format('select exists (select 1 from public.%I where id = $1 and org_id = $2)', v_tab)
      into v_ok using v_id, v_org;
    if not v_ok then
      raise exception 'CROSS_ORG_REFERENCE: %', v_col using errcode = 'P0001';
    end if;
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Club messaging settings
-- ---------------------------------------------------------------------------
create table if not exists public.messaging_settings (
  id                          uuid primary key default gen_random_uuid(),
  org_id                      uuid not null unique references public.organizations(id) on delete cascade,
  parents_can_start           boolean not null default true,
  parent_replies_in_channels  boolean not null default true,
  read_receipts               boolean not null default false,
  email_notifications         boolean not null default true,
  quiet_start                 time,
  quiet_end                   time,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint messaging_settings_quiet_chk check ((quiet_start is null) = (quiet_end is null))
);
create index if not exists idx_messaging_settings_org on public.messaging_settings(org_id);
drop trigger if exists trg_messaging_settings_updated on public.messaging_settings;
create trigger trg_messaging_settings_updated before update on public.messaging_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_messaging_settings on public.messaging_settings;
create trigger trg_audit_messaging_settings after insert or update or delete on public.messaging_settings
  for each row execute function public.audit_trigger();

-- Effective settings of an org (defaults when the club never saved any).
create or replace function public.msg_setting(p_org uuid, p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_key
      when 'parents_can_start' then s.parents_can_start
      when 'parent_replies_in_channels' then s.parent_replies_in_channels
      when 'read_receipts' then s.read_receipts
      when 'email_notifications' then s.email_notifications
    end from public.messaging_settings s where s.org_id = p_org),
    case p_key when 'read_receipts' then false else true end);
$$;

-- ---------------------------------------------------------------------------
-- 2) Conversations, participants, messages, attachments, read state, reports
-- ---------------------------------------------------------------------------
create table if not exists public.msg_conversations (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  kind             text not null default 'direct',
  subject          text,
  -- direct threads with a family side: the family the thread is about
  family_id        uuid references public.families(id) on delete set null,
  -- a family member writing to "the club office" (admins + finance)
  office           boolean not null default false,
  -- channel scope: exactly one of these for kind = 'channel'
  team_id          uuid references public.teams(id) on delete cascade,
  program_id       uuid references public.programs(id) on delete cascade,
  camp_edition_id  uuid references public.camp_editions(id) on delete cascade,
  allow_replies    boolean not null default true,
  -- sensitive: email notifications never carry the message text
  sensitive        boolean not null default true,
  status           text not null default 'open',
  closed_at        timestamptz,
  closed_by        uuid references public.profiles(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint msg_conversations_kind_chk check (kind in ('direct', 'channel')),
  constraint msg_conversations_status_chk check (status in ('open', 'closed')),
  constraint msg_conversations_subject_chk check (subject is null or length(subject) between 1 and 160),
  constraint msg_conversations_scope_chk check (
    (kind = 'direct' and team_id is null and program_id is null and camp_edition_id is null)
    or (kind = 'channel' and family_id is null and not office
        and num_nonnulls(team_id, program_id, camp_edition_id) = 1)),
  constraint msg_conversations_closed_chk check ((status = 'closed') = (closed_at is not null))
);
create index if not exists idx_msg_conversations_org on public.msg_conversations(org_id, last_message_at desc);
create index if not exists idx_msg_conversations_family on public.msg_conversations(family_id) where family_id is not null;
create index if not exists idx_msg_conversations_team on public.msg_conversations(team_id) where team_id is not null;
create index if not exists idx_msg_conversations_program on public.msg_conversations(program_id) where program_id is not null;
create index if not exists idx_msg_conversations_edition on public.msg_conversations(camp_edition_id) where camp_edition_id is not null;

drop trigger if exists trg_msg_conversations_updated on public.msg_conversations;
create trigger trg_msg_conversations_updated before update on public.msg_conversations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_msg_conversations_org on public.msg_conversations;
create trigger trg_msg_conversations_org before insert or update on public.msg_conversations
  for each row execute function public.msg_same_org_guard('family_id', 'team_id', 'program_id', 'camp_edition_id', 'created_by');
drop trigger if exists trg_audit_msg_conversations on public.msg_conversations;
create trigger trg_audit_msg_conversations after insert or update or delete on public.msg_conversations
  for each row execute function public.msg_audit_trigger('subject');

create table if not exists public.msg_participants (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null references public.msg_conversations(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  side             text not null,
  muted            boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint msg_participants_side_chk check (side in ('staff', 'family')),
  unique (conversation_id, profile_id)
);
create index if not exists idx_msg_participants_org on public.msg_participants(org_id);
create index if not exists idx_msg_participants_profile on public.msg_participants(profile_id);

-- Safeguarding: a participant is a staff member or a guardian of the org,
-- and the side matches; nobody else (no athlete identities, no outsiders).
create or replace function public.msg_participants_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.conversation_id <> old.conversation_id or new.profile_id <> old.profile_id
                           or new.side <> old.side or new.org_id <> old.org_id) then
    raise exception 'IMMUTABLE_PARTICIPANT' using errcode = 'P0001';
  end if;
  if new.side = 'staff' and not public.msg_profile_is_staff(new.org_id, new.profile_id) then
    raise exception 'NOT_A_STAFF_MEMBER' using errcode = 'P0001';
  end if;
  if new.side = 'family' and not public.msg_profile_is_guardian(new.org_id, new.profile_id) then
    raise exception 'NOT_A_GUARDIAN' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_msg_participants_guard on public.msg_participants;
create trigger trg_msg_participants_guard before insert or update on public.msg_participants
  for each row execute function public.msg_participants_guard();
drop trigger if exists trg_msg_participants_org on public.msg_participants;
create trigger trg_msg_participants_org before insert or update on public.msg_participants
  for each row execute function public.msg_same_org_guard('conversation_id', 'profile_id');
drop trigger if exists trg_msg_participants_updated on public.msg_participants;
create trigger trg_msg_participants_updated before update on public.msg_participants
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_msg_participants on public.msg_participants;
create trigger trg_audit_msg_participants after insert or delete on public.msg_participants
  for each row execute function public.msg_audit_trigger();

create table if not exists public.msg_messages (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null references public.msg_conversations(id) on delete cascade,
  sender_id        uuid references public.profiles(id) on delete set null,
  body             text not null,
  hidden_at        timestamptz,
  hidden_by        uuid references public.profiles(id) on delete set null,
  hidden_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint msg_messages_body_chk check (length(btrim(body)) between 1 and 5000),
  constraint msg_messages_hidden_chk check (hidden_reason is null or length(hidden_reason) <= 300)
);
create index if not exists idx_msg_messages_org on public.msg_messages(org_id);
create index if not exists idx_msg_messages_conv on public.msg_messages(conversation_id, created_at);

create table if not exists public.msg_read_state (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null references public.msg_conversations(id) on delete cascade,
  profile_id       uuid not null references public.profiles(id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (conversation_id, profile_id)
);
create index if not exists idx_msg_read_state_org on public.msg_read_state(org_id);
create index if not exists idx_msg_read_state_profile on public.msg_read_state(profile_id);
drop trigger if exists trg_msg_read_state_updated on public.msg_read_state;
create trigger trg_msg_read_state_updated before update on public.msg_read_state
  for each row execute function public.set_updated_at();
drop trigger if exists trg_msg_read_state_org on public.msg_read_state;
create trigger trg_msg_read_state_org before insert or update on public.msg_read_state
  for each row execute function public.msg_same_org_guard('conversation_id', 'profile_id');

-- Messages: only the moderation columns may change, and only by an admin.
create or replace function public.msg_messages_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.body is distinct from old.body or new.sender_id is distinct from old.sender_id
       or new.conversation_id <> old.conversation_id or new.org_id <> old.org_id
       or new.created_at <> old.created_at then
      raise exception 'MESSAGE_IMMUTABLE' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_msg_messages_guard on public.msg_messages;
create trigger trg_msg_messages_guard before update on public.msg_messages
  for each row execute function public.msg_messages_guard();
drop trigger if exists trg_msg_messages_org on public.msg_messages;
create trigger trg_msg_messages_org before insert or update on public.msg_messages
  for each row execute function public.msg_same_org_guard('conversation_id', 'sender_id');
drop trigger if exists trg_msg_messages_updated on public.msg_messages;
create trigger trg_msg_messages_updated before update on public.msg_messages
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_msg_messages on public.msg_messages;
create trigger trg_audit_msg_messages after insert or update or delete on public.msg_messages
  for each row execute function public.msg_audit_trigger('body', 'hidden_reason');

-- After a message: bump the thread, mark it read for the sender, and make an
-- office member who answers a direct thread a participant of it.
create or replace function public.msg_after_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_conv public.msg_conversations%rowtype;
begin
  select * into v_conv from public.msg_conversations where id = new.conversation_id;
  update public.msg_conversations set last_message_at = new.created_at where id = new.conversation_id;
  if new.sender_id is not null then
    insert into public.msg_read_state (org_id, conversation_id, profile_id, last_read_at)
      values (new.org_id, new.conversation_id, new.sender_id, new.created_at)
      on conflict (conversation_id, profile_id) do update set last_read_at = greatest(public.msg_read_state.last_read_at, excluded.last_read_at);
    if v_conv.kind = 'direct'
       and not exists (select 1 from public.msg_participants where conversation_id = new.conversation_id and profile_id = new.sender_id)
       and public.msg_profile_is_staff(new.org_id, new.sender_id) then
      insert into public.msg_participants (org_id, conversation_id, profile_id, side)
        values (new.org_id, new.conversation_id, new.sender_id, 'staff')
        on conflict (conversation_id, profile_id) do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_msg_after_message on public.msg_messages;
create trigger trg_msg_after_message after insert on public.msg_messages
  for each row execute function public.msg_after_message();

create table if not exists public.msg_attachments (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null references public.msg_conversations(id) on delete cascade,
  message_id       uuid not null references public.msg_messages(id) on delete cascade,
  storage_path     text not null unique,
  file_name        text not null,
  mime_type        text not null,
  size_bytes       integer not null,
  uploaded_by      uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint msg_attachments_size_chk check (size_bytes between 1 and 2621440),
  constraint msg_attachments_name_chk check (length(file_name) between 1 and 200),
  constraint msg_attachments_mime_chk check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint msg_attachments_path_chk check (storage_path like org_id::text || '/' || conversation_id::text || '/%')
);
create index if not exists idx_msg_attachments_org on public.msg_attachments(org_id);
create index if not exists idx_msg_attachments_message on public.msg_attachments(message_id);
drop trigger if exists trg_msg_attachments_org on public.msg_attachments;
create trigger trg_msg_attachments_org before insert or update on public.msg_attachments
  for each row execute function public.msg_same_org_guard('conversation_id', 'message_id');
drop trigger if exists trg_msg_attachments_updated on public.msg_attachments;
create trigger trg_msg_attachments_updated before update on public.msg_attachments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_msg_attachments on public.msg_attachments;
create trigger trg_audit_msg_attachments after insert or update or delete on public.msg_attachments
  for each row execute function public.msg_audit_trigger('file_name');

create table if not exists public.msg_reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  conversation_id  uuid not null references public.msg_conversations(id) on delete cascade,
  message_id       uuid not null references public.msg_messages(id) on delete cascade,
  reporter_id      uuid references public.profiles(id) on delete set null,
  reason           text not null,
  status           text not null default 'open',
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint msg_reports_reason_chk check (length(btrim(reason)) between 3 and 1000),
  constraint msg_reports_status_chk check (status in ('open', 'resolved', 'dismissed'))
);
create index if not exists idx_msg_reports_org on public.msg_reports(org_id, status);
drop trigger if exists trg_msg_reports_org on public.msg_reports;
create trigger trg_msg_reports_org before insert or update on public.msg_reports
  for each row execute function public.msg_same_org_guard('conversation_id', 'message_id', 'reporter_id');
drop trigger if exists trg_msg_reports_updated on public.msg_reports;
create trigger trg_msg_reports_updated before update on public.msg_reports
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_msg_reports on public.msg_reports;
create trigger trg_audit_msg_reports after insert or update or delete on public.msg_reports
  for each row execute function public.msg_audit_trigger('reason');

-- ---------------------------------------------------------------------------
-- 3) Access functions (caller = auth.uid())
-- ---------------------------------------------------------------------------

-- Is the caller a member of the thread (it is "theirs": unread counts)?
create or replace function public.msg_is_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.msg_conversations c
     where c.id = p_conv and c.org_id = public.current_org_id()
       and (
         (c.kind = 'direct' and (
            exists (select 1 from public.msg_participants p where p.conversation_id = c.id and p.profile_id = auth.uid())
            or (c.office and public.is_finance())))
         or (c.kind = 'channel' and (public.is_admin()
               or public.msg_scope_staff(c.team_id, c.program_id, c.camp_edition_id)
               or public.msg_scope_guardian(c.team_id, c.program_id, c.camp_edition_id)))
       ));
$$;

-- May the caller read the thread? Members, plus admins (oversight of every
-- staff <-> family thread of their club).
create or replace function public.msg_can_read(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.msg_conversations c where c.id = p_conv and c.org_id = public.current_org_id() and public.is_admin())
      or public.msg_is_member(p_conv);
$$;

-- May the caller post in the thread?
create or replace function public.msg_can_post(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.msg_conversations c
     where c.id = p_conv and c.org_id = public.current_org_id() and c.status = 'open'
       and public.msg_can_read(c.id)
       and (
         c.kind = 'direct'
         or public.is_admin()
         or public.msg_scope_staff(c.team_id, c.program_id, c.camp_edition_id)
         or (c.allow_replies and public.msg_setting(c.org_id, 'parent_replies_in_channels')
             and public.msg_scope_guardian(c.team_id, c.program_id, c.camp_edition_id))
       ));
$$;

-- May the caller start a direct thread with p_target? (Permission matrix;
-- mirrored in src/lib/messaging/permissions.ts.)
--   admin / finance (office) -> any staff member or guardian of the club
--   coach                    -> any staff member; guardians of athletes they coach
--   guardian                 -> office (admin / finance); coaches of their children
--                               never another guardian
create or replace function public.msg_can_contact(p_target uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.current_org_id();
begin
  if v_me is null or v_org is null or p_target is null or p_target = v_me then return false; end if;
  if not exists (select 1 from public.profiles where id = p_target and org_id = v_org and is_active) then return false; end if;
  if not (public.msg_profile_is_staff(v_org, p_target) or public.msg_profile_is_guardian(v_org, p_target)) then return false; end if;
  if public.msg_profile_is_office(v_org, v_me) then return true; end if;
  if public.msg_profile_is_staff(v_org, v_me) then
    if public.msg_profile_is_staff(v_org, p_target) then return true; end if;
    return exists (
      select 1 from public.family_members fm join public.families f on f.id = fm.family_id
       where fm.profile_id = p_target and f.org_id = v_org and public.msg_coach_serves_family(v_me, f.id));
  end if;
  if public.msg_profile_is_guardian(v_org, v_me) then
    if public.msg_profile_is_office(v_org, p_target) then return true; end if;
    if public.msg_profile_is_staff(v_org, p_target) then
      return exists (
        select 1 from public.family_members fm join public.families f on f.id = fm.family_id
         where fm.profile_id = v_me and f.org_id = v_org and public.msg_coach_serves_family(p_target, f.id));
    end if;
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Thread RPCs
-- ---------------------------------------------------------------------------

-- Start (or continue) a direct thread. p_target null = a guardian writing to
-- the club office. Returns the conversation id.
create or replace function public.msg_start_direct(
  p_target uuid, p_body text, p_subject text default null, p_family uuid default null, p_sensitive boolean default true)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me        uuid := auth.uid();
  v_org       uuid := public.current_org_id();
  v_me_staff  boolean;
  v_me_guard  boolean;
  v_t_staff   boolean;
  v_family    uuid;
  v_conv      uuid;
  v_subject   text := nullif(btrim(coalesce(p_subject, '')), '');
  v_body      text := btrim(coalesce(p_body, ''));
begin
  if v_me is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  if length(v_body) < 1 or length(v_body) > 5000 then raise exception 'INVALID_BODY' using errcode = 'P0001'; end if;
  if v_subject is not null and length(v_subject) > 160 then raise exception 'INVALID_SUBJECT' using errcode = 'P0001'; end if;
  v_me_staff := public.msg_profile_is_staff(v_org, v_me);
  v_me_guard := public.msg_profile_is_guardian(v_org, v_me);

  if p_target is null then
    -- family -> club office
    if v_me_staff or not v_me_guard then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
    if not public.msg_setting(v_org, 'parents_can_start') then raise exception 'PARENT_START_DISABLED' using errcode = 'P0001'; end if;
    select f.id into v_family from public.family_members fm join public.families f on f.id = fm.family_id
     where fm.profile_id = v_me and f.org_id = v_org and (p_family is null or f.id = p_family)
     order by fm.is_primary desc, f.created_at limit 1;
    if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0001'; end if;
  else
    if not public.msg_can_contact(p_target) then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
    v_t_staff := public.msg_profile_is_staff(v_org, p_target);
    if v_me_staff and v_t_staff then
      v_family := null;
    elsif v_me_staff then
      -- staff -> guardian: the family the thread is about (one the coach serves)
      select f.id into v_family from public.family_members fm join public.families f on f.id = fm.family_id
       where fm.profile_id = p_target and f.org_id = v_org and (p_family is null or f.id = p_family)
         and (public.msg_profile_is_office(v_org, v_me) or public.msg_coach_serves_family(v_me, f.id))
       order by fm.is_primary desc, f.created_at limit 1;
      if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0001'; end if;
    else
      if not public.msg_setting(v_org, 'parents_can_start') then raise exception 'PARENT_START_DISABLED' using errcode = 'P0001'; end if;
      select f.id into v_family from public.family_members fm join public.families f on f.id = fm.family_id
       where fm.profile_id = v_me and f.org_id = v_org and (p_family is null or f.id = p_family)
         and (public.msg_profile_is_office(v_org, p_target) or public.msg_coach_serves_family(p_target, f.id))
       order by fm.is_primary desc, f.created_at limit 1;
      if v_family is null then raise exception 'FAMILY_NOT_FOUND' using errcode = 'P0001'; end if;
    end if;
  end if;

  -- Continue the open thread between the same people about the same family.
  if v_subject is null then
    select c.id into v_conv from public.msg_conversations c
     where c.org_id = v_org and c.kind = 'direct' and c.status = 'open' and c.subject is null
       and c.family_id is not distinct from v_family
       and c.office = (p_target is null)
       and exists (select 1 from public.msg_participants p where p.conversation_id = c.id and p.profile_id = v_me)
       and (p_target is null or exists (select 1 from public.msg_participants p where p.conversation_id = c.id and p.profile_id = p_target))
       and (select count(*) from public.msg_participants p where p.conversation_id = c.id) = case when p_target is null then 1 else 2 end
     order by c.last_message_at desc limit 1;
  end if;

  if v_conv is null then
    insert into public.msg_conversations (org_id, kind, subject, family_id, office, sensitive, created_by)
      values (v_org, 'direct', v_subject, v_family, p_target is null, coalesce(p_sensitive, true), v_me)
      returning id into v_conv;
    insert into public.msg_participants (org_id, conversation_id, profile_id, side)
      values (v_org, v_conv, v_me, case when v_me_staff then 'staff' else 'family' end);
    if p_target is not null then
      insert into public.msg_participants (org_id, conversation_id, profile_id, side)
        values (v_org, v_conv, p_target, case when v_t_staff then 'staff' else 'family' end);
    end if;
  end if;

  insert into public.msg_messages (org_id, conversation_id, sender_id, body) values (v_org, v_conv, v_me, v_body);
  return v_conv;
end $$;

-- Start a team / programme / camp-edition channel (admin: any; coach: own).
create or replace function public.msg_start_channel(
  p_scope text, p_scope_id uuid, p_subject text, p_body text, p_allow_replies boolean default true, p_sensitive boolean default false)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_me      uuid := auth.uid();
  v_org     uuid := public.current_org_id();
  v_team    uuid;
  v_program uuid;
  v_edition uuid;
  v_conv    uuid;
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_body    text := btrim(coalesce(p_body, ''));
begin
  if v_me is null or v_org is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  if v_subject is null or length(v_subject) > 160 then raise exception 'INVALID_SUBJECT' using errcode = 'P0001'; end if;
  if length(v_body) < 1 or length(v_body) > 5000 then raise exception 'INVALID_BODY' using errcode = 'P0001'; end if;
  case p_scope
    when 'team' then
      if not exists (select 1 from public.teams where id = p_scope_id and org_id = v_org) then raise exception 'SCOPE_NOT_FOUND' using errcode = 'P0001'; end if;
      v_team := p_scope_id;
    when 'program' then
      if not exists (select 1 from public.programs where id = p_scope_id and org_id = v_org) then raise exception 'SCOPE_NOT_FOUND' using errcode = 'P0001'; end if;
      v_program := p_scope_id;
    when 'camp_edition' then
      if not exists (select 1 from public.camp_editions where id = p_scope_id and org_id = v_org) then raise exception 'SCOPE_NOT_FOUND' using errcode = 'P0001'; end if;
      v_edition := p_scope_id;
    else raise exception 'SCOPE_NOT_FOUND' using errcode = 'P0001';
  end case;
  if not (public.is_admin() or public.msg_scope_staff(v_team, v_program, v_edition)) then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  insert into public.msg_conversations (org_id, kind, subject, team_id, program_id, camp_edition_id, allow_replies, sensitive, created_by)
    values (v_org, 'channel', v_subject, v_team, v_program, v_edition, coalesce(p_allow_replies, true), coalesce(p_sensitive, false), v_me)
    returning id into v_conv;
  insert into public.msg_messages (org_id, conversation_id, sender_id, body) values (v_org, v_conv, v_me, v_body);
  return v_conv;
end $$;

-- Close / reopen a thread (admin moderation; a channel's coach too).
create or replace function public.msg_set_status(p_conv uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_c public.msg_conversations%rowtype;
begin
  if p_status not in ('open', 'closed') then raise exception 'INVALID_STATUS' using errcode = 'P0001'; end if;
  select * into v_c from public.msg_conversations where id = p_conv and org_id = public.current_org_id();
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if not (public.is_admin() or (v_c.kind = 'channel' and public.msg_scope_staff(v_c.team_id, v_c.program_id, v_c.camp_edition_id))) then
    raise exception 'NOT_ALLOWED' using errcode = 'P0001';
  end if;
  update public.msg_conversations
     set status = p_status,
         closed_at = case when p_status = 'closed' then now() end,
         closed_by = case when p_status = 'closed' then auth.uid() end
   where id = p_conv;
end $$;

-- Hide / unhide a message (admin moderation). The text stays for the record.
create or replace function public.msg_hide_message(p_message uuid, p_hidden boolean, p_reason text default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_conv uuid;
begin
  if not public.is_admin() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  update public.msg_messages
     set hidden_at = case when p_hidden then now() end,
         hidden_by = case when p_hidden then auth.uid() end,
         hidden_reason = case when p_hidden then nullif(left(btrim(coalesce(p_reason, '')), 300), '') end
   where id = p_message and org_id = public.current_org_id()
  returning conversation_id into v_conv;
  if v_conv is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if p_hidden then
    update public.msg_reports set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
     where message_id = p_message and status = 'open';
  end if;
  return v_conv;
end $$;

-- Mark a thread read for the caller (members and admins).
create or replace function public.msg_mark_read(p_conv uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.msg_can_read(p_conv) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  insert into public.msg_read_state (org_id, conversation_id, profile_id, last_read_at)
    values (public.current_org_id(), p_conv, auth.uid(), now())
    on conflict (conversation_id, profile_id) do update set last_read_at = now();
end $$;

-- The caller's inbox: threads they belong to (p_all: every thread an admin
-- may oversee), with unread counts. Contact details are never returned.
create or replace function public.msg_inbox(p_all boolean default false, p_limit integer default 100)
returns table (
  conversation_id uuid, kind text, subject text, status text, office boolean, family_id uuid, family_name text,
  team_id uuid, program_id uuid, camp_edition_id uuid, scope_name text, last_message_at timestamptz,
  unread integer, is_member boolean, has_family_side boolean, last_sender_side text, people text)
language sql stable security definer set search_path = public as $$
  with mine as (
    select c.*, public.msg_is_member(c.id) as member
      from public.msg_conversations c
     where c.org_id = public.current_org_id()
  )
  select m.id, m.kind, m.subject, m.status, m.office, m.family_id, f.name,
         m.team_id, m.program_id, m.camp_edition_id,
         coalesce(t.name, pr.name, coalesce(ce.name, pe.name)),
         m.last_message_at,
         case when m.member then (
           select count(*)::int from public.msg_messages x
            where x.conversation_id = m.id and x.hidden_at is null and x.sender_id is distinct from auth.uid()
              and x.created_at > coalesce((select rs.last_read_at from public.msg_read_state rs
                                            where rs.conversation_id = m.id and rs.profile_id = auth.uid()), '-infinity'::timestamptz))
         else 0 end,
         m.member,
         (m.office or exists (select 1 from public.msg_participants p where p.conversation_id = m.id and p.side = 'family')),
         (select case when public.msg_profile_is_staff(m.org_id, x.sender_id) then 'staff' else 'family' end
            from public.msg_messages x where x.conversation_id = m.id and x.hidden_at is null
           order by x.created_at desc limit 1),
         (select string_agg(distinct coalesce((select co.display_name from public.coaches co
                                                 where co.profile_id = p.profile_id and co.org_id = m.org_id limit 1),
                                                pf.full_name, '?'), ', ')
            from public.msg_participants p join public.profiles pf on pf.id = p.profile_id
           where p.conversation_id = m.id and p.profile_id <> auth.uid())
    from mine m
    left join public.families f on f.id = m.family_id
    left join public.teams t on t.id = m.team_id
    left join public.programs pr on pr.id = m.program_id
    left join public.camp_editions ce on ce.id = m.camp_edition_id
    left join public.programs pe on pe.id = ce.program_id
   where m.member or (coalesce(p_all, false) and public.is_admin())
   order by m.last_message_at desc
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- People of a thread: display names and sides only (never email / phone).
-- last_read_at only when the club turned read receipts on.
create or replace function public.msg_people(p_conv uuid)
returns table (profile_id uuid, display_name text, side text, is_participant boolean, last_read_at timestamptz)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.msg_conversations where id = p_conv and public.msg_can_read(p_conv)),
  ids as (
    select p.profile_id, p.side, true as part from public.msg_participants p where p.conversation_id = p_conv
    union
    select m.sender_id,
           case when public.msg_profile_is_staff((select org_id from c), m.sender_id) then 'staff' else 'family' end,
           false
      from public.msg_messages m where m.conversation_id = p_conv and m.sender_id is not null
  ),
  dedup as (select distinct on (profile_id) profile_id, side, part from ids order by profile_id, part desc)
  select d.profile_id,
         coalesce((select co.display_name from public.coaches co where co.profile_id = d.profile_id and co.org_id = (select org_id from c) limit 1),
                  pf.full_name),
         d.side, d.part,
         case when public.msg_setting((select org_id from c), 'read_receipts')
              then (select rs.last_read_at from public.msg_read_state rs where rs.conversation_id = p_conv and rs.profile_id = d.profile_id) end
    from dedup d
    join public.profiles pf on pf.id = d.profile_id
   where exists (select 1 from c);
$$;

-- People the caller may start a direct thread with (names only).
create or replace function public.msg_contacts()
returns table (profile_id uuid, display_name text, kind text, family_id uuid, family_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_me  uuid := auth.uid();
  v_org uuid := public.current_org_id();
begin
  if v_me is null or v_org is null then return; end if;
  return query
    select s.pid,
           coalesce((select co.display_name from public.coaches co where co.profile_id = s.pid and co.org_id = v_org limit 1), pf.full_name),
           case when public.msg_profile_is_office(v_org, s.pid) then 'office' else 'coach' end,
           null::uuid, null::text
      from (select distinct sr.profile_id as pid from public.staff_roles sr where sr.org_id = v_org) s
      join public.profiles pf on pf.id = s.pid and pf.is_active
     where public.msg_can_contact(s.pid);
  if public.msg_profile_is_staff(v_org, v_me) then
    return query
      select fm.profile_id, pf.full_name, 'guardian'::text, f.id, f.name
        from public.families f
        join public.family_members fm on fm.family_id = f.id
        join public.profiles pf on pf.id = fm.profile_id and pf.is_active and pf.org_id = v_org
       where f.org_id = v_org and fm.profile_id <> v_me
         and (public.msg_profile_is_office(v_org, v_me) or public.msg_coach_serves_family(v_me, f.id));
  end if;
end $$;

-- Everyone who should hear about a new message in the thread (server only):
-- direct = participants (+ office for office threads); channel = scope staff
-- and guardians. Returns profile ids and sides, never contact details.
create or replace function public.msg_conversation_audience(p_conv uuid)
returns table (profile_id uuid, side text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_c public.msg_conversations%rowtype;
begin
  if not public.staff_is_service_caller() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  select * into v_c from public.msg_conversations where id = p_conv;
  if not found then return; end if;
  if v_c.kind = 'direct' then
    return query
      select p.profile_id, p.side from public.msg_participants p where p.conversation_id = p_conv
      union
      select sr.profile_id, 'staff' from public.staff_roles sr
       where v_c.office and sr.org_id = v_c.org_id and sr.role in ('admin', 'finance')
         and not exists (select 1 from public.msg_participants p where p.conversation_id = p_conv and p.side = 'staff');
  else
    return query
      select distinct co.profile_id, 'staff'::text from public.coaches co
       where co.org_id = v_c.org_id and co.profile_id is not null and (
         (v_c.team_id is not null and exists (select 1 from public.team_coaches tc where tc.team_id = v_c.team_id and tc.coach_id = co.id))
         or (v_c.program_id is not null and exists (select 1 from public.program_sessions ps where ps.program_id = v_c.program_id and ps.coach_id = co.id))
         or (v_c.camp_edition_id is not null and exists (
               select 1 from public.program_sessions ps join public.camp_editions e on e.program_id = ps.program_id
                where e.id = v_c.camp_edition_id and ps.coach_id = co.id)))
      union
      select distinct fm.profile_id, 'family'::text from public.athletes a
        join public.family_members fm on fm.family_id = a.family_id
       where a.org_id = v_c.org_id and (
         (v_c.team_id is not null and exists (select 1 from public.team_memberships tm where tm.team_id = v_c.team_id and tm.athlete_id = a.id and tm.status <> 'inactive'))
         or (v_c.program_id is not null and exists (select 1 from public.registrations r where r.program_id = v_c.program_id and r.athlete_id = a.id and r.status <> 'cancelled'))
         or (v_c.camp_edition_id is not null and exists (select 1 from public.registrations r where r.camp_edition_id = v_c.camp_edition_id and r.athlete_id = a.id and r.status <> 'cancelled')));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Notification preferences (per user)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  profile_id   uuid not null unique references public.profiles(id) on delete cascade,
  -- { "<category>": { "in_app": bool, "email": bool } }; categories:
  -- messages (in-app always on), alerts, leads, announcements
  channels     jsonb not null default '{}'::jsonb,
  quiet_start  time,
  quiet_end    time,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint notification_preferences_channels_chk check (jsonb_typeof(channels) = 'object'),
  constraint notification_preferences_quiet_chk check ((quiet_start is null) = (quiet_end is null))
);
create index if not exists idx_notification_preferences_org on public.notification_preferences(org_id);
drop trigger if exists trg_notification_preferences_updated on public.notification_preferences;
create trigger trg_notification_preferences_updated before update on public.notification_preferences
  for each row execute function public.set_updated_at();
drop trigger if exists trg_notification_preferences_org on public.notification_preferences;
create trigger trg_notification_preferences_org before insert or update on public.notification_preferences
  for each row execute function public.msg_same_org_guard('profile_id');

-- ---------------------------------------------------------------------------
-- 6) Alerts
-- ---------------------------------------------------------------------------
create table if not exists public.club_alerts (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  body             text,
  severity         text not null default 'info',
  audience         text not null default 'all',
  team_id          uuid references public.teams(id) on delete cascade,
  program_id       uuid references public.programs(id) on delete cascade,
  camp_edition_id  uuid references public.camp_editions(id) on delete cascade,
  starts_at        timestamptz not null default now(),
  expires_at       timestamptz,
  dispatched_at    timestamptz,
  cancelled_at     timestamptz,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint club_alerts_title_chk check (length(btrim(title)) between 1 and 140),
  constraint club_alerts_body_chk check (body is null or length(body) <= 2000),
  constraint club_alerts_severity_chk check (severity in ('info', 'warning', 'urgent')),
  constraint club_alerts_audience_chk check (audience in ('all', 'staff', 'parents', 'team', 'program', 'camp_edition')),
  constraint club_alerts_scope_chk check (
    (audience = 'team') = (team_id is not null)
    and (audience = 'program') = (program_id is not null)
    and (audience = 'camp_edition') = (camp_edition_id is not null)),
  constraint club_alerts_expiry_chk check (expires_at is null or expires_at > starts_at)
);
create index if not exists idx_club_alerts_org on public.club_alerts(org_id, starts_at desc);
create index if not exists idx_club_alerts_due on public.club_alerts(starts_at) where dispatched_at is null and cancelled_at is null;
drop trigger if exists trg_club_alerts_updated on public.club_alerts;
create trigger trg_club_alerts_updated before update on public.club_alerts
  for each row execute function public.set_updated_at();
drop trigger if exists trg_club_alerts_org on public.club_alerts;
create trigger trg_club_alerts_org before insert or update on public.club_alerts
  for each row execute function public.msg_same_org_guard('team_id', 'program_id', 'camp_edition_id', 'created_by');
drop trigger if exists trg_audit_club_alerts on public.club_alerts;
create trigger trg_audit_club_alerts after insert or update or delete on public.club_alerts
  for each row execute function public.audit_trigger();

create table if not exists public.club_alert_dismissals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  alert_id     uuid not null references public.club_alerts(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (alert_id, profile_id)
);
create index if not exists idx_club_alert_dismissals_org on public.club_alert_dismissals(org_id);
drop trigger if exists trg_club_alert_dismissals_updated on public.club_alert_dismissals;
create trigger trg_club_alert_dismissals_updated before update on public.club_alert_dismissals
  for each row execute function public.set_updated_at();
drop trigger if exists trg_club_alert_dismissals_org on public.club_alert_dismissals;
create trigger trg_club_alert_dismissals_org before insert or update on public.club_alert_dismissals
  for each row execute function public.msg_same_org_guard('alert_id', 'profile_id');

-- Is the caller in the alert's audience?
create or replace function public.club_alert_for_me(p_audience text, p_team uuid, p_program uuid, p_edition uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_audience
    when 'all'     then public.is_staff() or public.msg_profile_is_guardian(public.current_org_id(), auth.uid())
    when 'staff'   then public.is_staff()
    when 'parents' then public.msg_profile_is_guardian(public.current_org_id(), auth.uid())
    else public.msg_scope_staff(p_team, p_program, p_edition) or public.msg_scope_guardian(p_team, p_program, p_edition)
  end;
$$;

-- Recipients of an alert (server only): profile ids, never contact details.
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
    scoped_guardians as (
      select distinct fm.profile_id from public.athletes a join public.family_members fm on fm.family_id = a.family_id
       where a.org_id = v_a.org_id and (
         (v_a.team_id is not null and exists (select 1 from public.team_memberships tm where tm.team_id = v_a.team_id and tm.athlete_id = a.id and tm.status <> 'inactive'))
         or (v_a.program_id is not null and exists (select 1 from public.registrations r where r.program_id = v_a.program_id and r.athlete_id = a.id and r.status <> 'cancelled'))
         or (v_a.camp_edition_id is not null and exists (select 1 from public.registrations r where r.camp_edition_id = v_a.camp_edition_id and r.athlete_id = a.id and r.status <> 'cancelled'))))
    select x.profile_id from (
      select s.profile_id from staff s where v_a.audience in ('all', 'staff')
      union select g.profile_id from guardians g where v_a.audience in ('all', 'parents')
      union select ss.profile_id from scoped_staff ss where v_a.audience in ('team', 'program', 'camp_edition')
      union select sg.profile_id from scoped_guardians sg where v_a.audience in ('team', 'program', 'camp_edition')
    ) x
    join public.profiles p on p.id = x.profile_id and p.org_id = v_a.org_id and p.is_active;
end $$;

-- ---------------------------------------------------------------------------
-- 7) New contacts (leads)
-- ---------------------------------------------------------------------------
create table if not exists public.contact_leads (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  email            text not null,
  phone            text,
  message          text not null,
  interest         text not null default 'other',
  program_id       uuid references public.programs(id) on delete set null,
  source_page      text,
  locale           text,
  consent_contact  boolean not null,
  consent_at       timestamptz not null default now(),
  ip_hash          text,
  status           text not null default 'new',
  family_id        uuid references public.families(id) on delete set null,
  handled_by       uuid references public.profiles(id) on delete set null,
  replied_at       timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contact_leads_name_chk check (length(btrim(name)) between 1 and 120),
  constraint contact_leads_email_chk check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint contact_leads_phone_chk check (phone is null or length(phone) <= 40),
  constraint contact_leads_message_chk check (length(btrim(message)) between 1 and 3000),
  constraint contact_leads_interest_chk check (interest in ('camp', 'training', 'team', 'other')),
  constraint contact_leads_status_chk check (status in ('new', 'replied', 'converted', 'closed')),
  constraint contact_leads_consent_chk check (consent_contact),
  constraint contact_leads_source_chk check (source_page is null or length(source_page) <= 200)
);
create index if not exists idx_contact_leads_org on public.contact_leads(org_id, created_at desc);
create index if not exists idx_contact_leads_status on public.contact_leads(org_id, status);
create index if not exists idx_contact_leads_ip on public.contact_leads(org_id, ip_hash, created_at desc) where ip_hash is not null;
drop trigger if exists trg_contact_leads_updated on public.contact_leads;
create trigger trg_contact_leads_updated before update on public.contact_leads
  for each row execute function public.set_updated_at();
drop trigger if exists trg_contact_leads_org on public.contact_leads;
create trigger trg_contact_leads_org before insert or update on public.contact_leads
  for each row execute function public.msg_same_org_guard('program_id', 'family_id');
drop trigger if exists trg_audit_contact_leads on public.contact_leads;
create trigger trg_audit_contact_leads after insert or update or delete on public.contact_leads
  for each row execute function public.msg_audit_trigger('name', 'email', 'phone', 'message', 'ip_hash');

create table if not exists public.contact_lead_replies (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  lead_id      uuid not null references public.contact_leads(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,
  body         text not null,
  email_sent   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint contact_lead_replies_body_chk check (length(btrim(body)) between 1 and 5000)
);
create index if not exists idx_contact_lead_replies_org on public.contact_lead_replies(org_id);
create index if not exists idx_contact_lead_replies_lead on public.contact_lead_replies(lead_id, created_at);
drop trigger if exists trg_contact_lead_replies_updated on public.contact_lead_replies;
create trigger trg_contact_lead_replies_updated before update on public.contact_lead_replies
  for each row execute function public.set_updated_at();
drop trigger if exists trg_contact_lead_replies_org on public.contact_lead_replies;
create trigger trg_contact_lead_replies_org before insert or update on public.contact_lead_replies
  for each row execute function public.msg_same_org_guard('lead_id', 'author_id');
drop trigger if exists trg_audit_contact_lead_replies on public.contact_lead_replies;
create trigger trg_audit_contact_lead_replies after insert or update or delete on public.contact_lead_replies
  for each row execute function public.msg_audit_trigger('body');

-- Rate limits for the public form (mirrored in src/lib/messaging/rate-limit.ts).
create or replace function public.contact_lead_limits()
returns jsonb language sql immutable as $$
  select jsonb_build_object('per_ip_10min', 3, 'per_ip_day', 10, 'per_org_hour', 100);
$$;

-- Public "contact us" submission. SERVER ONLY (service role): the server
-- action resolves the org from the request host / slug, checks the honeypot
-- and passes a salted hash of the client IP (the IP itself is never stored).
create or replace function public.contact_lead_submit(
  p_org uuid, p_name text, p_email text, p_phone text, p_message text, p_interest text,
  p_consent boolean, p_source text default null, p_locale text default null, p_ip_hash text default null,
  p_program uuid default null)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  v_id     uuid;
  v_limits jsonb := public.contact_lead_limits();
begin
  if not public.staff_is_service_caller() then raise exception 'NOT_ALLOWED' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.organizations where id = p_org) then raise exception 'ORG_NOT_FOUND' using errcode = 'P0001'; end if;
  if not coalesce(p_consent, false) then raise exception 'CONSENT_REQUIRED' using errcode = 'P0001'; end if;
  if p_ip_hash is not null then
    if (select count(*) from public.contact_leads where org_id = p_org and ip_hash = p_ip_hash and created_at > now() - interval '10 minutes')
         >= (v_limits->>'per_ip_10min')::int
       or (select count(*) from public.contact_leads where org_id = p_org and ip_hash = p_ip_hash and created_at > now() - interval '1 day')
         >= (v_limits->>'per_ip_day')::int then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.contact_leads where org_id = p_org and created_at > now() - interval '1 hour')
       >= (v_limits->>'per_org_hour')::int then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;
  if p_program is not null and not exists (select 1 from public.programs where id = p_program and org_id = p_org) then
    p_program := null;
  end if;
  insert into public.contact_leads (org_id, name, email, phone, message, interest, program_id, source_page, locale, consent_contact, ip_hash)
    values (p_org, btrim(p_name), lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''), btrim(p_message),
            coalesce(p_interest, 'other'), p_program, left(p_source, 200), left(p_locale, 10), true, p_ip_hash)
    returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------
alter table public.messaging_settings       enable row level security;
alter table public.msg_conversations        enable row level security;
alter table public.msg_participants         enable row level security;
alter table public.msg_messages             enable row level security;
alter table public.msg_attachments          enable row level security;
alter table public.msg_read_state           enable row level security;
alter table public.msg_reports              enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.club_alerts              enable row level security;
alter table public.club_alert_dismissals    enable row level security;
alter table public.contact_leads            enable row level security;
alter table public.contact_lead_replies     enable row level security;

-- messaging_settings: members of the club read, admins write
drop policy if exists messaging_settings_select on public.messaging_settings;
create policy messaging_settings_select on public.messaging_settings for select
  using (org_id = public.current_org_id());
drop policy if exists messaging_settings_insert on public.messaging_settings;
create policy messaging_settings_insert on public.messaging_settings for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists messaging_settings_update on public.messaging_settings;
create policy messaging_settings_update on public.messaging_settings for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists messaging_settings_delete on public.messaging_settings;
create policy messaging_settings_delete on public.messaging_settings for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- msg_conversations: read by members (+ admins); created and moderated only
-- through the RPCs above (no direct writes).
drop policy if exists msg_conversations_select on public.msg_conversations;
create policy msg_conversations_select on public.msg_conversations for select
  using (org_id = public.current_org_id() and public.msg_can_read(id));
drop policy if exists msg_conversations_insert on public.msg_conversations;
create policy msg_conversations_insert on public.msg_conversations for insert with check (false);
drop policy if exists msg_conversations_update on public.msg_conversations;
create policy msg_conversations_update on public.msg_conversations for update using (false) with check (false);
drop policy if exists msg_conversations_delete on public.msg_conversations;
create policy msg_conversations_delete on public.msg_conversations for delete using (false);

-- msg_participants: visible to whoever can read the thread; own row may be
-- muted; membership changes only through the RPCs.
drop policy if exists msg_participants_select on public.msg_participants;
create policy msg_participants_select on public.msg_participants for select
  using (org_id = public.current_org_id() and public.msg_can_read(conversation_id));
drop policy if exists msg_participants_insert on public.msg_participants;
create policy msg_participants_insert on public.msg_participants for insert with check (false);
drop policy if exists msg_participants_update on public.msg_participants;
create policy msg_participants_update on public.msg_participants for update
  using (org_id = public.current_org_id() and profile_id = auth.uid())
  with check (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists msg_participants_delete on public.msg_participants;
create policy msg_participants_delete on public.msg_participants for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- msg_messages: readers see visible messages (admins and the sender also see
-- hidden ones); posting needs msg_can_post; admins moderate; no deletes.
drop policy if exists msg_messages_select on public.msg_messages;
create policy msg_messages_select on public.msg_messages for select
  using (org_id = public.current_org_id() and public.msg_can_read(conversation_id)
         and (hidden_at is null or public.is_admin() or sender_id = auth.uid()));
drop policy if exists msg_messages_insert on public.msg_messages;
create policy msg_messages_insert on public.msg_messages for insert
  with check (org_id = public.current_org_id() and sender_id = auth.uid()
              and hidden_at is null and hidden_by is null
              and public.msg_can_post(conversation_id));
drop policy if exists msg_messages_update on public.msg_messages;
create policy msg_messages_update on public.msg_messages for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists msg_messages_delete on public.msg_messages;
create policy msg_messages_delete on public.msg_messages for delete using (false);

-- msg_attachments
drop policy if exists msg_attachments_select on public.msg_attachments;
create policy msg_attachments_select on public.msg_attachments for select
  using (org_id = public.current_org_id() and public.msg_can_read(conversation_id)
         and (public.is_admin() or exists (select 1 from public.msg_messages m where m.id = message_id and m.hidden_at is null)));
drop policy if exists msg_attachments_insert on public.msg_attachments;
create policy msg_attachments_insert on public.msg_attachments for insert
  with check (org_id = public.current_org_id() and uploaded_by = auth.uid()
              and public.msg_can_post(conversation_id)
              and exists (select 1 from public.msg_messages m
                           where m.id = message_id and m.conversation_id = msg_attachments.conversation_id
                             and m.sender_id = auth.uid()));
drop policy if exists msg_attachments_update on public.msg_attachments;
create policy msg_attachments_update on public.msg_attachments for update using (false) with check (false);
drop policy if exists msg_attachments_delete on public.msg_attachments;
create policy msg_attachments_delete on public.msg_attachments for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- msg_read_state: own rows only
drop policy if exists msg_read_state_select on public.msg_read_state;
create policy msg_read_state_select on public.msg_read_state for select
  using (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists msg_read_state_insert on public.msg_read_state;
create policy msg_read_state_insert on public.msg_read_state for insert
  with check (org_id = public.current_org_id() and profile_id = auth.uid() and public.msg_can_read(conversation_id));
drop policy if exists msg_read_state_update on public.msg_read_state;
create policy msg_read_state_update on public.msg_read_state for update
  using (org_id = public.current_org_id() and profile_id = auth.uid())
  with check (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists msg_read_state_delete on public.msg_read_state;
create policy msg_read_state_delete on public.msg_read_state for delete
  using (org_id = public.current_org_id() and profile_id = auth.uid());

-- msg_reports: anyone who can read a message may report it; reporter and
-- admins see the report; admins resolve.
drop policy if exists msg_reports_select on public.msg_reports;
create policy msg_reports_select on public.msg_reports for select
  using (org_id = public.current_org_id() and (reporter_id = auth.uid() or public.is_admin()));
drop policy if exists msg_reports_insert on public.msg_reports;
create policy msg_reports_insert on public.msg_reports for insert
  with check (org_id = public.current_org_id() and reporter_id = auth.uid() and status = 'open'
              and public.msg_can_read(conversation_id)
              and exists (select 1 from public.msg_messages m where m.id = message_id and m.conversation_id = msg_reports.conversation_id));
drop policy if exists msg_reports_update on public.msg_reports;
create policy msg_reports_update on public.msg_reports for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists msg_reports_delete on public.msg_reports;
create policy msg_reports_delete on public.msg_reports for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- notification_preferences: own row only
drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences for select
  using (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists notification_preferences_insert on public.notification_preferences;
create policy notification_preferences_insert on public.notification_preferences for insert
  with check (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_update on public.notification_preferences for update
  using (org_id = public.current_org_id() and profile_id = auth.uid())
  with check (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists notification_preferences_delete on public.notification_preferences;
create policy notification_preferences_delete on public.notification_preferences for delete
  using (org_id = public.current_org_id() and profile_id = auth.uid());

-- club_alerts: admins all; coaches their own team/programme/camp alerts; the
-- audience sees started, non-cancelled alerts.
drop policy if exists club_alerts_select on public.club_alerts;
create policy club_alerts_select on public.club_alerts for select
  using (org_id = public.current_org_id() and (
    public.is_admin() or created_by = auth.uid()
    or (cancelled_at is null and starts_at <= now()
        and public.club_alert_for_me(audience, team_id, program_id, camp_edition_id))));
drop policy if exists club_alerts_insert on public.club_alerts;
create policy club_alerts_insert on public.club_alerts for insert
  with check (org_id = public.current_org_id() and created_by = auth.uid() and dispatched_at is null
              and (public.is_admin()
                   or (audience in ('team', 'program', 'camp_edition') and public.msg_scope_staff(team_id, program_id, camp_edition_id))));
drop policy if exists club_alerts_update on public.club_alerts;
create policy club_alerts_update on public.club_alerts for update
  using (org_id = public.current_org_id() and (public.is_admin() or created_by = auth.uid()))
  with check (org_id = public.current_org_id()
              and (public.is_admin()
                   or (created_by = auth.uid() and audience in ('team', 'program', 'camp_edition')
                       and public.msg_scope_staff(team_id, program_id, camp_edition_id))));
drop policy if exists club_alerts_delete on public.club_alerts;
create policy club_alerts_delete on public.club_alerts for delete
  using (org_id = public.current_org_id() and (public.is_admin() or created_by = auth.uid()));

-- club_alert_dismissals: own rows only
drop policy if exists club_alert_dismissals_select on public.club_alert_dismissals;
create policy club_alert_dismissals_select on public.club_alert_dismissals for select
  using (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists club_alert_dismissals_insert on public.club_alert_dismissals;
create policy club_alert_dismissals_insert on public.club_alert_dismissals for insert
  with check (org_id = public.current_org_id() and profile_id = auth.uid()
              and exists (select 1 from public.club_alerts a where a.id = alert_id));
drop policy if exists club_alert_dismissals_update on public.club_alert_dismissals;
create policy club_alert_dismissals_update on public.club_alert_dismissals for update
  using (org_id = public.current_org_id() and profile_id = auth.uid())
  with check (org_id = public.current_org_id() and profile_id = auth.uid());
drop policy if exists club_alert_dismissals_delete on public.club_alert_dismissals;
create policy club_alert_dismissals_delete on public.club_alert_dismissals for delete
  using (org_id = public.current_org_id() and profile_id = auth.uid());

-- contact_leads: admins of the club; new leads only via contact_lead_submit()
drop policy if exists contact_leads_select on public.contact_leads;
create policy contact_leads_select on public.contact_leads for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contact_leads_insert on public.contact_leads;
create policy contact_leads_insert on public.contact_leads for insert with check (false);
drop policy if exists contact_leads_update on public.contact_leads;
create policy contact_leads_update on public.contact_leads for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contact_leads_delete on public.contact_leads;
create policy contact_leads_delete on public.contact_leads for delete
  using (org_id = public.current_org_id() and public.is_admin());

drop policy if exists contact_lead_replies_select on public.contact_lead_replies;
create policy contact_lead_replies_select on public.contact_lead_replies for select
  using (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contact_lead_replies_insert on public.contact_lead_replies;
create policy contact_lead_replies_insert on public.contact_lead_replies for insert
  with check (org_id = public.current_org_id() and public.is_admin() and author_id = auth.uid());
drop policy if exists contact_lead_replies_update on public.contact_lead_replies;
create policy contact_lead_replies_update on public.contact_lead_replies for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists contact_lead_replies_delete on public.contact_lead_replies;
create policy contact_lead_replies_delete on public.contact_lead_replies for delete
  using (org_id = public.current_org_id() and public.is_admin());

-- Grants
grant select, insert, update, delete on
  public.messaging_settings, public.msg_conversations, public.msg_participants, public.msg_messages,
  public.msg_attachments, public.msg_read_state, public.msg_reports, public.notification_preferences,
  public.club_alerts, public.club_alert_dismissals, public.contact_leads, public.contact_lead_replies
  to authenticated;
grant all on
  public.messaging_settings, public.msg_conversations, public.msg_participants, public.msg_messages,
  public.msg_attachments, public.msg_read_state, public.msg_reports, public.notification_preferences,
  public.club_alerts, public.club_alert_dismissals, public.contact_leads, public.contact_lead_replies
  to service_role;

-- Function privileges: helpers + caller RPCs for signed-in users; audience,
-- recipient and lead-submission functions for server code only.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.msg_audit_trigger()',
    'public.msg_same_org_guard()',
    'public.msg_participants_guard()',
    'public.msg_messages_guard()',
    'public.msg_after_message()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'public.msg_profile_is_staff(uuid, uuid)',
    'public.msg_profile_is_office(uuid, uuid)',
    'public.msg_profile_is_guardian(uuid, uuid)',
    'public.msg_coach_serves_family(uuid, uuid)',
    'public.msg_scope_staff(uuid, uuid, uuid)',
    'public.msg_scope_guardian(uuid, uuid, uuid)',
    'public.msg_setting(uuid, text)',
    'public.msg_is_member(uuid)',
    'public.msg_can_read(uuid)',
    'public.msg_can_post(uuid)',
    'public.msg_can_contact(uuid)',
    'public.msg_start_direct(uuid, text, text, uuid, boolean)',
    'public.msg_start_channel(text, uuid, text, text, boolean, boolean)',
    'public.msg_set_status(uuid, text)',
    'public.msg_hide_message(uuid, boolean, text)',
    'public.msg_mark_read(uuid)',
    'public.msg_inbox(boolean, integer)',
    'public.msg_people(uuid)',
    'public.msg_contacts()',
    'public.club_alert_for_me(text, uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public.msg_conversation_audience(uuid)',
    'public.club_alert_recipients(uuid)',
    'public.contact_lead_submit(uuid, text, text, text, text, text, boolean, text, text, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 9) Message attachments: private bucket, key <org_id>/<conversation_id>/<file>
-- ---------------------------------------------------------------------------
create or replace function public.msg_attachment_file_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_re    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_conv  uuid;
begin
  if auth.uid() is null or p_name is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' then return false; end if;
  if v_parts[1] !~ v_re or v_parts[2] !~ v_re then return false; end if;
  if v_parts[1]::uuid is distinct from public.current_org_id() then return false; end if;
  v_conv := v_parts[2]::uuid;
  if not exists (select 1 from public.msg_conversations where id = v_conv and org_id = v_parts[1]::uuid) then return false; end if;
  if p_write then return public.msg_can_post(v_conv); end if;
  return public.msg_can_read(v_conv)
     and exists (select 1 from public.msg_attachments a join public.msg_messages m on m.id = a.message_id
                  where a.storage_path = p_name and (m.hidden_at is null or public.is_admin()));
end $$;
revoke all on function public.msg_attachment_file_access(text, boolean) from public, anon;
grant execute on function public.msg_attachment_file_access(text, boolean) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('message-attachments', 'message-attachments', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 2621440 where id = 'message-attachments'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp']
                 where id = 'message-attachments'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists msg_files_select on storage.objects$p$;
    execute $p$create policy msg_files_select on storage.objects for select to authenticated
      using (bucket_id = 'message-attachments' and public.msg_attachment_file_access(name, false))$p$;
    execute $p$drop policy if exists msg_files_insert on storage.objects$p$;
    execute $p$create policy msg_files_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'message-attachments' and public.msg_attachment_file_access(name, true))$p$;
    execute $p$drop policy if exists msg_files_update on storage.objects$p$;
    execute $p$create policy msg_files_update on storage.objects for update to authenticated
      using (bucket_id = 'message-attachments' and false)
      with check (bucket_id = 'message-attachments' and false)$p$;
    execute $p$drop policy if exists msg_files_delete on storage.objects$p$;
    execute $p$create policy msg_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'message-attachments' and public.is_admin()
             and (storage.foldername(name))[1] = public.current_org_id()::text)$p$;
  end if;
end $$;
