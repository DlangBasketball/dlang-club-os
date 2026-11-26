import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/log";
import { parseFiles } from "./person-delete";

type AdminDb = ReturnType<typeof createAdminClient>;

/**
 * After an erase (admin action or daily purge): remove the files the database
 * listed from their private buckets, and scrub + lock the logins of guardians
 * who belonged to nothing else. Service role, server only. Never throws; the
 * database rows are already gone or anonymised.
 */
export async function finishErase(
  result: { files?: unknown; auth_user_ids?: unknown } | null | undefined,
  db: AdminDb = createAdminClient(),
): Promise<{ filesRemoved: number; loginsClosed: number }> {
  let filesRemoved = 0;
  let loginsClosed = 0;
  for (const { bucket, paths } of parseFiles(result?.files)) {
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await db.storage.from(bucket).remove(chunk);
      if (error) logError("personDelete.files", error, { bucket, count: chunk.length });
      else filesRemoved += chunk.length;
    }
  }
  const ids = Array.isArray(result?.auth_user_ids)
    ? (result!.auth_user_ids as unknown[]).filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))
    : [];
  for (const id of ids) {
    // Keep the auth row (profiles and history point at it) but leave nothing
    // personal in it and block sign-in for good.
    const { error } = await db.auth.admin.updateUserById(id, {
      email: `deleted-${id}@deleted.invalid`,
      user_metadata: {},
      ban_duration: "876000h",
    });
    if (error) logError("personDelete.login", error);
    else loginsClosed += 1;
  }
  return { filesRemoved, loginsClosed };
}
