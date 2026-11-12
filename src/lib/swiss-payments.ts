/**
 * Swiss payment helpers — QR reference, creditor reference (SCOR/RF), and the
 * Swiss QR-bill payload (Swiss Payment Code, SPC v0200) embedded in the QR.
 * Spec: SIX "Swiss Implementation Guidelines QR-bill".
 */

const QRR_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** Mod-10 recursive check digit (Swiss ESR / QR reference). */
export function qrrCheckDigit(ref: string): string {
  let carry = 0;
  for (const ch of ref.replace(/\D/g, "")) carry = QRR_TABLE[(carry + Number(ch)) % 10];
  return String((10 - carry) % 10);
}

/** True if a 27-digit QRR reference has a valid check digit. */
export function isValidQrr(ref: string): boolean {
  const digits = ref.replace(/\D/g, "");
  return digits.length === 27 && qrrCheckDigit(digits) === "0";
}

/** Display a QRR reference in blocks of 5 from the right: "21 00000 00003 …". */
export function formatQrReference(ref: string): string {
  const d = ref.replace(/\s/g, "");
  if (!d) return "";
  const groups: string[] = [];
  let rest = d;
  while (rest.length > 5) {
    groups.unshift(rest.slice(-5));
    rest = rest.slice(0, -5);
  }
  groups.unshift(rest);
  return groups.join(" ");
}

/** ISO 11649 creditor reference (RF…) for use with a normal (non-QR) IBAN. */
export function scorReference(raw: string): string {
  const ref = raw.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  const rearranged = `${ref}RF00`;
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  const check = String(98 - rem).padStart(2, "0");
  return `RF${check}${ref}`;
}

export type PaymentSettings = {
  creditorName: string;
  creditorStreet: string;
  creditorBuilding: string;
  creditorZip: string;
  creditorCity: string;
  creditorCountry: string;
  iban: string;
  qrIban: string;
  twintNumber: string;
  referenceType: "QRR" | "SCOR" | "NON";
  referencePrefix: string;
};

export type QrBillInput = {
  settings: PaymentSettings;
  amount: number;
  currency: string;
  reference: string; // raw QRR digits or RF reference
  debtorName?: string | null;
  message?: string | null;
};

/** Strip spaces from an IBAN for the payload. */
const cleanIban = (iban: string) => iban.replace(/\s/g, "").toUpperCase();

/** A Swiss/Liechtenstein IBAN (the only accounts a QR-bill may name). */
export function isChLiIban(iban: string | null | undefined): boolean {
  return /^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(cleanIban(iban ?? ""));
}

/** A QR-IBAN: CH/LI IBAN whose institution id (QR-IID) is 30000–31999. */
export function isQrIban(iban: string | null | undefined): boolean {
  const c = cleanIban(iban ?? "");
  if (!isChLiIban(c)) return false;
  const iid = Number(c.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

/** True for a well-formed ISO 11649 creditor reference (RFxx…, mod 97 = 1). */
export function isValidScor(ref: string): boolean {
  const r = ref.replace(/\s/g, "").toUpperCase();
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(r)) return false;
  const numeric = (r.slice(4) + r.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

export type ReferenceType = "QRR" | "SCOR" | "NON";

/** The reference type of a stored invoice reference (not the org setting). */
export function referenceTypeOf(reference: string | null | undefined): ReferenceType {
  const r = (reference ?? "").replace(/\s/g, "");
  if (!r) return "NON";
  if (isValidQrr(r)) return "QRR";
  if (isValidScor(r)) return "SCOR";
  return "NON";
}

export type QrBillAccount = { iban: string; referenceType: ReferenceType; reference: string };

/**
 * Picks the account and reference for a Swiss QR-bill from the invoice's
 * actual reference (SIX rules): a QRR reference needs a QR-IBAN; an SCOR
 * reference or no reference needs a normal (non-QR) CH/LI IBAN; NON carries an
 * empty reference. Returns null when no valid combination exists (no QR-bill
 * should be printed then, e.g. an EU club whose IBAN is not CH/LI).
 */
export function resolveQrBillAccount(settings: Pick<PaymentSettings, "iban" | "qrIban">, reference: string | null | undefined): QrBillAccount | null {
  const type = referenceTypeOf(reference);
  if (type === "QRR") {
    const iban = [settings.qrIban, settings.iban].map(cleanIban).find((i) => isQrIban(i));
    return iban ? { iban, referenceType: "QRR", reference: (reference ?? "").replace(/\D/g, "") } : null;
  }
  const iban = [settings.iban, settings.qrIban].map(cleanIban).find((i) => isChLiIban(i) && !isQrIban(i));
  if (!iban) return null;
  return type === "SCOR"
    ? { iban, referenceType: "SCOR", reference: (reference ?? "").replace(/\s/g, "").toUpperCase() }
    : { iban, referenceType: "NON", reference: "" };
}

/**
 * Build the Swiss QR Code payload (SPC). The reference type and account are
 * derived from the invoice's reference (resolveQrBillAccount), not from the
 * org's reference-type setting. Throws when no valid account/reference
 * combination exists.
 */
export function buildSpcPayload(input: QrBillInput): string {
  const s = input.settings;
  const account = resolveQrBillAccount(s, input.reference);
  if (!account) throw new Error("No IBAN matches this reference for a Swiss QR-bill");
  const { iban, referenceType, reference } = account;

  // 33 fixed elements + trailing; CR-LF separated per spec.
  const lines = [
    "SPC", "0200", "1",            // QRType, Version, Coding (UTF-8)
    iban,                          // Account (IBAN / QR-IBAN)
    "S",                           // Creditor address type: Structured
    s.creditorName,
    s.creditorStreet,
    s.creditorBuilding,
    s.creditorZip,
    s.creditorCity,
    s.creditorCountry,
    "", "", "", "", "", "", "",    // Ultimate creditor (unused) — 7 lines
    input.amount.toFixed(2),       // Amount
    input.currency,                // Currency
    input.debtorName ? "S" : "",   // Debtor address type
    input.debtorName ?? "",
    "", "", "", "",                // Debtor street/building/zip/city
    input.debtorName ? s.creditorCountry : "",
    referenceType,                 // Reference type: QRR | SCOR | NON
    reference,                     // Reference (empty for NON)
    input.message ?? "",           // Unstructured message
    "EPD",                         // Trailer
  ];
  return lines.join("\r\n");
}
