import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ListChecks, Paperclip, Repeat } from "lucide-react";
import { Badge, Button, ErrorState, Input, Label, PageHeader, Select, StatCard, statusTone } from "@/components/ui";
import { FinanceNav, RangeForm, ExportLink, HUB_TABS, type HubTab } from "@/components/finance/finance-nav";
import { FinTable, Signed } from "@/components/finance/fin-table";
import { ExpenseRowActions, RecurringButton } from "@/components/finance/expense-actions";
import { getSessionUser } from "@/lib/auth/get-user";
import { getI18n } from "@/lib/i18n/server";
import {
  balancesFromFacts, currenciesIn, ledgerFromFacts, listExpenses, loadFacts, todayKey, LEDGER_TYPES, type FinanceRefs, type LedgerType,
} from "@/lib/finance/data";
import { inRange, invoiceOutstanding, isIssued, paidByInvoice, paymentsRecorded, reconciledEarnings, sumMoney } from "@/lib/finance/math";
import { isCurrency, isUuid, qs, rangeFrom } from "@/lib/finance/params";

export async function generateMetadata() {
  const { t } = await getI18n();
  return { title: t("finance.title") };
}

type SP = { tab?: string; from?: string; to?: string; currency?: string; type?: string; category?: string; supplier?: string; status?: string; q?: string };

export default async function FinanceHubPage({ searchParams }: { searchParams: Promise<SP> }) {
  const [me, { t, f, ctx }, sp] = await Promise.all([getSessionUser(), getI18n(), searchParams]);
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance"))) redirect("/admin/dashboard");
  const tab: HubTab = (HUB_TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as HubTab) : "balances";
  const range = rangeFrom(sp, todayKey());

  const factsRes = await loadFacts(me.orgId, ctx.currency);
  if (factsRes.error !== null) {
    return <div className="animate-fade-up"><PageHeader title={t("finance.title")} /><ErrorState message={factsRes.error} /></div>;
  }
  const facts = factsRes.data;
  const currencies = currenciesIn(facts, ctx.currency);
  const currency = isCurrency(sp.currency) && currencies.includes(sp.currency) ? sp.currency : ctx.currency;
  const money = (n: number, c = currency) => f.money(n, c);
  const exportHref = (kind: string, extra: Record<string, string | undefined> = {}) =>
    `/admin/finance/export${qs({ kind, from: range.from, to: range.to, currency, ...extra })}`;

  return (
    <div className="animate-fade-up space-y-6">
      <PageHeader
        title={t("finance.title")}
        description={t("finance.description")}
        actions={
          <>
            <Link href="/admin/finance/expenses/new"><Button><Plus className="h-4 w-4" aria-hidden /> {t("finance.expenses.new")}</Button></Link>
            <Link href="/admin/invoices/new"><Button variant="secondary"><Plus className="h-4 w-4" aria-hidden /> {t("finance.invoices.new")}</Button></Link>
          </>
        }
      />
      <FinanceNav t={t} active={tab} />

      {tab === "balances" && (() => {
        const rows = balancesFromFacts(facts).filter((b) => b.currency === currency);
        const tot = (k: "invoiced" | "paid" | "credits" | "outstanding") => sumMoney(rows.map((r) => r[k]), currency);
        return (
          <div className="space-y-5">
            <RangeForm t={t} action="/admin/finance" from={range.from} to={range.to} currency={currency} currencies={currencies} hidden={{ tab }} showRange={false} />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label={t("finance.balances.invoiced")} value={money(tot("invoiced"))} />
              <StatCard label={t("finance.balances.paid")} value={money(tot("paid"))} tone="success" />
              <StatCard label={t("finance.balances.credits")} value={money(tot("credits"))} tone="accent" />
              <StatCard label={t("finance.balances.outstanding")} value={money(tot("outstanding"))} tone={tot("outstanding") > 0 ? "warning" : "brand"} />
            </div>
            <FinTable
              title={t("finance.balances.title")} subtitle={t("finance.balances.subtitle")} caption={t("finance.balances.title")}
              actions={<ExportLink href={exportHref("balances")} label={t("finance.exportCsv")} />}
              rows={rows} rowKey={(r) => `${r.familyId}|${r.currency}`} empty={t("finance.balances.empty")}
              cols={[
                { key: "family", header: t("finance.balances.family"), cell: (r) => <Link href={`/admin/families/${r.familyId}`} className="text-ink hover:text-maroon">{r.familyName}</Link> },
                { key: "invoices", header: t("finance.balances.invoices"), align: "right", cell: (r) => f.number(r.invoices) },
                { key: "invoiced", header: t("finance.balances.invoiced"), align: "right", cell: (r) => money(r.invoiced) },
                { key: "paid", header: t("finance.balances.paid"), align: "right", cell: (r) => money(r.paid) },
                { key: "credits", header: t("finance.balances.credits"), align: "right", cell: (r) => money(r.credits) },
                { key: "outstanding", header: t("finance.balances.outstanding"), align: "right", cell: (r) => <span className={r.outstanding > 0 ? "text-warning" : "text-ink-3"}>{money(r.outstanding)}</span> },
              ]}
            />
          </div>
        );
      })()}

      {tab === "transactions" && (() => {
        const type = (LEDGER_TYPES as readonly string[]).includes(sp.type ?? "") ? (sp.type as LedgerType) : undefined;
        const rows = ledgerFromFacts(facts, range, { types: type ? [type] : undefined, currency });
        const cashIn = sumMoney(rows.filter((r) => r.cash && r.amount > 0).map((r) => r.amount), currency);
        const cashOut = sumMoney(rows.filter((r) => r.cash && r.amount < 0).map((r) => -r.amount), currency);
        return (
          <div className="space-y-5">
            <RangeForm t={t} action="/admin/finance" from={range.from} to={range.to} currency={currency} currencies={currencies} hidden={{ tab }}>
              <div>
                <Label htmlFor="fin-type">{t("finance.ledger.type")}</Label>
                <Select id="fin-type" name="type" defaultValue={type ?? ""} className="w-48">
                  <option value="">{t("finance.ledger.allTypes")}</option>
                  {LEDGER_TYPES.map((x) => <option key={x} value={x}>{t.dynamic(`finance.ledger.types.${x}`)}</option>)}
                </Select>
              </div>
            </RangeForm>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label={t("finance.ledger.cashIn")} value={money(cashIn)} tone="success" />
              <StatCard label={t("finance.ledger.cashOut")} value={money(cashOut)} tone="danger" />
              <StatCard label={t("finance.ledger.net")} value={money(sumMoney([cashIn, -cashOut], currency))} />
            </div>
            <FinTable
              title={t("finance.ledger.title")} subtitle={t("finance.ledger.subtitle", { from: f.date(range.from), to: f.date(range.to) })} caption={t("finance.ledger.title")}
              actions={<ExportLink href={exportHref("ledger", { type })} label={t("finance.exportCsv")} />}
              rows={rows.slice(0, 500)} rowKey={(r) => r.id} empty={t("finance.ledger.empty")}
              cols={[
                { key: "date", header: t("finance.common.date"), cell: (r) => f.date(r.date) },
                { key: "type", header: t("finance.ledger.type"), cell: (r) => <Badge tone={r.type === "expense" ? "danger" : r.type === "payment" ? "success" : r.cash ? "warning" : "info"}>{t.dynamic(`finance.ledger.types.${r.type}`)}</Badge> },
                { key: "ref", header: t("finance.ledger.reference"), cell: (r) => r.href ? <Link href={r.href} className="font-mono text-ink hover:text-maroon">{r.reference || "—"}</Link> : r.reference || "—" },
                { key: "party", header: t("finance.ledger.party"), cell: (r) => r.party || "—" },
                { key: "desc", header: t("finance.common.description"), cell: (r) => <span className="line-clamp-1">{r.type === "payment" || r.type === "refund" || r.type === "reversal" ? t.dynamic(`payments.methods.${r.description}`, undefined, r.description) : r.description || "—"}</span> },
                { key: "amount", header: t("finance.common.amount"), align: "right", cell: (r) => <Signed value={r.amount} text={money(r.amount, r.currency)} /> },
              ]}
            />
            {rows.length > 500 && <p className="text-xs text-ink-3">{t("finance.ledger.truncated", { count: rows.length })}</p>}
          </div>
        );
      })()}

      {tab === "payments" && (() => {
        const rec = paymentsRecorded(facts.payments, range, currency);
        const net = reconciledEarnings(facts.payments, range, currency);
        const invById = new Map(facts.invoices.map((i) => [i.id, i]));
        const rows = facts.payments.filter((p) => p.currency === currency && inRange(p.date, range)).sort((a, b) => b.date.localeCompare(a.date));
        return (
          <div className="space-y-5">
            <RangeForm t={t} action="/admin/finance" from={range.from} to={range.to} currency={currency} currencies={currencies} hidden={{ tab }} />
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label={t("finance.reports.paymentsRecorded")} value={money(rec.amount)} hint={t("finance.payments.count", { count: rec.count })} />
              <StatCard label={t("finance.reports.pending")} value={money(rec.pendingAmount)} hint={t("finance.payments.count", { count: rec.pendingCount })} tone="warning" />
              <StatCard label={t("finance.reports.refunds")} value={money(sumMoney([net.refunded, net.reversed], currency))} tone="danger" />
              <StatCard label={t("finance.reports.reconciled")} value={money(net.amount)} tone="success" />
            </div>
            <FinTable
              title={t("finance.payments.title")} caption={t("finance.payments.title")}
              actions={<><Link href="/admin/payments" className="text-xs text-ink-2 hover:text-ink">{t("finance.payments.manage")}</Link><Link href="/admin/invoices/reconcile" className="text-xs text-ink-2 hover:text-ink">{t("finance.payments.reconcile")}</Link></>}
              rows={rows.slice(0, 300)} rowKey={(r) => r.id} empty={t("finance.payments.empty")}
              cols={[
                { key: "date", header: t("finance.common.date"), cell: (r) => f.date(r.date) },
                { key: "inv", header: t("finance.payments.invoice"), cell: (r) => { const i = r.invoiceId ? invById.get(r.invoiceId) : undefined; return i ? <Link href={`/admin/invoices/${i.id}`} className="font-mono text-ink hover:text-maroon">{i.number}</Link> : "—"; } },
                { key: "family", header: t("finance.balances.family"), cell: (r) => (r.invoiceId ? invById.get(r.invoiceId)?.familyName : null) ?? "—" },
                { key: "method", header: t("finance.common.method"), cell: (r) => t.dynamic(`payments.methods.${r.method}`, undefined, r.method) },
                { key: "status", header: t("finance.common.status"), cell: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge> },
                { key: "amount", header: t("finance.common.amount"), align: "right", cell: (r) => <Signed value={r.amount} text={money(r.amount, r.currency)} /> },
              ]}
            />
          </div>
        );
      })()}

      {tab === "invoices" && (() => {
        const paid = paidByInvoice(facts.payments);
        const rows = facts.invoices.filter((i) => i.currency === currency && inRange(i.issuedDate, range)).sort((a, b) => b.issuedDate.localeCompare(a.issuedDate));
        const issued = rows.filter((i) => isIssued(i.status));
        const totalInvoiced = sumMoney(issued.map((i) => i.total + i.adjustmentsTotal), currency);
        const totalOpen = sumMoney(issued.map((i) => invoiceOutstanding(i, paid.get(i.id) ?? 0)), currency);
        return (
          <div className="space-y-5">
            <RangeForm t={t} action="/admin/finance" from={range.from} to={range.to} currency={currency} currencies={currencies} hidden={{ tab }} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard label={t("finance.invoices.issued")} value={f.number(issued.length)} />
              <StatCard label={t("finance.balances.invoiced")} value={money(totalInvoiced)} />
              <StatCard label={t("finance.balances.outstanding")} value={money(totalOpen)} tone={totalOpen > 0 ? "warning" : "brand"} />
            </div>
            <FinTable
              title={t("finance.invoices.title")} caption={t("finance.invoices.title")}
              actions={<Link href="/admin/invoices" className="text-xs text-ink-2 hover:text-ink">{t("finance.invoices.manage")}</Link>}
              rows={rows.slice(0, 300)} rowKey={(r) => r.id} empty={t("finance.invoices.empty")}
              cols={[
                { key: "num", header: t("finance.payments.invoice"), cell: (r) => <Link href={`/admin/invoices/${r.id}`} className="font-mono text-ink hover:text-maroon">{r.number}</Link> },
                { key: "family", header: t("finance.balances.family"), cell: (r) => r.familyName },
                { key: "issued", header: t("finance.invoices.issuedOn"), cell: (r) => f.date(r.issuedDate) },
                { key: "due", header: t("finance.invoices.due"), cell: (r) => (r.dueDate ? f.date(r.dueDate) : "—") },
                { key: "status", header: t("finance.common.status"), cell: (r) => <Badge tone={statusTone(r.status)}>{t.dynamic(`status.${r.status}`, undefined, r.status)}</Badge> },
                { key: "total", header: t("finance.common.amount"), align: "right", cell: (r) => money(r.total + r.adjustmentsTotal, r.currency) },
                { key: "open", header: t("finance.balances.outstanding"), align: "right", cell: (r) => money(invoiceOutstanding(r, paid.get(r.id) ?? 0), r.currency) },
              ]}
            />
          </div>
        );
      })()}

      {tab === "expenses" && <ExpensesTab sp={sp} orgId={me.orgId} range={range} currency={currency} currencies={currencies} refs={facts.refs} exportHref={exportHref} />}
    </div>
  );
}

async function ExpensesTab({ sp, orgId, range, currency, currencies, refs, exportHref }: {
  sp: SP; orgId: string; range: { from: string; to: string }; currency: string; currencies: string[];
  refs: FinanceRefs; exportHref: (kind: string, extra?: Record<string, string | undefined>) => string;
}) {
  const { t, f } = await getI18n();
  const status: "paid" | "unpaid" | undefined = sp.status === "paid" || sp.status === "unpaid" ? sp.status : undefined;
  const filters = {
    from: range.from, to: range.to, status,
    categoryId: isUuid(sp.category) ? sp.category : undefined,
    supplierId: isUuid(sp.supplier) ? sp.supplier : undefined,
    q: (sp.q ?? "").slice(0, 100) || undefined,
  };
  const res = await listExpenses(orgId, filters);
  if (res.error !== null) return <ErrorState message={res.error} />;
  const rows = res.data.filter((e) => e.currency === currency);
  const cat = new Map(refs.categories.map((c) => [c.id, c.name]));
  const sup = new Map(refs.suppliers.map((s) => [s.id, s.name]));
  const coach = new Map(refs.coaches.map((c) => [c.id, c.name]));
  const prog = new Map(refs.programs.map((p) => [p.id, p.name]));
  const camp = new Map(refs.camps.map((c) => [c.id, c.name]));
  const total = sumMoney(rows.map((r) => r.amount), currency);
  const unpaid = sumMoney(rows.filter((r) => r.status === "unpaid").map((r) => r.amount), currency);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/admin/finance/expenses/new"><Button size="sm"><Plus className="h-4 w-4" aria-hidden /> {t("finance.expenses.new")}</Button></Link>
        <Link href="/admin/finance/lists"><Button size="sm" variant="secondary"><ListChecks className="h-4 w-4" aria-hidden /> {t("finance.lists.title")}</Button></Link>
        <RecurringButton />
      </div>
      <RangeForm t={t} action="/admin/finance" from={range.from} to={range.to} currency={currency} currencies={currencies} hidden={{ tab: "expenses" }}>
        <div>
          <Label htmlFor="fin-cat">{t("finance.expenses.category")}</Label>
          <Select id="fin-cat" name="category" defaultValue={filters.categoryId ?? ""} className="w-44">
            <option value="">{t("finance.filters.all")}</option>
            {refs.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="fin-sup">{t("finance.expenses.supplier")}</Label>
          <Select id="fin-sup" name="supplier" defaultValue={filters.supplierId ?? ""} className="w-44">
            <option value="">{t("finance.filters.all")}</option>
            {refs.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="fin-st">{t("finance.common.status")}</Label>
          <Select id="fin-st" name="status" defaultValue={status ?? ""} className="w-32">
            <option value="">{t("finance.filters.all")}</option>
            <option value="paid">{t("finance.expenses.statuses.paid")}</option>
            <option value="unpaid">{t("finance.expenses.statuses.unpaid")}</option>
          </Select>
        </div>
        <div><Label htmlFor="fin-q">{t("finance.filters.search")}</Label><Input id="fin-q" name="q" defaultValue={filters.q ?? ""} className="w-44" /></div>
      </RangeForm>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("finance.expenses.total")} value={f.money(total, currency)} hint={t("finance.expenses.count", { count: rows.length })} />
        <StatCard label={t("finance.expenses.unpaid")} value={f.money(unpaid, currency)} tone={unpaid > 0 ? "warning" : "brand"} />
        <StatCard label={t("finance.expenses.paid")} value={f.money(sumMoney([total, -unpaid], currency), currency)} tone="success" />
      </div>
      <FinTable
        title={t("finance.expenses.title")} caption={t("finance.expenses.title")}
        actions={<ExportLink href={exportHref("expenses", { status, category: filters.categoryId, supplier: filters.supplierId, q: filters.q })} label={t("finance.exportCsv")} />}
        rows={rows} rowKey={(r) => r.id} empty={t("finance.expenses.empty")}
        cols={[
          { key: "date", header: t("finance.common.date"), cell: (r) => f.date(r.date) },
          { key: "cat", header: t("finance.expenses.category"), cell: (r) => (r.categoryId ? cat.get(r.categoryId) : null) ?? "—" },
          { key: "sup", header: t("finance.expenses.supplier"), cell: (r) => (r.supplierId ? sup.get(r.supplierId) : null) ?? "—" },
          {
            key: "desc", header: t("finance.common.description"), cell: (r) => (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className="line-clamp-1">{r.description || "—"}</span>
                {r.coachId && <Badge>{coach.get(r.coachId) ?? ""}</Badge>}
                {r.campEditionId ? <Badge tone="info">{camp.get(r.campEditionId) ?? ""}</Badge> : r.programId ? <Badge tone="info">{prog.get(r.programId) ?? ""}</Badge> : null}
                {(r.recurringMonthly || r.isRecurringCopy) && <Repeat className="h-3.5 w-3.5 text-ink-3" aria-label={t("finance.expenses.recurring")} />}
                {r.hasReceipt && <Paperclip className="h-3.5 w-3.5 text-ink-3" aria-label={t("finance.receipt.title")} />}
              </span>
            ),
          },
          { key: "method", header: t("finance.common.method"), cell: (r) => t.dynamic(`finance.methods.${r.method}`, undefined, r.method) },
          { key: "status", header: t("finance.common.status"), cell: (r) => <Badge tone={r.status === "paid" ? "success" : "warning"}>{t.dynamic(`finance.expenses.statuses.${r.status}`)}</Badge> },
          { key: "amount", header: t("finance.common.amount"), align: "right", cell: (r) => f.money(r.amount, r.currency) },
          { key: "actions", header: t("finance.common.actions"), align: "right", cell: (r) => <ExpenseRowActions id={r.id} status={r.status} isPayout={!!r.payoutId} /> },
        ]}
      />
    </div>
  );
}
