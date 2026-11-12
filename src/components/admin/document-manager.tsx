"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, Download, Trash2, FileText } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Badge } from "@/components/ui";
import { uploadDocument, deleteDocument, getDocumentUrl } from "@/lib/actions/documents";
import type { AdminDoc, Opt } from "@/lib/data/documents";
import { useFormat } from "@/lib/i18n/client";

const SCOPES = [
  { v: "global", label: "All members (global)" },
  { v: "program", label: "Program-specific" },
  { v: "family", label: "Family-specific" },
  { v: "athlete", label: "Athlete-specific" },
] as const;
const KINDS = ["other", "consent_pdf", "medical", "insurance", "photo"] as const;
const SCOPE_TONE: Record<string, "neutral" | "success" | "warning" | "maroon"> = { global: "success", program: "warning", family: "neutral", athlete: "maroon" };

export function DocumentManager({ docs, targets }: { docs: AdminDoc[]; targets: { programs: Opt[]; families: Opt[]; athletes: Opt[] } }) {
  const f = useFormat();
  const router = useRouter();
  const [scope, setScope] = React.useState<string>("global");
  const [targetId, setTargetId] = React.useState("");
  const [kind, setKind] = React.useState<string>("other");
  const [title, setTitle] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const targetOpts = scope === "program" ? targets.programs : scope === "family" ? targets.families : scope === "athlete" ? targets.athletes : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg({ ok: false, text: "Choose a file" }); return; }
    if (scope !== "global" && !targetId) { setMsg({ ok: false, text: "Select a target" }); return; }
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append("file", file); fd.append("scope", scope); fd.append("targetId", targetId); fd.append("kind", kind); fd.append("title", title);
    const res = await uploadDocument(fd);
    setBusy(false);
    if (res.ok) { setMsg({ ok: true, text: "Uploaded" }); setTitle(""); setTargetId(""); if (fileRef.current) fileRef.current.value = ""; router.refresh(); }
    else setMsg({ ok: false, text: res.error });
  }
  async function download(id: string) {
    const res = await getDocumentUrl(id);
    if (res.ok && res.data) window.open(res.data.url, "_blank");
    else setMsg({ ok: false, text: res.ok ? "No link" : res.error });
  }
  async function remove(id: string) {
    if (!confirm("Delete this document?")) return;
    await deleteDocument(id); router.refresh();
  }

  const sel = "mt-1 w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink";
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4 text-maroon" /> Upload a document</CardTitle></CardHeader>
        <CardBody>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label>Scope</Label><select className={sel} value={scope} onChange={(e) => { setScope(e.target.value); setTargetId(""); }}>{SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></div>
            <div><Label>Target</Label><select className={sel} value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={scope === "global"}><option value="">{scope === "global" ? "— (all members)" : "Select…"}</option>{targetOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
            <div><Label>Kind</Label><select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
            <div><Label htmlFor="t">Title (optional)</Label><Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Season handbook" /></div>
            <div className="sm:col-span-2"><Label>File</Label><input ref={fileRef} type="file" className={sel} /></div>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? "Uploading…" : "Upload"}</Button>
              {msg && <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>All documents ({docs.length})</CardTitle></CardHeader>
        <CardBody className="p-0">
          {docs.length === 0 ? (
            <div className="p-5 text-sm text-ink-3">No documents uploaded yet.</div>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <FileText className="h-4 w-4 shrink-0 text-ink-3" />
                    <div className="min-w-0">
                      <div className="truncate text-sm text-ink">{d.title || d.fileName || "Document"}</div>
                      <div className="truncate text-xs text-ink-3">{d.targetName} · {f.date(d.createdAt)}{d.sizeBytes ? ` · ${(d.sizeBytes / 1024).toFixed(0)} KB` : ""}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={SCOPE_TONE[d.scope] ?? "neutral"}>{d.scope}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => download(d.id)} aria-label="Download"><Download className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(d.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-danger" /></Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
