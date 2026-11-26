import Link from "next/link";
import { ErrorState } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { FeatureGate } from "@/components/upgrades/feature-gate";

/** Settings -> Website (admins only): connection, news, import. */
export default async function WebsiteSettingsLayout({ children }: { children: React.ReactNode }) {
  const [me, t] = await Promise.all([getSessionUser(), getTranslations()]);
  if (!me?.orgId || !me.roles.includes("admin")) return <ErrorState message={t("website.errors.forbidden")} />;
  const tabs = [
    { href: "/admin/settings/website", label: t("website.admin.tabs.connection") },
    { href: "/admin/settings/website/news", label: t("website.admin.tabs.news") },
    { href: "/admin/settings/website/import", label: t("website.admin.tabs.import") },
  ];
  return (
    <FeatureGate feature="website_connect">
    <div className="space-y-6">
      <nav aria-label={t("website.admin.tab")} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href as never} className="rounded border border-border px-3 py-1.5 text-sm text-text-muted hover:border-brand-primary hover:text-text">
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
    </FeatureGate>
  );
}
