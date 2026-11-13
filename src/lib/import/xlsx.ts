import ExcelJS from "exceljs";

/**
 * .xlsx -> string table (first worksheet that has data). No I/O. Dates
 * become YYYY-MM-DD, formulas their cached result, rich text its plain
 * text; empty rows are dropped.
 */
/** Below the 3 MB server-action body limit (next.config.mjs). */
export const XLSX_MAX_BYTES = 2_900_000;

/** "PK\x03\x04": every .xlsx is a zip archive. */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Math.round(value * 1e6) / 1e6);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((r) => r.text).join("").trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
    if (typeof v.text === "string") return v.text.trim();
  }
  return "";
}

export async function parseXlsx(data: ArrayBuffer | Uint8Array, maxRows = 5000): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  // exceljs is typed for Node Buffers; a Buffer view over the same bytes.
  await wb.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ArrayBuffer);
  const sheet = wb.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) return [];
  const width = sheet.columnCount;
  const rows: string[][] = [];
  const last = Math.min(sheet.rowCount, maxRows + 1);
  for (let r = 1; r <= last; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    rows.push(cells);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}
