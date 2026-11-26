import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

/**
 * Typed view of the programme delete / archive / restore functions
 * (migration 20250420105300_program_delete_archive.sql). Kept local, like
 * src/lib/camps/db.ts, so the shared generated types do not need a hand edit;
 * `npm run types` merges them later.
 */
type ProgramFunctions = {
  program_delete_impact: { Args: { p_program: string }; Returns: Json };
  program_delete: { Args: { p_program: string }; Returns: Json };
  program_archive: { Args: { p_program: string }; Returns: Json };
  program_restore: { Args: { p_program: string }; Returns: Json };
};

type Pub = Database["public"];
export type ProgramsDatabase = {
  public: Omit<Pub, "Functions"> & { Functions: Pub["Functions"] & ProgramFunctions };
};
export type ProgramsClient = SupabaseClient<ProgramsDatabase>;
export type ProgramRpc = keyof ProgramFunctions;

/** RLS-scoped client (the signed-in user's session); the functions check the role and club again. */
export async function programsDb(): Promise<ProgramsClient> {
  return (await createClient()) as unknown as ProgramsClient;
}

/** Call one of the programme functions (bound call; see src/lib/supabase/rpc.ts). */
export async function programRpc(fn: ProgramRpc, programId: string): Promise<{ data: Json | null; error: { message: string } | null }> {
  const db = await programsDb();
  const { data, error } = await db.rpc(fn, { p_program: programId });
  return { data: (data ?? null) as Json | null, error: error ? { message: error.message } : null };
}
