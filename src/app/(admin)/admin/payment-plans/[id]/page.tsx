import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, PageHeader, StatCard } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getPlan } from "@/lib/plans/data";
import { InstalmentTable, instalmentTone } from "@/components/plans/instalment-table";
import { PauseForm, PlanControls, RemovePauseButton, RetryChargeButton, ScheduleEditor, SkipFutureForm, SkipPeriodButton } from "@/components/plans/plan-widgets";

/** One plan: schedule, reschedule / amounts, pause, cancel; recurring: periods, pauses, skip, end. */
export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me, { t, f }] = await Promise.all([params, getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const res = await getPlan(me.orgId, id);
  if (!res) notFound();
  const { plan, pauses, charges } = res;
  const money = (n: number) => f.money(n, plan.currency);
  const open = plan.rawStatus === "active" || plan.rawStatus === "paused";
  const title = plan.kind === "installments"
    ? t("plans.admin.planTitle", { invoice: plan.invoiceNumber ?? "—" })
    : `${plan.description ?? t("plans.recurring.title")}${plan.athleteName ? ` · ${plan.athleteName}` : ""}`;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={title} description={plan.familyName}
        actions={<div className="flex items-center gap-3">
          <Badge tone={instalmentTone(plan.status === "active" ? "upcoming" : plan.status === "completed" ? "paid" : plan.status)}>{t.dynamic(`plans.planStatus.${plan.status}`, undefined, plan.status)}</Badge>
          <Link href={plan.kind === "installments" ? "/admin/payment-plans" : "/admin/recurring-fees"} className="text-sm text-maroon hover:underline">{t("plans.admin.backToPlans")}</Link>
        </div>} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={t(plan.kind === "installments" ? "plans.common.total" : "plans.recurring.perPeriod")} value={plan.kind === "installments" ? money(plan.total) : money(plan.amountPerPeriod ?? 0)} />
        <StatCard label={t("plans.common.paid")} value={money(plan.paid)} tone="success" />
        <StatCard label={t("plans.common.outstanding")} value={money(plan.outstanding)} accent />
        <StatCard label={t(plan.kind === "installments" ? "plans.common.instalmentFee" : "plans.recurring.nextRun")}
          value={plan.kind === "installments" ? money(plan.feeAmount) : plan.nextRunDate && open ? f.date(plan.nextRunDate) : "—"} />
      </div>

      {plan.invoiceId && <p className="text-sm"><Link href={`/admin/invoices/${plan.invoiceId}`} className="text-maroon hover:underline">{t("plans.admin.openInvoice", { invoice: plan.invoiceNumber ?? "" })}</Link></p>}
      {plan.pauseReason && <p className="text-sm text-ink-2">{t("plans.admin.pausedBecause", { reason: plan.pauseReason })}</p>}
      {plan.cancelReason && <p className="text-sm text-ink-2">{t("plans.admin.cancelledBecause", { reason: plan.cancelReason })}</p>}

      <Card>
        <CardHeader><CardTitle>{t(plan.kind === "installments" ? "plans.common.schedule" : "plans.recurring.periods")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {plan.instalments.length === 0 ? <p className="text-sm text-ink-3">{t("plans.recurring.noPeriods")}</p>
            : <InstalmentTable plan={plan} pdfBase={plan.invoiceId ? `/admin/invoices/${plan.invoiceId}/pdf` : null} canPayOnline={false} showQr={open} />}
          {plan.kind === "recurring" && plan.instalments.some((i) => i.invoiceId && (i.status === "due" || i.status === "upcoming" || i.status === "overdue")) && (
            <div className="space-y-1 border-t border-line pt-3">
              <p className="text-xs text-ink-3">{t("plans.recurring.skipIssuedHint")}</p>
              <div className="flex flex-wrap gap-2">
                {plan.instalments.filter((i) => i.invoiceId && i.periodStart && i.status !== "paid" && i.status !== "skipped" && i.status !== "cancelled").map((i) => (
                  <span key={i.id} className="inline-flex items-center gap-1 text-xs text-ink-2">{f.date(i.periodStart!)} <SkipPeriodButton planId={plan.id} periodStart={i.periodStart!} /></span>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {open && plan.kind === "installments" && (
        <Card>
          <CardHeader><CardTitle>{t("plans.admin.editSchedule")}</CardTitle></CardHeader>
          <CardBody>
            <ScheduleEditor planId={plan.id} currency={plan.currency} total={plan.total}
              rows={plan.instalments.filter((i) => i.status !== "cancelled" && i.status !== "skipped").map((i) => ({
                id: i.id, seq: i.seq, dueDate: i.dueDate, amount: i.amount, amountPaid: i.amountPaid, locked: i.status === "paid",
              }))} />
          </CardBody>
        </Card>
      )}

      {open && plan.kind === "recurring" && (
        <Card>
          <CardHeader><CardTitle>{t("plans.recurring.pausesTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            {pauses.length > 0 && (
              <ul className="space-y-1 text-sm">
                {pauses.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{f.dateRange(p.starts_on, p.ends_on)} · {t.dynamic(`plans.recurring.pauseKinds.${p.kind}`, undefined, p.kind)}{p.note ? ` · ${p.note}` : ""}</span>
                    <RemovePauseButton pauseId={p.id} planId={plan.id} />
                  </li>
                ))}
              </ul>
            )}
            <PauseForm planId={plan.id} />
            <div className="border-t border-line pt-3"><SkipFutureForm planId={plan.id} /></div>
          </CardBody>
        </Card>
      )}

      {open && (
        <Card>
          <CardHeader><CardTitle>{t("plans.admin.actions")}</CardTitle></CardHeader>
          <CardBody><PlanControls planId={plan.id} status={plan.rawStatus} kind={plan.kind} /></CardBody>
        </Card>
      )}

      {charges.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("plans.autopay.historyTitle")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm">
              {charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{f.dateTime(c.created_at)} · {t("plans.autopay.attempt", { n: c.attempt })} · <span className="tnum">{f.money(Number(c.amount), c.currency)}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge tone={c.status === "succeeded" ? "success" : c.status === "failed" ? "danger" : "warning"}>{t.dynamic(`plans.autopay.chargeStatus.${c.status}`, undefined, c.status)}</Badge>
                    {c.decline_code || c.failure_code ? <span className="text-xs text-ink-3">{c.decline_code ?? c.failure_code}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {plan.instalments.some((i) => (i.autopayStatus === "failed" || i.autopayStatus === "fallback" || i.autopayStatus === "requires_action") && i.outstanding > 0) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {plan.instalments.filter((i) => (i.autopayStatus === "failed" || i.autopayStatus === "fallback" || i.autopayStatus === "requires_action") && i.outstanding > 0).map((i) => (
                  <span key={i.id} className="inline-flex items-center gap-2 text-xs text-ink-2">{f.date(i.dueDate)} <RetryChargeButton installmentId={i.id} /></span>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
