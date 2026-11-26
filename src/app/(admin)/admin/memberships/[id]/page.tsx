import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Wallet } from "lucide-react";
import { Button, Card, CardBody, ErrorState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getMembershipDetail, getPlayerMemberships } from "@/lib/data/player-billing";
import { MembershipCard } from "@/components/player-billing/membership-card";
import { CarryForwardButton } from "@/components/player-billing/carry-forward";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("playerBilling.membership.title") };
}

/**
 * One club membership: season, fee, teams, payers, plan, invoices, payments
 * and balance; carry an open amount forward to a later season (admin).
 * Issued amounts are changed through the invoice (credit note), never here.
 */
export default async function MembershipDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me, { t }] = await Promise.all([params, getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const isAdmin = me.roles.includes("admin");
  const canCarry = isAdmin || me.roles.includes("finance");
  const res = await getMembershipDetail(id);
  if (res.error !== null) return <ErrorState title={t("playerBilling.errors.loadFailedTitle")} message={t("playerBilling.errors.loadFailed")} />;
  const m = res.data;
  if (!m) notFound();

  // Later seasons of the same player (carry-forward targets).
  const others = m.athleteId && canCarry && m.kind === "season_fee" ? await getPlayerMemberships(m.athleteId) : null;
  const targets = (others?.data ?? [])
    .filter((x) => x.id !== m.id && x.kind === "season_fee" && x.status !== "cancelled" && (x.seasonStartsOn ?? "") > (m.seasonStartsOn ?? ""))
    .map((x) => ({ id: x.id, seasonName: x.seasonName ?? "" }));

  return (
    <div className="animate-fade-up max-w-4xl space-y-5">
      <PageHeader
        eyebrow={<Link href={`/admin/memberships${m.seasonId ? `?season=${m.seasonId}` : ""}`} className="hover:underline">{t("clubadmin.membership.title")}</Link>}
        title={m.athleteName || m.familyName || t("playerBilling.membership.title")}
        description={[m.seasonName, m.kind === "season_fee" ? t("playerBilling.membership.seasonFee") : m.typeName].filter(Boolean).join(" · ")}
        actions={
          <div className="flex flex-wrap gap-2">
            {m.athleteId && <Link href={`/admin/athletes/${m.athleteId}?tab=membership`}><Button size="sm" variant="secondary">{t("playerBilling.form.openPlayer")}</Button></Link>}
            {m.seasonFee.balance > 0 && (
              <Link href={`/admin/payments/record?family=${m.familyId}`}><Button size="sm"><Wallet className="h-4 w-4" aria-hidden /> {t("playerBilling.billing.recordPayment")}</Button></Link>
            )}
          </div>
        }
      />
      <MembershipCard m={m} />
      {m.kind === "season_fee" && (
        <Card><CardBody className="space-y-2">
          <h2 className="font-display text-lg text-text">{t("playerBilling.carry.section")}</h2>
          <p className="text-sm text-text-secondary">{t("playerBilling.membership.carryForwardHint")}</p>
          {canCarry
            ? <CarryForwardButton fromMembershipId={m.id} targets={targets} currency={m.currency} balance={m.seasonFee.balance} />
            : <p className="text-xs text-text-muted">{t("playerBilling.carry.adminOnly")}</p>}
        </CardBody></Card>
      )}
      <p className="text-xs text-text-muted">{t("playerBilling.membership.changeHint")}</p>
    </div>
  );
}
