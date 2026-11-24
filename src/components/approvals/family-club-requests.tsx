import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader, CardMeta, CardTitle } from "@/components/ui";
import { NextStepBadge } from "@/components/approvals/next-step-badge";
import { RequestThread } from "@/components/approvals/request-thread";
import { FamilyRequestActions } from "@/components/approvals/family-request-actions";
import { requestChild, requestNextStep, requestSubject, type ClubRequest } from "@/lib/approvals/types";
import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";

/**
 * Family: club requests (membership / club programmes) with the derived next
 * step, the conversation with the club, the invoice once approved, and the
 * reply / withdraw actions. Server component; the label is computed on read
 * from the request, its registration / membership and invoice.
 */
export function FamilyClubRequests({ rows, t, f, title, description, showChild = true }: {
  rows: ClubRequest[]; t: Translator; f: Formatter; title?: string; description?: string; showChild?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden />{title ?? t("approvals.family.title")}</CardTitle>
          <CardMeta>{description ?? t("approvals.family.description")}</CardMeta>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        <ul>
          {rows.map((r) => {
            const step = requestNextStep(r);
            const open = r.status === "pending" || r.status === "info_requested";
            const openAmount = r.invoice ? Number(r.invoice.open ?? 0) : 0;
            return (
              <li key={r.id} className="space-y-2 border-b border-border px-5 py-3 last:border-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium text-text">{requestSubject(r)}</div>
                    <div className="text-xs text-text-muted">
                      {showChild && <span>{requestChild(r)} · </span>}
                      {t(r.subject_kind === "membership" ? "approvals.kind.membership" : "approvals.kind.program_registration")}
                      {" · "}{t("approvals.family.sentOn", { date: f.date(r.created_at) })}
                    </div>
                    {r.status === "pending" && <p className="mt-1 text-xs text-text-muted">{t("approvals.family.pendingHint")}</p>}
                    {r.status === "info_requested" && <p className="mt-1 text-xs text-warning">{t("approvals.family.infoHint")}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                    <NextStepBadge step={step} t={t} />
                    {r.invoice && (
                      <Link href={`/parent/invoices/${r.invoice.id}`} className="text-xs text-brand-primary hover:underline">
                        {openAmount > 0
                          ? t("approvals.family.payInvoice", { number: r.invoice.number, amount: f.money(openAmount, r.invoice.currency) })
                          : t("approvals.family.viewInvoice", { number: r.invoice.number })}
                      </Link>
                    )}
                  </div>
                </div>
                <RequestThread messages={r.messages} t={t} f={f} viewer="family" />
                {open && <FamilyRequestActions id={r.id} canReply={r.status === "info_requested"} canWithdraw />}
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
