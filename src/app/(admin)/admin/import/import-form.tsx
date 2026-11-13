"use client";

import * as React from "react";
import { Card, CardBody, Button, Label, Badge, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { inspectImport, previewImport, commitImport, type ImportResult, type InspectResult, type ImportKind } from "./actions";

/**
 * Three steps: read the file (CSV or .xlsx) and map its columns, dry run,
 * import. Changing the file, the kind or the mapping invalidates the dry run.
 */
export function ImportForm() {
  const t = useT();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [kind, setKind] = React.useState<ImportKind>("families");
  const [inspect, setInspect] = React.useState<Extract<InspectResult, { ok: true }> | null>(null);
  const [mapping, setMapping] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<"inspect" | "preview" | "commit" | null>(null);

  const reset = () => {
    setResult(null);
    setError(null);
  };

  function formData(): FormData | null {
    if (!formRef.current) return null;
    const fd = new FormData(formRef.current);
    fd.set("kind", kind);
    if (inspect) fd.set("mapping", JSON.stringify(mapping));
    return fd;
  }

  async function runInspect() {
    const fd = formData();
    if (!fd) return;
    fd.delete("mapping");
    setPending("inspect");
    reset();
    const r = await inspectImport(fd);
    setPending(null);
    if (!r.ok) {
      setInspect(null);
      setError(r.error);
      return;
    }
    setInspect(r);
    setMapping(r.mapping);
  }

  async function run(step: "preview" | "commit") {
    const fd = formData();
    if (!fd) return;
    if (step === "commit" && !window.confirm(t("forms.import.confirm"))) return;
    setPending(step);
    setError(null);
    const res = step === "preview" ? await previewImport(fd) : await commitImport(fd);
    setPending(null);
    setResult(res);
  }

  const total = result?.totals ? Object.entries(result.totals).filter(([k]) => k !== "rows" && k !== "skipped" && k !== "athletesSkipped" && k !== "familiesExisting").reduce((n, [, v]) => n + v, 0) : 0;
  const canCommit = result?.mode === "dry-run" && result.ok && total > 0;
  const mappedCount = mapping.filter(Boolean).length;

  return (
    <div className="space-y-6">
      <Card className="max-w-3xl">
        <CardBody>
          <form ref={formRef} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <fieldset className="flex flex-wrap gap-4">
              <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("forms.import.kindLabel")}</legend>
              {(["families", "registrations"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-ink">
                  <input type="radio" name="kindPick" checked={kind === k} onChange={() => { setKind(k); setInspect(null); reset(); }} className="h-4 w-4 accent-[var(--brand-primary)]" />
                  {t(k === "families" ? "forms.import.kindFamilies" : "forms.import.kindRegistrations")}
                </label>
              ))}
            </fieldset>
            <div>
              <Label htmlFor="file">{t("forms.import.fileLabel")}</Label>
              <input
                id="file" name="file" type="file" required
                accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={() => { setInspect(null); reset(); }}
                className="block w-full text-sm text-ink-2 file:mr-3 file:rounded file:border file:border-line file:bg-surface-elevated file:px-3 file:py-2 file:text-ink"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="dateOrder">{t("forms.import.dateOrder")}</Label>
                <Select id="dateOrder" name="dateOrder" defaultValue="DMY" onChange={reset}>
                  <option value="DMY">{t("forms.import.dateDmy")}</option>
                  <option value="MDY">{t("forms.import.dateMdy")}</option>
                </Select>
              </div>
              {kind === "families" && (
                <label className="flex items-center gap-2 self-end text-sm text-ink-2">
                  <input type="checkbox" name="sendInvites" className="h-4 w-4" />
                  {t("forms.import.sendInvites")}
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={pending !== null} onClick={runInspect}>
                {pending === "inspect" ? t("forms.import.reading") : t("forms.import.stepRead")}
              </Button>
              <Button type="button" variant="secondary" disabled={!inspect || mappedCount === 0 || pending !== null} onClick={() => run("preview")}>
                {pending === "preview" ? t("forms.import.checking") : t("forms.import.stepDryRun")}
              </Button>
              <Button type="button" disabled={!canCommit || pending !== null} onClick={() => run("commit")}>
                {pending === "commit" ? t("forms.import.importing") : t("forms.import.stepImport")}
              </Button>
            </div>
            <p className="text-xs text-ink-3">{t("forms.import.dryRunHint")}</p>
            {error && <p className="text-sm text-danger">{error}</p>}
          </form>
        </CardBody>
      </Card>

      {inspect && (
        <Card className="max-w-5xl">
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">{t("forms.import.mappingTitle")}</h2>
              <Badge tone="neutral">{inspect.format === "xlsx" ? t("forms.import.formatXlsx") : t("forms.import.formatCsv")}</Badge>
              <span className="text-xs text-ink-3">{t("forms.import.rowsFound", { count: inspect.rows })}</span>
            </div>
            <p className="text-xs text-ink-3">{t("forms.import.mappingHint")}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-3">
                    <th className="py-2 pr-3">{t("forms.import.sourceColumn")}</th>
                    <th className="py-2 pr-3">{t("forms.import.sample")}</th>
                    <th className="py-2">{t("forms.import.targetColumn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inspect.headers.map((h, i) => (
                    <tr key={i} className="border-b border-line/60">
                      <td className="py-2 pr-3 font-mono text-xs text-ink">{h}</td>
                      <td className="max-w-xs truncate py-2 pr-3 text-xs text-ink-2">{inspect.sample.map((r) => r[i]).filter(Boolean).slice(0, 3).join(" · ")}</td>
                      <td className="py-2">
                        <Select aria-label={h} value={mapping[i] ?? ""} onChange={(e) => { const v = e.target.value; setMapping((m) => m.map((x, j) => (j === i ? v : x))); setResult(null); }}>
                          <option value="">{t("forms.import.ignore")}</option>
                          {inspect.targets.map((col) => (
                            <option key={col} value={col} disabled={mapping.includes(col) && mapping[i] !== col}>{col}</option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {result && <ResultView result={result} />}
    </div>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  const t = useT();
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={result.ok ? "success" : "danger"}>
            {result.mode === "dry-run" ? (result.ok ? t("forms.import.dryRunPassed") : t("forms.import.dryRunFailed")) : result.ok ? t("forms.import.imported") : t("forms.import.notImported")}
          </Badge>
          {result.error && <span className="text-sm text-danger">{result.error}</span>}
        </div>

        {result.committed && (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {Object.entries(result.committed).map(([k, v]) => <Stat key={k} label={t.dynamic(`forms.import.totals.${k}`, undefined, k)} value={v} />)}
          </div>
        )}

        {result.totals && !result.committed && (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            {Object.entries(result.totals).map(([k, v]) => <Stat key={k} label={t.dynamic(`forms.import.totals.${k}`, undefined, k)} value={v} />)}
          </div>
        )}

        <IssueList title={t("forms.import.errorsTitle")} tone="text-danger" issues={result.errors} />
        <IssueList title={t("forms.import.warningsTitle")} tone="text-warning" issues={result.warnings} />

        {result.preview && result.preview.length > 0 && result.mode === "dry-run" && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("forms.import.previewTitle", { count: result.preview.length })}</h3>
            <ul className="divide-y divide-line rounded border border-line text-sm">
              {result.preview.map((f, i) => (
                <li key={i} className="p-3">
                  <div className="font-medium text-ink">{f.title} {f.badge && <Badge tone="neutral">{f.badge}</Badge>}</div>
                  {f.lines.map((l, j) => <div key={j} className={j === 0 ? "text-ink-2" : "text-xs text-ink-3"}>{l}</div>)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-line p-2">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="tnum text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}

function IssueList({ title, tone, issues }: { title: string; tone: string; issues: { row: number; field?: string; message: string }[] }) {
  const t = useT();
  if (issues.length === 0) return null;
  return (
    <div>
      <h3 className={`mb-1 text-sm font-semibold ${tone}`}>{title} ({issues.length})</h3>
      <ul className="max-h-64 space-y-0.5 overflow-auto text-sm text-ink-2">
        {issues.map((i, k) => (
          <li key={k}>
            {i.row > 0 ? <span className="tnum text-ink-3">{t("forms.import.line", { row: i.row })}{i.field ? ` · ${i.field}` : ""}: </span> : null}
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
