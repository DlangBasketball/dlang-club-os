"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Send, Ban, BellRing, FileDown } from "lucide-react";
import { Button } from "@/components/ui";
import { sendInvoice, cancelInvoice, sendReminder } from "@/lib/actions/invoice";

export function InvoiceActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    const res = await fn();
    setBusy(null);
    if (!res.ok) window.alert(res.error ?? "Action failed");
    else router.refresh();
  }

  const canSend = status === "draft";
  const canCancel = status !== "paid" && status !== "cancelled";
  const canRemind = ["sent", "partially_paid", "overdue"].includes(status);

  return (
    <div className="flex flex-wrap gap-2">
      {canSend && <Button size="sm" disabled={busy !== null} onClick={() => run("send", () => sendInvoice(id))}><Send className="h-4 w-4" /> {busy === "send" ? "Sending…" : "Send"}</Button>}
      {canRemind && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run("remind", () => sendReminder(id))}><BellRing className="h-4 w-4" /> {busy === "remind" ? "Sending…" : "Send reminder"}</Button>}
      <a href={`/admin/invoices/${id}/pdf`} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="secondary"><FileDown className="h-4 w-4" /> PDF</Button></a>
      {canCancel && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run("cancel", () => cancelInvoice(id))}><Ban className="h-4 w-4" /> {busy === "cancel" ? "…" : "Cancel"}</Button>}
    </div>
  );
}
