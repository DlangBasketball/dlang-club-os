import { createHash } from "node:crypto";

/**
 * Re-import safety (pure, server). The importer records a hash of what it
 * wrote; on the next run a row is overwritten only while its current content
 * still has that hash (nobody edited it since), unless the admin ticked
 * "overwrite my edits".
 */

/** JSON with sorted keys and undefined dropped (jsonb round-trips change key order). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stableStringify(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

export function contentHash(content: unknown): string {
  return createHash("sha256").update(stableStringify(content)).digest("hex");
}

/** Grace period for rows imported before hashes existed: later updates within it are the import itself. */
const LEGACY_GRACE_MS = 10 * 60 * 1000;

/**
 * Was the row changed after the last import?
 *   - with a recorded hash: the current content's hash differs;
 *   - without one (imported by an older version): it was updated well after
 *     the import time.
 */
export function editedSinceImport(row: { content: unknown; updatedAt: string | null }, imported: { hash: string | null; importedAt: string | null }): boolean {
  if (imported.hash) return contentHash(row.content) !== imported.hash;
  const u = row.updatedAt ? Date.parse(row.updatedAt) : NaN;
  const i = imported.importedAt ? Date.parse(imported.importedAt) : NaN;
  if (Number.isNaN(u) || Number.isNaN(i)) return false;
  return u - i > LEGACY_GRACE_MS;
}

/** Decide what a re-import does with one existing row. */
export function rerunAction(edited: boolean, overwriteEdits: boolean): "update" | "keep" {
  return edited && !overwriteEdits ? "keep" : "update";
}
