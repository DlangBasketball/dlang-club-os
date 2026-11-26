-- ============================================================================
-- Athlete development: assessments, evaluations, rankings settings, exercise
-- library, workout / training plans, nutrition plans, daily wellness.
--
--   * development_settings: per-org ranking weights (attendance vs latest
--     evaluation), window, progress levels (thresholds + emoji), whether
--     families see their own rank band.
--   * assessment_templates / assessment_items: assessment builder per sport
--     and age group. Items are skills (scored on a configurable scale),
--     measurements (value + unit) or free text.
--   * evaluations / evaluation_scores: a coach evaluates an athlete against a
--     template. overall_score (0-100) is recomputed by trigger from the
--     weighted skill scores (mirrors src/lib/development/scoring.ts).
--     Families read an evaluation only once it is shared.
--   * exercises (+ private bucket "exercise-videos"), training_plans,
--     training_plan_items (week -> day -> exercise), training_plan_assignments
--     (manual or auto), training_plan_completions (check-off + feedback).
--   * nutrition_plans / nutrition_plan_meals / nutrition_plan_assignments.
--   * teams.wellness_enabled + wellness_checkins (sleep, energy, soreness,
--     mood 1-5 + note).
--
-- Evaluations, measurements, assignments, completions and wellness are
-- personal data of children: admins of the org, the athlete's coaches
-- (coach_can_access_athlete) and the child's guardians only. Finance gets no
-- policy on any of them. Additive and idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------
create or replace function public.development_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.has_role('coach');
$$;

-- Every "column:table" pair in the trigger arguments must point at a row of
-- the same org as the new row (no cross-tenant references).
create or replace function public.development_same_org_guard()
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
    if v_tab not in ('athletes', 'coaches', 'teams', 'assessment_templates', 'assessment_items', 'evaluations', 'exercises',
                     'training_plans', 'training_plan_items', 'training_plan_assignments', 'nutrition_plans') then
      raise exception 'development_same_org_guard: unknown table %', v_tab;
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

-- ---------------------------------------------------------------------------
-- 1) Settings (one row per org)
-- ---------------------------------------------------------------------------
create table if not exists public.development_settings (
  org_id               uuid primary key references public.organizations(id) on delete cascade,
  attendance_weight    numeric(5,2) not null default 50 check (attendance_weight between 0 and 100),
  evaluation_weight    numeric(5,2) not null default 50 check (evaluation_weight between 0 and 100),
  window_days          integer not null default 90 check (window_days between 7 and 730),
  levels               jsonb not null default '[{"min":0,"emoji":"🌱"},{"min":40,"emoji":"⭐"},{"min":60,"emoji":"🔥"},{"min":75,"emoji":"🏅"},{"min":90,"emoji":"🏆"}]'::jsonb
                       check (jsonb_typeof(levels) = 'array' and jsonb_array_length(levels) between 1 and 10),
  family_rank_visible  boolean not null default true,
  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint development_settings_weights_chk check (attendance_weight + evaluation_weight > 0)
);
drop trigger if exists trg_dev_settings_updated on public.development_settings;
create trigger trg_dev_settings_updated before update on public.development_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_audit_dev_settings on public.development_settings;
create trigger trg_audit_dev_settings after insert or update or delete on public.development_settings
  for each row execute function public.audit_trigger();

alter table public.development_settings enable row level security;
drop policy if exists dev_settings_select on public.development_settings;
create policy dev_settings_select on public.development_settings for select
  using (org_id = public.current_org_id());
drop policy if exists dev_settings_insert on public.development_settings;
create policy dev_settings_insert on public.development_settings for insert
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists dev_settings_update on public.development_settings;
create policy dev_settings_update on public.development_settings for update
  using (org_id = public.current_org_id() and public.is_admin())
  with check (org_id = public.current_org_id() and public.is_admin());
drop policy if exists dev_settings_delete on public.development_settings;
create policy dev_settings_delete on public.development_settings for delete
  using (org_id = public.current_org_id() and public.is_admin());
grant select, insert, update, delete on public.development_settings to authenticated;
grant all on public.development_settings to service_role;

-- ---------------------------------------------------------------------------
-- 2) Assessment builder
-- ---------------------------------------------------------------------------
create table if not exists public.assessment_templates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text check (description is null or length(description) <= 2000),
  sport        text check (sport is null or length(sport) <= 60),
  age_group    text check (age_group is null or length(age_group) <= 40),
  age_min      smallint check (age_min is null or age_min between 0 and 99),
  age_max      smallint check (age_max is null or age_max between 0 and 99),
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint assessment_templates_age_chk check (age_min is null or age_max is null or age_min <= age_max)
);
create index if not exists idx_assessment_templates_org on public.assessment_templates(org_id, is_active);
drop trigger if exists trg_assessment_templates_updated on public.assessment_templates;
create trigger trg_assessment_templates_updated before update on public.assessment_templates
  for each row execute function public.set_updated_at();

create table if not exists public.assessment_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  template_id       uuid not null references public.assessment_templates(id) on delete cascade,
  kind              text not null check (kind in ('skill', 'measurement', 'text')),
  label             text not null check (length(btrim(label)) between 1 and 120),
  description       text check (description is null or length(description) <= 500),
  category          text check (category is null or length(category) <= 60),
  scale_min         smallint not null default 1 check (scale_min between 0 and 100),
  scale_max         smallint not null default 5 check (scale_max between 1 and 100),
  unit              text check (unit is null or length(unit) <= 20),
  higher_is_better  boolean not null default true,
  weight            numeric(6,2) not null default 1 check (weight > 0 and weight <= 100),
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint assessment_items_scale_chk check (scale_max > scale_min)
);
create index if not exists idx_assessment_items_org on public.assessment_items(org_id);
create index if not exists idx_assessment_items_template on public.assessment_items(template_id, sort_order);
drop trigger if exists trg_assessment_items_updated on public.assessment_items;
create trigger trg_assessment_items_updated before update on public.assessment_items
  for each row execute function public.set_updated_at();
drop trigger if exists trg_assessment_items_same_org on public.assessment_items;
create trigger trg_assessment_items_same_org before insert or update on public.assessment_items
  for each row execute function public.development_same_org_guard('template_id:assessment_templates');

create or replace function public.development_can_edit_template(p_template uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.assessment_templates t
     where t.id = p_template and t.org_id = public.current_org_id()
       and (public.is_admin() or (public.has_role('coach') and t.created_by = auth.uid()))
  );
$$;

alter table public.assessment_templates enable row level security;
drop policy if exists assessment_templates_select on public.assessment_templates;
create policy assessment_templates_select on public.assessment_templates for select
  using (org_id = public.current_org_id());
drop policy if exists assessment_templates_insert on public.assessment_templates;
create policy assessment_templates_insert on public.assessment_templates for insert
  with check (org_id = public.current_org_id() and public.development_is_staff());
drop policy if exists assessment_templates_update on public.assessment_templates;
create policy assessment_templates_update on public.assessment_templates for update
  using (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())))
  with check (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())));
drop policy if exists assessment_templates_delete on public.assessment_templates;
create policy assessment_templates_delete on public.assessment_templates for delete
  using (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())));
grant select, insert, update, delete on public.assessment_templates to authenticated;
grant all on public.assessment_templates to service_role;

alter table public.assessment_items enable row level security;
drop policy if exists assessment_items_select on public.assessment_items;
create policy assessment_items_select on public.assessment_items for select
  using (org_id = public.current_org_id());
drop policy if exists assessment_items_insert on public.assessment_items;
create policy assessment_items_insert on public.assessment_items for insert
  with check (org_id = public.current_org_id() and public.development_can_edit_template(template_id));
drop policy if exists assessment_items_update on public.assessment_items;
create policy assessment_items_update on public.assessment_items for update
  using (org_id = public.current_org_id() and public.development_can_edit_template(template_id))
  with check (org_id = public.current_org_id() and public.development_can_edit_template(template_id));
drop policy if exists assessment_items_delete on public.assessment_items;
create policy assessment_items_delete on public.assessment_items for delete
  using (org_id = public.current_org_id() and public.development_can_edit_template(template_id));
grant select, insert, update, delete on public.assessment_items to authenticated;
grant all on public.assessment_items to service_role;

-- ---------------------------------------------------------------------------
-- 3) Evaluations
-- ---------------------------------------------------------------------------
create table if not exists public.evaluations (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  athlete_id          uuid not null references public.athletes(id) on delete cascade,
  template_id         uuid not null references public.assessment_templates(id) on delete restrict,
  coach_id            uuid references public.coaches(id) on delete set null,
  team_id             uuid references public.teams(id) on delete set null,
  evaluated_on        date not null default current_date,
  overall_score       numeric(5,2) check (overall_score is null or overall_score between 0 and 100),
  comments            text check (comments is null or length(comments) <= 4000),
  shared_with_family  boolean not null default false,
  shared_at           timestamptz,
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_evaluations_org on public.evaluations(org_id);
create index if not exists idx_evaluations_athlete on public.evaluations(athlete_id, evaluated_on desc);
create index if not exists idx_evaluations_team on public.evaluations(team_id);
drop trigger if exists trg_evaluations_updated on public.evaluations;
create trigger trg_evaluations_updated before update on public.evaluations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_evaluations_same_org on public.evaluations;
create trigger trg_evaluations_same_org before insert or update on public.evaluations
  for each row execute function public.development_same_org_guard(
    'athlete_id:athletes', 'template_id:assessment_templates', 'coach_id:coaches', 'team_id:teams');
drop trigger if exists trg_audit_evaluations on public.evaluations;
create trigger trg_audit_evaluations after insert or update or delete on public.evaluations
  for each row execute function public.audit_trigger();

-- shared_at follows shared_with_family.
create or replace function public.evaluations_share_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.shared_with_family and (tg_op = 'INSERT' or not old.shared_with_family) then
    new.shared_at := now();
  elsif not new.shared_with_family then
    new.shared_at := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_evaluations_share_stamp on public.evaluations;
create trigger trg_evaluations_share_stamp before insert or update on public.evaluations
  for each row execute function public.evaluations_share_stamp();

create table if not exists public.evaluation_scores (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  evaluation_id  uuid not null references public.evaluations(id) on delete cascade,
  item_id        uuid not null references public.assessment_items(id) on delete cascade,
  score          numeric(6,2),
  value          numeric(10,3),
  text_value     text check (text_value is null or length(text_value) <= 2000),
  comment        text check (comment is null or length(comment) <= 1000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (evaluation_id, item_id)
);
create index if not exists idx_evaluation_scores_org on public.evaluation_scores(org_id);
create index if not exists idx_evaluation_scores_item on public.evaluation_scores(item_id);
drop trigger if exists trg_evaluation_scores_updated on public.evaluation_scores;
create trigger trg_evaluation_scores_updated before update on public.evaluation_scores
  for each row execute function public.set_updated_at();
drop trigger if exists trg_evaluation_scores_same_org on public.evaluation_scores;
create trigger trg_evaluation_scores_same_org before insert or update on public.evaluation_scores
  for each row execute function public.development_same_org_guard('evaluation_id:evaluations', 'item_id:assessment_items');
drop trigger if exists trg_audit_evaluation_scores on public.evaluation_scores;
create trigger trg_audit_evaluation_scores after insert or update or delete on public.evaluation_scores
  for each row execute function public.audit_trigger();

-- Item must belong to the evaluation's template; skill scores stay on the scale.
create or replace function public.evaluation_scores_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_item public.assessment_items%rowtype;
  v_tpl  uuid;
begin
  select * into v_item from public.assessment_items where id = new.item_id;
  select template_id into v_tpl from public.evaluations where id = new.evaluation_id;
  if v_item.id is null or v_tpl is null or v_item.template_id <> v_tpl then
    raise exception 'ITEM_TEMPLATE_MISMATCH' using errcode = 'P0001';
  end if;
  if v_item.kind = 'skill' then
    new.value := null; new.text_value := null;
    if new.score is not null and (new.score < v_item.scale_min or new.score > v_item.scale_max) then
      raise exception 'SCORE_OUT_OF_RANGE' using errcode = 'P0001';
    end if;
  elsif v_item.kind = 'measurement' then
    new.score := null; new.text_value := null;
  else
    new.score := null; new.value := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_evaluation_scores_validate on public.evaluation_scores;
create trigger trg_evaluation_scores_validate before insert or update on public.evaluation_scores
  for each row execute function public.evaluation_scores_validate();

-- overall_score = weighted mean of the skill scores normalised to 0-100
-- (score - min) / (max - min) * 100; reversed when lower is better.
create or replace function public.evaluation_overall_score(p_eval uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select round(sum(i.weight * (case when i.higher_is_better
                                    then (s.score - i.scale_min) else (i.scale_max - s.score) end)
                           / (i.scale_max - i.scale_min) * 100) / nullif(sum(i.weight), 0), 2)
    from public.evaluation_scores s
    join public.assessment_items i on i.id = s.item_id
   where s.evaluation_id = p_eval and i.kind = 'skill' and s.score is not null;
$$;

create or replace function public.evaluation_scores_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_eval uuid := case when tg_op = 'DELETE' then old.evaluation_id else new.evaluation_id end;
begin
  update public.evaluations e
     set overall_score = public.evaluation_overall_score(v_eval)
   where e.id = v_eval and e.overall_score is distinct from public.evaluation_overall_score(v_eval);
  return null;
end $$;
drop trigger if exists trg_evaluation_scores_rollup on public.evaluation_scores;
create trigger trg_evaluation_scores_rollup after insert or update or delete on public.evaluation_scores
  for each row execute function public.evaluation_scores_rollup();

create or replace function public.development_can_read_evaluation(p_eval uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.evaluations e
     where e.id = p_eval and e.org_id = public.current_org_id()
       and (public.is_admin() or public.coach_can_access_athlete(e.athlete_id)
            or (e.shared_with_family and public.is_guardian_of_athlete(e.athlete_id)))
  );
$$;

create or replace function public.development_can_write_evaluation(p_eval uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.evaluations e
     where e.id = p_eval and e.org_id = public.current_org_id()
       and (public.is_admin()
            or (public.coach_can_access_athlete(e.athlete_id)
                and (e.coach_id = public.current_coach_id() or e.created_by = auth.uid())))
  );
$$;

alter table public.evaluations enable row level security;
drop policy if exists evaluations_select on public.evaluations;
create policy evaluations_select on public.evaluations for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id)
              or (shared_with_family and public.is_guardian_of_athlete(athlete_id))));
drop policy if exists evaluations_insert on public.evaluations;
create policy evaluations_insert on public.evaluations for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists evaluations_update on public.evaluations;
create policy evaluations_update on public.evaluations for update
  using (org_id = public.current_org_id()
         and (public.is_admin() or (public.coach_can_access_athlete(athlete_id)
                                    and (coach_id = public.current_coach_id() or created_by = auth.uid()))))
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists evaluations_delete on public.evaluations;
create policy evaluations_delete on public.evaluations for delete
  using (org_id = public.current_org_id()
         and (public.is_admin() or (public.coach_can_access_athlete(athlete_id)
                                    and (coach_id = public.current_coach_id() or created_by = auth.uid()))));
grant select, insert, update, delete on public.evaluations to authenticated;
grant all on public.evaluations to service_role;

alter table public.evaluation_scores enable row level security;
drop policy if exists evaluation_scores_select on public.evaluation_scores;
create policy evaluation_scores_select on public.evaluation_scores for select
  using (org_id = public.current_org_id() and public.development_can_read_evaluation(evaluation_id));
drop policy if exists evaluation_scores_insert on public.evaluation_scores;
create policy evaluation_scores_insert on public.evaluation_scores for insert
  with check (org_id = public.current_org_id() and public.development_can_write_evaluation(evaluation_id));
drop policy if exists evaluation_scores_update on public.evaluation_scores;
create policy evaluation_scores_update on public.evaluation_scores for update
  using (org_id = public.current_org_id() and public.development_can_write_evaluation(evaluation_id))
  with check (org_id = public.current_org_id() and public.development_can_write_evaluation(evaluation_id));
drop policy if exists evaluation_scores_delete on public.evaluation_scores;
create policy evaluation_scores_delete on public.evaluation_scores for delete
  using (org_id = public.current_org_id() and public.development_can_write_evaluation(evaluation_id));
grant select, insert, update, delete on public.evaluation_scores to authenticated;
grant all on public.evaluation_scores to service_role;

-- ---------------------------------------------------------------------------
-- 4) Exercise library (+ private video bucket)
-- ---------------------------------------------------------------------------
create table if not exists public.exercises (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text check (description is null or length(description) <= 4000),
  sport        text check (sport is null or length(sport) <= 60),
  category     text not null default 'skills'
               check (category in ('strength_conditioning', 'skills', 'mobility', 'conditioning', 'recovery', 'other')),
  video_url    text check (video_url is null or (length(video_url) <= 500 and video_url ~ '^https://')),
  video_path   text check (video_path is null or length(video_path) <= 300),
  equipment    text[] not null default '{}',
  difficulty   text not null default 'beginner' check (difficulty in ('beginner', 'intermediate', 'advanced', 'elite')),
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_exercises_org on public.exercises(org_id, is_active);
drop trigger if exists trg_exercises_updated on public.exercises;
create trigger trg_exercises_updated before update on public.exercises
  for each row execute function public.set_updated_at();

alter table public.exercises enable row level security;
drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises for select
  using (org_id = public.current_org_id());
drop policy if exists exercises_insert on public.exercises;
create policy exercises_insert on public.exercises for insert
  with check (org_id = public.current_org_id() and public.development_is_staff());
drop policy if exists exercises_update on public.exercises;
create policy exercises_update on public.exercises for update
  using (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())))
  with check (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())));
drop policy if exists exercises_delete on public.exercises;
create policy exercises_delete on public.exercises for delete
  using (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())));
grant select, insert, update, delete on public.exercises to authenticated;
grant all on public.exercises to service_role;

-- Objects at <org_id>/<exercise_id>/<random>.<ext>; staff of that org only.
-- Families get short-lived signed URLs from the server after an RLS check.
create or replace function public.exercise_video_access(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_ex uuid;
begin
  begin
    v_org := split_part(p_name, '/', 1)::uuid;
    v_ex  := split_part(p_name, '/', 2)::uuid;
  exception when others then return false;
  end;
  return v_org = public.current_org_id() and public.development_is_staff()
     and exists (select 1 from public.exercises e where e.id = v_ex and e.org_id = v_org);
end $$;
revoke all on function public.exercise_video_access(text) from public, anon;
grant execute on function public.exercise_video_access(text) to authenticated, service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
      values ('exercise-videos', 'exercise-videos', false)
      on conflict (id) do update set public = false;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
      execute $q$update storage.buckets set file_size_limit = 104857600 where id = 'exercise-videos'$q$;
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
      execute $q$update storage.buckets set allowed_mime_types = array['video/mp4','video/webm','video/quicktime']
                 where id = 'exercise-videos'$q$;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute $p$drop policy if exists exercise_videos_select on storage.objects$p$;
    execute $p$create policy exercise_videos_select on storage.objects for select to authenticated
      using (bucket_id = 'exercise-videos' and public.exercise_video_access(name))$p$;
    execute $p$drop policy if exists exercise_videos_insert on storage.objects$p$;
    execute $p$create policy exercise_videos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'exercise-videos' and public.exercise_video_access(name))$p$;
    execute $p$drop policy if exists exercise_videos_update on storage.objects$p$;
    execute $p$create policy exercise_videos_update on storage.objects for update to authenticated
      using (bucket_id = 'exercise-videos' and public.exercise_video_access(name))
      with check (bucket_id = 'exercise-videos' and public.exercise_video_access(name))$p$;
    execute $p$drop policy if exists exercise_videos_delete on storage.objects$p$;
    execute $p$create policy exercise_videos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'exercise-videos' and public.exercise_video_access(name))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Training plans (weeks -> days -> exercises), assignments, completions
-- ---------------------------------------------------------------------------
create table if not exists public.training_plans (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text check (description is null or length(description) <= 4000),
  sport        text check (sport is null or length(sport) <= 60),
  age_min      smallint check (age_min is null or age_min between 0 and 99),
  age_max      smallint check (age_max is null or age_max between 0 and 99),
  level        text check (level is null or level in ('beginner', 'intermediate', 'advanced', 'elite')),
  weeks        smallint not null default 4 check (weeks between 1 and 52),
  is_template  boolean not null default true,
  auto_assign  boolean not null default false,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint training_plans_age_chk check (age_min is null or age_max is null or age_min <= age_max),
  constraint training_plans_auto_chk check (not auto_assign or is_template)
);
create index if not exists idx_training_plans_org on public.training_plans(org_id, is_active);
drop trigger if exists trg_training_plans_updated on public.training_plans;
create trigger trg_training_plans_updated before update on public.training_plans
  for each row execute function public.set_updated_at();

create table if not exists public.training_plan_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  plan_id       uuid not null references public.training_plans(id) on delete cascade,
  week          smallint not null check (week between 1 and 52),
  day           smallint not null check (day between 1 and 7),
  exercise_id   uuid references public.exercises(id) on delete set null,
  title         text check (title is null or length(btrim(title)) between 1 and 120),
  sets          smallint check (sets is null or sets between 0 and 100),
  reps          smallint check (reps is null or reps between 0 and 1000),
  duration_sec  integer check (duration_sec is null or duration_sec between 0 and 86400),
  rest_sec      integer check (rest_sec is null or rest_sec between 0 and 3600),
  notes         text check (notes is null or length(notes) <= 1000),
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint training_plan_items_what_chk check (exercise_id is not null or title is not null)
);
create index if not exists idx_training_plan_items_org on public.training_plan_items(org_id);
create index if not exists idx_training_plan_items_plan on public.training_plan_items(plan_id, week, day, sort_order);
drop trigger if exists trg_training_plan_items_updated on public.training_plan_items;
create trigger trg_training_plan_items_updated before update on public.training_plan_items
  for each row execute function public.set_updated_at();
drop trigger if exists trg_training_plan_items_same_org on public.training_plan_items;
create trigger trg_training_plan_items_same_org before insert or update on public.training_plan_items
  for each row execute function public.development_same_org_guard('plan_id:training_plans', 'exercise_id:exercises');

create table if not exists public.training_plan_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  plan_id      uuid not null references public.training_plans(id) on delete cascade,
  athlete_id   uuid not null references public.athletes(id) on delete cascade,
  starts_on    date not null default current_date,
  ends_on      date,
  status       text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  source       text not null default 'manual' check (source in ('manual', 'auto')),
  at_home      boolean not null default true,
  notes        text check (notes is null or length(notes) <= 1000),
  assigned_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint training_plan_assignments_dates_chk check (ends_on is null or ends_on >= starts_on)
);
create index if not exists idx_tpa_org on public.training_plan_assignments(org_id);
create index if not exists idx_tpa_athlete on public.training_plan_assignments(athlete_id, status);
create unique index if not exists tpa_one_active_per_plan
  on public.training_plan_assignments(plan_id, athlete_id) where status = 'active';
drop trigger if exists trg_tpa_updated on public.training_plan_assignments;
create trigger trg_tpa_updated before update on public.training_plan_assignments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_tpa_same_org on public.training_plan_assignments;
create trigger trg_tpa_same_org before insert or update on public.training_plan_assignments
  for each row execute function public.development_same_org_guard('plan_id:training_plans', 'athlete_id:athletes');
drop trigger if exists trg_audit_tpa on public.training_plan_assignments;
create trigger trg_audit_tpa after insert or update or delete on public.training_plan_assignments
  for each row execute function public.audit_trigger();

create table if not exists public.training_plan_completions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  assignment_id  uuid not null references public.training_plan_assignments(id) on delete cascade,
  item_id        uuid not null references public.training_plan_items(id) on delete cascade,
  athlete_id     uuid not null references public.athletes(id) on delete cascade,
  completed_on   date not null default current_date,
  rating         smallint check (rating is null or rating between 1 and 5),
  comment        text check (comment is null or length(comment) <= 1000),
  completed_by   uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (assignment_id, item_id)
);
create index if not exists idx_tpc_org on public.training_plan_completions(org_id);
create index if not exists idx_tpc_athlete on public.training_plan_completions(athlete_id, completed_on desc);
drop trigger if exists trg_tpc_updated on public.training_plan_completions;
create trigger trg_tpc_updated before update on public.training_plan_completions
  for each row execute function public.set_updated_at();
drop trigger if exists trg_tpc_same_org on public.training_plan_completions;
create trigger trg_tpc_same_org before insert or update on public.training_plan_completions
  for each row execute function public.development_same_org_guard(
    'assignment_id:training_plan_assignments', 'item_id:training_plan_items', 'athlete_id:athletes');
drop trigger if exists trg_audit_tpc on public.training_plan_completions;
create trigger trg_audit_tpc after insert or update or delete on public.training_plan_completions
  for each row execute function public.audit_trigger();

-- The completion's athlete and item must match the assignment and its plan.
create or replace function public.training_plan_completions_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_a public.training_plan_assignments%rowtype;
begin
  select * into v_a from public.training_plan_assignments where id = new.assignment_id;
  if v_a.id is null or v_a.athlete_id <> new.athlete_id then
    raise exception 'ASSIGNMENT_MISMATCH' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.training_plan_items i where i.id = new.item_id and i.plan_id = v_a.plan_id) then
    raise exception 'ASSIGNMENT_MISMATCH' using errcode = 'P0001';
  end if;
  if v_a.status = 'cancelled' then
    raise exception 'ASSIGNMENT_CLOSED' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_tpc_validate on public.training_plan_completions;
create trigger trg_tpc_validate before insert or update on public.training_plan_completions
  for each row execute function public.training_plan_completions_validate();

-- A family sees a plan once one of their children has a live assignment of it.
create or replace function public.development_guardian_has_plan(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.training_plan_assignments a
                  where a.plan_id = p_plan and a.status <> 'cancelled'
                    and public.is_guardian_of_athlete(a.athlete_id));
$$;

create or replace function public.development_can_read_plan(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.training_plans p
     where p.id = p_plan and p.org_id = public.current_org_id()
       and (public.development_is_staff() or public.development_guardian_has_plan(p.id))
  );
$$;

create or replace function public.development_can_edit_plan(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.training_plans p
     where p.id = p_plan and p.org_id = public.current_org_id()
       and (public.is_admin() or (public.has_role('coach') and p.created_by = auth.uid()))
  );
$$;

alter table public.training_plans enable row level security;
drop policy if exists training_plans_select on public.training_plans;
create policy training_plans_select on public.training_plans for select
  using (org_id = public.current_org_id() and (public.development_is_staff() or public.development_guardian_has_plan(id)));
drop policy if exists training_plans_insert on public.training_plans;
create policy training_plans_insert on public.training_plans for insert
  with check (org_id = public.current_org_id() and public.development_is_staff());
drop policy if exists training_plans_update on public.training_plans;
create policy training_plans_update on public.training_plans for update
  using (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())))
  with check (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())));
drop policy if exists training_plans_delete on public.training_plans;
create policy training_plans_delete on public.training_plans for delete
  using (org_id = public.current_org_id() and (public.is_admin() or (public.has_role('coach') and created_by = auth.uid())));
grant select, insert, update, delete on public.training_plans to authenticated;
grant all on public.training_plans to service_role;

alter table public.training_plan_items enable row level security;
drop policy if exists training_plan_items_select on public.training_plan_items;
create policy training_plan_items_select on public.training_plan_items for select
  using (org_id = public.current_org_id() and public.development_can_read_plan(plan_id));
drop policy if exists training_plan_items_insert on public.training_plan_items;
create policy training_plan_items_insert on public.training_plan_items for insert
  with check (org_id = public.current_org_id() and public.development_can_edit_plan(plan_id));
drop policy if exists training_plan_items_update on public.training_plan_items;
create policy training_plan_items_update on public.training_plan_items for update
  using (org_id = public.current_org_id() and public.development_can_edit_plan(plan_id))
  with check (org_id = public.current_org_id() and public.development_can_edit_plan(plan_id));
drop policy if exists training_plan_items_delete on public.training_plan_items;
create policy training_plan_items_delete on public.training_plan_items for delete
  using (org_id = public.current_org_id() and public.development_can_edit_plan(plan_id));
grant select, insert, update, delete on public.training_plan_items to authenticated;
grant all on public.training_plan_items to service_role;

alter table public.training_plan_assignments enable row level security;
drop policy if exists tpa_select on public.training_plan_assignments;
create policy tpa_select on public.training_plan_assignments for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists tpa_insert on public.training_plan_assignments;
create policy tpa_insert on public.training_plan_assignments for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists tpa_update on public.training_plan_assignments;
create policy tpa_update on public.training_plan_assignments for update
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)))
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists tpa_delete on public.training_plan_assignments;
create policy tpa_delete on public.training_plan_assignments for delete
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
grant select, insert, update, delete on public.training_plan_assignments to authenticated;
grant all on public.training_plan_assignments to service_role;

alter table public.training_plan_completions enable row level security;
drop policy if exists tpc_select on public.training_plan_completions;
create policy tpc_select on public.training_plan_completions for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists tpc_insert on public.training_plan_completions;
create policy tpc_insert on public.training_plan_completions for insert
  with check (org_id = public.current_org_id()
              and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists tpc_update on public.training_plan_completions;
create policy tpc_update on public.training_plan_completions for update
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)))
  with check (org_id = public.current_org_id()
              and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists tpc_delete on public.training_plan_completions;
create policy tpc_delete on public.training_plan_completions for delete
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
grant select, insert, update, delete on public.training_plan_completions to authenticated;
grant all on public.training_plan_completions to service_role;

-- ---------------------------------------------------------------------------
-- 6) Nutrition plans (general guidance, not medical advice)
-- ---------------------------------------------------------------------------
create table if not exists public.nutrition_plans (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 120),
  description  text check (description is null or length(description) <= 2000),
  age_min      smallint check (age_min is null or age_min between 0 and 99),
  age_max      smallint check (age_max is null or age_max between 0 and 99),
  athlete_id   uuid references public.athletes(id) on delete cascade, -- client-specific plan
  hydration_ml integer check (hydration_ml is null or hydration_ml between 0 and 10000),
  guidelines   text check (guidelines is null or length(guidelines) <= 4000),
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint nutrition_plans_age_chk check (age_min is null or age_max is null or age_min <= age_max)
);
create index if not exists idx_nutrition_plans_org on public.nutrition_plans(org_id, is_active);
drop trigger if exists trg_nutrition_plans_updated on public.nutrition_plans;
create trigger trg_nutrition_plans_updated before update on public.nutrition_plans
  for each row execute function public.set_updated_at();
drop trigger if exists trg_nutrition_plans_same_org on public.nutrition_plans;
create trigger trg_nutrition_plans_same_org before insert or update on public.nutrition_plans
  for each row execute function public.development_same_org_guard('athlete_id:athletes');
drop trigger if exists trg_audit_nutrition_plans on public.nutrition_plans;
create trigger trg_audit_nutrition_plans after insert or update or delete on public.nutrition_plans
  for each row execute function public.audit_trigger();

create table if not exists public.nutrition_plan_meals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  plan_id      uuid not null references public.nutrition_plans(id) on delete cascade,
  day          smallint not null default 0 check (day between 0 and 7), -- 0 = every day
  meal         text not null check (meal in ('breakfast', 'morning_snack', 'lunch', 'afternoon_snack', 'dinner', 'pre_training', 'post_training')),
  description  text not null check (length(btrim(description)) between 1 and 1000),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_nutrition_plan_meals_org on public.nutrition_plan_meals(org_id);
create index if not exists idx_nutrition_plan_meals_plan on public.nutrition_plan_meals(plan_id, day, sort_order);
drop trigger if exists trg_nutrition_plan_meals_updated on public.nutrition_plan_meals;
create trigger trg_nutrition_plan_meals_updated before update on public.nutrition_plan_meals
  for each row execute function public.set_updated_at();
drop trigger if exists trg_nutrition_plan_meals_same_org on public.nutrition_plan_meals;
create trigger trg_nutrition_plan_meals_same_org before insert or update on public.nutrition_plan_meals
  for each row execute function public.development_same_org_guard('plan_id:nutrition_plans');

create table if not exists public.nutrition_plan_assignments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  plan_id      uuid not null references public.nutrition_plans(id) on delete cascade,
  athlete_id   uuid not null references public.athletes(id) on delete cascade,
  starts_on    date not null default current_date,
  ends_on      date,
  assigned_by  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (plan_id, athlete_id),
  constraint nutrition_plan_assignments_dates_chk check (ends_on is null or ends_on >= starts_on)
);
create index if not exists idx_npa_org on public.nutrition_plan_assignments(org_id);
create index if not exists idx_npa_athlete on public.nutrition_plan_assignments(athlete_id);
drop trigger if exists trg_npa_updated on public.nutrition_plan_assignments;
create trigger trg_npa_updated before update on public.nutrition_plan_assignments
  for each row execute function public.set_updated_at();
drop trigger if exists trg_npa_same_org on public.nutrition_plan_assignments;
create trigger trg_npa_same_org before insert or update on public.nutrition_plan_assignments
  for each row execute function public.development_same_org_guard('plan_id:nutrition_plans', 'athlete_id:athletes');
drop trigger if exists trg_audit_npa on public.nutrition_plan_assignments;
create trigger trg_audit_npa after insert or update or delete on public.nutrition_plan_assignments
  for each row execute function public.audit_trigger();

-- Staff read templates; a client-specific plan only by admins, that child's
-- coaches and guardians; families read plans assigned to their children.
create or replace function public.development_guardian_has_nutrition(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.nutrition_plan_assignments a
                  where a.plan_id = p_plan and public.is_guardian_of_athlete(a.athlete_id));
$$;

-- Row-level rule shared by the plan and its meals.
create or replace function public.development_nutrition_visible(p_plan uuid, p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (p_athlete is null and public.has_role('coach'))
      or (p_athlete is not null and (public.coach_can_access_athlete(p_athlete) or public.is_guardian_of_athlete(p_athlete)))
      or public.development_guardian_has_nutrition(p_plan);
$$;

create or replace function public.development_can_read_nutrition(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.nutrition_plans p
     where p.id = p_plan and p.org_id = public.current_org_id()
       and public.development_nutrition_visible(p.id, p.athlete_id)
  );
$$;

create or replace function public.development_can_edit_nutrition(p_plan uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.nutrition_plans p
     where p.id = p_plan and p.org_id = public.current_org_id()
       and (public.is_admin() or (public.has_role('coach') and p.created_by = auth.uid()
                                  and (p.athlete_id is null or public.coach_can_access_athlete(p.athlete_id))))
  );
$$;

alter table public.nutrition_plans enable row level security;
drop policy if exists nutrition_plans_select on public.nutrition_plans;
create policy nutrition_plans_select on public.nutrition_plans for select
  using (org_id = public.current_org_id() and public.development_nutrition_visible(id, athlete_id));
drop policy if exists nutrition_plans_insert on public.nutrition_plans;
create policy nutrition_plans_insert on public.nutrition_plans for insert
  with check (org_id = public.current_org_id()
              and (public.is_admin() or (public.has_role('coach') and (athlete_id is null or public.coach_can_access_athlete(athlete_id)))));
drop policy if exists nutrition_plans_update on public.nutrition_plans;
create policy nutrition_plans_update on public.nutrition_plans for update
  using (org_id = public.current_org_id() and public.development_can_edit_nutrition(id))
  with check (org_id = public.current_org_id()
              and (public.is_admin() or (public.has_role('coach') and (athlete_id is null or public.coach_can_access_athlete(athlete_id)))));
drop policy if exists nutrition_plans_delete on public.nutrition_plans;
create policy nutrition_plans_delete on public.nutrition_plans for delete
  using (org_id = public.current_org_id() and public.development_can_edit_nutrition(id));
grant select, insert, update, delete on public.nutrition_plans to authenticated;
grant all on public.nutrition_plans to service_role;

alter table public.nutrition_plan_meals enable row level security;
drop policy if exists nutrition_plan_meals_select on public.nutrition_plan_meals;
create policy nutrition_plan_meals_select on public.nutrition_plan_meals for select
  using (org_id = public.current_org_id() and public.development_can_read_nutrition(plan_id));
drop policy if exists nutrition_plan_meals_insert on public.nutrition_plan_meals;
create policy nutrition_plan_meals_insert on public.nutrition_plan_meals for insert
  with check (org_id = public.current_org_id() and public.development_can_edit_nutrition(plan_id));
drop policy if exists nutrition_plan_meals_update on public.nutrition_plan_meals;
create policy nutrition_plan_meals_update on public.nutrition_plan_meals for update
  using (org_id = public.current_org_id() and public.development_can_edit_nutrition(plan_id))
  with check (org_id = public.current_org_id() and public.development_can_edit_nutrition(plan_id));
drop policy if exists nutrition_plan_meals_delete on public.nutrition_plan_meals;
create policy nutrition_plan_meals_delete on public.nutrition_plan_meals for delete
  using (org_id = public.current_org_id() and public.development_can_edit_nutrition(plan_id));
grant select, insert, update, delete on public.nutrition_plan_meals to authenticated;
grant all on public.nutrition_plan_meals to service_role;

alter table public.nutrition_plan_assignments enable row level security;
drop policy if exists npa_select on public.nutrition_plan_assignments;
create policy npa_select on public.nutrition_plan_assignments for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists npa_insert on public.nutrition_plan_assignments;
create policy npa_insert on public.nutrition_plan_assignments for insert
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists npa_update on public.nutrition_plan_assignments;
create policy npa_update on public.nutrition_plan_assignments for update
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)))
  with check (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
drop policy if exists npa_delete on public.nutrition_plan_assignments;
create policy npa_delete on public.nutrition_plan_assignments for delete
  using (org_id = public.current_org_id() and (public.is_admin() or public.coach_can_access_athlete(athlete_id)));
grant select, insert, update, delete on public.nutrition_plan_assignments to authenticated;
grant all on public.nutrition_plan_assignments to service_role;

-- ---------------------------------------------------------------------------
-- 7) Daily wellness questionnaire (optional per team)
-- ---------------------------------------------------------------------------
alter table public.teams add column if not exists wellness_enabled boolean not null default false;

create table if not exists public.wellness_checkins (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  athlete_id    uuid not null references public.athletes(id) on delete cascade,
  checkin_date  date not null default current_date,
  sleep         smallint not null check (sleep between 1 and 5),
  energy        smallint not null check (energy between 1 and 5),
  soreness      smallint not null check (soreness between 1 and 5),  -- 1 = none, 5 = very sore
  mood          smallint not null check (mood between 1 and 5),
  note          text check (note is null or length(note) <= 500),
  submitted_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (athlete_id, checkin_date)
);
create index if not exists idx_wellness_checkins_org on public.wellness_checkins(org_id, checkin_date desc);
drop trigger if exists trg_wellness_checkins_updated on public.wellness_checkins;
create trigger trg_wellness_checkins_updated before update on public.wellness_checkins
  for each row execute function public.set_updated_at();
drop trigger if exists trg_wellness_checkins_same_org on public.wellness_checkins;
create trigger trg_wellness_checkins_same_org before insert or update on public.wellness_checkins
  for each row execute function public.development_same_org_guard('athlete_id:athletes');
drop trigger if exists trg_audit_wellness_checkins on public.wellness_checkins;
create trigger trg_audit_wellness_checkins after insert or update or delete on public.wellness_checkins
  for each row execute function public.audit_trigger();

-- True when the athlete is an active member of a team with the questionnaire on.
create or replace function public.wellness_enabled_for_athlete(p_athlete uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_memberships tm
    join public.teams t on t.id = tm.team_id
    where tm.athlete_id = p_athlete and tm.status <> 'inactive' and t.is_active and t.wellness_enabled
  );
$$;

create or replace function public.wellness_checkins_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.wellness_enabled_for_athlete(new.athlete_id) then
    raise exception 'WELLNESS_DISABLED' using errcode = 'P0001';
  end if;
  if new.checkin_date > current_date + 1 then
    raise exception 'WELLNESS_FUTURE_DATE' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_wellness_checkins_validate on public.wellness_checkins;
create trigger trg_wellness_checkins_validate before insert or update on public.wellness_checkins
  for each row execute function public.wellness_checkins_validate();

alter table public.wellness_checkins enable row level security;
drop policy if exists wellness_select on public.wellness_checkins;
create policy wellness_select on public.wellness_checkins for select
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists wellness_insert on public.wellness_checkins;
create policy wellness_insert on public.wellness_checkins for insert
  with check (org_id = public.current_org_id()
              and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists wellness_update on public.wellness_checkins;
create policy wellness_update on public.wellness_checkins for update
  using (org_id = public.current_org_id()
         and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)))
  with check (org_id = public.current_org_id()
              and (public.is_admin() or public.coach_can_access_athlete(athlete_id) or public.is_guardian_of_athlete(athlete_id)));
drop policy if exists wellness_delete on public.wellness_checkins;
create policy wellness_delete on public.wellness_checkins for delete
  using (org_id = public.current_org_id() and (public.is_admin() or public.is_guardian_of_athlete(athlete_id)));
grant select, insert, update, delete on public.wellness_checkins to authenticated;
grant all on public.wellness_checkins to service_role;

-- ---------------------------------------------------------------------------
-- 8) Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public.development_is_staff() from public, anon;
revoke all on function public.development_can_edit_template(uuid) from public, anon;
revoke all on function public.development_can_read_evaluation(uuid) from public, anon;
revoke all on function public.development_can_write_evaluation(uuid) from public, anon;
revoke all on function public.development_can_read_plan(uuid) from public, anon;
revoke all on function public.development_can_edit_plan(uuid) from public, anon;
revoke all on function public.development_can_read_nutrition(uuid) from public, anon;
revoke all on function public.development_guardian_has_plan(uuid) from public, anon;
revoke all on function public.development_guardian_has_nutrition(uuid) from public, anon;
revoke all on function public.development_nutrition_visible(uuid, uuid) from public, anon;
revoke all on function public.development_can_edit_nutrition(uuid) from public, anon;
revoke all on function public.wellness_enabled_for_athlete(uuid) from public, anon;
revoke all on function public.evaluation_overall_score(uuid) from public, anon;
grant execute on function public.development_is_staff() to authenticated, service_role;
grant execute on function public.development_can_edit_template(uuid) to authenticated, service_role;
grant execute on function public.development_can_read_evaluation(uuid) to authenticated, service_role;
grant execute on function public.development_can_write_evaluation(uuid) to authenticated, service_role;
grant execute on function public.development_can_read_plan(uuid) to authenticated, service_role;
grant execute on function public.development_can_edit_plan(uuid) to authenticated, service_role;
grant execute on function public.development_can_read_nutrition(uuid) to authenticated, service_role;
grant execute on function public.development_guardian_has_plan(uuid) to authenticated, service_role;
grant execute on function public.development_guardian_has_nutrition(uuid) to authenticated, service_role;
grant execute on function public.development_nutrition_visible(uuid, uuid) to authenticated, service_role;
grant execute on function public.development_can_edit_nutrition(uuid) to authenticated, service_role;
grant execute on function public.wellness_enabled_for_athlete(uuid) to authenticated, service_role;
grant execute on function public.evaluation_overall_score(uuid) to authenticated, service_role;
