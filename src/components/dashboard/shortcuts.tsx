import Link from "next/link";
import { BarChart3, CreditCard, IdCard, Medal, Search, type LucideIcon } from "lucide-react";
import { getSessionUser } from "@/lib/auth/get-user";
import { getTranslations } from "@/lib/i18n/server";
import { getTenant } from "@/lib/tenant/server";
import { labelsFor } from "@/lib/sportsops/labels";
import { getAdminNavContext, getCurrentSeasonId } from "@/lib/data/admin-nav";
import { buildDashboardShortcuts, type ShortcutKey } from "@/components/layout/admin-nav";

const ICONS: Record<ShortcutKey, LucideIcon> = {
  findPlayer: Search, addMembership: IdCard, addToRoster: Medal, recordPayment: CreditCard, monthlyReport: BarChart3,
};

/**
 * Compact row of everyday jumps on the admin dashboard. Role- and plan-
 * filtered on the server (same rules as the menu); the current season and
 * the club's selection programme are resolved here, never from the client.
 */
export async function DashboardShortcuts() {
  const user = await getSessionUser();
  if (!user?.orgId || !(user.roles.includes("admin") || user.roles.includes("finance"))) return null;
  const [t, tenant, nav, seasonId] = await Promise.all([
    getTranslations(), getTenant(), getAdminNavContext(user), getCurrentSeasonId(user.orgId),
  ]);
  const shortcuts = buildDashboardShortcuts({ ...nav, currentSeasonId: seasonId });
  if (!shortcuts.length) return null;
  const labels = labelsFor(tenant.terminology);
  const label = (s: (typeof shortcuts)[number]) => {
    switch (s.key) {
      case "findPlayer": return t("dashboard.widgets.shortcuts.findPlayer", { label: labels.athletes });
      case "addMembership": return t("dashboard.widgets.shortcuts.addMembership");
      case "addToRoster": return s.labelParams?.name
        ? t("dashboard.widgets.shortcuts.addToRosterFor", { name: s.labelParams.name })
        : t("dashboard.widgets.shortcuts.addToRoster");
      case "recordPayment": return t("dashboard.widgets.shortcuts.recordPayment");
      case "monthlyReport": return t("dashboard.widgets.shortcuts.monthlyReport");
    }
  };
  return (
    <nav aria-label={t("dashboard.widgets.shortcuts.label")}>
      <h2 className="sr-only">{t("dashboard.widgets.shortcuts.title")}</h2>
      <ul className="flex flex-wrap gap-2">
        {shortcuts.map((s) => {
          const Icon = ICONS[s.key];
          return (
            <li key={s.key}>
              <Link
                href={s.href as never}
                prefetch={false}
                className="touch-target inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs text-text-secondary transition-colors duration-150 hover:border-brand-primary hover:text-text focus-visible:outline-none focus-visible:shadow-focus"
              >
                <Icon aria-hidden className="h-3.5 w-3.5 text-brand-primary" />
                {label(s)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
