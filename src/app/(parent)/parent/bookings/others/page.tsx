import Link from "next/link";
import { CalendarDays, ChevronLeft, Clock, Receipt } from "lucide-react";
import { Card, CardBody, EmptyState, PageHeader } from "@/components/ui";
import { NextStepBadge } from "@/components/approvals/next-step-badge";
import { getI18n } from "@/lib/i18n/server";
import { nextStep } from "@/lib/status/next-step";
import { getBookerStatus } from "@/lib/public-entry/server";
import { consentState } from "@/lib/public-entry/shared";
import { WithdrawRequest } from "./withdraw-request";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("consentRequest.others.title") };
}

/**
 * "Bookings for others" — what a booker sees about the participants they
 * booked for another family: activity, dates, booking status, next step and,
 * when they are the payer, the invoice status and amount due. Never the
 * participant's profile, DOB, medical data, documents or club records
 * (booker_booking_status() whitelists the fields).
 */
export default async function BookingsForOthersPage({ searchParams }: { searchParams: Promise<{ held?: string }> }) {
  const [{ t, f }, sp, rows] = await Promise.all([getI18n(), searchParams, getBookerStatus()]);
  return (
    <div className="animate-fade-up max-w-3xl space-y-5">
      <Link href="/parent/bookings" className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> {t("consentRequest.others.back")}
      </Link>
      <PageHeader title={t("consentRequest.others.title")} description={t("consentRequest.others.description")} />
      {(sp.held === "camp" || sp.held === "training") && (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-sm text-text">{t("consentRequest.others.held")}</p>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t("consentRequest.others.empty")} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const consent = consentState(r.consent);
            const step = nextStep({
              status: r.status, consent, campApproval: r.camp_approval,
              balance: r.invoice ? Number(r.invoice.balance) : undefined,
            });
            return (
              <li key={`${r.kind}-${r.item_id}`}>
                <Card><CardBody className="space-y-2 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-text">{r.participant_name}</div>
                      <div className="text-sm text-text-muted">{r.activity}{r.edition ? ` · ${r.edition}` : ""}</div>
                    </div>
                    <NextStepBadge step={step} t={t} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                      {r.starts_on && r.ends_on ? f.dateRange(r.starts_on, r.ends_on) : r.starts_at ? f.dateTime(r.starts_at) : "—"}
                    </span>
                    {step === "awaiting_guardian_consent" && r.consent_expires_at && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" aria-hidden /> {t("consentRequest.others.expires", { when: f.dateTime(r.consent_expires_at) })}
                      </span>
                    )}
                    {r.invoice && (
                      <span className="inline-flex items-center gap-1">
                        <Receipt className="h-3.5 w-3.5" aria-hidden />
                        {t("consentRequest.others.invoice", {
                          number: r.invoice.number,
                          due: f.money(Number(r.invoice.balance), r.invoice.currency),
                          status: t.dynamic(`status.${r.invoice.status}`, undefined, r.invoice.status),
                        })}
                      </span>
                    )}
                  </div>
                  {step === "awaiting_guardian_consent" && <WithdrawRequest requestId={r.consent_request_id} />}
                </CardBody></Card>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-xs text-text-muted">{t("consentRequest.others.privacy")}</p>
    </div>
  );
}
