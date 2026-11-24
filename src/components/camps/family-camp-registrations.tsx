import Link from "next/link";
import { Tent } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { NextStepBadge } from "@/components/approvals/next-step-badge";
import { nextStep, type NextStepInput } from "@/lib/status/next-step";
import type { FamilyCampRegistration } from "@/lib/camps/approval-data";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

/** Next-step input of a camp week, derived from its current registration state + invoice. */
function campNextStepInput(r: FamilyCampRegistration): NextStepInput {
  const paid = r.invoiceStatus === "paid";
  switch (r.state) {
    case "pending_approval": return { campApproval: "pending" };
    case "declined": return { campApproval: "declined" };
    case "withdrawn": return { campApproval: "withdrawn" };
    // A camp week is 'pending' (reserved) until its invoice is paid.
    case "approved_awaiting_payment":
    case "pending": return { status: "pending", balance: r.invoiceId && !paid ? r.amount ?? 1 : r.invoiceId ? 0 : null };
    default: return { status: r.state };
  }
}

/**
 * Parent "My bookings": camp weeks of the family's children, with requests
 * pending admin approval, approved ones awaiting payment (invoice link) and
 * the club's message on a decision.
 */
export function FamilyCampRegistrations({ rows, t, f, showChild }: { rows: FamilyCampRegistration[]; t: Translator; f: Formatter; showChild: boolean }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Tent className="h-4 w-4" aria-hidden />{t("camps.approval.family.title")}</CardTitle></CardHeader>
      <CardBody>
        <p className="mb-3 text-xs text-text-muted">{t("camps.approval.family.description")}</p>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium text-text">{r.programName}{r.editionName ? ` · ${r.editionName}` : ""}</div>
                <div className="text-xs text-text-muted">
                  {showChild && <span>{r.athleteName} · </span>}
                  {r.startsOn ? f.dateRange(r.startsOn, r.endsOn) : ""}
                  {r.amount !== null && r.currency ? ` · ${f.money(r.amount, r.currency)}` : ""}
                </div>
                {r.state === "pending_approval" && <p className="mt-1 text-xs text-text-muted">{t("camps.approval.family.pendingHint")}</p>}
                {r.note && <p className="mt-1 whitespace-pre-wrap text-xs text-text">{t("camps.approval.family.message", { note: r.note })}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <NextStepBadge step={nextStep(campNextStepInput(r))} t={t} />
                {r.invoiceId && r.invoiceNumber && (
                  <Link href={`/parent/invoices/${r.invoiceId}`} className="text-xs text-brand-primary hover:underline">
                    {r.state === "approved_awaiting_payment" || r.state === "pending" ? t("camps.approval.family.payInvoice", { number: r.invoiceNumber }) : t("camps.approval.family.viewInvoice", { number: r.invoiceNumber })}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
