"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, Megaphone, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Badge } from "@/components/ui";
import { sendOverdueReminders, broadcastAnnouncement, retryFailedEmail, retryAllFailed } from "@/lib/actions/notifications-admin";
import type { EmailLog } from "@/lib/data/notifications-admin";
import { timeAgo } from "@/lib/utils";

function emailTone(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "sent" || status === "delivered") return "success";
  if (status === "failed" || status === "bounced") return "danger";
  if (status === "queued") return "warning";
  return "neutral";
}

export function ReminderPanel({ overdueInvoices, parents }: { overdueInvoices: number; parents: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    const res = await sendOverdueReminders();
    setBusy(false);
    setMsg(res.ok ? `Sent ${res.sent} email${res.sent === 1 ? "" : "s"} · ${res.inApp} in-app · ${res.failed} failed (${res.targets} recipients)` : res.error);
    router.refresh();
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-4 w-4 text-maroon" /> Overdue payment reminders</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-3">Emails every guardian of an overdue invoice with the amount, due date and a payment link, and records an in-app notification.</p>
        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={busy || overdueInvoices === 0}>{busy ? "Sending…" : `Send to ${overdueInvoices} overdue invoice${overdueInvoices === 1 ? "" : "s"}`}</Button>
          {overdueInvoices === 0 && <span className="text-xs text-success">No overdue invoices 🎉</span>}
        </div>
        {msg && <p className="text-sm text-ink-2">{msg}</p>}
      </CardBody>
    </Card>
  );
}

export function BroadcastForm({ parents }: { parents: number }) {
  const router = useRouter();
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [email, setEmail] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  async function send() {
    setBusy(true); setMsg(null);
    const res = await broadcastAnnouncement({ title, message, email });
    setBusy(false);
    if (res.ok) { setMsg(`Delivered to ${res.inApp} parents${email ? ` · ${res.sent} emails (${res.failed} failed)` : ""}`); setTitle(""); setMessage(""); }
    else setMsg(res.error);
    router.refresh();
  }
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> Broadcast to all parents ({parents})</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <div><Label htmlFor="t">Title</Label><Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Practice cancelled this Saturday" /></div>
        <div>
          <Label htmlFor="m">Message</Label>
          <textarea id="m" value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
            className="mt-1 w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink"
            placeholder="Hi {{parent_name}}, this Saturday's session is cancelled due to weather." />
          <p className="mt-1 text-xs text-ink-4">Supports variables: <code className="text-ink-3">{"{{parent_name}}"}</code></p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} className="accent-maroon" /> Also send email
        </label>
        <div className="flex items-center gap-3">
          <Button onClick={send} disabled={busy || !title.trim() || !message.trim()}>{busy ? "Sending…" : "Send broadcast"}</Button>
          {msg && <span className="text-sm text-ink-2">{msg}</span>}
        </div>
      </CardBody>
    </Card>
  );
}

export function EmailLogTable({ logs, failedCount }: { logs: EmailLog[]; failedCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function retry(id: string) { setBusy(id); await retryFailedEmail(id); setBusy(null); router.refresh(); }
  async function retryAll() { setBusy("all"); await retryAllFailed(); setBusy(null); router.refresh(); }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Email delivery log</CardTitle>
          {failedCount > 0 && <Button size="sm" variant="secondary" onClick={retryAll} disabled={busy !== null}><RefreshCw className="h-4 w-4" /> {busy === "all" ? "Retrying…" : `Retry all (${failedCount})`}</Button>}
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {logs.length === 0 ? (
          <div className="p-5 text-sm text-ink-3">No emails sent yet.</div>
        ) : (
          <ul>
            {logs.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-3 last:border-0">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{l.subject ?? l.template ?? "Email"}</div>
                  <div className="truncate text-xs text-ink-3">{l.toEmail} · {timeAgo(l.createdAt)}{l.attempts > 1 ? ` · ${l.attempts} attempts` : ""}</div>
                  {l.status === "failed" && l.error && <div className="mt-0.5 flex items-center gap-1 text-xs text-danger"><AlertTriangle className="h-3 w-3" />{l.error}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={emailTone(l.status)}>{l.status}</Badge>
                  {(l.status === "failed" || l.status === "bounced") && (
                    <Button size="sm" variant="ghost" onClick={() => retry(l.id)} disabled={busy !== null}>{busy === l.id ? "…" : "Retry"}</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
