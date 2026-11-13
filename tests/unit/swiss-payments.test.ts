import { describe, expect, it } from "vitest";
import {
  buildSpcPayload,
  formatQrReference,
  isValidQrr,
  qrrCheckDigit,
  scorReference,
  isQrIban,
  isValidScor,
  referenceTypeOf,
  resolveQrBillAccount,
  type PaymentSettings,
} from "@/lib/swiss-payments";

// Reference QRR from the SIX "Swiss Implementation Guidelines QR-bill" samples.
const SIX_QRR = "210000000003139471430009017";

describe("qrrCheckDigit (mod-10 recursive)", () => {
  it("computes the check digit of the SIX sample reference", () => {
    expect(qrrCheckDigit(SIX_QRR.slice(0, 26))).toBe("7");
  });

  it("returns 0 for a full valid reference (self-check property)", () => {
    expect(qrrCheckDigit(SIX_QRR)).toBe("0");
  });

  it("ignores spaces and non-digits", () => {
    expect(qrrCheckDigit("21 00000 00003 13947 14300 0901")).toBe("7");
  });

  it("handles all-zero input", () => {
    expect(qrrCheckDigit("0".repeat(26))).toBe("0");
  });

  it("produces a valid 27-digit reference for arbitrary 26-digit bases", () => {
    for (const base of ["00000000000000000000000001", "12345678901234567890123456", "99999999999999999999999999"]) {
      expect(isValidQrr(base + qrrCheckDigit(base))).toBe(true);
    }
  });

  it("detects every single-digit transcription error in the sample", () => {
    for (let i = 0; i < 26; i++) {
      const d = Number(SIX_QRR[i]);
      const mutated = SIX_QRR.slice(0, i) + String((d + 1) % 10) + SIX_QRR.slice(i + 1);
      expect(isValidQrr(mutated)).toBe(false);
    }
  });
});

describe("isValidQrr", () => {
  it("accepts the SIX sample, with or without spaces", () => {
    expect(isValidQrr(SIX_QRR)).toBe(true);
    expect(isValidQrr("21 00000 00003 13947 14300 09017")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidQrr(SIX_QRR.slice(1))).toBe(false);
    expect(isValidQrr(SIX_QRR + "0")).toBe(false);
    expect(isValidQrr("")).toBe(false);
  });

  it("rejects a wrong check digit", () => {
    expect(isValidQrr(SIX_QRR.slice(0, 26) + "8")).toBe(false);
  });
});

describe("formatQrReference", () => {
  it("groups in blocks of 5 from the right", () => {
    expect(formatQrReference(SIX_QRR)).toBe("21 00000 00003 13947 14300 09017");
  });
  it("is idempotent on already formatted input", () => {
    expect(formatQrReference("21 00000 00003 13947 14300 09017")).toBe("21 00000 00003 13947 14300 09017");
  });
  it("handles short and empty input", () => {
    expect(formatQrReference("123")).toBe("123");
    expect(formatQrReference("12345")).toBe("12345");
    expect(formatQrReference("123456")).toBe("1 23456");
    expect(formatQrReference("")).toBe("");
  });
});

/** ISO 7064 mod 97-10 validation of an RF reference. */
function rfIsValid(rf: string): boolean {
  const s = rf.slice(4) + rf.slice(0, 4);
  const numeric = s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

describe("scorReference (ISO 11649)", () => {
  it("matches the ISO 11649 worked example", () => {
    expect(scorReference("539007547034")).toBe("RF18539007547034");
  });
  it("normalises case and strips separators", () => {
    expect(scorReference("5390 0754-7034")).toBe("RF18539007547034");
    expect(scorReference("inv2026x0211")).toBe(scorReference("INV2026X0211"));
  });
  it("always yields a two-digit check and a mod-97 valid reference", () => {
    for (const raw of ["1", "A", "INV20260001", "DLANG000123", "Z".repeat(21)]) {
      const rf = scorReference(raw);
      expect(rf).toMatch(/^RF\d{2}[0-9A-Z]+$/);
      expect(rfIsValid(rf)).toBe(true);
    }
  });
});

const settings: PaymentSettings = {
  creditorName: "DLang Basketball",
  creditorStreet: "Rue du Test",
  creditorBuilding: "1",
  creditorZip: "1000",
  creditorCity: "Lausanne",
  creditorCountry: "CH",
  iban: "CH93 0076 2011 6238 5295 7",
  qrIban: "CH44 3199 9123 0008 8901 2",
  twintNumber: "",
  referenceType: "QRR",
  referencePrefix: "21",
};

describe("buildSpcPayload (Swiss Payment Code v0200)", () => {
  it("emits a CRLF-separated payload with the fixed header and trailer", () => {
    const p = buildSpcPayload({ settings, amount: 290, currency: "CHF", reference: SIX_QRR });
    const lines = p.split("\r\n");
    expect(lines.slice(0, 3)).toEqual(["SPC", "0200", "1"]);
    expect(lines.at(-1)).toBe("EPD");
    // Header(3) + account(1) + creditor(7) + ultimate creditor(7) + amount/currency(2)
    // + debtor(7) + reference(3) + EPD trailer = 31 (no billing info / alt schemes).
    expect(lines).toHaveLength(31);
    expect(p).not.toMatch(/(?<!\r)\n/);
  });

  it("uses the QR-IBAN (without spaces) and digits-only reference for QRR", () => {
    const lines = buildSpcPayload({ settings, amount: 1490, currency: "CHF", reference: "21 00000 00003 13947 14300 09017" }).split("\r\n");
    expect(lines[3]).toBe("CH4431999123000889012");
    expect(lines[27]).toBe("QRR");
    expect(lines[28]).toBe(SIX_QRR);
  });

  it("uses the normal IBAN for SCOR and keeps the RF reference verbatim", () => {
    const rf = scorReference("INV20260211");
    const lines = buildSpcPayload({ settings: { ...settings, referenceType: "SCOR" }, amount: 10, currency: "EUR", reference: rf }).split("\r\n");
    expect(lines[3]).toBe("CH9300762011623852957");
    expect(lines[19]).toBe("EUR");
    expect(lines[27]).toBe("SCOR");
    expect(lines[28]).toBe(rf);
  });

  it("refuses a QRR reference without a QR-IBAN (banks reject QRR on a normal IBAN)", () => {
    expect(() => buildSpcPayload({ settings: { ...settings, qrIban: "" }, amount: 1, currency: "CHF", reference: SIX_QRR })).toThrow();
  });

  it("takes the reference type from the invoice reference, not the org setting", () => {
    // Setting says SCOR, invoice carries a QRR -> QRR + QR-IBAN.
    const qrr = buildSpcPayload({ settings: { ...settings, referenceType: "SCOR" }, amount: 1, currency: "CHF", reference: SIX_QRR }).split("\r\n");
    expect(qrr[3]).toBe("CH4431999123000889012");
    expect(qrr[27]).toBe("QRR");
    // Setting says QRR, invoice carries an RF reference -> SCOR + normal IBAN.
    const rf = scorReference("INV20260211");
    const scor = buildSpcPayload({ settings, amount: 1, currency: "CHF", reference: rf }).split("\r\n");
    expect(scor[3]).toBe("CH9300762011623852957");
    expect(scor[27]).toBe("SCOR");
  });

  it("writes NON with an empty reference when the invoice has none", () => {
    const lines = buildSpcPayload({ settings: { ...settings, referenceType: "NON" }, amount: 1, currency: "CHF", reference: "" }).split("\r\n");
    expect(lines[3]).toBe("CH9300762011623852957");
    expect(lines[27]).toBe("NON");
    expect(lines[28]).toBe("");
  });

  it("refuses a non-CH/LI IBAN", () => {
    const eu = { ...settings, iban: "DE89 3704 0044 0532 0130 00", qrIban: "" };
    expect(() => buildSpcPayload({ settings: eu, amount: 1, currency: "EUR", reference: scorReference("INV1") })).toThrow();
  });

  it("formats the amount with exactly two decimals", () => {
    const amt = (n: number) => buildSpcPayload({ settings, amount: n, currency: "CHF", reference: SIX_QRR }).split("\r\n")[18];
    expect(amt(290)).toBe("290.00");
    expect(amt(0.1 + 0.2)).toBe("0.30");
    expect(amt(1234.5)).toBe("1234.50");
  });

  it("adds a structured debtor block only when a debtor name is present", () => {
    const without = buildSpcPayload({ settings, amount: 1, currency: "CHF", reference: SIX_QRR }).split("\r\n");
    expect(without[20]).toBe("");
    expect(without[26]).toBe("");
    const withDebtor = buildSpcPayload({ settings, amount: 1, currency: "CHF", reference: SIX_QRR, debtorName: "Carla Lopes", message: "INV-2026-0211" }).split("\r\n");
    expect(withDebtor[20]).toBe("S");
    expect(withDebtor[21]).toBe("Carla Lopes");
    expect(withDebtor[26]).toBe("CH");
    expect(withDebtor[29]).toBe("INV-2026-0211");
  });
});

describe("QR-bill account resolution", () => {
  it("recognises QR-IBANs by their QR-IID (30000-31999)", () => {
    expect(isQrIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQrIban("CH93 0076 2011 6238 5295 7")).toBe(false);
    expect(isQrIban("DE89 3704 0044 0532 0130 00")).toBe(false);
    expect(isQrIban("")).toBe(false);
  });

  it("classifies stored references", () => {
    expect(referenceTypeOf(SIX_QRR)).toBe("QRR");
    expect(referenceTypeOf(scorReference("INV20260211"))).toBe("SCOR");
    expect(referenceTypeOf("")).toBe("NON");
    expect(referenceTypeOf(null)).toBe("NON");
    expect(isValidScor("RF18539007547034")).toBe(true);
    expect(isValidScor("RF19539007547034")).toBe(false);
  });

  it("returns null when no account fits the reference", () => {
    expect(resolveQrBillAccount({ iban: "CH93 0076 2011 6238 5295 7", qrIban: "" }, SIX_QRR)).toBeNull();
    expect(resolveQrBillAccount({ iban: "", qrIban: "CH44 3199 9123 0008 8901 2" }, scorReference("X1"))).toBeNull();
    expect(resolveQrBillAccount({ iban: "FR76 3000 6000 0112 3456 7890 189", qrIban: "" }, scorReference("X1"))).toBeNull();
  });
});
