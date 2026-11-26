import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getClubBillingSettings } from "@/lib/data/billing";
import { getMembershipFormOptions, getMembershipFormPlayer, isUuid } from "@/lib/data/player-billing";
import { MembershipForm } from "@/components/player-billing/membership-form";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("playerBilling.form.title") };
}

/**
 * Add a club membership (season fee) — dashboard shortcut target. Accepts
 * ?athlete= (player preselected) and ?season=. Admin issues; finance may
 * open it to preview. One membership per player and season.
 */
export default async function NewMembershipPage({ searchParams }: { searchParams: Promise<{ athlete?: string; season?: string }> }) {
  const [me, { t }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const isAdmin = me.roles.includes("admin");
  const [options, settings, player] = await Promise.all([
    getMembershipFormOptions(),
    getClubBillingSettings(),
    isUuid(sp.athlete) ? getMembershipFormPlayer(sp.athlete) : Promise.resolve({ data: null, error: null }),
  ]);
  if (options.error !== null || settings.error !== null) {
    return <ErrorState title={t("playerBilling.errors.loadFailedTitle")} message={t("playerBilling.errors.loadFailed")} />;
  }
  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader
        eyebrow={<Link href="/admin/memberships" className="hover:underline">{t("clubadmin.membership.title")}</Link>}
        title={t("playerBilling.form.title")}
        description={t("playerBilling.form.description")}
      />
      {options.data.seasons.length === 0 ? (
        <Card><CardBody className="text-sm text-text-secondary">
          {t("playerBilling.form.noSeasons")} <Link href="/admin/settings/seasons" className="text-brand-primary hover:underline">{t("billing.seasons.tab")}</Link>
        </CardBody></Card>
      ) : (
        <Card><CardBody>
          <MembershipForm
            seasons={options.data.seasons}
            types={options.data.types}
            defaults={{
              installmentCount: settings.data.installmentCount, dueDay: settings.data.installmentDueDay,
              firstInstallmentMonth: settings.data.firstInstallmentMonth, currency: settings.data.currency,
            }}
            initialPlayer={player.data ?? null}
            initialSeasonId={isUuid(sp.season) ? sp.season : null}
            canIssue={isAdmin}
            canCreatePlayer={isAdmin}
          />
        </CardBody></Card>
      )}
    </div>
  );
}
