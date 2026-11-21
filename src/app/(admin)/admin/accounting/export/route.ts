import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasFeature } from "@/lib/upgrades/server";
import { tenantMatchesOrg } from "@/lib/tenant/server";
import { getI18n } from "@/lib/i18n/server";
import { writeAudit } from "@/lib/people/server";
import { toCsv, type CsvCell } from "@/lib/sportsops/csv";
import { isDay } from "@/lib/finance/params";
import { accountingDb } from "@/lib/accounting/db";
import { getSupport, loadJournal, loadOpenItems, reimbursementReport } from "@/lib/accounting/data";
import { formatAmount, journalRows, toBexioCsv } from "@/lib/accounting/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /admin/accounting/export?kind=…
 *   bexio        Bexio manual-entry CSV for from..to          [Verify with Bexio import]
 *   journal      generic double-entry journal CSV for from..to
 *   journal_xlsx the same journal as an Excel workbook
 *   open_items   debtors with an open balance at `at`
 *   collection   dunning cases flagged for collection (marks them exported)
 *   reimbursements  external reimbursements + totals per funder kind
 * Admin / finance only; every read is scoped to the session's club (RLS +
 * explicit org filter). Headers are translated; amounts are plain decimals.
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me?.orgId || !(me.roles.includes("admin") || me.roles.includes("finance")) || !(await tenantMatchesOrg(me.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Module not in the club's plan: the route does not exist for it.
  if (!(await hasFeature(me.orgId, "accounting"))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = { id: me.id, orgId: me.orgId };
  const { t } = await getI18n();
  const url = new URL(request.url);
  const p = (k: string) => url.searchParams.get(k);
  const kind = p("kind") ?? "";
  const today = new Date().toISOString().slice(0, 10);
  const from = isDay(p("from")) ? p("from")! : `${today.slice(0, 7)}-01`;
  const to = isDay(p("to")) ? p("to")! : today;
  if (to < from) return NextResponse.json({ error: "Bad range" }, { status: 400 });
  const fail = (e: string) => NextResponse.json({ error: e }, { status: 500 });
  const csv = (name: string, body: string) => {
    const res = new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
    return res;
  };
  const jHeaders = [t("accounting.journal.date"), t("accounting.journal.docNo"), t("accounting.journal.debit"), t("accounting.journal.credit"),
    t("accounting.journal.amount"), t("accounting.journal.currency"), t("accounting.journal.vatCode"), t("accounting.journal.text")];

  if (kind === "bexio" || kind === "journal" || kind === "journal_xlsx") {
    const j = await loadJournal(me.orgId, { from, to });
    if (j.error !== null) return fail(j.error);
    await writeAudit(actor, `accounting.export.${kind}`, "accounting_mappings", null, { from, to, lines: j.data.lines.length, unmapped: j.data.issues.length });
    if (kind === "bexio") return csv(`bexio-journal_${from}_${to}.csv`, toBexioCsv(j.data.lines));
    if (kind === "journal") return csv(`journal_${from}_${to}.csv`, "﻿" + toCsv(jHeaders, journalRows(j.data.lines)));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(t("accounting.journal.sheet"));
    ws.addRow(jHeaders).font = { bold: true };
    for (const l of j.data.lines) ws.addRow([l.date, l.docNo, l.debit, l.credit, Number(formatAmount(l.amount, l.currency)), l.currency, l.vatCode ?? "", l.text]);
    ws.columns.forEach((c) => { c.width = 16; });
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(buf as ArrayBuffer, { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="journal_${from}_${to}.xlsx"`, "Cache-Control": "no-store",
    } });
  }

  if (kind === "open_items") {
    const at = isDay(p("at")) ? p("at")! : today;
    const r = await loadOpenItems(at);
    if (r.error !== null) return fail(r.error);
    await writeAudit(actor, "accounting.export.open_items", "invoices", null, { at, rows: r.data.length });
    const headers = [t("accounting.openItems.family"), t("accounting.openItems.invoice"), t("accounting.openItems.issued"), t("accounting.openItems.due"),
      t("accounting.openItems.amountDue"), t("accounting.openItems.paid"), t("accounting.openItems.open"), t("accounting.journal.currency"),
      t("accounting.openItems.daysOverdue"), t("accounting.openItems.dunningLevel")];
    const rows: CsvCell[][] = r.data.map((o) => [o.family_name ?? "", o.number, o.issued_on, o.due_date ?? "", formatAmount(o.amount_due, o.currency),
      formatAmount(o.paid, o.currency), formatAmount(o.open_amount, o.currency), o.currency, o.days_overdue, o.dunning_level]);
    return csv(`open-items_${at}.csv`, "﻿" + toCsv(headers, rows));
  }

  if (kind === "collection") {
    const db = await accountingDb();
    const { data: cases, error } = await db.from("dunning_cases").select("*").eq("org_id", me.orgId).eq("status", "collection").order("collection_at");
    if (error) return fail(error.message);
    const list = cases ?? [];
    const invIds = list.map((c) => c.invoice_id);
    const famIds = list.map((c) => c.family_id);
    const [{ data: invs }, { data: fams }] = await Promise.all([
      invIds.length ? db.from("invoices").select("id,number,currency,total_chf,adjustments_total,due_date,issued_at").in("id", invIds) : Promise.resolve({ data: [] }),
      famIds.length ? db.from("families").select("id,name,address,phone").in("id", famIds) : Promise.resolve({ data: [] }),
    ]);
    const open = await loadOpenItems(today);
    const openBy = new Map((open.data ?? []).map((o) => [o.invoice_id, o]));
    const invBy = new Map(((invs ?? []) as { id: string; number: string; currency: string; due_date: string | null; issued_at: string }[]).map((i) => [i.id, i]));
    const famBy = new Map(((fams ?? []) as { id: string; name: string; address: string | null; phone: string | null }[]).map((f) => [f.id, f]));
    const headers = [t("accounting.openItems.family"), t("accounting.collection.address"), t("accounting.collection.phone"), t("accounting.openItems.invoice"),
      t("accounting.openItems.issued"), t("accounting.openItems.due"), t("accounting.openItems.open"), t("accounting.journal.currency"),
      t("accounting.collection.flaggedOn"), t("accounting.collection.lastNotice")];
    const rows: CsvCell[][] = list.map((c) => {
      const inv = invBy.get(c.invoice_id); const fam = famBy.get(c.family_id); const o = openBy.get(c.invoice_id);
      return [fam?.name ?? "", fam?.address ?? "", fam?.phone ?? "", inv?.number ?? "", inv?.issued_at.slice(0, 10) ?? "", inv?.due_date ?? "",
        o ? formatAmount(o.open_amount, o.currency) : "", inv?.currency ?? "", c.collection_at?.slice(0, 10) ?? "", c.last_notice_at?.slice(0, 10) ?? ""];
    });
    if (list.length) await db.rpc("dunning_mark_exported", { p_cases: list.map((c) => c.id) });
    await writeAudit(actor, "accounting.export.collection", "dunning_cases", null, { cases: list.length });
    return csv(`collection_${today}.csv`, "﻿" + toCsv(headers, rows));
  }

  if (kind === "reimbursements") {
    const r = await getSupport(me.orgId);
    if (r.error !== null) return fail(r.error);
    const headers = [t("accounting.support.funderKind"), t("accounting.support.funderName"), t("accounting.openItems.family"), t("accounting.openItems.invoice"),
      t("accounting.support.period"), t("accounting.support.expected"), t("accounting.support.received"), t("accounting.journal.currency"),
      t("accounting.common.status"), t("accounting.support.requestedOn"), t("accounting.support.receivedOn"), t("accounting.support.reference")];
    const rows: CsvCell[][] = r.data.reimbursements.map((x) => [t.dynamic(`accounting.support.funders.${x.funder_kind}`), x.funder_name, x.familyName ?? "",
      x.invoiceNumber ?? "", [x.period_start, x.period_end].filter(Boolean).join(" – "), formatAmount(Number(x.amount_expected), x.currency),
      x.amount_received == null ? "" : formatAmount(Number(x.amount_received), x.currency), x.currency, t.dynamic(`accounting.support.statuses.${x.status}`),
      x.requested_on ?? "", x.received_on ?? "", x.reference ?? ""]);
    rows.push([]);
    for (const s of reimbursementReport(r.data.reimbursements)) {
      rows.push([t.dynamic(`accounting.support.funders.${s.key}`), t("accounting.support.total"), "", "", "", formatAmount(s.expected, s.currency), formatAmount(s.received, s.currency), s.currency, "", "", "", ""]);
    }
    await writeAudit(actor, "accounting.export.reimbursements", "external_reimbursements", null, { rows: r.data.reimbursements.length });
    return csv(`reimbursements_${today}.csv`, "﻿" + toCsv(headers, rows));
  }

  return NextResponse.json({ error: "Unknown export" }, { status: 400 });
}
