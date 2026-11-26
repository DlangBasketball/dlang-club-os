-- Link requests: relatives and friends name their relation.
--
-- The request form only offered mother / father / legal guardian / other
-- carer, so an aunt asking for one child's access was recorded as "other
-- carer". A request can now name the relations of per-child links (aunt /
-- uncle, grandparent, adult sibling, family friend); the approver's default
-- scope for those is "This child only" (UI) and the per-child link keeps the
-- requested relation unless the approver changes it. A whole-family approval
-- of a relative stores a family-member relation the family pages know
-- (grandparent kept, other relatives -> 'other').
-- Additive / idempotent: widened check, participant_link_decide replaced with
-- the same signature (grants kept).

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'athlete_link_requests_relation_chk'
              and conrelid = 'public.athlete_link_requests'::regclass
              and pg_get_constraintdef(oid) not like '%aunt_uncle%') then
    alter table public.athlete_link_requests drop constraint athlete_link_requests_relation_chk;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'athlete_link_requests_relation_chk'
                  and conrelid = 'public.athlete_link_requests'::regclass) then
    alter table public.athlete_link_requests add constraint athlete_link_requests_relation_chk
      check (relation in ('mother', 'father', 'guardian', 'other', 'aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend'));
  end if;
end $$;

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
    -- A per-child link of the same adult is superseded by the family access.
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
    v_perm := jsonb_build_object(
      'scope', 'athlete', 'relation', v_rel,
      'can_register', coalesce((p_permissions->>'can_register')::boolean, true),
      'can_pay', coalesce((p_permissions->>'can_pay')::boolean, true),
      'can_see_medical', coalesce((p_permissions->>'can_see_medical')::boolean, false),
      'receives_emails', coalesce((p_permissions->>'receives_emails')::boolean, true),
      'can_edit_profile', coalesce((p_permissions->>'can_edit_profile')::boolean, false));
    if (v_perm->>'can_register')::boolean and not (v_perm->>'can_pay')::boolean then
      raise exception 'REGISTER_NEEDS_PAY' using errcode = 'P0001';
    end if;
    -- Already a family guardian of this child: nothing to add.
    if not exists (select 1 from public.family_members where family_id = v_fam and profile_id = r.requester_profile_id) then
      select id into v_link from public.athlete_guardian_links
       where athlete_id = r.athlete_id and profile_id = r.requester_profile_id and status = 'active';
      if v_link is null then
        insert into public.athlete_guardian_links
          (org_id, athlete_id, profile_id, relation, can_register, can_pay, can_see_medical, receives_emails, can_edit_profile,
           granted_by, link_request_id)
        values (r.org_id, r.athlete_id, r.requester_profile_id, v_rel, (v_perm->>'can_register')::boolean,
                (v_perm->>'can_pay')::boolean, (v_perm->>'can_see_medical')::boolean, (v_perm->>'receives_emails')::boolean,
                (v_perm->>'can_edit_profile')::boolean, auth.uid(), r.id)
        returning id into v_link;
      else
        update public.athlete_guardian_links
           set relation = v_rel, can_register = (v_perm->>'can_register')::boolean, can_pay = (v_perm->>'can_pay')::boolean,
               can_see_medical = (v_perm->>'can_see_medical')::boolean, receives_emails = (v_perm->>'receives_emails')::boolean,
               can_edit_profile = (v_perm->>'can_edit_profile')::boolean, link_request_id = r.id
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

-- Request: accept the relative / friend relations too (same body otherwise).
create or replace function public.participant_link_request(p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid := public.current_org_id();
  v_rep   jsonb;
  v_first text := btrim(coalesce(p_payload->>'first_name', ''));
  v_last  text := btrim(coalesce(p_payload->>'last_name', ''));
  v_rel   text := lower(coalesce(nullif(btrim(coalesce(p_payload->>'relation', '')), ''), 'guardian'));
  v_dob   date;
  v_ath   uuid;
  v_id    uuid;
  v_res   jsonb;
begin
  if v_me is null then raise exception 'NOT_AUTHENTICATED' using errcode = '42501'; end if;
  if v_org is null then raise exception 'NO_ORG' using errcode = '42501'; end if;
  if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rep := public.bk_replay(p_request_id, 'participant_link');
  if v_rep is not null then return v_rep; end if;
  if v_rel not in ('mother', 'father', 'guardian', 'other', 'aunt_uncle', 'grandparent', 'adult_sibling', 'family_friend') then raise exception 'INVALID_RELATION' using errcode = 'P0001'; end if;
  if length(v_first) = 0 or length(v_first) > 80 or length(v_last) = 0 or length(v_last) > 80 then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_dob := public.participant_read_dob(p_payload, v_org);
  select m into v_ath from public.participant_matches(v_org, v_first, v_last, v_dob, v_me) m limit 1;
  if v_ath is null then raise exception 'NO_MATCH' using errcode = 'P0002'; end if;

  select id into v_id from public.athlete_link_requests
   where athlete_id = v_ath and requester_profile_id = v_me and status = 'pending';
  if v_id is null then
    insert into public.athlete_link_requests (org_id, athlete_id, requester_profile_id, relation, submitted, request_id)
    values (v_org, v_ath, v_me, v_rel, jsonb_build_object('first_name', v_first, 'last_name', v_last, 'dob', v_dob), p_request_id)
    returning id into v_id;
    perform public.bk_flag(v_org, 'athlete_link_requests', v_id, 'ATHLETE_LINK_REQUEST', jsonb_build_object('athlete_id', v_ath));
  end if;
  v_res := jsonb_build_object('ok', true, 'link_request_id', v_id, 'status', 'pending');
  return public.bk_remember(p_request_id, 'participant_link', v_res);
end $$;
