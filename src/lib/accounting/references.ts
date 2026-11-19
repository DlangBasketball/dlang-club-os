/**
 * Structured payment references on incoming credits:
 *   QRR  27-digit Swiss QR reference (mod-10 recursive check digit; same as the old ESR/ISR)
 *   SCOR ISO 11649 creditor reference "RFxx..." (mod-97 check)
 * Pure; mirrors public.find_invoice_by_reference (comparison ignores spaces / case).
 */
export type ReferenceType = "QRR" | "SCOR" | "NON";

const MOD10_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** Upper-case, alphanumerics only ("21 00000 ..." -> "2100000..."). */
export function normalizeReference(s: string | null | undefined): string {
  return (s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function qrrValid(ref: string): boolean {
  const r = normalizeReference(ref);
  if (!/^\d{27}$/.test(r)) return false;
  let carry = 0;
  for (const ch of r.slice(0, 26)) carry = MOD10_TABLE[(carry + Number(ch)) % 10];
  return (10 - carry) % 10 === Number(r[26]);
}

export function scorValid(ref: string): boolean {
  const r = normalizeReference(ref);
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(r)) return false;
  const moved = r.slice(4) + r.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

/**
 * Reference of a credit: the structured one when present (its type from the
 * file, else from its shape), otherwise a valid QRR / SCOR found in the free
 * text (some banks put the reference only in Ustrd).
 */
export function detectReference(structured: string | null, typeHint: string | null, freeText: string | null): { reference: string | null; type: ReferenceType } {
  const s = normalizeReference(structured);
  if (s) {
    const ref = s.slice(0, 40);
    if (typeHint === "SCOR" || (typeHint !== "QRR" && scorValid(s))) return { reference: ref, type: "SCOR" };
    // ISR (ESR) references arrive with other type codes; a valid 27-digit one matches like a QRR.
    if (typeHint === "QRR" || qrrValid(s)) return { reference: ref, type: "QRR" };
    return { reference: ref, type: "NON" };
  }
  const text = freeText ?? "";
  for (const m of text.matchAll(/(?:\d[\s]?){26}\d/g)) {
    const cand = normalizeReference(m[0]);
    if (qrrValid(cand)) return { reference: cand, type: "QRR" };
  }
  for (const m of text.toUpperCase().matchAll(/RF\d{2}(?:\s?[0-9A-Z]){1,21}/g)) {
    // The pattern is greedy (it may swallow a following word): try the longest valid prefix.
    const cand = normalizeReference(m[0]);
    for (let len = cand.length; len >= 5; len--) {
      if (scorValid(cand.slice(0, len))) return { reference: cand.slice(0, len), type: "SCOR" };
    }
  }
  return { reference: null, type: "NON" };
}
