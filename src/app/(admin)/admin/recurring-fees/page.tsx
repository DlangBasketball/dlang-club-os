import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, DataTable, EmptyState, PageHeader, buttonVariants } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { clubToday, enrolOptions, listEnrolments, listFailedCharges, listTemplates, previewRun, type PreviewRow, type TemplateView } from "@/lib/plans/data";
import { addDays } from "@/lib/payments/plans";
import { EnrolForm, RunNowForm, TemplateForm, type TemplateFormValue } from "@/components/plans/recurring-forms";
import { RetryChargeButton } from "@/components/plans/plan-widgets";
import { instalmentTone } from "@/components/plans/instalment-table";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("plans.recurring.title") };
}

const toForm = (x: TemplateView): TemplateFormValue => ({
  id: x.id, name: x.name, description: x.description ?? "", amount: String(x.amount), currency: x.currency, frequency: x.frequency,
  billingDay: String(x.billing_day), startDate: x.start_date, endDate: x.end_date ?? "", programId: x.program_id ?? "", teamId: x.team_id ?? "",
  proration: x.proration, dueDays: String(x.due_days), applyDiscounts: x.apply_discounts, isActive: x.is_active,
});

/** Recurring club fees: templates, enrolments, next-run preview, run now, failed charges. */
export default async function RecurringFeesPage({ searchParams }: { searchParams: Promise<{ until?: string }> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const today = await clubToday(me.orgId);
  const until = /^\d{4}-\d{2}-\d{2}$/.test(sp.until ?? "") && sp.until! <= addDays(today, 31) ? sp.until! : today;
  const [templates, enrolments, opts, preview, failed] = await Promise.all([
    listTemplates(me.orgId), listEnrolments(me.orgId), enrolOptions(me.orgId), previewRun(me.orgId, until), listFailedCharges(me.orgId),
  ]);
  const blank: TemplateFormValue = {
    id: null, name: "", description: "", amount: "", currency: ctx.currency, frequency: "monthly", billingDay: "1", startDate: today,
    endDate: "", programId: "", teamId: "", proration: "none", dueDays: "14", applyDiscounts: true, isActive: true,
  };

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("plans.recurring.title")} description={t("plans.recurring.description")}
        actions={<Link href="/admin/payment-plans" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("plans.admin.title")}</Link>} />

      <Card>
        <CardHeader><CardTitle>{t("plans.recurring.preview", { date: f.date(until) })}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" action="/admin/recurring-fees">
            <label htmlFor="rf-until" className="text-sm text-ink-2">{t("plans.recurring.previewUntil")}</label>
            <input id="rf-until" name="until" type="date" defaultValue={until} max={addDays(today, 31)} className="rounded-md border border-line bg-surface px-2 py-1 text-sm" />
            <button type="submit" className={buttonVariants({ variant: "secondary", size: "sm" })}>{t("plans.recurring.refreshPreview")}</button>
          </form>
          <DataTable caption={t("plans.recurring.previewCaption")} rows={preview as (PreviewRow & Record<string, unknown>)[]} getRowKey={(r, i) => `${r.planId}-${r.periodStart}-${i}`}
            empty={<p className="text-sm text-ink-3">{t("plans.recurring.previewEmpty")}</p>}
            columns={[
              { key: "family", header: t("plans.common.family"), render: (r) => r.familyName },
              { key: "athlete", header: t("plans.recurring.athlete"), render: (r) => r.athleteName ?? "—" },
              { key: "period", header: t("plans.recurring.period"), render: (r) => f.dateRange(r.periodStart, r.periodEnd) },
              { key: "amount", header: t("plans.common.amount"), align: "right", render: (r) => <span className="tnum">{f.money(r.amount, r.currency)}</span> },
              { key: "discount", header: t("plans.recurring.discount"), align: "right", render: (r) => r.discount > 0 ? <span className="tnum text-success">− {f.money(r.discount, r.currency)}</span> : "—" },
              { key: "net", header: t("plans.common.total"), align: "right", render: (r) => <span className="tnum">{f.money(r.net, r.currency)}</span> },
              { key: "action", header: "", render: (r) => <Badge tone={r.action === "invoice" ? "info" : "neutral"}>{t.dynamic(`plans.recurring.actions.${r.action}`, undefined, r.action)}</Badge> },
            ]} />
          <RunNowForm today={until} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("plans.recurring.newTemplate")}</CardTitle></CardHeader>
        <CardBody><TemplateForm initial={blank} teams={opts.teams} programs={opts.programs} /></CardBody>
      </Card>

      {templates.length === 0 && <EmptyState title={t("plans.recurring.noTemplates")} description={t("plans.recurring.noTemplatesHint")} />}
      {templates.map((x) => {
        const rows = enrolments.filter((e) => e.templateId === x.id && e.rawStatus !== "cancelled");
        return (
          <Card key={x.id}>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle>{x.name}</CardTitle>
              <span className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                <span className="tnum">{t("plans.recurring.amountPer", { amount: f.money(x.amount, x.currency), frequency: t.dynamic(`plans.recurring.frequencies.${x.frequency}`, undefined, x.frequency) })}</span>
                {x.teamName && <Badge tone="neutral">{x.teamName}</Badge>}
                {!x.is_active && <Badge tone="neutral">{t("plans.recurring.inactive")}</Badge>}
                <Badge tone="info">{t("plans.recurring.enrolledCount", { count: x.enrolled })}</Badge>
              </span>
            </CardHeader>
            <CardBody className="space-y-4">
              <p className="text-xs text-ink-3">{t("plans.recurring.summary", {
                day: x.billing_day, start: f.date(x.start_date), end: x.end_date ? f.date(x.end_date) : "—",
                proration: t.dynamic(`plans.recurring.prorations.${x.proration}`, undefined, x.proration), due: x.due_days,
              })}</p>
              <EnrolForm templateId={x.id} defaultTeamId={x.team_id} teams={opts.teams} athletes={opts.athletes} today={today} />
              {rows.length > 0 && (
                <ul className="divide-y divide-line text-sm">
                  {rows.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                      <span>{e.athleteName ?? "—"} · <span className="text-ink-3">{e.familyName}</span></span>
                      <span className="flex items-center gap-2">
                        {e.nextRunDate && e.rawStatus === "active" && <span className="text-xs text-ink-3">{t("plans.recurring.nextRunOn", { date: f.date(e.nextRunDate) })}</span>}
                        <Badge tone={instalmentTone(e.status === "active" ? "upcoming" : e.status === "completed" ? "paid" : e.status)}>{t.dynamic(`plans.planStatus.${e.status}`, undefined, e.status)}</Badge>
                        <Link href={`/admin/payment-plans/${e.id}`} className="text-maroon hover:underline">{t("plans.admin.open")}</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-maroon">{t("plans.recurring.editTemplate")}</summary>
                <div className="pt-3"><TemplateForm initial={toForm(x)} teams={opts.teams} programs={opts.programs} /></div>
              </details>
            </CardBody>
          </Card>
        );
      })}

      {failed.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("plans.admin.failedTitle")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {failed.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{c.familyName} · <Link href={`/admin/invoices/${c.invoice_id}`} className="tnum text-maroon hover:underline">{c.invoiceNumber}</Link> · <span className="tnum">{f.money(c.amount, c.currency)}</span></span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-ink-3">{t.dynamic(`plans.autopay.status.${c.autopayStatus ?? c.status}`, { date: c.next_retry_on ? f.date(c.next_retry_on) : "" }, c.status)}</span>
                    {(c.instalmentStatus === "scheduled" || c.instalmentStatus === "invoiced") && <RetryChargeButton installmentId={c.installment_id} />}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
