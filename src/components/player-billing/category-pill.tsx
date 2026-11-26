"use client";

import { Badge } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { categoryLabelKey } from "@/lib/billing/activities";
import type { MoneyStatus } from "@/lib/billing/player-billing";

/**
 * Revenue category of an invoice as a small badge, from data the caller
 * already loaded (lists). Selection invoices show the programme series
 * ("EYBL") when known. For a single invoice page use InvoiceCategoryBadge.
 */
export function CategoryPill({ category, label, className }: { category: string; label?: string | null; className?: string }) {
  const t = useT();
  const text = category === "selection" && label ? label : t(categoryLabelKey(category));
  return <Badge tone={category === "other" ? "warning" : "neutral"} className={className}>{text}</Badge>;
}

const PAY_TONE: Record<MoneyStatus, "success" | "warning" | "danger" | "neutral"> = { paid: "success", partial: "warning", unpaid: "danger", none: "neutral" };

/** Paid / partly paid / unpaid badge. */
export function MoneyStatusPill({ status, overdue }: { status: MoneyStatus; overdue?: boolean }) {
  const t = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={PAY_TONE[status]}>{t(`playerBilling.paymentStatus.${status}`)}</Badge>
      {overdue && <Badge tone="danger" dot>{t("playerBilling.paymentStatus.overdue")}</Badge>}
    </span>
  );
}
