/**
 * Column mapping for spreadsheet imports (pure). The admin sees the file's
 * own headers next to a suggested target column and can change each one;
 * the server re-applies the mapping before validating (the client's preview
 * is never trusted).
 */
import { normaliseHeader } from "./families";

export const IGNORE = "";

/** Suggested target for each source header (`""` = ignore the column). */
export function suggestMapping(headers: string[], targets: readonly string[], aliases: Record<string, string> = {}): string[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const base = normaliseHeader(h);
    const n = aliases[base] ?? base;
    if (targets.includes(n) && !used.has(n)) {
      used.add(n);
      return n;
    }
    return IGNORE;
  });
}

export type MappingCheck = { ok: true; mapping: string[] } | { ok: false; key: "mappingInvalid" | "mappingDuplicate"; values?: Record<string, string> };

/** Validate a client-supplied mapping against the file's headers and the targets. */
export function checkMapping(raw: unknown, headerCount: number, targets: readonly string[]): MappingCheck {
  if (!Array.isArray(raw) || raw.length !== headerCount || raw.some((v) => typeof v !== "string")) return { ok: false, key: "mappingInvalid" };
  const mapping = raw as string[];
  const seen = new Set<string>();
  for (const m of mapping) {
    if (m === IGNORE) continue;
    if (!targets.includes(m)) return { ok: false, key: "mappingInvalid" };
    if (seen.has(m)) return { ok: false, key: "mappingDuplicate", values: { column: m } };
    seen.add(m);
  }
  return { ok: true, mapping };
}

/** Rewrite the header row to target names and drop ignored columns. */
export function applyMapping(table: string[][], mapping: string[]): string[][] {
  if (table.length === 0) return table;
  const keep = mapping.map((m, i) => (m === IGNORE ? -1 : i)).filter((i) => i >= 0);
  return [keep.map((i) => mapping[i]), ...table.slice(1).map((row) => keep.map((i) => row[i] ?? ""))];
}
