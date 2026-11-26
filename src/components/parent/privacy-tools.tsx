"use client";
import * as React from "react";
import { Download, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button } from "@/components/ui";
import { exportMyData, requestDeletion } from "@/lib/actions/privacy";

export function PrivacyTools() {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const [showDel, setShowDel] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function exportData() {
    setBusy("export"); setMsg(null);
    const res = await exportMyData();
    setBusy(null);
    if (!res.ok || !res.data) { setMsg({ ok: false, text: res.ok ? "No data" : res.error }); return; }
    const blob = new Blob([res.data.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  }
  async function submitDeletion() {
    setBusy("delete"); setMsg(null);
    const res = await requestDeletion(reason);
    setBusy(null);
    setMsg({ ok: res.ok, text: res.ok ? "Request submitted — an administrator will review it." : res.error });
    if (res.ok) { setShowDel(false); setReason(""); }
  }
  return (
    <Card>
      <CardHeader><CardTitle>Privacy &amp; your data</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        <div>
          <p className="text-sm text-ink-2">Download a copy of all data we hold about your family (FADP/GDPR data portability).</p>
          <Button className="mt-2" variant="secondary" size="sm" onClick={exportData} disabled={busy !== null}><Download className="h-4 w-4" /> {busy === "export" ? "Preparing…" : "Download my data"}</Button>
        </div>
        <div className="border-t border-line-soft pt-4">
          <p className="text-sm text-ink-2">Request erasure of your family&apos;s personal data. Financial records are retained as required by law; personal details are anonymised.</p>
          {!showDel ? (
            <Button className="mt-2" variant="ghost" size="sm" onClick={() => setShowDel(true)}><Trash2 className="h-4 w-4 text-danger" /> Request data deletion</Button>
          ) : (
            <div className="mt-2 space-y-2">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason (optional)" className="w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink" />
              <div className="flex gap-2">
                <Button variant="danger" size="sm" onClick={submitDeletion} disabled={busy !== null}>{busy === "delete" ? "Submitting…" : "Submit request"}</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowDel(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
        {msg && <p className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
