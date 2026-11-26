import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { toWinAnsi } from "@/lib/invoice-pdf";

/**
 * Plain A4 document PDF used for form submissions and signed contracts.
 * All strings come in already translated / rendered; this module only lays
 * them out (wrapping, pagination, signature image).
 */
export type PdfBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "row"; label: string; value: string };

export type DocumentPdfInput = {
  title: string;
  subtitle?: string;
  meta: { label: string; value: string }[];
  blocks: PdfBlock[];
  signature?: { heading: string; lines: string[]; png?: Uint8Array | null };
  footer: string;
};

const A4: [number, number] = [595.28, 841.89];
const M = 50;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const cand = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(cand, size) <= maxWidth) {
        line = cand;
        continue;
      }
      if (line) out.push(line);
      // A single word longer than the line is hard-broken.
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export async function buildDocumentPdf(d: DocumentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(font.getCharacterSet());
  const safe = (s: string) => toWinAnsi(s, charset);
  pdf.setTitle(safe(d.title));

  let page: PDFPage = pdf.addPage(A4);
  const width = A4[0] - 2 * M;
  let y = A4[1] - M;
  const ensure = (h: number) => {
    if (y - h < M + 30) {
      page = pdf.addPage(A4);
      y = A4[1] - M;
    }
  };
  const write = (text: string, f: PDFFont, size: number, color = INK, indent = 0) => {
    for (const line of wrapText(safe(text), f, size, width - indent)) {
      ensure(size + 4);
      page.drawText(line, { x: M + indent, y: y - size, size, font: f, color });
      y -= size + 4;
    }
  };

  write(d.title, bold, 18);
  if (d.subtitle) write(d.subtitle, font, 11, MUTED);
  y -= 6;
  for (const m of d.meta) write(`${m.label}: ${m.value}`, font, 9, MUTED);
  y -= 10;

  for (const b of d.blocks) {
    if (b.kind === "heading") {
      y -= 6;
      write(b.text, bold, 12);
      y -= 2;
    } else if (b.kind === "paragraph") {
      write(b.text, font, 10);
      y -= 4;
    } else {
      write(b.label, bold, 9, MUTED);
      write(b.value || "-", font, 10, INK, 8);
      y -= 4;
    }
  }

  if (d.signature) {
    y -= 10;
    write(d.signature.heading, bold, 12);
    for (const l of d.signature.lines) write(l, font, 10);
    if (d.signature.png && d.signature.png.length) {
      let img: PDFImage | null = null;
      try {
        img = await pdf.embedPng(d.signature.png);
      } catch {
        img = null;
      }
      if (img) {
        const scale = Math.min(220 / img.width, 80 / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ensure(h + 8);
        page.drawImage(img, { x: M, y: y - h, width: w, height: h });
        y -= h + 8;
      }
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(safe(`${d.footer} · ${i + 1}/${pages.length}`), { x: M, y: M - 20, size: 8, font, color: MUTED });
  });
  return pdf.save();
}
