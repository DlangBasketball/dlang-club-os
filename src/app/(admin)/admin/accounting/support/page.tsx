import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader, StatCard } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ApplySupportButton, ReimbursementForm, SupportForm, SupportToggle } from "@/components/accounting/admin-forms";
import { ExportLink } from "@/components/finance/finance-nav";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { accountingDb } from "@/lib/accounting/db";
import { getSupport, reimbursementReport } from "@/lib/accounting/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.support.title") };
}

/** Family support (scholarships, subsidies, J+S-financed reductions) and expected external reimbursements. */
export default async function SupportPage() {
  const [me, { t, f, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const res = await getSupport(me.orgId);
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title={t("accounting.support.title")} /><ErrorState message={res.error} /></div>;
  const { discounts, reimbursements, families } = res.data;
  const db = await accountingDb();
  const { data: invs } = await db.from("invoices").select("id,number,family_id").eq("org_id", me.orgId).neq("status", "draft").order("issued_at", { ascending: false }).limit(300);
  const famName = new Map(families.map((x) => [x.id, x.name]));
  const invoiceOptions = ((invs ?? []) as { id: string; number: string; family_id: string }[]).map((i) => ({ id: i.id, label: `${i.number} · ${famName.get(i.family_id) ?? ""}` }));
  const report = reimbursementReport(reimbursements);

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.support.title")} description={t("accounting.support.description")} />
      <AccountingNav t={t} active="support" />

      <FinTable
        title={t("accounting.support.discountsTitle")} subtitle={t("accounting.support.discountsHint")} caption={t("accounting.support.discountsTitle")}
        rows={discounts} rowKey={(r) => r.id} empty={t("accounting.support.discountsEmpty")} actions={<ApplySupportButton />}
        cols={[
          { key: "family", header: t("accounting.common.family"), cell: (r) => r.familyName ?? "—" },
          { key: "name", header: t("accounting.support.name"), cell: (r) => <div><div className="text-ink">{r.name}</div><div className="text-xs text-ink-3">{t.dynamic(`accounting.support.reasons.${r.support_reason ?? "other"}`)}</div></div> },
          { key: "value", header: t("accounting.support.value"), cell: (r) => r.kind === "percent" ? f.percent(Number(r.value) / 100) : f.money(Number(r.value), r.currency ?? ctx.currency) },
          { key: "scope", header: t("accounting.support.scope"), cell: (r) => t.dynamic(`accounting.support.scopes.${r.scope}`, undefined, r.scope) },
          { key: "cap", header: t("accounting.support.granted"), align: "right", cell: (r) => (
            <span className="tnum">{f.money(r.granted, r.currency ?? ctx.currency)}{r.max_amount != null ? ` / ${f.money(Number(r.max_amount), r.currency ?? ctx.currency)}` : ""}</span>
          ) },
          { key: "valid", header: t("accounting.support.validity"), cell: (r) => r.valid_from || r.valid_until
            ? `${r.valid_from ? f.date(r.valid_from) : "…"} – ${r.valid_until ? f.date(r.valid_until) : "…"}` : t("accounting.support.always") },
          { key: "status", header: t("accounting.common.status"), cell: (r) => <Badge tone={r.is_active ? "success" : "neutral"}>{r.is_active ? t("accounting.common.active") : t("accounting.common.inactive")}</Badge> },
          { key: "actions", header: t("accounting.common.actions"), align: "right", cell: (r) => <SupportToggle id={r.id} active={r.is_active} /> },
        ]}
      />
      <Card>
        <CardHeader><CardTitle>{t("accounting.support.add")}</CardTitle></CardHeader>
        <CardBody><SupportForm families={families} currency={ctx.currency} /></CardBody>
      </Card>

      <section aria-labelledby="reimb-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="reimb-h" className="font-display text-lg text-ink">{t("accounting.support.reimbursementsTitle")}</h2>
          <ExportLink href="/admin/accounting/export?kind=reimbursements" label={t("accounting.support.exportReport")} />
        </div>
        {report.length > 0 && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {report.map((r) => (
              <StatCard key={`${r.key}-${r.currency}`} label={t.dynamic(`accounting.support.funders.${r.key}`)}
                value={f.money(r.open, r.currency)} tone={r.open > 0 ? "warning" : "success"} />
            ))}
          </div>
        )}
        {reimbursements.length === 0 ? <p className="text-sm text-ink-3">{t("accounting.support.reimbursementsEmpty")}</p> : (
          <div className="space-y-2">
            {reimbursements.map((r) => (
              <details key={r.id} className="rounded-lg border border-border bg-surface p-3">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-ink">{r.funder_name} <span className="text-ink-3">· {t(`accounting.support.funders.${r.funder_kind}`)}{r.familyName ? ` · ${r.familyName}` : ""}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ""}</span></span>
                  <span className="flex items-center gap-2">
                    <Badge tone={r.status === "received" ? "success" : r.status === "rejected" ? "neutral" : "warning"}>{t(`accounting.support.statuses.${r.status}`)}</Badge>
                    <span className="tnum">{f.money(Number(r.amount_expected), r.currency)}</span>
                  </span>
                </summary>
                <div className="mt-3">
                  <ReimbursementForm id={r.id} families={families} invoices={invoiceOptions} currency={r.currency} initial={{
                    funderKind: r.funder_kind, funderName: r.funder_name, familyId: r.family_id ?? "", invoiceId: r.invoice_id ?? "",
                    periodStart: r.period_start ?? "", periodEnd: r.period_end ?? "", amountExpected: String(r.amount_expected),
                    amountReceived: r.amount_received == null ? "" : String(r.amount_received), status: r.status, requestedOn: r.requested_on ?? "",
                    receivedOn: r.received_on ?? "", reference: r.reference ?? "", notes: r.notes ?? "",
                  }} />
                </div>
              </details>
            ))}
          </div>
        )}
        <Card>
          <CardHeader><CardTitle>{t("accounting.support.addReimbursement")}</CardTitle></CardHeader>
          <CardBody><ReimbursementForm families={families} invoices={invoiceOptions} currency={ctx.currency} /></CardBody>
        </Card>
      </section>
    </div>
  );
}
