-- ============================================================================
-- Coach management: admin page for coaches, coach profile photos, safe delete.
-- Additive and idempotent.
--
--  1) coaches.photo_path (+ photo_updated_at): key of the coach's photo in the
--     PRIVATE bucket "coach-photos", path <org_id>/<coach_id>/<file>. The path
--     must sit under the coach's own org + id (check constraint).
--  2) Storage bucket "coach-photos" (private, 2 MB, jpeg/webp/png) and its
--     object policies through public.coach_photo_access():
--       read  : any signed-in member of the coach's org (staff and guardians:
--               coaches are adult staff and the photo helps parents recognise
--               them). Other orgs and anonymous callers: denied.
--       write : admins of that org, and the coach themself when the coach row
--               is linked to their login (coaches.profile_id = auth.uid()).
--  3) set_coach_photo(): the only way a linked coach (not admin) can change a
--     column of the coaches row; admins use it too, so both paths share the
--     same scope checks.
--  4) coach_usage() / delete_coach_if_unused(): a coach that is referenced by
--     teams, sessions, attendance, availability or bookings is never hard
--     deleted (deactivate instead); an unreferenced coach can be deleted.
--  5) Audit triggers on coaches and team_coaches (staff personal data).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Photo columns
-- ---------------------------------------------------------------------------
alter table public.coaches add column if not exists photo_path text;
alter table public.coaches add column if not exists photo_updated_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coaches_photo_path_scope') then
    alter table public.coaches add constraint coaches_photo_path_scope
      check (photo_path is null
             or photo_path like (org_id::text || '/' || id::text || '/%'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'coaches_display_name_len') then
    alter table public.coaches add constraint coaches_display_name_len
      check (char_length(btrim(display_name)) between 1 and 120) not valid;
  end if;
end $$;

create index if not exists idx_coaches_org_active on public.coaches(org_id, is_active);

-- ---------------------------------------------------------------------------
-- 2) Storage: private bucket + object policies
-- ---------------------------------------------------------------------------
-- Key format: <org_id>/<coach_id>/<file>. The org segment must be the caller's
-- org AND the coach's org.
create or replace function public.coach_photo_access(p_name text, p_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_org   uuid;
  v_coach uuid;
  v_re    constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if auth.uid() is null or p_name is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if coalesce(array_length(v_parts, 1), 0) <> 3 or v_parts[3] = '' then return false; end if;
  if v_parts[1] !~ v_re or v_parts[2] !~ v_re then return false; end if;
  v_org := v_parts[1]::uuid;
  v_coach := v_parts[2]::uuid;
  if v_org is distinct from public.current_org_id() then return false; end if;
  if not exists (select 1 from public.coaches c where c.id = v_coach and c.org_id = v_org) then
    return false;
  end if;
  if not p_write then return true; end if;  -- any member of the same org may view
  if public.is_admin() then return true; end if;
  return exists (select 1 from public.coaches c
                  where c.id = v_coach and c.org_id = v_org and c.profile_id = auth.uid());
end $$;

revoke all on function public.coach_photo_access(text, boolean) from public, anon;
grant execute on function public.coach_photo_access(text, boolean) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('coach-photos', 'coach-photos', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 2097152 where id = 'coach-photos'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['image/jpeg','image/webp','image/png']
                 where id = 'coach-photos'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists coach_photos_select on storage.objects$p$;
    execute $p$create policy coach_photos_select on storage.objects for select to authenticated
      using (bucket_id = 'coach-photos' and public.coach_photo_access(name, false))$p$;

    execute $p$drop policy if exists coach_photos_insert on storage.objects$p$;
    execute $p$create policy coach_photos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'coach-photos' and public.coach_photo_access(name, true))$p$;

    execute $p$drop policy if exists coach_photos_update on storage.objects$p$;
    execute $p$create policy coach_photos_update on storage.objects for update to authenticated
      using (bucket_id = 'coach-photos' and public.coach_photo_access(name, true))
      with check (bucket_id = 'coach-photos' and public.coach_photo_access(name, true))$p$;

    execute $p$drop policy if exists coach_photos_delete on storage.objects$p$;
    execute $p$create policy coach_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'coach-photos' and public.coach_photo_access(name, true))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) set_coach_photo: admin of the org, or the linked coach themself
-- ---------------------------------------------------------------------------
-- Returns the previous photo_path (so the caller removes the old object).
create or replace function public.set_coach_photo(p_coach uuid, p_path text)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.coaches%rowtype;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.coaches where id = p_coach for update;
  if not found or v_row.org_id is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_admin() or coalesce(v_row.profile_id = auth.uid(), false)) then
    raise exception 'FORBIDDEN';
  end if;
  if p_path is not null and p_path not like (v_row.org_id::text || '/' || v_row.id::text || '/%') then
    raise exception 'INVALID_PATH';
  end if;
  update public.coaches
     set photo_path = p_path, photo_updated_at = now()
   where id = v_row.id;
  return v_row.photo_path;
end $$;

revoke all on function public.set_coach_photo(uuid, text) from public, anon;
grant execute on function public.set_coach_photo(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Usage counts and safe delete (admins of the coach's org only)
-- ---------------------------------------------------------------------------
create or replace function public.coach_usage(p_coach uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select org_id into v_org from public.coaches where id = p_coach;
  if v_org is null or v_org is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND';
  end if;
  return jsonb_build_object(
    'teams',         (select count(*) from public.team_coaches        where coach_id = p_coach),
    'sessions',      (select count(*) from public.program_sessions    where coach_id = p_coach),
    'attendance',    (select count(*) from public.attendance_sessions where coach_id = p_coach)
                   + (select count(*) from public.attendance_marks    where marked_by = p_coach),
    'availability',  (select count(*) from public.coach_availability  where coach_id = p_coach),
    'bookings',      (select count(*) from public.training_bookings   where coach_id = p_coach)
  );
end $$;

revoke all on function public.coach_usage(uuid) from public, anon;
grant execute on function public.coach_usage(uuid) to authenticated, service_role;

-- Deletes the coach only when nothing references it. Returns
-- {"deleted": true, "photo_path": <path or null>} so the caller removes the
-- photo object; raises COACH_IN_USE otherwise.
create or replace function public.delete_coach_if_unused(p_coach uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row   public.coaches%rowtype;
  v_usage jsonb;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.coaches where id = p_coach for update;
  if not found or v_row.org_id is distinct from public.current_org_id() then
    raise exception 'NOT_FOUND';
  end if;
  v_usage := public.coach_usage(p_coach);
  if (select coalesce(sum(value::bigint), 0) from jsonb_each_text(v_usage)) > 0 then
    raise exception 'COACH_IN_USE';
  end if;
  update public.invitations set coach_id = null
   where coach_id = p_coach and org_id = v_row.org_id;
  delete from public.coaches where id = p_coach and org_id = v_row.org_id;
  return jsonb_build_object('deleted', true, 'photo_path', v_row.photo_path);
end $$;

revoke all on function public.delete_coach_if_unused(uuid) from public, anon;
grant execute on function public.delete_coach_if_unused(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Audit trail
-- ---------------------------------------------------------------------------
drop trigger if exists trg_audit_coaches on public.coaches;
create trigger trg_audit_coaches after insert or update or delete on public.coaches
  for each row execute function public.audit_trigger();

drop trigger if exists trg_audit_team_coaches on public.team_coaches;
create trigger trg_audit_team_coaches after insert or update or delete on public.team_coaches
  for each row execute function public.audit_trigger();
