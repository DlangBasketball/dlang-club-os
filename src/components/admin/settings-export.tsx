"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button } from "@/components/ui";
import { exportClubData } from "@/lib/actions/settings";

export function ExportTool() {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const res = await exportClubData();
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    const blob = new Blob([res.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `dlang-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Export data</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-3">Download a JSON export of the club&apos;s configuration and record counts (FADP/GDPR data-portability).</p>
        <div className="flex items-center gap-3"><Button onClick={go} disabled={busy}><Download className="h-4 w-4" /> {busy ? "Preparing…" : "Export JSON"}</Button>{err && <span className="text-sm text-danger">{err}</span>}</div>
      </CardBody>
    </Card>
  );
}
