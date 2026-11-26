import Link from "next/link";
import { cookies } from "next/headers";
import { getTranslations } from "@/lib/i18n/server";
import { DEMO_COOKIE, demoEnabled, isWellFormedDemoToken } from "@/lib/demo/config";

/**
 * Small "Demo · Switch role" pill shown on every page of a browser that holds
 * a prospect demo token (staging only). Reads the cookie only, no database.
 */
export async function DemoBar() {
  if (!demoEnabled()) return null;
  if (!isWellFormedDemoToken((await cookies()).get(DEMO_COOKIE)?.value)) return null;
  const t = await getTranslations();
  return (
    <Link
      href="/demo"
      className="fixed bottom-4 left-4 z-50 inline-flex items-center gap-2 rounded-full border border-brand-primary bg-surface px-3 py-1.5 text-xs font-medium text-text shadow-md hover:bg-surface-elevated print:hidden"
    >
      <span className="rounded-full bg-brand-primary px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-on-brand">{t("demo.bar.label")}</span>
      {t("demo.bar.switch")}
    </Link>
  );
}
