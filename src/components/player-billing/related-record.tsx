import Link from "next/link";
import { Link2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, statusTone } from "@/components/ui";
import { getI18n } from "@/lib/i18n/server";
import { getInvoiceSource, type InvoiceSource } from "@/lib/data/billing";
import { getBookingState } from "@/lib/data/player-billing";

/** Admin link of the record an invoice was raised for. */
export function relatedRecordHref(src: InvoiceSource): string | null {
  switch (src.kind) {
    case "membership": return `/admin/memberships/${src.id}`;
    case "programme":
      // An enrolment (application) carries its programme id; a bare programme link has id = programme.
      return src.programId && src.programId !== src.id ? `/admin/selection/${src.programId}/players/${src.id}` : `/admin/programs/${src.id}`;
    case "registration": return `/admin/registrations/${src.id}`;
    case "booking": return `/admin/bookings/${src.id}`;
    case "training_package": return "/admin/training";
    case "shop": return `/admin/shop/orders/${src.id}`;
    default: return null;
  }
}

/**
 * "Related record" on the invoice page (invoice_source): the membership,
 * enrolment, booking, camp / programme registration or shop order the
 * invoice belongs to. A cancelled booking keeps its invoice and history;
 * Finance credits or refunds it with the invoice's own actions.
 */
export async function RelatedRecordCard({ invoiceId }: { invoiceId: string }) {
  const [{ t }, res] = await Promise.all([getI18n(), getInvoiceSource(invoiceId)]);
  const src = res.data;
  if (!src) return null;
  const href = relatedRecordHref(src);
  const booking = src.kind === "booking" ? await getBookingState(src.id) : null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" aria-hidden /> {t("playerBilling.related.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-2 text-sm">
        <div className="text-xs uppercase tracking-wide text-text-muted">{t.dynamic(`playerBilling.related.kinds.${src.kind}`, undefined, src.kind)}</div>
        {href ? <Link href={href} className="block text-brand-primary hover:underline">{src.label ?? t("playerBilling.related.open")}</Link> : <span>{src.label ?? "—"}</span>}
        {booking && (
          <div className="space-y-1">
            <Badge tone={statusTone(booking.status)}>{t.dynamic(`editOps.bookings.statuses.${booking.status}`, undefined, booking.status)}</Badge>
            {booking.status === "cancelled" && <p className="text-xs text-text-secondary">{t("playerBilling.related.bookingCancelled")}</p>}
            {booking.athleteId && <Link href={`/admin/athletes/${booking.athleteId}?tab=bookings`} className="block text-xs text-brand-primary hover:underline">{t("playerBilling.related.openPlayer")}</Link>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
