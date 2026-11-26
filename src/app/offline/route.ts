import { getTenant } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { brandingToCssVars } from "@/lib/tenant/theme";
import { renderOfflinePage } from "@/lib/pwa/offline-page";

/**
 * Offline fallback (/offline). A self-contained HTML document (inline styles,
 * no scripts or build assets) so it renders from the service-worker cache with
 * no network. The worker fetches it signed out: it never holds personal data.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const tenant = await getTenant();
  const { t, ctx } = await getI18n(tenant.id);
  const html = renderOfflinePage({
    lang: ctx.locale,
    appName: tenant.appName,
    cssVars: brandingToCssVars(tenant.branding),
    title: t("pwa.offline.title"),
    body: t("pwa.offline.body"),
    retry: t("pwa.offline.retry"),
  });
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Robots-Tag": "noindex",
    },
  });
}
