-- ============================================================================
-- Club OS - Member card QR check-in as a separate club decision (Nov 2026).
--
-- The Courtside card (brands, portrait / photo-free layouts, photos) is used
-- without the check-in function until the club decides to use it:
--   * app_settings.settings.member_card.qr_check_in (boolean, default false);
--   * org_card_check_in_enabled(org) reads it;
--   * member_card_check_in refuses with CHECK_IN_DISABLED while it is off
--     (whatever the caller: coach scanner, NFC, direct RPC call).
-- The card token (member_cards) is not touched: turning the setting on later
-- makes the existing cards scannable. Additive and idempotent.
-- ============================================================================

create or replace function public.org_card_check_in_enabled(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(s.settings->'member_card'->'qr_check_in') = 'boolean'
                               then (s.settings->'member_card'->>'qr_check_in')::boolean end
                     from public.app_settings s where s.org_id = p_org), false);
$$;
revoke all on function public.org_card_check_in_enabled(uuid) from public, anon;
grant execute on function public.org_card_check_in_enabled(uuid) to authenticated;

-- The signed-in user's club setting (any member of the club may read it: it decides whether a QR is shown).
create or replace function public.card_check_in_setting()
returns boolean language sql stable security definer set search_path = public as $$
  select public.org_card_check_in_enabled(public.current_org_id());
$$;
revoke all on function public.card_check_in_setting() from public, anon;
grant execute on function public.card_check_in_setting() to authenticated;

create or replace function public.member_card_check_in(p_event uuid, p_token text, p_request_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_ev    public.events%rowtype;
  v_tok   text := btrim(coalesce(p_token, ''));
  v_parts text[];
  v_tag   text;
  c       public.member_cards%rowtype;
  s       public.team_attendance_sheets%rowtype;
  m       public.team_attendance_marks%rowtype;
  v_name  text;
  v_res   jsonb;
begin
  -- QR / NFC check-in is a club decision of its own (20250420106900): off unless the club turned it on.
  if not public.org_card_check_in_enabled(public.current_org_id()) then
    raise exception 'CHECK_IN_DISABLED' using errcode = 'P0001';
  end if;
  -- Same checks as every sheet write: org, ta_can_run (admin / coach who
  -- runs the event / approved substitute), sheet event type.
  v_ev := public.ta_event_for_write(p_event);
  if length(v_tok) = 0 or length(v_tok) > 200 then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD'); end if;

  if v_tok ~ '^M1\.[0-9a-f]{32}\.[0-9a-f]{32}$' then
    v_parts := string_to_array(v_tok, '.');
    select * into c from public.member_cards mc where mc.nonce = v_parts[2] and mc.org_id = v_ev.org_id and mc.is_active;
    if not found or public.member_card_sign(v_ev.org_id, c.nonce, c.version) <> v_parts[3] then
      return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD');
    end if;
  else
    v_tag := nullif(upper(regexp_replace(v_tok, '[^0-9A-Fa-f]', '', 'g')), '');
    if v_tag is null or length(v_tag) < 4 then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD'); end if;
    select * into c from public.member_cards mc where mc.nfc_tag_id = v_tag and mc.org_id = v_ev.org_id and mc.is_active;
    if not found then return jsonb_build_object('ok', false, 'code', 'UNKNOWN_CARD'); end if;
  end if;

  perform public.attendance_open(p_event);
  select * into s from public.team_attendance_sheets where event_id = p_event;
  select * into m from public.team_attendance_marks where sheet_id = s.id and athlete_id = c.athlete_id;
  if found or public.is_admin() or public.coach_can_access_athlete(c.athlete_id) then
    select btrim(first_name || ' ' || last_name) into v_name from public.athletes where id = c.athlete_id;
  end if;
  if m.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_ON_SHEET', 'athlete_id', case when v_name is not null then c.athlete_id end,
                              'name', v_name);
  end if;
  if s.status = 'final' then
    return jsonb_build_object('ok', false, 'code', 'SHEET_FINAL', 'athlete_id', c.athlete_id, 'name', v_name, 'status', m.finalized_status);
  end if;
  if m.status in ('present', 'late') then
    return jsonb_build_object('ok', true, 'already', true, 'athlete_id', c.athlete_id, 'name', v_name, 'status', m.status,
                              'version', s.version);
  end if;

  v_res := public.attendance_save(p_event,
             jsonb_build_array(jsonb_build_object('athlete_id', c.athlete_id, 'status', 'present', 'base_rev', m.rev)),
             s.version, p_request_id, false);
  if jsonb_array_length(coalesce(v_res->'conflicts', '[]'::jsonb)) > 0 then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'athlete_id', c.athlete_id, 'name', v_name);
  end if;
  if jsonb_array_length(coalesce(v_res->'applied', '[]'::jsonb)) > 0 then
    insert into public.audit_logs (org_id, actor_id, action, target_table, target_id, new_data)
    values (v_ev.org_id, auth.uid(), 'MEMBER_CARD_CHECK_IN', 'team_attendance_marks', m.id,
            jsonb_build_object('event_id', p_event, 'athlete_id', c.athlete_id));
  end if;
  return jsonb_build_object('ok', true, 'already', coalesce((v_res->>'replayed')::boolean, false),
                            'athlete_id', c.athlete_id, 'name', v_name, 'status', 'present', 'version', v_res->'version');
end $$;
