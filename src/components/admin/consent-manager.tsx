"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Plus, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Badge } from "@/components/ui";
import { publishConsentVersion, toggleConsentForm } from "@/lib/actions/consents-admin";
import type { ConsentForm } from "@/lib/data/consents-admin";

export function ConsentManager({ forms }: { forms: ConsentForm[] }) {
  const router = useRouter();
  const keys = Array.from(new Set(forms.map((f) => f.key)));
  const [key, setKey] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [required, setRequired] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function publish() {
    setBusy(true); setMsg(null);
    const res = await publishConsentVersion({ key: key.trim(), title, body, required });
    setBusy(false);
    if (res.ok) { setMsg({ ok: true, text: "New version published" }); setTitle(""); setBody(""); setKey(""); router.refresh(); }
    else setMsg({ ok: false, text: res.error });
  }
  async function toggle(id: string, field: "is_active" | "is_required", value: boolean) {
    await toggleConsentForm(id, field, value); router.refresh();
  }

  const sel = "mt-1 w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink";
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Consent forms</CardTitle></CardHeader>
        <CardBody className="p-0">
          <ul>
            {forms.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-ink"><ShieldCheck className="h-4 w-4 text-success" />{f.title} <span className="text-xs text-ink-4">v{f.version} · {f.key}</span></div>
                  <div className="text-xs text-ink-3">{f.acceptedCount} acceptance{f.acceptedCount === 1 ? "" : "s"} · {f.bodyLength} chars</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => toggle(f.id, "is_required", !f.isRequired)}><Badge tone={f.isRequired ? "danger" : "neutral"}>{f.isRequired ? "required" : "optional"}</Badge></button>
                  <button onClick={() => toggle(f.id, "is_active", !f.isActive)}><Badge tone={f.isActive ? "success" : "neutral"}>{f.isActive ? "active" : "inactive"}</Badge></button>
                  <Link href={`/admin/consents/${f.id}`} className="text-ink-3 hover:text-ink"><ChevronRight className="h-4 w-4" /></Link>
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4 text-maroon" /> Publish a new version</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-3">Creates the next version of a form (or a brand-new key) and supersedes the previous active one. Existing acceptances keep their snapshot of the old wording.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="k">Key</Label><Input id="k" list="consent-keys" value={key} onChange={(e) => setKey(e.target.value)} placeholder="privacy, liability, conduct…" /><datalist id="consent-keys">{keys.map((k) => <option key={k} value={k} />)}</datalist></div>
            <div><Label htmlFor="ti">Title</Label><Input id="ti" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Privacy policy" /></div>
          </div>
          <div><Label htmlFor="b">Body (the exact text parents accept)</Label><textarea id="b" rows={5} value={body} onChange={(e) => setBody(e.target.value)} className={sel} placeholder="I have read and agree to…" /></div>
          <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-maroon" /> Required at registration</label>
          <div className="flex items-center gap-3">
            <Button onClick={publish} disabled={busy || !key.trim() || !title.trim() || body.trim().length < 10}>{busy ? "Publishing…" : "Publish version"}</Button>
            {msg && <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
