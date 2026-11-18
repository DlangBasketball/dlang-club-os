import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, Card, CardBody, CardHeader, CardTitle, ErrorState, PageHeader, type BadgeProps } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { DunningSettingsForm, PauseFamilyForm, ResolveCaseButton, ResumeFamilyButton, RunDunningButton } from "@/components/accounting/admin-forms";
import { ExportLink } from "@/components/finance/finance-nav";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getDunning } from "@/lib/accounting/data";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.dunning.title") };
}

const TONE: Record<string, BadgeProps["tone"]> = { active: "warning", collection: "danger", resolved: "success" };

/** Dunning: steps and fees, run now, open cases, collection export, per-family pause. */
export default async function DunningPage() {
  const [me, { t, f, ctx }] = await Promise.all([getSessionUser(), getI18n()]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const res = await getDunning(me.orgId);
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title={t("accounting.dunning.title")} /><ErrorState message={res.error} /></div>;
  const { settings, cases, pauses, families } = res.data;
  const live = cases.filter((c) => c.status !== "resolved");

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.dunning.title")} description={t("accounting.dunning.description")} actions={<RunDunningButton />} />
      <AccountingNav t={t} active="dunning" />

      <Card>
        <CardHeader><div><CardTitle>{t("accounting.dunning.settingsTitle")}</CardTitle><p className="mt-0.5 text-xs text-ink-3">{t("accounting.dunning.autopayNote")}</p></div></CardHeader>
        <CardBody className="space-y-3">
          <DunningSettingsForm initial={settings} currency={ctx.currency} />
          <p className="text-xs text-ink-3">
            {t("accounting.dunning.schedule", { d1: settings.level1Days, d2: settings.level2Days, d3: settings.level3Days, dc: settings.collectionDays })}
          </p>
        </CardBody>
      </Card>

      <FinTable
        title={t("accounting.dunning.casesTitle")} caption={t("accounting.dunning.casesTitle")} rows={live} rowKey={(r) => r.id} empty={t("accounting.dunning.casesEmpty")}
        actions={<ExportLink href="/admin/accounting/export?kind=collection" label={t("accounting.dunning.exportCollection")} />}
        cols={[
          { key: "invoice", header: t("accounting.common.invoice"), cell: (r) => <Link href={`/admin/invoices/${r.invoice_id}`} className="tnum text-ink hover:text-maroon">{r.invoiceNumber ?? "—"}</Link> },
          { key: "family", header: t("accounting.common.family"), cell: (r) => r.familyName ?? "—" },
          { key: "level", header: t("accounting.dunning.level"), cell: (r) => r.level ? t.dynamic(`accounting.dunning.levels.${r.level}`) : "—" },
          { key: "status", header: t("accounting.common.status"), cell: (r) => (
            <div className="space-y-1">
              <Badge tone={TONE[r.status]}>{t(`accounting.dunning.caseStatuses.${r.status}`)}</Badge>
              {r.collection_exported_at && <div className="text-xs text-ink-3">{t("accounting.dunning.exportedOn", { date: f.date(r.collection_exported_at) })}</div>}
            </div>
          ) },
          { key: "last", header: t("accounting.dunning.lastNotice"), cell: (r) => r.last_notice_at ? f.date(r.last_notice_at) : "—" },
          { key: "fees", header: t("accounting.dunning.fees"), align: "right", cell: (r) => {
            const fee = r.notices.reduce((s, n) => s + Math.round(Number(n.fee_amount) * 100), 0) / 100;
            return fee ? f.money(fee, r.notices[0]?.currency) : "—";
          } },
          { key: "sent", header: t("accounting.dunning.sent"), cell: (r) => r.notices.length ? `${f.number(r.notices.filter((n) => n.sent_at).length)} / ${f.number(r.notices.length)}` : "—" },
          { key: "actions", header: t("accounting.common.actions"), align: "right", cell: (r) => <ResolveCaseButton id={r.id} /> },
        ]}
      />

      <Card>
        <CardHeader><CardTitle>{t("accounting.dunning.pausesTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <PauseFamilyForm families={families} />
          {pauses.length === 0 ? <p className="text-sm text-ink-3">{t("accounting.dunning.pausesEmpty")}</p> : (
            <ul className="divide-y divide-line-soft text-sm">
              {pauses.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="text-ink">{p.familyName ?? "—"}</span>
                    <span className="text-ink-3"> · {p.paused_until ? t("accounting.dunning.until", { date: f.date(p.paused_until) }) : t("accounting.dunning.indefinitely")} · {p.reason}</span>
                  </span>
                  <ResumeFamilyButton id={p.id} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
