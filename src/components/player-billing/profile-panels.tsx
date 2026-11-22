import Link from "next/link";
import { Plus, Wallet } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, statusTone } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { categoryLabelKey } from "@/lib/billing/activities";
import { groupByCategory, totalsByCategory } from "@/lib/billing/player-billing";
import type { MembershipView, PlayerBillingOverview, PlayerBookingView } from "@/lib/data/player-billing";
import { CategoryPill, MoneyStatusPill } from "./category-pill";
import { MembershipCard } from "./membership-card";

/*
 * Player profile tab panels (admin / finance). Server components fed by
 * src/lib/data/player-billing.ts; the profile page decides who sees what.
 */

/** Club Membership tab: one card per season, newest first; "Add club membership" when the current season has none. */
export async function MembershipTab({ athleteId, memberships, currentSeasonId, canAdd, error }: {
  athleteId: string; memberships: MembershipView[]; currentSeasonId: string | null; canAdd: boolean; error?: string | null;
}) {
  const { t } = await getI18n();
  const hasCurrent = memberships.some((m) => m.kind === "season_fee" && m.seasonId === currentSeasonId && m.status !== "cancelled");
  const addHref = `/admin/memberships/new?athlete=${athleteId}${currentSeasonId ? `&season=${currentSeasonId}` : ""}`;
  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-danger">{t("playerBilling.errors.loadFailed")}</p>}
      {!hasCurrent && canAdd && (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">{t("playerBilling.membership.noneCurrent")}</p>
            <Link href={addHref}><Button size="sm"><Plus className="h-4 w-4" aria-hidden /> {t("playerBilling.membership.add")}</Button></Link>
          </CardBody>
        </Card>
      )}
      {memberships.length === 0 && !canAdd && <p className="text-sm text-text-muted">{t("playerBilling.membership.none")}</p>}
      {memberships.map((m) => (
        <MembershipCard key={m.id} m={m} actions={<Link href={`/admin/memberships/${m.id}`} className="text-xs text-brand-primary hover:underline">{t("playerBilling.membership.open")}</Link>} />
      ))}
    </div>
  );
}

/** Bookings tab: training bookings with their invoice (number, status, payment status), linked both ways. */
export async function BookingsTab({ bookings, error }: { bookings: PlayerBookingView[]; error?: string | null }) {
  const { t, f } = await getI18n();
  return (
    <Card>
      <CardHeader><CardTitle>{t("playerBilling.bookings.title")}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {error ? <p role="alert" className="px-5 py-6 text-sm text-danger">{t("playerBilling.errors.loadFailed")}</p>
          : bookings.length === 0 ? <p className="px-5 py-6 text-center text-sm text-text-muted">{t("playerBilling.bookings.empty")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="bg-surface-elevated text-left text-[11px] uppercase tracking-[0.1em] text-text-muted">
                <tr>
                  <th className="px-4 py-2">{t("playerBilling.bookings.date")}</th>
                  <th className="px-4 py-2">{t("playerBilling.bookings.service")}</th>
                  <th className="px-4 py-2 text-right">{t("playerBilling.bookings.price")}</th>
                  <th className="px-4 py-2">{t("playerBilling.common.invoice")}</th>
                  <th className="px-4 py-2">{t("playerBilling.bookings.payment")}</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.id} className="border-t border-border-soft align-top">
                    <td className="px-4 py-2">
                      <Link href={`/admin/bookings/${b.id}`} className="tnum text-text hover:text-brand-primary">{f.date(b.start)} · {f.time(b.start)}</Link>
                      <span className="block"><Badge tone={statusTone(b.status)}>{t.dynamic(`editOps.bookings.statuses.${b.status}`, undefined, b.status)}</Badge></span>
                    </td>
                    <td className="px-4 py-2 text-text">{b.serviceName}<span className="block text-xs text-text-muted">{b.coachName}</span></td>
                    <td className="px-4 py-2 text-right tnum text-text">
                      {b.creditsUsed > 0 ? t("playerBilling.bookings.credits", { count: b.creditsUsed }) : b.price != null ? f.money(b.price, b.invoice?.currency) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {b.invoice ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/admin/invoices/${b.invoice.id}`} className="tnum text-brand-primary hover:underline">{b.invoice.number}</Link>
                          <Badge tone={statusTone(b.invoice.status)}>{t.dynamic(`status.${b.invoice.status}`, undefined, b.invoice.status)}</Badge>
                        </span>
                      ) : <span className="text-text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2">{b.invoice ? <MoneyStatusPill status={b.invoice.paymentStatus} /> : <span className="text-text-muted">—</span>}</td>
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

/**
 * Billing tab: balance per revenue category (never added together), invoices
 * grouped by category, payments with their receipt allocation, and credit
 * per category.
 */
export async function BillingTab({ overview, familyId, athleteId, error }: {
  overview: PlayerBillingOverview | null; familyId: string; athleteId: string; error?: string | null;
}) {
  const { t, f } = await getI18n();
  if (error || !overview) return <p role="alert" className="text-sm text-danger">{t("playerBilling.errors.loadFailed")}</p>;
  const live = overview.invoices.filter((i) => !["cancelled", "void", "draft"].includes(i.status));
  const balances = totalsByCategory(live, (i) => i.category, (i) => i.balance, (i) => i.currency);
  const groups = groupByCategory(overview.invoices, (i) => i.category);
  const label = (c: string, l?: string | null) => (c === "selection" && l ? l : t(categoryLabelKey(c)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-muted">{t("playerBilling.billing.hint")}</p>
        <span className="flex flex-wrap gap-2">
          <Link href={`/admin/payments/record?athlete=${athleteId}`}><Button size="sm" variant="secondary"><Wallet className="h-4 w-4" aria-hidden /> {t("playerBilling.billing.recordPayment")}</Button></Link>
          <Link href={`/admin/families/${familyId}`}><Button size="sm" variant="ghost">{t("media.profile.openFamily")}</Button></Link>
        </span>
      </div>

      <section aria-labelledby="pb-balances">
        <h2 id="pb-balances" className="mb-2 text-sm font-medium text-text-secondary">{t("playerBilling.billing.balances")}</h2>
        {balances.length === 0 ? <p className="text-sm text-text-muted">{t("media.profile.noInvoices")}</p> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {balances.map((b) => (
              <div key={`${b.category}-${b.currency}`} className="rounded-md border border-border bg-surface-elevated px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text-muted">{label(b.category)}</div>
                <div className="font-display text-lg tnum text-text">{f.money(b.total, b.currency)}</div>
                <div className="text-xs text-text-muted">{t("playerBilling.billing.invoiceCount", { count: b.count })}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {groups.map((g) => (
        <Card key={g.category}>
          <CardHeader><CardTitle className="flex items-center gap-2"><CategoryPill category={g.category} label={g.items.find((i) => i.categoryLabel)?.categoryLabel} /></CardTitle></CardHeader>
          <CardBody className="p-0">
            <ul>
              {g.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <Link href={`/admin/invoices/${i.id}`} className="tnum text-sm text-text hover:text-brand-primary">{i.number}</Link>
                    <div className="text-xs text-text-muted">
                      {f.date(i.issuedAt)}{i.description ? ` · ${i.description}` : ""}{!i.athleteId ? ` · ${t("media.profile.familyInvoice")}` : ""}
                      {i.chargeKind === "carry_forward" ? ` · ${t("playerBilling.membership.carryForward")}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="tnum text-sm text-text">{f.money(i.amountDue, i.currency)}</span>
                    <span className="tnum text-xs text-text-muted">{t("playerBilling.common.balanceShort", { amount: f.money(i.balance, i.currency) })}</span>
                    <Badge tone={statusTone(i.status)}>{t.dynamic(`status.${i.status}`, undefined, i.status)}</Badge>
                    {i.status !== "draft" && i.status !== "cancelled" && i.status !== "void" && <MoneyStatusPill status={i.paymentStatus} overdue={i.overdue} />}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}

      <Card>
        <CardHeader><CardTitle>{t("playerBilling.billing.payments")}</CardTitle></CardHeader>
        <CardBody className="p-0">
          {overview.payments.length === 0 ? <div className="p-5"><EmptyState title={t("playerBilling.billing.noPayments")} /></div> : (
            <ul>
              {overview.payments.map((p) => (
                <li key={p.id} className={`flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-2.5 last:border-0 ${p.voided ? "opacity-60" : ""}`}>
                  <div className="min-w-0 text-sm">
                    <span className="text-text">{p.paidAt ? f.date(p.paidAt) : "—"} · {t.dynamic(`editMoney.methods.${p.method}`, undefined, p.method)}</span>
                    <span className="block text-xs text-text-muted">
                      {t("playerBilling.billing.allocatedTo")} <Link href={`/admin/invoices/${p.invoiceId}`} className="tnum text-brand-primary hover:underline">{p.invoiceNumber}</Link>
                      {" · "}{label(p.category, p.categoryLabel)}
                      {p.receipt && ` · ${t("playerBilling.billing.receiptLine", { amount: f.money(p.receipt.amount, p.currency), date: f.date(p.receipt.receivedOn), payer: p.receipt.payerName ?? "—" })}`}
                      {p.voided && ` · ${t("playerBilling.common.voided")}`}
                    </span>
                  </div>
                  <span className={`tnum text-sm ${p.amount < 0 ? "text-danger" : "text-success"} ${p.voided ? "line-through" : ""}`}>{f.money(p.amount, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("playerBilling.billing.credits")}</CardTitle></CardHeader>
        <CardBody>
          {overview.credits.length === 0 ? <p className="text-sm text-text-muted">{t("playerBilling.billing.noCredits")}</p> : (
            <ul className="space-y-1 text-sm">
              {overview.credits.map((c) => (
                <li key={`${c.activity}-${c.currency}`} className="flex justify-between gap-3">
                  <span className="text-text-secondary">{c.activity === "unassigned" ? t("playerBilling.billing.unassignedCredit") : label(c.activity)}</span>
                  <span className="tnum text-text">{f.money(c.credit, c.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
