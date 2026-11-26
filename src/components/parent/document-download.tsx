"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { getDocumentUrl } from "@/lib/actions/documents";

export function DocumentDownload({ id }: { id: string }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await getDocumentUrl(id);
    setBusy(false);
    if (r.ok && r.data) window.open(r.data.url, "_blank");
    else setErr(r.ok ? "No link" : r.error);
  }
  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-xs text-danger">{err}</span>}
      <Button size="sm" variant="ghost" onClick={go} disabled={busy} aria-label="Download"><Download className="h-4 w-4" /></Button>
    </div>
  );
}
