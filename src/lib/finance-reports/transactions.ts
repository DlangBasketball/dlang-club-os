import ExcelJS from "exceljs";
import type { CsvCell } from "@/lib/sportsops/csv";
import { formatAmount } from "@/lib/accounting/journal";
import { moneyFormat } from "./membership-workbook";

/**
 * Accountant export of a period (pure): invoices, adjustment documents
 * (credit / debit notes, write-offs, cancellations), payments, refunds and
 * reversals, each with the original invoice number, payment reference,
 * revenue category, issuing entity and source label. Rows come from
 * public.accounting_transactions (migration 20250420103700_finance_reports.sql).
 */

export const TRANSACTION_KINDS = ["invoice", "credit_note", "debit_note", "write_off", "cancellation", "payment", "refund", "reversal"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

export type AccountingTransactionDbRow = {
  kind: string; txn_date: string; document_number: string | null; invoice_id: string; invoice_number: string;
  invoice_reference: string | null; payment_reference: string | null; category: string; category_label: string | null;
  billing_entity_id: string | null; billing_entity_name: string | null; source_label: string | null; family_name: string | null;
  payer_name: string | null; description: string | null; method: string | null; status: string | null;
  amount: number | string; currency: string;
};

export type AccountingTransaction = {
  kind: TransactionKind; date: string; documentNumber: string | null; invoiceId: string; invoiceNumber: string;
  invoiceReference: string | null; paymentReference: string | null; category: string; categoryLabel: string | null;
  entityId: string | null; entityName: string | null; sourceLabel: string | null; familyName: string | null; payerName: string | null;
  description: string | null; method: string | null; status: string | null; amount: number; currency: string;
};

const isKind = (v: string): v is TransactionKind => (TRANSACTION_KINDS as readonly string[]).includes(v);

export function toTransaction(r: AccountingTransactionDbRow): AccountingTransaction {
  return {
    kind: isKind(r.kind) ? r.kind : "invoice", date: r.txn_date, documentNumber: r.document_number, invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_number, invoiceReference: r.invoice_reference, paymentReference: r.payment_reference, category: r.category,
    categoryLabel: r.category_label, entityId: r.billing_entity_id, entityName: r.billing_entity_name, sourceLabel: r.source_label,
    familyName: r.family_name, payerName: r.payer_name, description: r.description, method: r.method, status: r.status,
    amount: Number(r.amount ?? 0), currency: (r.currency ?? "").toUpperCase(),
  };
}

export const TRANSACTION_COLUMNS = [
  "date", "kind", "documentNumber", "invoiceNumber", "invoiceReference", "paymentReference", "category", "entity", "sourceLabel",
  "family", "payer", "method", "status", "amount", "currency", "description",
] as const;
export type TransactionColumn = (typeof TRANSACTION_COLUMNS)[number];

export type TransactionLabels = {
  sheet: string;
  columns: Record<TransactionColumn, string>;
  kind: (k: TransactionKind) => string;
  /** Category label (selection invoices pass the programme series instead). */
  category: (t: AccountingTransaction) => string;
  method: (m: string) => string;
  status: (s: string) => string;
};

function cells(t: AccountingTransaction, L: TransactionLabels): Record<TransactionColumn, string | number> {
  return {
    date: t.date, kind: L.kind(t.kind), documentNumber: t.documentNumber ?? "", invoiceNumber: t.invoiceNumber,
    invoiceReference: t.invoiceReference ?? "", paymentReference: t.paymentReference ?? "", category: L.category(t),
    entity: t.entityName ?? "", sourceLabel: t.sourceLabel ?? "", family: t.familyName ?? "", payer: t.payerName ?? "",
    method: t.method ? L.method(t.method) : "", status: t.status ? L.status(t.status) : "", amount: t.amount,
    currency: t.currency, description: t.description ?? "",
  };
}

/** CSV rows (amounts as plain decimals with the currency's digits). */
export function transactionCsvRows(rows: AccountingTransaction[], L: TransactionLabels): { headers: string[]; rows: CsvCell[][] } {
  return {
    headers: TRANSACTION_COLUMNS.map((c) => L.columns[c]),
    rows: rows.map((t) => {
      const c = cells(t, L);
      return TRANSACTION_COLUMNS.map((k) => (k === "amount" ? formatAmount(t.amount, t.currency) : c[k]));
    }),
  };
}

export function buildTransactionsWorkbook(rows: AccountingTransaction[], L: TransactionLabels): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheet, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(TRANSACTION_COLUMNS.map((c) => L.columns[c])).font = { bold: true };
  const amountCol = TRANSACTION_COLUMNS.indexOf("amount") + 1;
  for (const t of rows) {
    const c = cells(t, L);
    const row = ws.addRow(TRANSACTION_COLUMNS.map((k) => c[k]));
    row.getCell(amountCol).numFmt = moneyFormat(t.currency);
  }
  ws.columns.forEach((col) => { col.width = 18; });
  return wb;
}
