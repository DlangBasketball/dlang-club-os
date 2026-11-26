import "server-only";
import { getI18n } from "@/lib/i18n/server";
import { logError } from "@/lib/log";
import type { Tenant } from "@/lib/tenant/types";
import type { Translator } from "@/lib/i18n/translator";
import { buildNews, loadPublicEvents, type Ctx } from "./public-data";
import { getWebsiteSettings } from "./server";

/**
 * The app's own public pages (/club, /club/schedule) show the same public
 * data as the website API, in the visitor's language, with app-relative
 * links. They do not require the website connection to be enabled: the
 * public flags alone decide what is shown.
 */
async function hubCtx(tenant: Tenant): Promise<Ctx | null> {
  if (!tenant.id) return null;
  const [{ t, f }, settings] = await Promise.all([getI18n(tenant.id), getWebsiteSettings(tenant.id)]);
  return { club: { tenant: tenant as Tenant & { id: string }, settings }, t, f, appUrl: "" };
}

type News = Awaited<ReturnType<typeof buildNews>>;
type Events = Awaited<ReturnType<typeof loadPublicEvents>>;

export async function getHubNews(tenant: Tenant): Promise<{ items: News; t: Translator }> {
  const ctx = await hubCtx(tenant);
  const { t } = await getI18n(tenant.id);
  if (!ctx) return { items: [], t };
  try {
    return { items: await buildNews(ctx, { limit: 5 }), t };
  } catch (e) {
    logError("website.hubNews", e);
    return { items: [], t };
  }
}

export async function getHubSchedule(tenant: Tenant, team: string | null): Promise<{ upcoming: Events; results: Events; t: Translator }> {
  const ctx = await hubCtx(tenant);
  const { t } = await getI18n(tenant.id);
  if (!ctx) return { upcoming: [], results: [], t };
  try {
    const [upcoming, results] = await Promise.all([
      loadPublicEvents(ctx, { team }),
      loadPublicEvents(ctx, { team, pastOnly: true }),
    ]);
    return { upcoming, results: results.slice(0, 20), t };
  } catch (e) {
    logError("website.hubSchedule", e);
    return { upcoming: [], results: [], t };
  }
}
