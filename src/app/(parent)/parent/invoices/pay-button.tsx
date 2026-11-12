"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui";
import { createCheckoutSession } from "@/lib/actions/invoice";

export function PayButton({ invoiceId, label = "Pay by card" }: { invoiceId: string; label?: string }) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function pay() {
    setPending(true);
    setError(null);
    const res = await createCheckoutSession(invoiceId);
    if (res.ok) {
      window.location.href = res.url;
    } else {
      setError(res.error);
      setPending(false);
    }
  }

  return (
    <div>
      <Button onClick={pay} disabled={pending}><CreditCard className="h-4 w-4" /> {pending ? "Redirecting…" : label}</Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
