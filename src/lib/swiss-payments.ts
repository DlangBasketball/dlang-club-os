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

/**
 * Build the Swiss QR Code payload (SPC). The reference type is derived from the
 * settings: QRR uses the QR-IBAN, SCOR/NON use the normal IBAN.
 */
export function buildSpcPayload(input: QrBillInput): string {
  const s = input.settings;
  const useQrr = s.referenceType === "QRR";
  const iban = cleanIban(useQrr ? s.qrIban || s.iban : s.iban);
  const reference = useQrr ? input.reference.replace(/\D/g, "") : input.reference;

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
    s.referenceType,               // Reference type: QRR | SCOR | NON
    reference,                     // Reference
    input.message ?? "",           // Unstructured message
    "EPD",                         // Trailer
  ];
  return lines.join("\r\n");
}
