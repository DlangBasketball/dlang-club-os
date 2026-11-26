import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getFamilyPlans } from "@/lib/plans/data";
import { plansDb } from "@/lib/plans/db";
import { loadPlanSettings } from "@/lib/plans/settings";
import { getOrgPaymentProfile, methodsForInvoice } from "@/lib/payments/settings";
import { cardExpiringSoon, todayIn } from "@/lib/payments/plans";
import { InstalmentTable } from "@/components/plans/instalment-table";
import { AutopayPanel } from "@/components/plans/autopay-panel";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("plans.parent.title") };
}

/** Parent: instalments, recurring fees, saved card for autopay, history — own family only (RLS). */
export default async function ParentPaymentPlansPage({ searchParams }: { searchParams: Promise<{ autopay?: string }> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId) redirect("/login");
  const db = await plansDb();
  const { data: links } = await db.from("family_members").select("family_id").eq("profile_id", me.id);
  const linkIds = (links ?? []).map((l) => l.family_id);
  const { data: fams } = linkIds.length ? await db.from("families").select("id").eq("org_id", me.orgId).in("id", linkIds) : { data: [] as { id: string }[] };
  const familyIds = (fams ?? []).map((x) => x.id);
  const [data, settings, profile] = await Promise.all([getFamilyPlans(me.orgId, familyIds), loadPlanSettings(me.orgId), getOrgPaymentProfile(me.orgId)]);
  const today = todayIn(ctx.timeZone);
  const online = methodsForInvoice(profile, profile.currency).some((m) => m.via === "stripe");
  const isSwiss = profile.region === "CH";
  const autopayAvailable = settings.autopayEnabled && profile.stripeReady;
  const consentText = t("plans.autopay.consentText", { club: profile.name });

  const upcomingRecurring = data.recurring.filter((p) => p.rawStatus === "active" || p.rawStatus === "paused");
  const hasAnything = data.instalmentPlans.length + data.recurring.length > 0;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("plans.parent.title")} description={t("plans.parent.description")} />

      {sp.autopay === "saved" && (
        <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success-soft px-4 py-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4" /> {t("plans.autopay.savedBanner")}
        </div>
      )}

      {(settings.autopayEnabled || data.mandates.length > 0) && data.families.map((fam) => {
        const m = data.mandates.find((x) => x.family_id === fam.id) ?? null;
        return (
          <Card key={fam.id}>
            <CardHeader><CardTitle>{data.families.length > 1 ? t("plans.autopay.titleFor", { family: fam.name }) : t("plans.autopay.title")}</CardTitle></CardHeader>
            <CardBody>
              <AutopayPanel familyId={fam.id} available={autopayAvailable} consentText={consentText}
                consentedLabel={m ? t("plans.autopay.consentedOn", { date: f.date(m.consented_at), version: m.consent_version }) : null}
                card={m ? {
                  id: m.id, enabled: m.enabled, brand: m.card_brand, last4: m.card_last4, expMonth: m.card_exp_month, expYear: m.card_exp_year,
                  consentedAt: m.consented_at, expiringSoon: cardExpiringSoon(m.card_exp_month, m.card_exp_year, today),
                } : null} />
            </CardBody>
          </Card>
        );
      })}

      {!hasAnything && <EmptyState title={t("plans.parent.empty")} description={t("plans.parent.emptyHint")} />}

      {data.instalmentPlans.map((p) => (
        <Card key={p.id}>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("plans.parent.planFor", { invoice: p.invoiceNumber ?? "—" })}</CardTitle>
            <span className="flex items-center gap-2">
              <Badge tone={p.status === "overdue" ? "danger" : p.status === "completed" ? "success" : "info"}>{t.dynamic(`plans.planStatus.${p.status}`, undefined, p.status)}</Badge>
              {p.invoiceId && <Link href={`/parent/invoices/${p.invoiceId}`} className="text-sm text-maroon hover:underline">{t("plans.parent.viewInvoice")}</Link>}
            </span>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-sm text-ink-2">{t("plans.invoice.planSummary", { count: p.count, total: f.money(p.total, p.currency), outstanding: f.money(p.outstanding, p.currency) })}</p>
            <InstalmentTable plan={p} pdfBase={isSwiss && p.invoiceId ? `/parent/invoices/${p.invoiceId}/pdf` : null}
              canPayOnline={online && p.rawStatus !== "cancelled"} showQr={isSwiss && p.rawStatus !== "cancelled"} />
          </CardBody>
        </Card>
      ))}

      {data.recurring.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("plans.parent.recurringTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-5">
            {data.recurring.map((p) => {
              const pauses = data.pauses.filter((x) => x.plan_id === p.id && x.ends_on >= today);
              return (
                <div key={p.id} className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-ink">{p.description ?? "—"}{p.athleteName ? ` · ${p.athleteName}` : ""}</div>
                    <span className="flex items-center gap-2 text-xs text-ink-3">
                      {p.amountPerPeriod != null && <span className="tnum">{t("plans.recurring.amountEach", { amount: f.money(p.amountPerPeriod, p.currency) })}</span>}
                      {p.nextRunDate && upcomingRecurring.includes(p) && <span>{t("plans.recurring.nextRunOn", { date: f.date(p.nextRunDate) })}</span>}
                      <Badge tone="neutral">{t.dynamic(`plans.planStatus.${p.status}`, undefined, p.status)}</Badge>
                    </span>
                  </div>
                  {pauses.map((x) => <p key={x.id} className="text-xs text-ink-3">{t("plans.parent.pausedRange", { range: f.dateRange(x.starts_on, x.ends_on) })}</p>)}
                  {p.instalments.length > 0 && <InstalmentTable plan={{ ...p, instalments: p.instalments.slice(-6) }} pdfBase={null} canPayOnline={online} showQr={false} />}
                </div>
              );
            })}
            <p className="text-xs text-ink-3">{t("plans.parent.recurringHint")}</p>
          </CardBody>
        </Card>
      )}

      {data.charges.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("plans.autopay.historyTitle")}</CardTitle></CardHeader>
          <CardBody>
            <ul className="divide-y divide-line text-sm">
              {data.charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>{f.date(c.created_at)} · <span className="tnum">{f.money(Number(c.amount), c.currency)}</span></span>
                  <Badge tone={c.status === "succeeded" ? "success" : c.status === "failed" ? "danger" : "warning"}>{t.dynamic(`plans.autopay.chargeStatus.${c.status}`, undefined, c.status)}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
