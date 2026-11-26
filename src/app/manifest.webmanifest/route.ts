import { getTenant } from "@/lib/tenant/server";
import { getTranslator } from "@/lib/i18n/messages";
import { DEFAULT_LOCALE, normalizeLocale } from "@/lib/i18n/config";
import { buildWebManifest } from "@/lib/pwa/manifest";

/**
 * Per-tenant web app manifest (/manifest.webmanifest). The tenant comes from
 * the request host (getTenant), never from the client. Public branding only.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const tenant = await getTenant();
  const t = getTranslator(normalizeLocale(tenant.defaultLocale) ?? DEFAULT_LOCALE);
  const manifest = buildWebManifest(tenant, {
    description: t("pwa.manifest.description", { club: tenant.name }),
  });
  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Per host; short so a re-brand reaches installed apps quickly.
      "Cache-Control": "public, max-age=300, must-revalidate",
      Vary: "Host",
    },
  });
}
