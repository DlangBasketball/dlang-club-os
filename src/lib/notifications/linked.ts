import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";

/**
 * Club messages about one child also reach the adults linked to THAT child
 * only (athlete_guardian_links, active, receives_emails), never the child's
 * family again (the database leaves family members out) and never for other
 * children. One audience rule for every server-side notice; the SQL paths
 * (booking notices, scoped alerts) use the same athlete_linked_recipients().
 * Service role, filtered by org in SQL. Never throws.
 */
export type LinkedRecipient = { athleteId: string; profileId: string; email: string | null; name: string | null };

export async function linkedRecipientsFor(orgId: string, athleteIds: string[]): Promise<LinkedRecipient[]> {
  const ids = Array.from(new Set(athleteIds.filter(Boolean)));
  if (!orgId || !ids.length) return [];
  try {
    const db = createAdminClient() as unknown as {
      rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await db.rpc("athlete_linked_recipients_for", { p_org: orgId, p_athletes: ids });
    if (error) {
      logError("notifications.linkedRecipients", error);
      return [];
    }
    return ((data ?? []) as { athlete_id: string; profile_id: string; email: string | null; name: string | null }[])
      .map((r) => ({ athleteId: r.athlete_id, profileId: r.profile_id, email: r.email, name: r.name }));
  } catch (e) {
    logError("notifications.linkedRecipients", e);
    return [];
  }
}

/** Profile ids to add to an audience, without the ones already in it (one copy per person). */
export function addLinked(audience: string[], linked: LinkedRecipient[]): string[] {
  return Array.from(new Set([...audience, ...linked.map((l) => l.profileId)]));
}
