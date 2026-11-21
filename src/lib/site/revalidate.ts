import "server-only";
import { revalidateTag } from "next/cache";
import { logError } from "@/lib/log";

/**
 * Cache invalidation of the club site. Tag names mirror src/lib/site/server.ts
 * (kept here without its imports so any server action can call these cheaply).
 *   revalidateSite(org)      everything of the site (publish, settings, media)
 *   revalidateSiteLive(org)  live blocks only (app data changed)
 * Never throws: outside a request context revalidateTag is a no-op error.
 */

export function revalidateSite(orgId: string | null | undefined): void {
  if (!orgId) return;
  try {
    revalidateTag(`site:${orgId}`);
  } catch (e) {
    logError("site.revalidate", e);
  }
}

export function revalidateSiteLive(orgId: string | null | undefined): void {
  if (!orgId) return;
  try {
    revalidateTag(`site-live:${orgId}`);
  } catch {
    // Called from code paths without a request (cron jobs): the 5-minute
    // revalidate window covers it.
  }
}
