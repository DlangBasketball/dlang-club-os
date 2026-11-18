import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, ErrorState, PageHeader, StatCard, type BadgeProps } from "@/components/ui";
import { AccountingNav } from "@/components/accounting/accounting-nav";
import { ConfirmAllButton, EntryActions } from "@/components/accounting/bank-forms";
import { FinTable } from "@/components/finance/fin-table";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import { getImport, openInvoicesForMatching } from "@/lib/accounting/data";
import { isUuid } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("accounting.bank.title") };
}

const TONE: Record<string, BadgeProps["tone"]> = { unmatched: "warning", suggested: "info", booked: "success", ignored: "neutral" };

/** One imported bank file: credits with their match, confirm / assign / ignore / undo. */
export default async function BankImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [me, { t, f }, { id }] = await Promise.all([getSessionUser(), getI18n(), params]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  if (!isUuid(id)) notFound();
  const [res, open] = await Promise.all([getImport(me.orgId, id), openInvoicesForMatching(me.orgId)]);
  if (res.error !== null) return <div className="animate-fade-up"><PageHeader title={t("accounting.bank.title")} /><ErrorState message={res.error} /></div>;
  if (!res.data) notFound();
  const { file, entries } = res.data;
  const refMatches = entries.filter((e) => e.status === "suggested" && e.match_kind === "reference").length;
  const count = (s: string) => entries.filter((e) => e.status === s).length;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={file.file_name}
        description={t("accounting.bank.detailDescription", { format: file.format, date: f.dateTime(file.created_at) })}
        actions={<Link href="/admin/accounting/bank" className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /> {t("accounting.bank.back")}</Link>}
      />
      <AccountingNav t={t} active="bank" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("accounting.bank.statuses.booked")} value={f.number(count("booked"))} tone="success" />
        <StatCard label={t("accounting.bank.statuses.suggested")} value={f.number(count("suggested"))} tone="accent" />
        <StatCard label={t("accounting.bank.statuses.unmatched")} value={f.number(count("unmatched"))} tone={count("unmatched") ? "warning" : "brand"} />
        <StatCard label={t("accounting.bank.statuses.ignored")} value={f.number(count("ignored"))} />
      </div>
      <p className="text-xs text-ink-3">
        {t("accounting.bank.fileSummary", { duplicates: file.duplicate_count, skipped: file.skipped_count })}
      </p>
      <FinTable
        title={t("accounting.bank.entriesTitle")} caption={t("accounting.bank.entriesTitle")} rows={entries} rowKey={(r) => r.id}
        empty={t("accounting.bank.emptyEntries")}
        actions={<ConfirmAllButton importId={file.id} count={refMatches} />}
        cols={[
          { key: "date", header: t("accounting.bank.columns.valueDate"), cell: (r) => r.value_date ? f.date(r.value_date) : "—" },
          { key: "amount", header: t("accounting.common.amount"), align: "right", cell: (r) => <span className="tnum font-medium">{f.money(Number(r.amount), r.currency)}</span> },
          { key: "debtor", header: t("accounting.bank.columns.debtor"), cell: (r) => (
            <div className="min-w-40">
              <div className="text-ink">{r.debtor_name ?? "—"}</div>
              {r.debtor_iban_last4 && <div className="text-xs text-ink-3">{t("accounting.bank.accountLast4", { last4: r.debtor_iban_last4 })}</div>}
            </div>
          ) },
          { key: "ref", header: t("accounting.bank.columns.reference"), cell: (r) => (
            <div className="max-w-56">
              {r.reference ? <div className="break-all font-mono text-xs text-ink-2">{r.reference_type} {r.reference}</div> : null}
              {r.remittance && <div className="line-clamp-2 text-xs text-ink-3">{r.remittance}</div>}
              {!r.reference && !r.remittance && "—"}
            </div>
          ) },
          { key: "status", header: t("accounting.common.status"), cell: (r) => (
            <div className="space-y-1">
              <Badge tone={TONE[r.status]}>{t(`accounting.bank.statuses.${r.status}`)}</Badge>
              {r.match_kind && <div className="text-xs text-ink-3">{t(`accounting.bank.kinds.${r.match_kind}`)}{r.match_kind === "heuristic" && r.match_score != null ? ` · ${f.number(Number(r.match_score))}` : ""}</div>}
              {r.ignored_reason && <div className="text-xs text-ink-3">{r.ignored_reason}</div>}
            </div>
          ) },
          { key: "invoice", header: t("accounting.common.invoice"), cell: (r) => r.invoice_id
            ? <div><Link href={`/admin/invoices/${r.invoice_id}`} className="tnum text-ink hover:text-maroon">{r.invoiceNumber ?? "—"}</Link><div className="text-xs text-ink-3">{r.familyName ?? ""}</div></div>
            : "—" },
          { key: "actions", header: t("accounting.common.actions"), align: "right", cell: (r) => (
            <EntryActions id={r.id} status={r.status} hasInvoice={!!r.invoice_id}
              options={open.filter((o) => o.currency === r.currency).map((o) => ({ id: o.id, label: `${o.number} · ${o.familyName ?? ""} · ${f.money(o.balance, o.currency)}` }))} />
          ) },
        ]}
      />
    </div>
  );
}
