"use client";

import Link from "next/link";
import { Badge, Input } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import type { PayerContext } from "@/lib/data/player-billing";
import { groupByCategory, installmentsSettled, parseAmount, type AllocationRowError } from "@/lib/billing/player-billing";
import { CategoryPill } from "./category-pill";

export type OpenInvoiceRow = PayerContext["openInvoices"][number];

/**
 * Open invoices of a payer grouped by revenue category (never combined),
 * with an amount field per invoice and the instalments that amount settles.
 * Invoices in another currency than the receipt cannot be allocated.
 */
export function AllocationList({ invoices, currency, alloc, onChange, rowErrors }: {
  invoices: OpenInvoiceRow[]; currency: string; alloc: Record<string, string>; onChange: (next: Record<string, string>) => void;
  rowErrors: Record<string, AllocationRowError>;
}) {
  const t = useT();
  const f = useFormat();
  if (!invoices.length) return <p className="text-sm text-text-muted">{t("playerBilling.record.noOpenInvoices")}</p>;
  return (
    <div className="space-y-3">
      {groupByCategory(invoices, (i) => i.category).map((g) => (
        <fieldset key={g.category} className="rounded-md border border-border">
          <legend className="ml-3 px-1"><CategoryPill category={g.category} label={g.items.find((i) => i.categoryLabel)?.categoryLabel} /></legend>
          <ul className="divide-y divide-border-soft">
            {g.items.map((i) => {
              const typed = parseAmount(alloc[i.id] ?? "");
              const settles = typed && Number.isFinite(typed) ? installmentsSettled(i.installments, typed, i.currency) : [];
              const rowError = rowErrors[i.id];
              return (
                <li key={i.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0 text-sm">
                    <Link href={`/admin/invoices/${i.id}`} className="tnum font-medium text-text hover:text-brand-primary">{i.number}</Link>
                    <span className="ml-2 text-xs text-text-muted">
                      {[i.athleteName, i.description, i.dueDate ? t("playerBilling.record.due", { date: f.date(i.dueDate) }) : null].filter(Boolean).join(" · ")}
                    </span>
                    {i.overdue && <Badge tone="danger" dot className="ml-2">{t("playerBilling.paymentStatus.overdue")}</Badge>}
                    {settles.length > 0 && (
                      <span className="mt-1 block text-xs text-text-secondary">
                        {t("playerBilling.record.settles", {
                          list: settles.map((s) => `#${s.seq} ${f.date(s.dueDate)}${s.covers === "partial" ? ` (${t("playerBilling.record.partial")})` : ""}`).join(", "),
                        })}
                      </span>
                    )}
                    {rowError && <span role="alert" className="mt-1 block text-xs text-danger">{t(`playerBilling.allocation.${rowError}`)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tnum text-xs text-text-muted">{t("playerBilling.common.balanceShort", { amount: f.money(i.balance, i.currency) })}</span>
                    <Input aria-label={t("playerBilling.record.allocateTo", { number: i.number })} inputMode="decimal" className="w-28 text-right"
                      disabled={i.currency !== currency} value={alloc[i.id] ?? ""} placeholder="0" onChange={(e) => onChange({ ...alloc, [i.id]: e.target.value })} />
                  </div>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
