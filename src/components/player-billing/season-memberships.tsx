import Link from "next/link";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Label, Select, StatCard } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { MEMBERSHIP_PAYMENT_FILTERS, matchesPaymentFilter, totalsByCategory, type MembershipPaymentFilter } from "@/lib/billing/player-billing";
import type { MembershipFormSeason, MembershipView } from "@/lib/data/player-billing";
import { MoneyStatusPill } from "./category-pill";

/**
 * Season memberships (club fee) of one season with filters in the URL
 * (season, team, payment status, search). One row per membership: a player
 * on two teams is counted once and both teams are listed.
 */
export async function SeasonMemberships({ rows, seasons, teams, filters, error }: {
  rows: MembershipView[]; seasons: MembershipFormSeason[]; teams: { id: string; name: string }[];
  filters: { seasonId: string | null; teamId: string | null; payment: MembershipPaymentFilter | null; q: string }; error?: string | null;
}) {
  const { t, f } = await getI18n();
  const shown = rows.filter((r) => matchesPaymentFilter({ status: r.paymentStatus, overdue: r.overdue }, filters.payment));
  const live = shown.filter((r) => r.status !== "cancelled");
  const sum = (pick: (r: MembershipView) => number) =>
    totalsByCategory(live, () => "club_membership", pick, (r) => r.currency).map((x) => f.money(x.total, x.currency)).join(" · ") || f.money(0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("playerBilling.list.title")}</CardTitle>
        <Link href={`/admin/memberships/new${filters.seasonId ? `?season=${filters.seasonId}` : ""}`}><Button size="sm">{t("playerBilling.membership.add")}</Button></Link>
      </CardHeader>
      <CardBody className="space-y-4">
        <form method="get" className="grid gap-3 sm:grid-cols-5" role="search">
          <div>
            <Label htmlFor="ms-season">{t("playerBilling.form.season")}</Label>
            <Select id="ms-season" name="season" defaultValue={filters.seasonId ?? ""}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="ms-team">{t("playerBilling.list.team")}</Label>
            <Select id="ms-team" name="team" defaultValue={filters.teamId ?? ""}>
              <option value="">{t("clubadmin.common.all")}</option>
              {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="ms-pay">{t("playerBilling.list.paymentStatus")}</Label>
            <Select id="ms-pay" name="payment" defaultValue={filters.payment ?? ""}>
              <option value="">{t("clubadmin.common.all")}</option>
              {MEMBERSHIP_PAYMENT_FILTERS.map((p) => <option key={p} value={p}>{t(`playerBilling.paymentStatus.${p}`)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="ms-q">{t("common.search")}</Label>
            <Input id="ms-q" name="q" defaultValue={filters.q} placeholder={t("playerBilling.search.placeholder")} />
          </div>
          <div className="flex items-end"><Button type="submit" size="sm" variant="secondary">{t("playerBilling.list.apply")}</Button></div>
        </form>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label={t("playerBilling.list.members")} value={String(live.length)} />
          <StatCard label={t("playerBilling.membership.invoiced")} value={sum((r) => r.seasonFee.invoiced)} />
          <StatCard label={t("playerBilling.membership.paid")} value={sum((r) => r.seasonFee.paid)} />
          <StatCard label={t("playerBilling.membership.balance")} value={sum((r) => r.seasonFee.balance)} />
        </div>

        {error ? <p role="alert" className="text-sm text-danger">{t("playerBilling.errors.loadFailed")}</p>
          : shown.length === 0 ? <EmptyState title={t("playerBilling.list.empty")} description={t("playerBilling.list.emptyHint")} /> : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">{t("playerBilling.list.title")}</caption>
              <thead className="bg-surface-elevated text-left text-[11px] uppercase tracking-[0.1em] text-text-muted">
                <tr>
                  <th className="px-3 py-2">{t("playerBilling.list.player")}</th>
                  <th className="px-3 py-2">{t("playerBilling.membership.teams")}</th>
                  <th className="px-3 py-2">{t("playerBilling.membership.payers")}</th>
                  <th className="px-3 py-2 text-right">{t("playerBilling.membership.agreedFee")}</th>
                  <th className="px-3 py-2 text-right">{t("playerBilling.membership.paid")}</th>
                  <th className="px-3 py-2 text-right">{t("playerBilling.membership.balance")}</th>
                  <th className="px-3 py-2">{t("playerBilling.list.paymentStatus")}</th>
                  <th className="px-3 py-2"><span className="sr-only">{t("common.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={`border-t border-border align-top ${r.status === "cancelled" ? "opacity-60" : ""}`}>
                    <td className="px-3 py-2">
                      {r.athleteId ? <Link href={`/admin/athletes/${r.athleteId}?tab=membership`} className="font-medium text-text hover:text-brand-primary">{r.athleteName}</Link> : <span>{r.familyName}</span>}
                      <span className="block text-xs text-text-muted">{r.familyName}</span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{r.teams.length ? r.teams.map((x) => x.name).join(", ") : "—"}</td>
                    <td className="px-3 py-2 text-text-secondary">{r.payers.map((p) => p.name ?? t.dynamic(`playerBilling.payerKinds.${p.kind}`, undefined, p.kind)).join(", ") || "—"}</td>
                    <td className="px-3 py-2 text-right tnum text-text">{f.money(r.agreedFee, r.currency)}</td>
                    <td className="px-3 py-2 text-right tnum text-text">{f.money(r.seasonFee.paid, r.currency)}</td>
                    <td className="px-3 py-2 text-right tnum text-text">
                      {f.money(r.seasonFee.balance, r.currency)}
                      {r.carryForwardInvoices.length > 0 && <span className="block text-xs text-text-muted">{t("playerBilling.list.plusCarry", { amount: f.money(r.carryForward.balance, r.currency) })}</span>}
                    </td>
                    <td className="px-3 py-2"><MoneyStatusPill status={r.paymentStatus} overdue={r.overdue} /></td>
                    <td className="px-3 py-2 text-right"><Link href={`/admin/memberships/${r.id}`} className="text-xs text-brand-primary hover:underline">{t("playerBilling.membership.open")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
