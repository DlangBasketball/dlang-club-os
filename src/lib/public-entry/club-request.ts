import "server-only";
import { randomUUID } from "node:crypto";
import type { Json } from "@/types/database";
import { logError } from "@/lib/log";
import { entryAdminDb, entryDb } from "./db";

/**
 * Public programme page (/register/[programSlug]) of a club programme that
 * needs club approval (programs.requires_club_approval, Workstream C): a
 * signed-in visitor's children are resolved in their own family (or a
 * bootstrapped guest family; no duplicates) and one club request per child is
 * sent with club_request_submit() as the visitor (it re-checks the guardian,
 * the programme window and the age). Nothing is registered or invoiced until
 * the club approves.
 */
export async function submitClubRequestsForPublicForm(x: {
  profileId: string; currentOrgId: string | null; orgId: string; programId: string;
  parent: Record<string, string>; children: Record<string, string>[];
}): Promise<{ ok: true } | { ok: false; key: string }> {
  const { data, error } = await entryAdminDb().rpc("public_entry_resolve_children", {
    p_payload: { profile_id: x.profileId, program_id: x.programId, parent: x.parent, children: x.children } as Json,
  });
  if (error) {
    logError("publicEntry.clubRequest.resolve", error);
    return { ok: false, key: /INVALID_DOB/.test(error.message) ? "entry.errors.invalidDob" : "entry.errors.generic" };
  }
  const r = (data ?? {}) as { family_id?: string; athlete_ids?: string[] };
  const db = await entryDb();
  // The request is made in the programme's club (membership exists after the bootstrap).
  if (x.currentOrgId !== x.orgId) {
    const { error: sw } = await db.rpc("switch_current_org", { p_org: x.orgId });
    if (sw) return { ok: false, key: "entry.errors.generic" };
  }
  for (const athleteId of r.athlete_ids ?? []) {
    const { error: e } = await db.rpc("club_request_submit", {
      p_payload: { kind: "program_registration", family_id: r.family_id, athlete_id: athleteId, program_id: x.programId } as Json,
      p_request_id: randomUUID(),
    });
    if (e) {
      const code = /\b([A-Z][A-Z_]{3,})\b/.exec(e.message)?.[1];
      if (code === "ALREADY_REQUESTED" || code === "ALREADY_REGISTERED") continue;
      return { ok: false, key: code ? `approvals.errors.${code}` : "entry.errors.generic" };
    }
  }
  return { ok: true };
}
