/**
 * EPC QR code ("GiroCode" / SEPA credit-transfer QR) payload — pure.
 * Spec: EPC069-12 v2.1 (Quick Response Code: guidelines to enable data capture
 * for the initiation of a SEPA credit transfer). Optional for EU clubs; Swiss
 * clubs use the Swiss QR-bill (src/lib/swiss-payments.ts) instead.
 */

export type EpcQrInput = {
  name: string;          // beneficiary, max 70
  iban: string;
  bic?: string | null;   // optional within the EEA (version 002)
  amountEur: number;     // 0.01 – 999999999.99
  /** ISO 11649 RF reference (structured) — mutually exclusive with `text`. */
  reference?: string | null;
  /** Unstructured remittance text, max 140. */
  text?: string | null;
};

export function buildEpcQrPayload(input: EpcQrInput): string {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw new Error("Invalid IBAN");
  if (!(input.amountEur >= 0.01 && input.amountEur <= 999_999_999.99)) throw new Error("Amount out of range");
  const name = input.name.trim().slice(0, 70);
  if (!name) throw new Error("Beneficiary name required");
  const reference = input.reference?.replace(/\s/g, "").toUpperCase() ?? "";
  const text = reference ? "" : (input.text ?? "").slice(0, 140);

  const lines = [
    "BCD",                         // service tag
    "002",                         // version
    "1",                           // UTF-8
    "SCT",                         // SEPA credit transfer
    (input.bic ?? "").trim().toUpperCase(),
    name,
    iban,
    `EUR${input.amountEur.toFixed(2)}`,
    "",                            // purpose (optional)
    reference,                     // structured reference
    text,                          // unstructured remittance
  ];
  // Trailing empty elements may be omitted.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
