import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CamtError, parseCamt } from "@/lib/accounting/camt";
import { parseXml, XmlError } from "@/lib/accounting/xml";
import { detectReference, qrrValid, scorValid } from "@/lib/accounting/references";

const fixture = (f: string) => readFileSync(path.join(__dirname, "fixtures", "camt", f), "utf8");
const code = (fn: () => unknown): string => {
  try { fn(); } catch (e) { return (e as CamtError | XmlError).code; }
  return "NO_ERROR";
};

describe("camt.054 (QR batch notification)", () => {
  const r = parseCamt(fixture("camt054-qr-batch.xml"));

  it("reads the header and account (IBAN reduced to the last 4)", () => {
    expect(r.format).toBe("camt.054");
    expect(r.messageId).toBe("MSG-2026-11-17-0001");
    expect(r.accountLast4).toBe("9012");
    expect(r.from).toBe("2026-11-16");
    expect(r.to).toBe("2026-11-16");
  });

  it("splits a batch booking into one credit per transaction", () => {
    expect(r.credits).toHaveLength(2);
    const [qr, other] = r.credits;
    expect(qr).toMatchObject({
      bankRef: "T:ASR-TX-0001", amount: 1490, currency: "CHF", bookingDate: "2026-11-16", valueDate: "2026-11-16",
      reference: "210000000003139471430009017", referenceType: "QRR", debtorName: "João Testeiro", debtorIbanLast4: "2957",
    });
    expect(other).toMatchObject({ bankRef: "T:ASR-TX-0002", amount: 300, referenceType: "NON", reference: null, debtorName: "Anna Beispiel & Co" });
    expect(other.remittance).toContain("INV-2026-0042");
  });

  it("never keeps a full debtor IBAN", () => {
    expect(JSON.stringify(r)).not.toContain("CH9300762011623852957");
  });

  it("skips debits and pending entries", () => {
    expect(r.skipped).toBe(2);
  });
});

describe("camt.053 (statement, prefixed namespace, .04)", () => {
  const r = parseCamt(fixture("camt053-statement.xml"));
  it("finds a SCOR reference in the unstructured text and skips reversals", () => {
    expect(r.format).toBe("camt.053");
    expect(r.credits).toHaveLength(1);
    expect(r.credits[0]).toMatchObject({ amount: 120.5, currency: "EUR", reference: "RF18539007547034", referenceType: "SCOR", bookingDate: "2026-10-03" });
    expect(r.credits[0].bankRef.startsWith("H:")).toBe(true);
    expect(r.skipped).toBe(1);
    expect(r.accountLast4).toBe("8009");
  });
  it("derives the same hash key for the same transaction (idempotent re-import)", () => {
    expect(parseCamt(fixture("camt053-statement.xml")).credits[0].bankRef).toBe(r.credits[0].bankRef);
  });
});

describe("hardened XML: malicious input is rejected", () => {
  it("rejects an external entity (XXE)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document><BkToCstmrStmt>&x;</BkToCstmrStmt></Document>`;
    expect(code(() => parseCamt(xxe))).toBe("DTD_NOT_ALLOWED");
  });
  it("rejects entity expansion (billion laughs)", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><r>&lol2;</r>`;
    expect(code(() => parseXml(bomb))).toBe("DTD_NOT_ALLOWED");
  });
  it("rejects a DOCTYPE hidden in lower case or after a comment", () => {
    expect(code(() => parseXml(`<!-- x --><!doctype r><r/>`))).toBe("DTD_NOT_ALLOWED");
  });
  it("rejects undeclared named entities and bare ampersands", () => {
    expect(code(() => parseXml(`<r>&nbsp;</r>`))).toBe("ENTITY_NOT_ALLOWED");
    expect(code(() => parseXml(`<r>a & b</r>`))).toBe("MALFORMED");
    expect(code(() => parseXml(`<r>&#0;</r>`))).toBe("ENTITY_NOT_ALLOWED");
  });
  it("enforces size, depth and node limits", () => {
    expect(code(() => parseXml(`<r>${"x".repeat(200)}</r>`, { maxBytes: 100 }))).toBe("TOO_LARGE");
    expect(code(() => parseXml("<a>".repeat(80) + "</a>".repeat(80)))).toBe("TOO_DEEP");
    expect(code(() => parseXml(`<r>${"<i/>".repeat(50)}</r>`, { maxNodes: 10 }))).toBe("TOO_MANY_NODES");
  });
  it("rejects malformed documents", () => {
    expect(code(() => parseXml(`<a><b></a></b>`))).toBe("MALFORMED");
    expect(code(() => parseXml(`<a/><b/>`))).toBe("MALFORMED");
    expect(code(() => parseXml(``))).toBe("EMPTY");
    expect(code(() => parseXml(`<a x="1" y></a>`))).toBe("MALFORMED");
  });
  it("rejects other ISO messages and bad amounts", () => {
    expect(code(() => parseCamt(`<Document><BkToCstmrAcctRpt/></Document>`))).toBe("UNSUPPORTED_FORMAT");
    const bad = `<Document><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="CHF">1e9</Amt><CdtDbtInd>CRDT</CdtDbtInd></Ntry></Stmt></BkToCstmrStmt></Document>`;
    expect(code(() => parseCamt(bad))).toBe("INVALID_AMOUNT");
    expect(code(() => parseCamt(`<Document><BkToCstmrStmt><Stmt/></BkToCstmrStmt></Document>`))).toBe("NO_ENTRIES");
  });
  it("decodes CDATA and the predefined entities", () => {
    const n = parseXml(`<r a="x &quot;y&quot;"><![CDATA[<b>&amp;</b>]]> &lt;&#x41;&gt;</r>`);
    expect(n.attrs.a).toBe('x "y"');
    expect(n.text).toBe("<b>&amp;</b> <A>");
  });
});

describe("structured references", () => {
  it("validates QRR (mod 10 recursive) and SCOR (mod 97)", () => {
    expect(qrrValid("21 00000 00003 13947 14300 09017")).toBe(true);
    expect(qrrValid("210000000003139471430009018")).toBe(false);
    expect(scorValid("RF18 5390 0754 7034")).toBe(true);
    expect(scorValid("RF19539007547034")).toBe(false);
  });
  it("detects the type from the file hint or the shape", () => {
    expect(detectReference("210000000003139471430009017", null, null)).toEqual({ reference: "210000000003139471430009017", type: "QRR" });
    expect(detectReference("rf18 5390 0754 7034", "SCOR", null)).toEqual({ reference: "RF18539007547034", type: "SCOR" });
    expect(detectReference(null, null, "ref 21 00000 00003 13947 14300 09017 ok").type).toBe("QRR");
    expect(detectReference(null, null, "no reference here")).toEqual({ reference: null, type: "NON" });
  });
});
