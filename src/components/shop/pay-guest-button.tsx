"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { payGuestOrder } from "@/lib/actions/shop";

/** Card / TWINT payment of a guest order (Stripe Checkout on the club's account). */
export function PayGuestButton({ token, methods }: { token: string; methods: string }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function pay() {
    setBusy(true); setErr(null);
    const res = await payGuestOrder(token);
    if (!res.ok) { setBusy(false); setErr(res.error); return; }
    window.location.assign(res.data!.url);
  }
  return (
    <div className="space-y-2">
      <Button onClick={pay} loading={busy}><CreditCard className="h-4 w-4" aria-hidden /> {t("shop.order.payOnline")}</Button>
      <p className="text-xs text-text-muted">{t("shop.order.payOnlineHint", { methods })}</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
