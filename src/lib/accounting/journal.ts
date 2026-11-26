/**
 * Double-entry journal for a period, built from the club's money records
 * (public.accounting_journal_source). Pure; one line per booking with a
 * debit account, a credit account and a positive amount, so every line
 * balances on its own and the whole journal always has debit = credit.
 *
 * Bookings (account keys -> the club's mapping, see chart.ts):
 *   invoice issued      Dr receivables          / Cr income.<kind>   (gross, VAT code by rate)
 *   credit note, cancel Dr income.<kind>        / Cr receivables
 *   debit note          Dr receivables          / Cr income.<kind>, dunning fees -> Cr dunning_fees
 *   write-off           Dr writeoff             / Cr receivables
 *   voided adjustment   the reverse booking, dated on the void
 *   payment in          Dr bank|cash|stripe_clearing|family_credit / Cr receivables
 *   refund / reversal   the reverse booking (negative payment rows)
 *   platform fee        Dr stripe_fees          / Cr stripe_clearing
 *   expense             Dr expense.<category>|expense.default / Cr bank|cash (paid) or payables (unpaid)
 * Amounts are gross; the VAT code tells the accounting software to split the
 * VAT (the usual import convention for Bexio / Banana / Abacus). Stripe
 * processing fees and payouts are booked from Stripe's payout report (not
 * part of this journal).
 */
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/currency";
import { vatKey, type IncomeKind } from "./chart";

export type SourceInvoice = {
  id: string; number: string; date: string; status: string; total: number; tax_rate: number; tax_amount: number;
  currency: string; family: string | null; kind: IncomeKind | string; description: string | null;
};
export type SourceAdjustment = {
  id: string; number: string; date: string; kind: "credit_note" | "debit_note" | "write_off" | "cancellation" | string;
  amount: number; tax_rate: number; currency: string; invoice_id: string; invoice_number: string; family: string | null;
  invoice_kind: IncomeKind | string; reason: string | null; voided_on: string | null;
};
export type SourcePayment = {
  id: string; date: string; amount: number; currency: string; method: string; method_detail: string | null;
  stripe: boolean; fee: number | null; invoice_id: string; invoice_number: string; family: string | null; reference: string | null;
};
export type SourceExpense = {
  id: string; date: string; amount: number; currency: string; category_id: string | null; category: string | null;
  description: string | null; status: "paid" | "unpaid" | string; method: string; supplier: string | null;
};
export type JournalSource = {
  invoices: SourceInvoice[]; adjustments: SourceAdjustment[]; payments: SourcePayment[]; expenses: SourceExpense[];
};

export type Mapping = Record<string, { account: string | null; vatCode: string | null }>;

export type JournalKind =
  | "invoice" | "credit_note" | "debit_note" | "write_off" | "cancellation" | "adjustment_void"
  | "payment" | "refund" | "fee" | "expense";

export type JournalLine = {
  date: string;
  docNo: string;
  debit: string;
  credit: string;
  amount: number;
  currency: string;
  vatCode: string | null;
  /** Short booking text (number / family / description), not translated: it is record data. */
  text: string;
  kind: JournalKind;
  sourceId: string;
};

export type JournalIssue = { key: string; docNo: string };
export type Journal = { lines: JournalLine[]; issues: JournalIssue[] };
export type Range = { from: string; to: string };

const BANK_METHODS = new Set(["qr_bill", "bank_transfer", "sepa_debit", "ach", "ideal", "bancontact"]);

/** Which money account a payment row moves. */
export function paymentAccountKey(p: Pick<SourcePayment, "method" | "method_detail" | "stripe">): string {
  if (p.method_detail === "family_credit" || p.method_detail === "to_family_credit") return "family_credit";
  if (p.method_detail === "bank_refund") return "bank";
  if (p.stripe) return "stripe_clearing";
  if (p.method === "manual") return "cash";
  if (BANK_METHODS.has(p.method) || p.method === "twint" || p.method === "card") return "bank";
  return "bank";
}

const inRange = (d: string | null | undefined, r: Range) => !!d && d >= r.from && d <= r.to;
const short = (s: string | null | undefined, n = 80) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const join = (...parts: (string | null | undefined)[]) => parts.map((p) => short(p, 60)).filter(Boolean).join(" · ");

export function buildJournal(src: JournalSource, mapping: Mapping, range: Range): Journal {
  const lines: JournalLine[] = [];
  const issues: JournalIssue[] = [];
  const acct = (key: string, docNo: string): string => {
    const a = mapping[key]?.account ?? (key.startsWith("expense.") ? mapping["expense.default"]?.account : null)
      ?? (key.startsWith("income.") ? mapping["income.other"]?.account : null);
    if (!a) {
      if (!issues.some((i) => i.key === key)) issues.push({ key, docNo });
      return "";
    }
    return a;
  };
  const vat = (rate: number | null | undefined) => {
    const k = vatKey(rate);
    return k ? mapping[k]?.vatCode ?? null : null;
  };
  const push = (l: Omit<JournalLine, "amount" | "debit" | "credit"> & { amount: number; debitKey: string; creditKey: string }) => {
    const minor = toMinorUnits(Math.abs(l.amount), l.currency);
    if (minor === 0) return;
    // A negative amount swaps the sides; the line amount is always positive.
    const [dk, ck] = l.amount < 0 ? [l.creditKey, l.debitKey] : [l.debitKey, l.creditKey];
    lines.push({
      date: l.date, docNo: l.docNo, debit: acct(dk, l.docNo), credit: acct(ck, l.docNo),
      amount: fromMinorUnits(minor, l.currency), currency: l.currency.toUpperCase(), vatCode: l.vatCode,
      text: l.text, kind: l.kind, sourceId: l.sourceId,
    });
  };

  for (const i of src.invoices) {
    if (!inRange(i.date, range)) continue;
    push({ date: i.date, docNo: i.number, amount: Number(i.total), currency: i.currency, vatCode: vat(i.tax_rate),
      text: join(i.number, i.family, i.description), kind: "invoice", sourceId: i.id,
      debitKey: "receivables", creditKey: `income.${i.kind}` });
  }

  for (const a of src.adjustments) {
    const income = `income.${a.invoice_kind}`;
    const isDunningFee = a.kind === "debit_note" && (a.reason ?? "").startsWith("dunning_fee");
    const [dk, ck]: [string, string] =
      a.kind === "debit_note" ? ["receivables", isDunningFee ? "dunning_fees" : income]
      : a.kind === "write_off" ? ["writeoff", "receivables"]
      : [income, "receivables"]; // credit_note, cancellation
    const kind: JournalKind = a.kind === "debit_note" || a.kind === "write_off" || a.kind === "cancellation" ? a.kind : "credit_note";
    const vatCode = a.kind === "write_off" || isDunningFee ? null : vat(a.tax_rate);
    if (inRange(a.date, range)) {
      push({ date: a.date, docNo: a.number, amount: Number(a.amount), currency: a.currency, vatCode,
        text: join(a.number, a.invoice_number, a.family), kind, sourceId: a.id, debitKey: dk, creditKey: ck });
    }
    if (a.voided_on && inRange(a.voided_on, range)) {
      push({ date: a.voided_on, docNo: a.number, amount: -Number(a.amount), currency: a.currency, vatCode,
        text: join(a.number, a.invoice_number, a.family), kind: "adjustment_void", sourceId: a.id, debitKey: dk, creditKey: ck });
    }
  }

  for (const p of src.payments) {
    if (!inRange(p.date, range)) continue;
    const docNo = `${p.invoice_number}-P${p.id.slice(0, 6).toUpperCase()}`;
    const amount = Number(p.amount);
    push({ date: p.date, docNo, amount, currency: p.currency, vatCode: null,
      text: join(p.invoice_number, p.family, p.reference), kind: amount < 0 ? "refund" : "payment", sourceId: p.id,
      debitKey: paymentAccountKey(p), creditKey: "receivables" });
    if (p.stripe && amount > 0 && Number(p.fee ?? 0) > 0) {
      push({ date: p.date, docNo, amount: Number(p.fee), currency: p.currency, vatCode: null,
        text: join(p.invoice_number, "fee"), kind: "fee", sourceId: p.id, debitKey: "stripe_fees", creditKey: "stripe_clearing" });
    }
  }

  for (const e of src.expenses) {
    if (!inRange(e.date, range)) continue;
    const creditKey = e.status === "paid" ? (e.method === "cash" ? "cash" : "bank") : "payables";
    push({ date: e.date, docNo: `EXP-${e.id.slice(0, 8).toUpperCase()}`, amount: Number(e.amount), currency: e.currency, vatCode: null,
      text: join(e.category, e.supplier, e.description), kind: "expense", sourceId: e.id,
      debitKey: e.category_id ? `expense.${e.category_id}` : "expense.default", creditKey });
  }

  const order = new Map(lines.map((l, i) => [l, i]));
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo) || order.get(a)! - order.get(b)!);
  return { lines, issues };
}

/** Per currency: total debits, total credits (equal by construction) and per-account balances (sum = 0). */
export function trialBalance(lines: JournalLine[]): Map<string, { debit: number; credit: number; accounts: Map<string, number> }> {
  const out = new Map<string, { debitMinor: number; creditMinor: number; accounts: Map<string, number> }>();
  for (const l of lines) {
    const cur = out.get(l.currency) ?? { debitMinor: 0, creditMinor: 0, accounts: new Map<string, number>() };
    const m = toMinorUnits(l.amount, l.currency);
    cur.debitMinor += m;
    cur.creditMinor += m;
    cur.accounts.set(l.debit, (cur.accounts.get(l.debit) ?? 0) + m);
    cur.accounts.set(l.credit, (cur.accounts.get(l.credit) ?? 0) - m);
    out.set(l.currency, cur);
  }
  const res = new Map<string, { debit: number; credit: number; accounts: Map<string, number> }>();
  for (const [c, v] of out) {
    res.set(c, {
      debit: fromMinorUnits(v.debitMinor, c),
      credit: fromMinorUnits(v.creditMinor, c),
      accounts: new Map(Array.from(v.accounts, ([k, x]) => [k, fromMinorUnits(x, c)])),
    });
  }
  return res;
}

// ---------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------
const neutralise = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/** "2026-03-05" -> "05.03.2026" */
export function chDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/**
 * Bexio manual-entry import CSV.
 * [Verify with Bexio import] Format assumptions, to be confirmed against a
 * Bexio test company before production use:
 *   - semicolon-separated, UTF-8 with BOM, CRLF line ends, one header row;
 *   - columns in this order: date (DD.MM.YYYY), document number, debit
 *     account, credit account, amount (dot decimal separator, no thousands
 *     separator, minor units of the currency), currency (ISO 4217), VAT code
 *     (empty when no VAT), booking text;
 *   - the header names are Bexio's German column labels (Bexio maps columns
 *     on import, so the names are a convenience, not a contract);
 *   - foreign-currency lines are imported in their own currency; Bexio
 *     converts with its exchange rate.
 */
export const BEXIO_HEADERS = ["Datum", "Beleg", "Soll", "Haben", "Betrag", "Währung", "MWST-Code", "Buchungstext"] as const;

export function toBexioCsv(lines: JournalLine[]): string {
  const esc = (v: string) => {
    const s = neutralise(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = lines.map((l) => [chDate(l.date), l.docNo, l.debit, l.credit, formatAmount(l.amount, l.currency), l.currency, l.vatCode ?? "", l.text]);
  return "﻿" + [BEXIO_HEADERS.join(";"), ...rows.map((r) => r.map((c) => esc(String(c))).join(";"))].join("\r\n") + "\r\n";
}

/** Plain decimal with the currency's minor digits ("1490.00", "1500" for JPY). */
export function formatAmount(amount: number, currency: string): string {
  const minor = toMinorUnits(amount, currency);
  const digits = Math.round(Math.log10(Math.max(1, toMinorUnits(1, currency))));
  const neg = minor < 0;
  const abs = Math.abs(minor);
  if (digits === 0) return `${neg ? "-" : ""}${abs}`;
  const s = String(abs).padStart(digits + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/** Generic double-entry journal rows (date, doc no, debit, credit, amount, currency, VAT code, text). */
export function journalRows(lines: JournalLine[]): string[][] {
  return lines.map((l) => [l.date, l.docNo, l.debit, l.credit, formatAmount(l.amount, l.currency), l.currency, l.vatCode ?? "", l.text]);
}
