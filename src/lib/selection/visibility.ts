import "server-only";
import type { SessionUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

/**
 * Parent-app entries a non-member family does not see. A family that joined
 * only for a programme (public page: guest / programme-only, e.g. a player of
 * another club applying to a selection team) uses the parent app for that
 * programme, its invoices, documents and notifications — not the club's
 * internal spaces (board, carpooling with other families' details, club kit,
 * player development). Staff and member families see everything.
 */
export const PROGRAM_ONLY_HIDDEN_HREFS = ["/board", "/parent/carpool", "/parent/kit", "/parent/journey", "/parent/development"];

export async function programOnlyHiddenHrefs(user: SessionUser): Promise<string[]> {
  if (!user.orgId || user.roles.some((r) => r === "admin" || r === "finance" || r === "coach")) return [];
  try {
    const db = await createClient();
    const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", user.id);
    const ids = (links ?? []).map((l) => l.family_id);
    if (!ids.length) return [];
    const { data: fams } = await db.from("families").select("membership_status").eq("org_id", user.orgId).in("id", ids);
    const rows = (fams ?? []) as { membership_status: string | null }[];
    return rows.length > 0 && rows.every((f) => f.membership_status === "guest") ? PROGRAM_ONLY_HIDDEN_HREFS : [];
  } catch {
    return [];
  }
}
