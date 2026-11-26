import "server-only";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";
import { toWinAnsi } from "@/lib/invoice-pdf";

/**
 * Printable member card (credit-card size, 85.6 x 54 mm) with the athlete's
 * QR code. The QR code holds only the opaque token; the printed name is for
 * the family's own use. Labels arrive translated in the club's locale.
 */
export type MemberCardPdf = {
  clubName: string;
  athleteName: string;
  token: string;
  brandColor: string | null;
  labels: { title: string; hint: string };
};

function hexToRgb(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = m ? parseInt(m[1], 16) : 0x333333;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const MM = 72 / 25.4;

export async function buildMemberCardPdf(d: MemberCardPdf): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const w = 85.6 * MM;
  const h = 54 * MM;
  const page = pdf.addPage([w, h]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const brand = hexToRgb(d.brandColor);
  const ink = rgb(0.1, 0.1, 0.1);
  const mute = rgb(0.4, 0.4, 0.4);

  page.drawRectangle({ x: 0, y: h - 12 * MM, width: w, height: 12 * MM, color: brand });
  page.drawText(toWinAnsi(d.clubName, charset).slice(0, 40), { x: 4 * MM, y: h - 8 * MM, size: 10, font: bold, color: rgb(1, 1, 1) });
  page.drawText(toWinAnsi(d.labels.title, charset).slice(0, 40), { x: 4 * MM, y: h - 18 * MM, size: 7, font, color: mute });
  page.drawText(toWinAnsi(d.athleteName, charset).slice(0, 32), { x: 4 * MM, y: h - 24 * MM, size: 11, font: bold, color: ink });
  const hint = toWinAnsi(d.labels.hint, charset);
  const words = hint.split(/\s+/);
  let line = "";
  let y = h - 32 * MM;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, 6) > 42 * MM && line) {
      page.drawText(line, { x: 4 * MM, y, size: 6, font, color: mute });
      y -= 3 * MM;
      line = word;
    } else line = next;
  }
  if (line) page.drawText(line, { x: 4 * MM, y, size: 6, font, color: mute });

  const png = await QRCode.toBuffer(d.token, { type: "png", errorCorrectionLevel: "M", margin: 1, width: 300 });
  const img = await pdf.embedPng(png);
  const size = 34 * MM;
  page.drawImage(img, { x: w - size - 3 * MM, y: 3 * MM, width: size, height: size });
  return pdf.save();
}
