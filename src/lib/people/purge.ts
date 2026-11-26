import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";
import { adminRecipients, sendNotice } from "@/lib/club-admin/notify";
import { finishErase } from "./erase-cleanup";
import { revalidatePersonEverywhere } from "./revalidate";
import { PURGE_NOTICE_DAYS } from "./person-delete";

type NoticeRow = { org_id: string; deletion_id: string; kind: string; purge_after: string };
type PurgeRow = { org_id: string; deletion_id: string; ok: boolean; files?: unknown; auth_user_ids?: unknown; error?: string };

/**
 * Daily job (club-admin cron), service role, every club:
 *   1. tell each club's admins once, PURGE_NOTICE_DAYS before, how many
 *      archived people will be deleted permanently (no names in the notice);
 *   2. erase the archived people whose 30 days are over, then remove their
 *      files and close the logins the database returned.
 * Idempotent: notices are marked in the database, erased rows are not due again.
 */
export async function purgeArchivedPeople(): Promise<{ noticed: number; erased: number; failed: number }> {
  const db = createAdminClient();
  let noticed = 0, erased = 0, failed = 0;

  const { data: due, error: noticeError } = await db.rpc("person_deletions_due_notice", { p_days: PURGE_NOTICE_DAYS });
  if (noticeError) logError("people.purge.notice", noticeError);
  const byOrg = new Map<string, { count: number; first: string }>();
  for (const r of (due ?? []) as NoticeRow[]) {
    const cur = byOrg.get(r.org_id);
    byOrg.set(r.org_id, { count: (cur?.count ?? 0) + 1, first: !cur || r.purge_after < cur.first ? r.purge_after : cur.first });
  }
  for (const [orgId, { count, first }] of Array.from(byOrg)) {
    await sendNotice({
      orgId, kind: "personPurgeAdmin", recipients: await adminRecipients(orgId),
      params: { name: String(count), date: first }, link: "/admin/deleted",
    });
    noticed += count;
  }

  const { data: purged, error } = await db.rpc("purge_due_person_deletions", { p_limit: 200 });
  if (error) {
    logError("people.purge.run", error);
    return { noticed, erased, failed };
  }
  const touched = new Set<string>();
  for (const r of ((purged ?? []) as unknown as PurgeRow[])) {
    if (!r.ok) {
      failed += 1;
      logError("people.purge.row", new Error(r.error ?? "erase failed"), { deletion: r.deletion_id });
      continue;
    }
    await finishErase(r, db);
    erased += 1;
    touched.add(r.org_id);
  }
  for (const orgId of Array.from(touched)) revalidatePersonEverywhere(orgId);
  return { noticed, erased, failed };
}
