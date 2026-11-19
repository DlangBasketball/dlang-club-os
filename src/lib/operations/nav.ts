import "server-only";
import type { SessionUser } from "@/lib/auth/get-user";
import { opsDb } from "./db";

export const BOARD_HREF = "/board";

/**
 * Nav entries of the operations module to hide for this user: the board is
 * shown to admins and to current committee members only.
 */
export async function operationsHiddenHrefs(user: SessionUser): Promise<string[]> {
  if (user.roles.includes("admin")) return [];
  try {
    const db = await opsDb();
    const { data } = await db.rpc("is_any_committee_member", {});
    return data ? [] : [BOARD_HREF];
  } catch {
    return [BOARD_HREF];
  }
}
