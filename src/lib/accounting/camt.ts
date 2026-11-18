/**
 * ISO 20022 bank-to-customer files: camt.053 (account statement) and
 * camt.054 (debit/credit notification), as delivered by Swiss banks
 * (PostFinance, UBS, Raiffeisen, cantonal banks ...). Swiss Payment Standards
 * use versions .001.04 (SPS 2018) and .001.08 (SPS 2022); both are read here
 * because the parser works on local element names.
 *
 * Extracts the BOOKED CREDITS only (incoming money). Debits, reversals and
 * pending entries are counted as skipped. Batch bookings (one Ntry with many
 * TxDtls, e.g. a QR-bill collective credit) yield one credit per TxDtls.
 *
 * Privacy: the debtor IBAN is reduced to its last 4 characters here; the full
 * value never leaves this function.
 */
import { createHash } from "node:crypto";
import { child, childrenNamed, parseXml, path, textAt, XmlError, type XmlNode } from "./xml";
import { normalizeReference, detectReference, type ReferenceType } from "./references";

export type CamtFormat = "camt.053" | "camt.054";

export type CamtCredit = {
  /** Stable per-transaction key, unique per bank account; used to make re-imports idempotent. */
  bankRef: string;
  amount: number;
  currency: string;
  bookingDate: string | null;
  valueDate: string | null;
  reference: string | null;
  referenceType: ReferenceType;
  debtorName: string | null;
  debtorIbanLast4: string | null;
  remittance: string | null;
};

export type CamtResult = {
  format: CamtFormat;
  messageId: string | null;
  accountLast4: string | null;
  from: string | null;
  to: string | null;
  credits: CamtCredit[];
  /** Debits, reversals and not-yet-booked entries. */
  skipped: number;
};

export type CamtErrorCode = "UNSUPPORTED_FORMAT" | "INVALID_AMOUNT" | "NO_ENTRIES" | XmlError["code"];

export class CamtError extends Error {
  readonly code: CamtErrorCode;
  constructor(code: CamtErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.name = "CamtError";
  }
}

const AMOUNT_RE = /^\d{1,15}(\.\d{1,5})?$/;

function dateOf(n: XmlNode | null): string | null {
  const t = textAt(n, "Dt") ?? textAt(n, "DtTm");
  if (!t) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1] : null;
}

function amountOf(n: XmlNode | null): { amount: number; currency: string } | null {
  if (!n) return null;
  const t = n.text.trim();
  if (!AMOUNT_RE.test(t)) throw new CamtError("INVALID_AMOUNT", t.slice(0, 20));
  const ccy = (n.attrs.Ccy ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(ccy)) throw new CamtError("INVALID_AMOUNT", "currency");
  return { amount: Math.round(Number(t) * 100) / 100, currency: ccy };
}

function last4(iban: string | null): string | null {
  if (!iban) return null;
  const v = iban.replace(/\s/g, "").toUpperCase();
  return v.length >= 4 ? v.slice(-4) : null;
}

function clip(s: string | null, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function isBooked(ntry: XmlNode): boolean {
  const sts = child(ntry, "Sts");
  if (!sts) return true;
  const code = (textAt(sts, "Cd") ?? sts.text.trim()).toUpperCase();
  return code === "" || code === "BOOK";
}

function debtorName(tx: XmlNode): string | null {
  const parties = child(tx, "RltdPties");
  // SPS 2022 (.08): Dbtr > Pty > Nm; SPS 2018 (.04): Dbtr > Nm. Ultimate debtor as a fallback.
  return clip(textAt(parties, "Dbtr", "Pty", "Nm") ?? textAt(parties, "Dbtr", "Nm")
    ?? textAt(parties, "UltmtDbtr", "Pty", "Nm") ?? textAt(parties, "UltmtDbtr", "Nm"), 140);
}

function debtorIban(tx: XmlNode): string | null {
  return textAt(tx, "RltdPties", "DbtrAcct", "Id", "IBAN");
}

function remittanceOf(tx: XmlNode | null): { reference: string | null; typeHint: string | null; text: string | null } {
  const rmt = child(tx, "RmtInf");
  if (!rmt) return { reference: null, typeHint: null, text: null };
  let reference: string | null = null;
  let typeHint: string | null = null;
  for (const strd of childrenNamed(rmt, "Strd")) {
    const cri = child(strd, "CdtrRefInf");
    const ref = textAt(cri, "Ref");
    if (ref && !reference) {
      reference = ref;
      typeHint = (textAt(cri, "Tp", "CdOrPrtry", "Prtry") ?? textAt(cri, "Tp", "CdOrPrtry", "Cd"))?.toUpperCase() ?? null;
    }
  }
  const ustrd = childrenNamed(rmt, "Ustrd").map((u) => u.text.trim()).filter(Boolean).join(" ");
  const addtl = childrenNamed(rmt, "Strd").map((s) => textAt(s, "AddtlRmtInf")).filter(Boolean).join(" ");
  return { reference, typeHint, text: clip([ustrd, addtl].filter(Boolean).join(" "), 500) };
}

function hashKey(parts: (string | number | null)[]): string {
  return createHash("sha256").update(parts.map((p) => (p == null ? "" : String(p))).join("|")).digest("hex").slice(0, 40);
}

/** Parse a camt.053 / camt.054 XML document. Throws CamtError (or XmlError codes wrapped in it). */
export function parseCamt(xml: string): CamtResult {
  let doc: XmlNode;
  try {
    doc = parseXml(xml);
  } catch (e) {
    if (e instanceof XmlError) throw new CamtError(e.code, e.message);
    throw e;
  }
  const rootMsg = doc.name === "Document" ? doc.children[0] ?? null : doc;
  let format: CamtFormat;
  let containers: XmlNode[];
  if (rootMsg?.name === "BkToCstmrStmt") {
    format = "camt.053";
    containers = childrenNamed(rootMsg, "Stmt");
  } else if (rootMsg?.name === "BkToCstmrDbtCdtNtfctn") {
    format = "camt.054";
    containers = childrenNamed(rootMsg, "Ntfctn");
  } else {
    throw new CamtError("UNSUPPORTED_FORMAT", rootMsg?.name ?? doc.name);
  }

  const messageId = clip(textAt(rootMsg, "GrpHdr", "MsgId"), 140);
  const credits: CamtCredit[] = [];
  let skipped = 0;
  let accountLast4: string | null = null;
  let from: string | null = null;
  let to: string | null = null;

  for (const c of containers) {
    const iban = textAt(c, "Acct", "Id", "IBAN");
    accountLast4 = accountLast4 ?? last4(iban);
    const fr = textAt(c, "FrToDt", "FrDtTm")?.slice(0, 10) ?? null;
    const tt = textAt(c, "FrToDt", "ToDtTm")?.slice(0, 10) ?? null;
    if (fr && (!from || fr < from)) from = fr;
    if (tt && (!to || tt > to)) to = tt;

    for (const ntry of childrenNamed(c, "Ntry")) {
      const indicator = textAt(ntry, "CdtDbtInd");
      const reversal = (textAt(ntry, "RvslInd") ?? "").toLowerCase() === "true";
      if (indicator !== "CRDT" || reversal || !isBooked(ntry)) { skipped += 1; continue; }
      const entryAmt = amountOf(child(ntry, "Amt"));
      if (!entryAmt) { skipped += 1; continue; }
      const bookingDate = dateOf(child(ntry, "BookgDt"));
      const valueDate = dateOf(child(ntry, "ValDt"));
      const entryRef = textAt(ntry, "AcctSvcrRef") ?? textAt(ntry, "NtryRef");

      const txs = childrenNamed(ntry, "NtryDtls").flatMap((d) => childrenNamed(d, "TxDtls"));
      const list: (XmlNode | null)[] = txs.length ? txs : [null];
      list.forEach((tx, idx) => {
        if (tx && textAt(tx, "CdtDbtInd") === "DBIT") { skipped += 1; return; }
        const amt = tx ? amountOf(child(tx, "Amt") ?? path(tx, "AmtDtls", "TxAmt", "Amt")) ?? (list.length === 1 ? entryAmt : null) : entryAmt;
        if (!amt) { skipped += 1; return; }
        const rmt = remittanceOf(tx ?? ntry);
        const det = detectReference(rmt.reference, rmt.typeHint, rmt.text);
        const txRef = tx ? textAt(tx, "Refs", "AcctSvcrRef") : null;
        const name = tx ? debtorName(tx) : null;
        const bankRef = txRef
          ? `T:${txRef}`
          : entryRef
            ? (list.length > 1 ? `E:${entryRef}#${idx + 1}` : `E:${entryRef}`)
            : `H:${hashKey([accountLast4, bookingDate, valueDate, amt.amount, amt.currency, det.reference, name, tx ? textAt(tx, "Refs", "EndToEndId") : null, idx])}`;
        credits.push({
          bankRef: bankRef.slice(0, 200),
          amount: amt.amount,
          currency: amt.currency,
          bookingDate,
          valueDate: valueDate ?? bookingDate,
          reference: det.reference,
          referenceType: det.type,
          debtorName: name,
          debtorIbanLast4: tx ? last4(debtorIban(tx)) : null,
          remittance: rmt.text,
        });
      });
    }
  }
  if (!credits.length && !skipped) throw new CamtError("NO_ENTRIES");
  return { format, messageId, accountLast4, from, to, credits, skipped };
}

export { normalizeReference };
