"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label } from "@/components/ui";
import { updateNotificationTemplate } from "@/lib/actions/settings";

const TYPES = [
  "registration_confirmation", "invoice_sent", "payment_received", "payment_overdue",
  "booking_confirmation", "booking_cancellation", "attendance_submitted", "document_uploaded", "consent_required", "announcement",
];
const VARS = ["parent_name", "athlete_name", "invoice_number", "amount_due", "due_date", "payment_link", "service_name", "coach_name"];

export function TemplateEditor({ overrides }: { overrides: Record<string, { subject?: string; body?: string }> }) {
  const router = useRouter();
  const [type, setType] = React.useState(TYPES[0]);
  const [subject, setSubject] = React.useState(overrides[TYPES[0]]?.subject ?? "");
  const [body, setBody] = React.useState(overrides[TYPES[0]]?.body ?? "");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  function pick(t: string) { setType(t); setSubject(overrides[t]?.subject ?? ""); setBody(overrides[t]?.body ?? ""); setMsg(null); }
  async function save() {
    setBusy(true); setMsg(null);
    const res = await updateNotificationTemplate(type, subject, body);
    setBusy(false); setMsg({ ok: res.ok, text: res.ok ? "Template saved" : res.error ?? "Failed" });
    if (res.ok) router.refresh();
  }
  const sel = "mt-1 w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink";
  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Notification templates</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-3">Override the default subject and body per notification type. Leave blank to use the built-in default. Supports variables below.</p>
        <div><Label>Notification type</Label><select className={sel} value={type} onChange={(e) => pick(e.target.value)}>{TYPES.map((t) => <option key={t} value={t}>{t}{overrides[t] ? " (customised)" : ""}</option>)}</select></div>
        <div><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="(uses default)" /></div>
        <div><Label>Body</Label><textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} className={sel} placeholder="(uses default)" /></div>
        <div className="flex flex-wrap gap-1.5">{VARS.map((v) => (
          <button key={v} type="button" onClick={() => setBody((b) => `${b}{{${v}}}`)} className="rounded bg-surface-elevated px-2 py-1 font-mono text-xs text-ink-3 hover:text-ink">{`{{${v}}}`}</button>
        ))}</div>
        <div className="flex items-center gap-3"><Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save template"}</Button>{msg && <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}</div>
      </CardBody>
    </Card>
  );
}
