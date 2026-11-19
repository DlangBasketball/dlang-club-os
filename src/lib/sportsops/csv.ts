export type CsvCell = string | number | boolean | null | undefined;

/** RFC-4180 CSV. Neutralises spreadsheet formula injection (=, +, -, @). */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const esc = (v: CsvCell) => {
    let s = v == null ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}
