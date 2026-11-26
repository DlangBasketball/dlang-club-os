import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the athlete-development tables (migration
 * 20250420100600_athlete_development.sql). Kept local like
 * src/lib/training/db.ts; merges into src/types/database.ts once the types are
 * regenerated with `npm run types`.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };
type Stamp = { created_at: string; updated_at: string };

export type DevSettingsRow = Stamp & {
  org_id: string; attendance_weight: number; evaluation_weight: number; window_days: number; levels: Json;
  family_rank_visible: boolean; updated_by: string | null;
};
export type TemplateRow = Stamp & {
  id: string; org_id: string; name: string; description: string | null; sport: string | null; age_group: string | null;
  age_min: number | null; age_max: number | null; is_active: boolean; created_by: string | null;
};
export type ItemRow = Stamp & {
  id: string; org_id: string; template_id: string; kind: "skill" | "measurement" | "text"; label: string; description: string | null;
  category: string | null; scale_min: number; scale_max: number; unit: string | null; higher_is_better: boolean; weight: number; sort_order: number;
};
export type EvaluationRow = Stamp & {
  id: string; org_id: string; athlete_id: string; template_id: string; coach_id: string | null; team_id: string | null;
  evaluated_on: string; overall_score: number | null; comments: string | null; shared_with_family: boolean; shared_at: string | null;
  created_by: string | null;
};
export type ScoreRow = Stamp & {
  id: string; org_id: string; evaluation_id: string; item_id: string; score: number | null; value: number | null;
  text_value: string | null; comment: string | null;
};
export type ExerciseRow = Stamp & {
  id: string; org_id: string; name: string; description: string | null; sport: string | null; category: string; video_url: string | null;
  video_path: string | null; equipment: string[]; difficulty: string; is_active: boolean; created_by: string | null;
};
export type PlanRow = Stamp & {
  id: string; org_id: string; name: string; description: string | null; sport: string | null; age_min: number | null; age_max: number | null;
  level: string | null; weeks: number; is_template: boolean; auto_assign: boolean; is_active: boolean; created_by: string | null;
};
export type PlanItemRow = Stamp & {
  id: string; org_id: string; plan_id: string; week: number; day: number; exercise_id: string | null; title: string | null;
  sets: number | null; reps: number | null; duration_sec: number | null; rest_sec: number | null; notes: string | null; sort_order: number;
};
export type AssignmentRow = Stamp & {
  id: string; org_id: string; plan_id: string; athlete_id: string; starts_on: string; ends_on: string | null;
  status: "active" | "completed" | "cancelled"; source: "manual" | "auto"; at_home: boolean; notes: string | null; assigned_by: string | null;
};
export type CompletionRow = Stamp & {
  id: string; org_id: string; assignment_id: string; item_id: string; athlete_id: string; completed_on: string;
  rating: number | null; comment: string | null; completed_by: string | null;
};
export type NutritionRow = Stamp & {
  id: string; org_id: string; name: string; description: string | null; age_min: number | null; age_max: number | null;
  athlete_id: string | null; hydration_ml: number | null; guidelines: string | null; is_active: boolean; created_by: string | null;
};
export type MealRow = Stamp & { id: string; org_id: string; plan_id: string; day: number; meal: string; description: string; sort_order: number };
export type NutritionAssignmentRow = Stamp & {
  id: string; org_id: string; plan_id: string; athlete_id: string; starts_on: string; ends_on: string | null; assigned_by: string | null;
};
export type WellnessRow = Stamp & {
  id: string; org_id: string; athlete_id: string; checkin_date: string; sleep: number; energy: number; soreness: number; mood: number;
  note: string | null; submitted_by: string | null;
};
export type TeamDevRow = {
  id: string; org_id: string; name: string; sport: string | null; age_group: string | null; is_active: boolean; wellness_enabled: boolean;
  program_id: string | null;
};
export type TeamMembershipRow = { id: string; org_id: string; team_id: string; athlete_id: string; status: string };
export type TeamCoachRow = { team_id: string; coach_id: string; org_id: string; role: string };
export type TrainingProfileLevelRow = { id: string; org_id: string; athlete_id: string; level: string | null };
export type FamilyMemberRow = { family_id: string; profile_id: string; relation: string | null; is_primary: boolean };

type DevTables = {
  development_settings: T<DevSettingsRow>;
  assessment_templates: T<TemplateRow>;
  assessment_items: T<ItemRow>;
  evaluations: T<EvaluationRow>;
  evaluation_scores: T<ScoreRow>;
  exercises: T<ExerciseRow>;
  training_plans: T<PlanRow>;
  training_plan_items: T<PlanItemRow>;
  training_plan_assignments: T<AssignmentRow>;
  training_plan_completions: T<CompletionRow>;
  nutrition_plans: T<NutritionRow>;
  nutrition_plan_meals: T<MealRow>;
  nutrition_plan_assignments: T<NutritionAssignmentRow>;
  wellness_checkins: T<WellnessRow>;
  teams: T<TeamDevRow>;
  team_memberships: T<TeamMembershipRow>;
  team_coaches: T<TeamCoachRow>;
  athlete_training_profiles: T<TrainingProfileLevelRow>;
  family_members: T<FamilyMemberRow>;
};

type Pub = Database["public"];
export type DevDatabase = {
  public: Omit<Pub, "Tables"> & { Tables: Omit<Pub["Tables"], keyof DevTables> & DevTables };
};
export type DevClient = SupabaseClient<DevDatabase>;

/** RLS-scoped client (user session) with the development tables typed. */
export async function devDb(): Promise<DevClient> {
  return (await createClient()) as unknown as DevClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function devAdminDb(): DevClient {
  return createAdminClient() as unknown as DevClient;
}
