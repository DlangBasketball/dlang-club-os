"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui";
import { markInvoicePaid } from "@/lib/actions/invoice";

export function MarkPaidButton({ invoiceId, size = "sm" }: { invoiceId: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  async function run() {
    setBusy(true);
    const res = await markInvoicePaid(invoiceId, "bank_transfer");
    setBusy(false);
    if (!res.ok) window.alert(res.error ?? "Failed");
    else router.refresh();
  }
  return (
    <Button size={size} variant="secondary" disabled={busy} onClick={run}>
      <Check className="h-4 w-4" /> {busy ? "Marking…" : "Mark paid"}
    </Button>
  );
}
