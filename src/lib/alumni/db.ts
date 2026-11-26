import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { AlumniPlacementStatus, AlumniStatus, ContactDirection, ContactKind, InstitutionType, Scholarship } from "./rules";

/**
 * Typed view of the tables and RPCs of migration
 * 20250420102800_alumni_placements.sql. Kept local like src/lib/selection/db.ts;
 * merges into src/types/database.ts once the types are regenerated.
 */
type T<Row> = { Row: Row; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: [] };

export type AlumniRow = {
  id: string; org_id: string; athlete_id: string | null; first_name: string; last_name: string; birth_year: number | null;
  birth_date: string | null; gender: string | null; nationality: string | null; photo_path: string | null; email: string | null;
  phone: string | null; whatsapp: boolean; instagram: string | null; x_handle: string | null; linkedin_url: string | null;
  highlight_url: string | null; guardian_name: string | null; guardian_email: string | null; guardian_phone: string | null;
  contact_consent: boolean; contact_consent_on: string | null; contact_consent_source: string | null; showcase_consent: boolean;
  showcase_consent_on: string | null; showcase_guardian_consent: boolean; showcase_name_style: "initial" | "full";
  notes: string | null; tags: string[]; status: AlumniStatus; created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
};
export type AlumniPlacementRow = {
  id: string; org_id: string; alumni_id: string; institution: string; institution_type: InstitutionType; country: string | null;
  region: string | null; league: string | null; level: string | null; sport: string | null; position: string | null;
  start_date: string | null; end_year: number | null; scholarship: Scholarship; status: AlumniPlacementStatus; is_current: boolean;
  source_note: string | null; roster_url: string | null; placement_target_id: string | null; created_by: string | null;
  created_at: string; updated_at: string;
};
export type AlumniContactRow = {
  id: string; org_id: string; alumni_id: string; kind: ContactKind; direction: ContactDirection; summary: string;
  happened_at: string; by_user: string | null; follow_up_on: string | null; follow_up_done: boolean;
  follow_up_notified_at: string | null; created_at: string; updated_at: string;
};
export type ShowcaseRow = {
  id: string; display_name: string; institution: string; institution_type: InstitutionType; level: string | null; league: string | null;
  country: string | null; sport: string | null; start_year: number | null; end_year: number | null; status: AlumniPlacementStatus;
};

type AlumniTables = {
  alumni: T<AlumniRow>;
  alumni_placements: T<AlumniPlacementRow>;
  alumni_contacts: T<AlumniContactRow>;
  coaches: T<Database["public"]["Tables"]["coaches"]["Row"] & { alumni_access: boolean }>;
};
type AlumniFunctions = {
  alumni_staff_can: { Args: Record<string, never>; Returns: boolean };
  alumni_public_showcase: { Args: { p_org: string; p_limit?: number }; Returns: ShowcaseRow[] };
};

type Pub = Database["public"];
export type AlumniDatabase = {
  public: Omit<Pub, "Tables" | "Functions"> & {
    Tables: Omit<Pub["Tables"], keyof AlumniTables> & AlumniTables;
    Functions: Omit<Pub["Functions"], keyof AlumniFunctions> & AlumniFunctions;
  };
};
export type AlumniClient = SupabaseClient<AlumniDatabase>;

/** RLS-scoped client (user session). */
export async function alumniDb(): Promise<AlumniClient> {
  return (await createClient()) as unknown as AlumniClient;
}

/** Service-role client (server only; callers filter by org explicitly). */
export function alumniAdminDb(): AlumniClient {
  return createAdminClient() as unknown as AlumniClient;
}
