/**
 * "My family's data" export: the readable HTML summary that goes next to the
 * machine-readable JSON (GDPR Art. 15/20, nFADP Art. 25). Pure; all text is
 * escaped. Labels come from the caller's translator; values are shown as
 * stored (dates/numbers formatted with the caller's formatter).
 */
export type ExportSection = { key: string; title: string; rows: Record<string, unknown>[] };

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function cell(v: unknown, fmtDate: (s: string) => string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string" && ISO.test(v)) return escapeHtml(fmtDate(v));
  if (typeof v === "object") return `<code>${escapeHtml(JSON.stringify(v))}</code>`;
  return escapeHtml(v);
}

/** Columns never worth showing in the readable summary (still in the JSON). */
const HIDDEN = new Set(["org_id", "html", "storage_path", "token_hash", "auth_secret", "p256dh"]);

export function buildExportHtml(opts: {
  title: string;
  intro: string;
  generatedLabel: string;
  generatedAt: string;
  emptyLabel: string;
  sections: ExportSection[];
  lang: string;
  fmtDate: (iso: string) => string;
}): string {
  const body = opts.sections
    .map((s) => {
      if (!s.rows.length) return `<section><h2>${escapeHtml(s.title)}</h2><p class="muted">${escapeHtml(opts.emptyLabel)}</p></section>`;
      const cols = Array.from(new Set(s.rows.flatMap((r) => Object.keys(r)))).filter((c) => !HIDDEN.has(c));
      const head = cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
      const rows = s.rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(r[c], opts.fmtDate)}</td>`).join("")}</tr>`).join("");
      return `<section><h2>${escapeHtml(s.title)} (${s.rows.length})</h2><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="${escapeHtml(opts.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>
:root{--bg:#ffffff;--text:#111111;--muted:#555555;--line:#dddddd}
@media (prefers-color-scheme: dark){:root{--bg:#121212;--text:#f1f1f1;--muted:#aaaaaa;--line:#333333}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}
.muted{color:var(--muted)}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top}
code{font-size:11.5px;word-break:break-all}
</style></head><body>
<h1>${escapeHtml(opts.title)}</h1>
<p class="muted">${escapeHtml(opts.generatedLabel)}: ${escapeHtml(opts.fmtDate(opts.generatedAt))}</p>
<p>${escapeHtml(opts.intro)}</p>
${body}
</body></html>`;
}
