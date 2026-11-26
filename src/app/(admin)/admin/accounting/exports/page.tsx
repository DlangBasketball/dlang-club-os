import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, ErrorState, Input, Label, PageHeader, Select } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ExportLink } from "@/components/finance/finance-nav";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { loadJournal, loadOpenItems } from "@/lib/accounting/data";
import { trialBalance } from "@/lib/accounting/journal";
import { isDay, isUuid, qs } from "@/lib/finance/params";
import { getAccountingTransactions, getLastExports } from "@/lib/finance-reports/data";
import { getBillingEntities } from "@/lib/data/billing";
import { BILLING_ACTIVITIES, categoryLabelKey, isBillingActivity } from "@/lib/billing/activities";
import { reportErrorKey } from "@/lib/finance-reports/errors";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.exports.title") };
}

type SP = { from?: string; to?: string; at?: string; entity?: string; category?: string };

/** Journal exports (Bexio CSV, generic CSV / XLSX) for a period and the open-items list at a date. */
export default async function ExportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [me, { t, f }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const today = new Date().toISOString().slice(0, 10);
  const prevMonthEnd = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10);
  const from = isDay(sp.from) ? sp.from : `${prevMonthEnd.slice(0, 7)}-01`;
  const to = isDay(sp.to) && sp.to >= from ? sp.to : prevMonthEnd;
  const at = isDay(sp.at) ? sp.at : today;
  const entityId = isUuid(sp.entity) ? sp.entity : undefined;
  const category = isBillingActivity(sp.category) ? sp.category : undefined;
  const [journal, open, txns, lastRuns, entitiesRes] = await Promise.all([
    loadJournal(me.orgId, { from, to }), loadOpenItems(at),
    getAccountingTransactions({ from, to, entityId: entityId ?? null, category: category ?? null }),
    getLastExports(), getBillingEntities(),
  ]);
  const entities = entitiesRes.data?.entities ?? [];
  const href = (kind: string, extra: Record<string, string> = {}) => `/admin/accounting/export${qs({ kind, from, to, ...extra })}`;
  const txExtra: Record<string, string> = { ...(entityId ? { entity: entityId } : {}), ...(category ? { category } : {}) };
  const last = lastRuns.data?.[0] ?? null;
  const exportKind = (k: string) => t.dynamic(`financeReports.accounting.exportKinds.${k}`, undefined, k);
  const PREVIEW = 200;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader title={t("accounting.exports.title")} description={t("accounting.exports.description")} />
      <AccountingNav t={t} active="exports" />

      <Card>
        <CardHeader><CardTitle>{t("financeReports.accounting.integrationTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm">
          {/* No accounting-software connector exists in this product yet: say so plainly, never fake a connection. */}
          <p className="text-ink">{t("financeReports.accounting.noIntegration")}</p>
          <p className="text-xs text-ink-3">
            {lastRuns.error !== null ? t.dynamic(reportErrorKey(lastRuns.error)) : last ? (
              <>
                <Badge tone={last.ok ? "success" : "danger"}>
                  {(last.ok ? t("financeReports.accounting.lastExport", { kind: exportKind(last.kind), date: f.dateTime(last.exportedAt) })
                    : t("financeReports.accounting.lastExportFailed", { kind: exportKind(last.kind), date: f.dateTime(last.exportedAt) }))}
                </Badge>
                {last.ok && last.rows != null && <span className="ml-2">{t("financeReports.accounting.lastExportRows", { count: last.rows })}</span>}
              </>
            ) : t("financeReports.accounting.neverExported")}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>{t("financeReports.accounting.transactionsTitle")}</CardTitle>
            <p className="mt-0.5 text-xs text-ink-3">{t("financeReports.accounting.transactionsHint")}</p>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="at" value={at} />
            <div><Label htmlFor="tx-from">{t("financeReports.accounting.from")}</Label><Input id="tx-from" name="from" type="date" defaultValue={from} className="w-44" /></div>
            <div><Label htmlFor="tx-to">{t("financeReports.accounting.to")}</Label><Input id="tx-to" name="to" type="date" defaultValue={to} className="w-44" /></div>
            {entities.length > 1 && (
              <div>
                <Label htmlFor="tx-entity">{t("financeReports.accounting.cols.entity")}</Label>
                <Select id="tx-entity" name="entity" defaultValue={entityId ?? ""} className="w-52">
                  <option value="">{t("financeReports.invoices.allEntities")}</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="tx-cat">{t("financeReports.accounting.cols.category")}</Label>
              <Select id="tx-cat" name="category" defaultValue={category ?? ""} className="w-48">
                <option value="">{t("financeReports.invoices.allCategories")}</option>
                {BILLING_ACTIVITIES.map((c) => <option key={c} value={c}>{t(categoryLabelKey(c))}</option>)}
              </Select>
            </div>
            <Button type="submit" variant="secondary">{t("accounting.exports.preview")}</Button>
          </form>
          <div className="flex flex-wrap gap-4">
            <ExportLink href={href("transactions_csv", txExtra)} label={t("financeReports.accounting.transactionsCsv")} />
            <ExportLink href={href("transactions_xlsx", txExtra)} label={t("financeReports.accounting.transactionsXlsx")} />
          </div>
        </CardBody>
      </Card>
      {txns.error !== null ? <ErrorState message={t.dynamic(reportErrorKey(txns.error))} /> : (
        <>
          <FinTable
            title={t("financeReports.accounting.transactionsTitle")}
            subtitle={t("financeReports.accounting.count", { count: txns.data.length })}
            caption={t("financeReports.accounting.transactionsTitle")}
            rows={txns.data.slice(0, PREVIEW)} rowKey={(r, i) => `${r.kind}-${r.invoiceId}-${i}`}
            empty={t("financeReports.accounting.previewEmpty")}
            cols={[
              { key: "date", header: t("financeReports.accounting.cols.date"), cell: (r) => f.date(r.date) },
              { key: "kind", header: t("financeReports.accounting.cols.kind"), cell: (r) => t.dynamic(`financeReports.accounting.kinds.${r.kind}`) },
              { key: "inv", header: t("financeReports.accounting.cols.invoiceNumber"), cell: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span> },
              { key: "doc", header: t("financeReports.accounting.cols.documentNumber"), cell: (r) => <span className="font-mono text-xs">{r.documentNumber && r.documentNumber !== r.invoiceNumber ? r.documentNumber : "—"}</span> },
              { key: "ref", header: t("financeReports.accounting.cols.paymentReference"), cell: (r) => <span className="font-mono text-xs">{r.paymentReference ?? "—"}</span> },
              { key: "cat", header: t("financeReports.accounting.cols.category"), cell: (r) => <Badge tone={r.category === "other" ? "warning" : "neutral"}>{r.categoryLabel ?? t(categoryLabelKey(r.category))}</Badge> },
              { key: "ent", header: t("financeReports.accounting.cols.entity"), cell: (r) => <span className="text-xs">{r.entityName ?? "—"}</span> },
              { key: "src", header: t("financeReports.accounting.cols.sourceLabel"), cell: (r) => <span className="line-clamp-1 text-xs">{r.sourceLabel ?? "—"}</span> },
              { key: "amount", header: t("financeReports.accounting.cols.amount"), align: "right", cell: (r) => <span className="tnum">{f.money(r.amount, r.currency)}</span> },
            ]}
          />
          {txns.data.length > PREVIEW && <p className="text-xs text-ink-3">{t("financeReports.accounting.previewTruncated", { count: PREVIEW })}</p>}
        </>
      )}

      <Card>
        <CardHeader><CardTitle>{t("accounting.exports.journalTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="at" value={at} />
            <div><Label htmlFor="ex-from">{t("accounting.exports.from")}</Label><Input id="ex-from" name="from" type="date" defaultValue={from} className="w-44" /></div>
            <div><Label htmlFor="ex-to">{t("accounting.exports.to")}</Label><Input id="ex-to" name="to" type="date" defaultValue={to} className="w-44" /></div>
            <Button type="submit" variant="secondary">{t("accounting.exports.preview")}</Button>
          </form>
          <div className="flex flex-wrap gap-4">
            <ExportLink href={href("bexio")} label={t("accounting.exports.bexio")} />
            <ExportLink href={href("journal")} label={t("accounting.exports.journalCsv")} />
            <ExportLink href={href("journal_xlsx")} label={t("accounting.exports.journalXlsx")} />
          </div>
          <p className="text-xs text-ink-3">{t("accounting.exports.bexioHint")}</p>
        </CardBody>
      </Card>

      {journal.error !== null ? <ErrorState message={journal.error} /> : (() => {
        const tb = trialBalance(journal.data.lines);
        return (
          <>
            {journal.data.issues.length > 0 && (
              <div role="alert" className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <div>
                  {t("accounting.exports.unmappedWarning", { count: journal.data.issues.length })}
                  <div className="mt-1 font-mono text-xs">{journal.data.issues.map((i) => i.key).join(", ")}</div>
                </div>
              </div>
            )}
            <FinTable
              title={t("accounting.exports.previewTitle")}
              subtitle={[t("accounting.exports.lines", { count: journal.data.lines.length }),
                ...Array.from(tb.entries()).map(([c, v]) => t("accounting.exports.totals", { debit: f.money(v.debit, c), credit: f.money(v.credit, c) }))].join(" · ")}
              caption={t("accounting.exports.previewTitle")} rows={journal.data.lines.slice(0, 200)} rowKey={(r, i) => `${r.sourceId}-${r.kind}-${i}`}
              empty={t("accounting.exports.previewEmpty")}
              cols={[
                { key: "date", header: t("accounting.journal.date"), cell: (r) => f.date(r.date) },
                { key: "doc", header: t("accounting.journal.docNo"), cell: (r) => <span className="font-mono text-xs">{r.docNo}</span> },
                { key: "kind", header: t("accounting.exports.kind"), cell: (r) => t.dynamic(`accounting.exports.kinds.${r.kind}`) },
                { key: "debit", header: t("accounting.journal.debit"), cell: (r) => <span className="tnum">{r.debit || "—"}</span> },
                { key: "credit", header: t("accounting.journal.credit"), cell: (r) => <span className="tnum">{r.credit || "—"}</span> },
                { key: "amount", header: t("accounting.journal.amount"), align: "right", cell: (r) => <span className="tnum">{f.money(r.amount, r.currency)}</span> },
                { key: "vat", header: t("accounting.journal.vatCode"), cell: (r) => r.vatCode ?? "" },
                { key: "text", header: t("accounting.journal.text"), cell: (r) => <span className="line-clamp-1 text-ink-2">{r.text}</span> },
              ]}
            />
          </>
        );
      })()}

      <Card>
        <CardHeader><div><CardTitle>{t("accounting.exports.openItems")}</CardTitle><p className="mt-0.5 text-xs text-ink-3">{t("accounting.exports.openItemsHint")}</p></div></CardHeader>
        <CardBody className="space-y-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="from" value={from} />
            <input type="hidden" name="to" value={to} />
            <div><Label htmlFor="ex-at">{t("accounting.exports.openItemsAt")}</Label><Input id="ex-at" name="at" type="date" defaultValue={at} className="w-44" /></div>
            <Button type="submit" variant="secondary">{t("accounting.exports.preview")}</Button>
            <ExportLink href={`/admin/accounting/export${qs({ kind: "open_items", at })}`} label={t("accounting.exports.openItemsCsv")} />
          </form>
        </CardBody>
      </Card>
      {open.error !== null ? <ErrorState message={open.error} /> : (
        <FinTable
          title={t("accounting.exports.openItemsAtDate", { date: f.date(at) })} caption={t("accounting.exports.openItems")}
          rows={open.data.slice(0, 300)} rowKey={(r) => r.invoice_id} empty={t("accounting.exports.openItemsEmpty")}
          cols={[
            { key: "family", header: t("accounting.openItems.family"), cell: (r) => r.family_name ?? "—" },
            { key: "invoice", header: t("accounting.openItems.invoice"), cell: (r) => <span className="tnum">{r.number}</span> },
            { key: "issued", header: t("accounting.openItems.issued"), cell: (r) => f.date(r.issued_on) },
            { key: "due", header: t("accounting.openItems.due"), cell: (r) => r.due_date ? f.date(r.due_date) : "—" },
            { key: "open", header: t("accounting.openItems.open"), align: "right", cell: (r) => <span className="tnum">{f.money(r.open_amount, r.currency)}</span> },
            { key: "overdue", header: t("accounting.openItems.daysOverdue"), align: "right", cell: (r) => f.number(r.days_overdue) },
            { key: "level", header: t("accounting.openItems.dunningLevel"), align: "right", cell: (r) => r.dunning_level ? f.number(r.dunning_level) : "—" },
          ]}
        />
      )}
    </div>
  );
}
