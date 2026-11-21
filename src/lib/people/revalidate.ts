import "server-only";
import { revalidatePath } from "next/cache";
import { notifyWebsite } from "@/lib/website/webhooks";
import { revalidateSiteLive } from "@/lib/site/revalidate";
import type { WebhookResource } from "@/lib/website/webhook-schedule";

/**
 * Route groups that show people: lists, rosters, counts, calendars and
 * dashboards of every portal. Revalidating the layout of each group refreshes
 * every page below it on the next request.
 */
export const PERSON_ROUTE_GROUPS = ["/admin", "/coach", "/parent", "/board", "/book", "/club"] as const;

/** Website API resources that carry people (rosters, sign-up counts, results). */
export const PERSON_WEBSITE_RESOURCES: WebhookResource[] = ["teams", "programs", "camps", "events", "results", "training"];

/**
 * After a person is added, changed, removed, archived, restored or erased:
 * refresh every portal (admin, coach, parent, public booking / club pages),
 * the built-in site's live blocks, and queue the "content.updated" webhook to
 * the club's external website (which purges its cache of the website API).
 *
 * Never throws: outside a request context (cron jobs) Next's revalidation is
 * unavailable and the short cache windows cover it.
 */
export function revalidatePersonEverywhere(orgId: string | null | undefined): void {
  for (const path of PERSON_ROUTE_GROUPS) {
    try {
      revalidatePath(path, "layout");
    } catch {
      // No request context (cron): nothing cached per request to refresh.
    }
  }
  if (!orgId) return;
  revalidateSiteLive(orgId);
  try {
    notifyWebsite(orgId, ...PERSON_WEBSITE_RESOURCES);
  } catch {
    // Best effort; the website cron retries queued deliveries.
  }
}
