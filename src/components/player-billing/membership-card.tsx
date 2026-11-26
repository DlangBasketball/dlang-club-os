import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, CardTitle, statusTone } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import type { MembershipView } from "@/lib/data/player-billing";
import { CategoryPill, MoneyStatusPill } from "./category-pill";

/**
 * One club membership (one season): type, agreed fee, teams, payers with
 * share and amount, instalment plan, invoices (number + category), payments
 * and balance. Amounts carried forward from an earlier season are shown on
 * a separate line and never counted in the season fee. Server component;
 * staff only (the caller decides).
 */
export async function MembershipCard({ m, showPlayer = false, actions }: { m: MembershipView; showPlayer?: boolean; actions?: React.ReactNode }) {
  const { t, f } = await getI18n();
  const money = (n: number) => f.money(n, m.currency);
  const payerKind = (k: string) => t.dynamic(`playerBilling.payerKinds.${k}`, undefined, k);
  const share = (p: MembershipView["payers"][number]) => (p.shareKind === "percent" ? `${f.number(p.shareValue)} %` : money(p.shareValue));
  const invNumber = new Map(m.invoices.concat(m.carryForwardInvoices).map((i) => [i.id, i.number]));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <CardTitle>
            {showPlayer && m.athleteId ? <Link href={`/admin/athletes/${m.athleteId}?tab=membership`} className="hover:text-brand-primary">{m.athleteName}</Link> : (m.seasonName ?? m.typeName ?? t("playerBilling.membership.title"))}
          </CardTitle>
          <p className="text-xs text-text-muted">
            {[showPlayer ? m.seasonName : null, m.kind === "season_fee" ? t("playerBilling.membership.seasonFee") : m.typeName, f.dateRange(m.validFrom, m.validUntil)].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m.isCurrentSeason && <Badge tone="info">{t("playerBilling.membership.currentSeason")}</Badge>}
          {m.sponsored && <Badge tone="accent">{t("playerBilling.membership.sponsored")}</Badge>}
          <Badge tone={statusTone(m.status)}>{t.dynamic(`clubadmin.membership.statuses.${m.status}`, undefined, m.status)}</Badge>
          <MoneyStatusPill status={m.paymentStatus} overdue={m.overdue} />
          {actions}
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {([
            ["agreedFee", money(m.agreedFee)], ["invoiced", money(m.seasonFee.invoiced)], ["paid", money(m.seasonFee.paid)], ["balance", money(m.seasonFee.balance)],
          ] as const).map(([k, v]) => (
            <div key={k}><dt className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{t(`playerBilling.membership.${k}`)}</dt><dd className="font-display text-lg tnum text-text">{v}</dd></div>
          ))}
        </dl>

        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.1em] text-text-muted">{t("playerBilling.membership.teams")}</h3>
          {m.teams.length === 0 ? <p className="text-sm text-text-muted">{t("playerBilling.membership.noTeams")}</p> : (
            <p className="flex flex-wrap gap-1.5">{m.teams.map((x) => <Link key={x.id} href={`/admin/teams/${x.id}`}><Badge tone="neutral">{x.name}</Badge></Link>)}</p>
          )}
          <p className="mt-1 text-xs text-text-muted">{t("playerBilling.membership.teamsNeverChangeFee")}</p>
        </div>

        {m.payers.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.1em] text-text-muted">{t("playerBilling.membership.payers")}</h3>
            <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
              {m.payers.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="text-text">{p.name ?? "—"}</span>
                    <span className="ml-2 text-xs text-text-muted">{payerKind(p.kind)} · {share(p)}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum text-text">{money(p.amount)}</span>
                    {p.invoiceId && <Link href={`/admin/invoices/${p.invoiceId}`} className="tnum text-xs text-brand-primary hover:underline">{invNumber.get(p.invoiceId) ?? t("playerBilling.common.invoice")}</Link>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {m.installments.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.1em] text-text-muted">
              {t("playerBilling.membership.plan", { count: m.installmentCount ?? m.installments.length })}
            </h3>
            <div className="overflow-x-auto rounded-md border border-border-soft">
              <table className="w-full min-w-[28rem] text-sm">
                <thead className="bg-surface-elevated text-left text-[11px] uppercase tracking-[0.1em] text-text-muted">
                  <tr>
                    <th className="px-3 py-1.5">#</th>
                    <th className="px-3 py-1.5">{t("playerBilling.common.invoice")}</th>
                    <th className="px-3 py-1.5">{t("playerBilling.common.dueOn")}</th>
                    <th className="px-3 py-1.5 text-right">{t("playerBilling.common.amount")}</th>
                    <th className="px-3 py-1.5 text-right">{t("playerBilling.common.paid")}</th>
                    <th className="px-3 py-1.5">{t("playerBilling.common.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {m.installments.map((x) => (
                    <tr key={x.id} className="border-t border-border-soft">
                      <td className="px-3 py-1.5 tnum text-text-muted">{x.seq}</td>
                      <td className="px-3 py-1.5 tnum text-text-secondary">{invNumber.get(x.invoiceId) ?? ""}</td>
                      <td className="px-3 py-1.5 tnum text-text">{f.date(x.dueDate)}</td>
                      <td className="px-3 py-1.5 text-right tnum text-text">{money(x.amount)}</td>
                      <td className="px-3 py-1.5 text-right tnum text-text-secondary">{money(x.amountPaid)}</td>
                      <td className="px-3 py-1.5"><Badge tone={statusTone(x.status)}>{t.dynamic(`playerBilling.installmentStatus.${x.status}`, undefined, x.status)}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.1em] text-text-muted">{t("playerBilling.membership.invoices")}</h3>
          {m.invoices.length === 0 ? <p className="text-sm text-text-muted">{m.sponsored ? t("playerBilling.membership.sponsoredNoInvoice") : t("playerBilling.membership.noInvoices")}</p> : (
            <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
              {m.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/invoices/${i.id}`} className="tnum font-medium text-text hover:text-brand-primary">{i.number}</Link>
                    <CategoryPill category={i.category} label={i.categoryLabel} />
                    {i.payerName && <span className="text-xs text-text-muted">{i.payerName}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tnum text-text">{money(i.amountDue)}</span>
                    <span className="tnum text-xs text-text-muted">{t("playerBilling.common.balanceShort", { amount: money(i.balance) })}</span>
                    <Badge tone={statusTone(i.status)}>{t.dynamic(`status.${i.status}`, undefined, i.status)}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {m.payments.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-[0.1em] text-text-muted">{t("playerBilling.membership.payments")}</h3>
            <ul className="divide-y divide-border-soft rounded-md border border-border-soft">
              {m.payments.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${p.voided ? "opacity-60" : ""}`}>
                  <span className="text-text-secondary">
                    {p.paidAt ? f.date(p.paidAt) : "—"} · {t.dynamic(`editMoney.methods.${p.method}`, undefined, p.method)} · <span className="tnum">{p.invoiceNumber}</span>
                    {p.receiptId && <span className="ml-1 text-xs text-text-muted">{t("playerBilling.common.fromReceipt")}</span>}
                    {p.voided && <span className="ml-1 text-xs text-text-muted">{t("playerBilling.common.voided")}</span>}
                  </span>
                  <span className={`tnum ${p.amount < 0 ? "text-danger" : "text-success"} ${p.voided ? "line-through" : ""}`}>{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {m.carryForwardInvoices.length > 0 && (
          <div className="rounded-md border border-dashed border-border p-3">
            <h3 className="text-xs font-medium uppercase tracking-[0.1em] text-text-muted">{t("playerBilling.membership.carryForward")}</h3>
            <p className="mb-2 text-xs text-text-muted">{t("playerBilling.membership.carryForwardHint")}</p>
            <ul className="space-y-1 text-sm">
              {m.carryForwardInvoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Link href={`/admin/invoices/${i.id}`} className="tnum text-text hover:text-brand-primary">{i.number}</Link><CategoryPill category={i.category} /></span>
                  <span className="tnum text-text">{money(i.amountDue)} · {t("playerBilling.common.balanceShort", { amount: money(i.balance) })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {m.sponsoredNotes && <p className="text-xs text-text-muted">{m.sponsoredNotes}</p>}
      </CardBody>
    </Card>
  );
}
