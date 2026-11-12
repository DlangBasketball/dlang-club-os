"use client";

import * as React from "react";
import { Card, CardBody, Button, Label, Badge } from "@/components/ui";
import { previewImport, commitImport, type ImportResult } from "./actions";

export function ImportForm() {
  const formRef = React.useRef<HTMLFormElement>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [pending, setPending] = React.useState<"preview" | "commit" | null>(null);
  const [previewedName, setPreviewedName] = React.useState<string | null>(null);

  async function run(kind: "preview" | "commit") {
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const file = fd.get("file");
    if (kind === "commit") {
      const n = result?.totals;
      const ok = window.confirm(
        `Import ${n?.athletes ?? 0} athletes into ${(n?.familiesNew ?? 0) + (n?.familiesExisting ?? 0)} families and create ${n?.invitations ?? 0} guardian invitations?`,
      );
      if (!ok) return;
    }
    setPending(kind);
    const res = kind === "preview" ? await previewImport(fd) : await commitImport(fd);
    setPending(null);
    setResult(res);
    if (kind === "preview") setPreviewedName(file instanceof File ? file.name : null);
  }

  const canCommit = result?.mode === "dry-run" && result.ok && (result.totals?.athletes ?? 0) + (result.totals?.invitations ?? 0) > 0;

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <CardBody>
          <form ref={formRef} className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <div>
              <Label htmlFor="file">CSV file</Label>
              <input
                id="file"
                name="file"
                type="file"
                accept=".csv,text/csv,text/plain"
                required
                onChange={() => {
                  setResult(null);
                  setPreviewedName(null);
                }}
                className="block w-full text-sm text-ink-2 file:mr-3 file:rounded file:border file:border-line file:bg-surface-elevated file:px-3 file:py-2 file:text-ink"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="dateOrder">Dates written as dd/mm/yyyy or mm/dd/yyyy?</Label>
                <select id="dateOrder" name="dateOrder" defaultValue="DMY" className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
                  <option value="DMY">Day first — 14/03/2013 (CH, EU)</option>
                  <option value="MDY">Month first — 03/14/2013 (US)</option>
                </select>
              </div>
              <label className="flex items-center gap-2 self-end text-sm text-ink-2">
                <input type="checkbox" name="sendInvites" className="h-4 w-4" />
                Email the guardian invitations immediately
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={pending !== null} onClick={() => run("preview")}>
                {pending === "preview" ? "Checking…" : "1 · Dry run (check only)"}
              </Button>
              <Button type="button" disabled={!canCommit || pending !== null} onClick={() => run("commit")}>
                {pending === "commit" ? "Importing…" : "2 · Import"}
              </Button>
            </div>
            <p className="text-xs text-ink-3">
              The dry run writes nothing. Import is only enabled after a clean dry run{previewedName ? ` of ${previewedName}` : ""}; the file is validated again on the server before anything is saved.
            </p>
          </form>
        </CardBody>
      </Card>

      {result && <ResultView result={result} />}
    </div>
  );
}

function ResultView({ result }: { result: ImportResult }) {
  const t = result.totals;
  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={result.ok ? "success" : "danger"}>
            {result.mode === "dry-run" ? (result.ok ? "Dry run passed" : "Dry run found errors") : result.ok ? "Imported" : "Not imported"}
          </Badge>
          {result.error && <span className="text-sm text-danger">{result.error}</span>}
        </div>

        {result.committed && (
          <p className="text-sm text-ink">
            Created {result.committed.families} families, {result.committed.athletes} athletes and {result.committed.invitations} guardian invitations
            {result.committed.invitesSent + result.committed.inviteFailures > 0 &&
              ` · ${result.committed.invitesSent} invite emails sent${result.committed.inviteFailures ? `, ${result.committed.inviteFailures} failed (resend from Invitations)` : ""}`}
            .
          </p>
        )}

        {t && (
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-6">
            <Stat label="Rows" value={t.rows} />
            <Stat label="New families" value={t.familiesNew} />
            <Stat label="Existing families" value={t.familiesExisting} />
            <Stat label="Athletes" value={t.athletes} />
            <Stat label="Already in club" value={t.athletesSkipped} />
            <Stat label="Invitations" value={t.invitations} />
          </div>
        )}

        <IssueList title="Errors (must fix)" tone="text-danger" issues={result.errors} />
        <IssueList title="Warnings" tone="text-warning" issues={result.warnings} />

        {result.preview && result.preview.length > 0 && result.mode === "dry-run" && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Preview (first {result.preview.length} families)</h3>
            <ul className="divide-y divide-line rounded border border-line text-sm">
              {result.preview.map((f, i) => (
                <li key={i} className="p-3">
                  <div className="font-medium text-ink">
                    {f.name} {f.existing && <Badge tone="neutral">existing family</Badge>}
                  </div>
                  <div className="text-ink-2">{f.athletes.join(" · ") || "No new athletes"}</div>
                  {f.guardians.length > 0 && <div className="text-xs text-ink-3">Invite: {f.guardians.join(", ")}</div>}
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
  if (issues.length === 0) return null;
  return (
    <div>
      <h3 className={`mb-1 text-sm font-semibold ${tone}`}>
        {title} ({issues.length})
      </h3>
      <ul className="max-h-64 space-y-0.5 overflow-auto text-sm text-ink-2">
        {issues.map((i, k) => (
          <li key={k}>
            {i.row > 0 ? <span className="tnum text-ink-3">Line {i.row}{i.field ? ` · ${i.field}` : ""}: </span> : null}
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
