import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { PLATFORM_NAME } from "@/lib/brand";

export type QrBillSection = {
  payload: string; // Swiss Payment Code (SPC) string
  iban: string;
  reference: string; // formatted for display
  creditorLines: string[];
  debtorLines: string[];
  amount: number;
  currency: string;
};

export type InvoicePdfData = {
  number: string;
  issuedAt: string;
  dueDate: string | null;
  status: string;
  familyName: string;
  contactName: string | null;
  contactEmail: string | null;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  total: number;
  paid: number;
  balance: number;
  qrBill?: QrBillSection | null;
  /** Issuing club (tenant) identity and the invoice currency. */
  club: { name: string; city?: string | null; country?: string | null };
  currency: string;
  /** Tenant brand colour (#RRGGBB); default: platform red. */
  brandColor?: string | null;
  /** White-label platform name printed under the club name. */
  platformName?: string | null;
  /** Footer line on how to pay, built from the club's enabled methods (paymentFooterText). */
  paymentNote?: string | null;
};

const DEFAULT_BRAND = rgb(0.855, 0.149, 0.153); // #DA2627

function hexToRgb(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex ?? "");
  if (!m) return DEFAULT_BRAND;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Letters the standard fonts lack, mapped to their closest Latin-1 form. */
const FOLD: Record<string, string> = {
  "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "Ħ": "H", "ħ": "h", "ı": "i", "Ŀ": "L", "ŀ": "l",
  "Ŧ": "T", "ŧ": "t", "ĸ": "k", "Ŋ": "N", "ŋ": "n", "Ə": "E", "ə": "e", "ẞ": "SS",
  "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"', "\u2013": "-", "\u2014": "-", "\u00A0": " ", "\u202F": " ",
};

/**
 * Make text drawable with a WinAnsi standard font: keeps every character the
 * font can encode, folds the rest to their base letter (Č -> C, ő -> o,
 * Ł -> L, Nguyễn -> Nguyen) and replaces anything left with "?". pdf-lib's
 * drawText throws on unencodable characters, which used to 500 the invoice.
 */
export function toWinAnsi(input: string, supported: ReadonlySet<number>): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (supported.has(cp)) { out += ch; continue; }
    if (FOLD[ch] !== undefined) { out += FOLD[ch]; continue; }
    const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += base && [...base].every((c) => supported.has(c.codePointAt(0)!)) ? base : "?";
  }
  return out;
}

/** "How to pay" footer from the methods the payer can actually use (no TWINT outside CH, etc.). */
export function paymentFooterText(methods: { key: string; label: string; via: "stripe" | "offline" }[]): string {
  const online = Array.from(new Set(methods.filter((m) => m.via === "stripe" && m.key !== "manual").map((m) => m.label)));
  const bank = methods.some((m) => m.via === "offline" && (m.key === "bank_transfer" || m.key === "qr_bill"));
  if (online.length && bank) return `Pay online (${online.join(", ")}) via your parent account, or by bank transfer to the club account.`;
  if (online.length) return `Pay online (${online.join(", ")}) via your parent account.`;
  if (bank) return "Pay by bank transfer to the club account.";
  return "Please contact the club to arrange payment.";
}
const INK = rgb(0.1, 0.1, 0.1);
const MUTE = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.85, 0.85, 0.85);

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export async function buildInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const chf = (n: number) => `${d.currency} ${n.toFixed(2)}`;
  const place = [d.club.city, d.club.country].filter(Boolean).join(" · ");
  const initial = (d.club.name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "C").toUpperCase();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const MAROON = hexToRgb(d.brandColor);
  const platform = d.platformName?.trim() || PLATFORM_NAME;
  const { width, height } = page.getSize();
  const M = 50;
  let y = height - M;

  const text = (p: PDFPage, s: string, x: number, yy: number, f: PDFFont, size: number, color = INK) =>
    p.drawText(toWinAnsi(s, charset), { x, y: yy, size, font: f, color });
  const right = (s: string, xRight: number, yy: number, f: PDFFont, size: number, color = INK) =>
    text(page, s, xRight - f.widthOfTextAtSize(toWinAnsi(s, charset), size), yy, f, size, color);

  // Header
  page.drawRectangle({ x: M, y: y - 6, width: 30, height: 30, color: MAROON });
  text(page, initial, M + 9, y + 1, bold, 20, rgb(1, 1, 1));
  text(page, d.club.name, M + 42, y + 8, bold, 15);
  text(page, place ? `${platform} · ${place}` : platform, M + 42, y - 5, font, 9, MUTE);
  right("INVOICE", width - M, y + 6, bold, 22, MAROON);
  right(d.number, width - M, y - 10, font, 11, MUTE);
  y -= 54;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: LINE });
  y -= 28;

  // Bill-to + meta
  text(page, "BILL TO", M, y, bold, 9, MUTE);
  text(page, "DETAILS", width / 2 + 20, y, bold, 9, MUTE);
  y -= 16;
  text(page, d.familyName, M, y, bold, 11);
  text(page, "Issued", width / 2 + 20, y, font, 10, MUTE);
  right(fmtDate(d.issuedAt), width - M, y, font, 10);
  y -= 15;
  if (d.contactName) { text(page, d.contactName, M, y, font, 10, MUTE); }
  text(page, "Due", width / 2 + 20, y, font, 10, MUTE);
  right(fmtDate(d.dueDate), width - M, y, font, 10);
  y -= 15;
  if (d.contactEmail) { text(page, d.contactEmail, M, y, font, 10, MUTE); }
  text(page, "Status", width / 2 + 20, y, font, 10, MUTE);
  right(d.status.replace("_", " ").toUpperCase(), width - M, y, bold, 10, MAROON);
  y -= 34;

  // Items table header
  page.drawRectangle({ x: M, y: y - 4, width: width - 2 * M, height: 22, color: rgb(0.96, 0.96, 0.96) });
  text(page, "DESCRIPTION", M + 8, y + 3, bold, 9, MUTE);
  right("QTY", M + 330, y + 3, bold, 9, MUTE);
  right("UNIT", M + 415, y + 3, bold, 9, MUTE);
  right("AMOUNT", width - M - 8, y + 3, bold, 9, MUTE);
  y -= 26;

  for (const it of d.items) {
    text(page, it.description.slice(0, 60), M + 8, y, font, 10);
    right(String(it.quantity), M + 330, y, font, 10);
    right(chf(it.unitPrice), M + 415, y, font, 10);
    right(chf(it.amount), width - M - 8, y, font, 10);
    y -= 20;
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: width - M, y: y + 6 }, thickness: 0.5, color: LINE });
  }

  // Totals
  y -= 12;
  const totalsX = width - M - 200;
  const totalRow = (label: string, value: string, f = font, color = INK) => {
    text(page, label, totalsX, y, f, 10, color);
    right(value, width - M - 8, y, f, 10, color);
    y -= 18;
  };
  totalRow("Total", chf(d.total), bold);
  if (d.paid > 0) totalRow("Paid", `- ${chf(d.paid)}`, font, rgb(0.18, 0.62, 0.33));
  page.drawLine({ start: { x: totalsX, y: y + 8 }, end: { x: width - M, y: y + 8 }, thickness: 1, color: LINE });
  y -= 4;
  text(page, "Balance due", totalsX, y, bold, 12, MAROON);
  right(chf(d.balance), width - M - 8, y, bold, 12, MAROON);

  // Footer
  if (d.paymentNote) text(page, d.paymentNote, M, M + 16, font, 9, MUTE);
  text(page, [d.club.name, place].filter(Boolean).join(" · "), M, M, font, 9, MUTE);

  // ----- Swiss QR-bill payment part (scaffold; final layout finalised later) -----
  if (d.qrBill) {
    const partTop = 300;
    page.drawLine({ start: { x: M, y: partTop }, end: { x: width - M, y: partTop }, thickness: 0.5, color: LINE, dashArray: [3, 3] });
    text(page, "Payment part — Swiss QR-bill", M, partTop - 14, font, 8, MUTE);

    // QR code
    const qrPng = await QRCode.toBuffer(d.qrBill.payload, { errorCorrectionLevel: "M", margin: 0, width: 360, type: "png" });
    const qrImg = await pdf.embedPng(qrPng);
    const qrSize = 130;
    const qrX = M;
    const qrY = partTop - 28 - qrSize;
    page.drawImage(qrImg, { x: qrX, y: qrY, width: qrSize, height: qrSize });

    // Swiss cross overlay (centre)
    const cc = qrX + qrSize / 2;
    const cm = qrY + qrSize / 2;
    const sq = 16;
    page.drawRectangle({ x: cc - sq / 2, y: cm - sq / 2, width: sq, height: sq, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: cc - sq / 2 + 1.5, y: cm - sq / 2 + 1.5, width: sq - 3, height: sq - 3, color: rgb(0, 0, 0) });
    page.drawRectangle({ x: cc - 4.5, y: cm - 1.5, width: 9, height: 3, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: cc - 1.5, y: cm - 4.5, width: 3, height: 9, color: rgb(1, 1, 1) });

    // Details column
    const dx = qrX + qrSize + 26;
    let dy = partTop - 38;
    const detail = (label: string, lines: string[]) => {
      text(page, label, dx, dy, bold, 8, MUTE); dy -= 12;
      for (const ln of lines) { if (ln) { text(page, ln, dx, dy, font, 9); dy -= 12; } }
      dy -= 4;
    };
    detail("Account / Payable to", [d.qrBill.iban, ...d.qrBill.creditorLines]);
    if (d.qrBill.reference) detail("Reference", [d.qrBill.reference]);
    if (d.qrBill.debtorLines.some(Boolean)) detail("Payable by", d.qrBill.debtorLines);

    // Amount strip
    text(page, "Currency", dx, dy, bold, 8, MUTE);
    text(page, "Amount", dx + 70, dy, bold, 8, MUTE);
    dy -= 12;
    text(page, d.qrBill.currency, dx, dy, font, 10);
    text(page, d.qrBill.amount.toFixed(2), dx + 70, dy, font, 10);
  }

  return pdf.save();
}
