import { Badge } from "@/components/ui";
import { getInvoiceCategoryInfo } from "@/lib/data/billing";
import { getTranslations } from "@/lib/i18n/server";
import { categoryLabelKey } from "@/lib/billing/activities";

/**
 * Revenue category (and what the invoice is for) of one invoice, as a small
 * badge. Server component; the read is RLS-scoped, so it renders nothing
 * for an invoice the caller cannot see.
 */
export async function InvoiceCategoryBadge({ invoiceId }: { invoiceId: string }) {
  const [res, t] = await Promise.all([getInvoiceCategoryInfo(invoiceId), getTranslations()]);
  const info = res.data;
  if (!info) return null;
  const label = info.category === "selection" && info.categoryLabel ? info.categoryLabel : t(categoryLabelKey(info.category));
  const title = [label, info.sourceLabel, info.number].filter(Boolean).join(" · ");
  return (
    <Badge tone={info.category === "other" ? "warning" : "neutral"} title={title}>
      {info.sourceLabel ? `${label} · ${info.sourceLabel}` : label}
    </Badge>
  );
}
