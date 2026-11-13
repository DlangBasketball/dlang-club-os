"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { setOrderStatus } from "@/lib/actions/shop";
import { nextStatuses, type AdminTransition, type OrderStatus } from "@/lib/shop/validation";

/** Admin buttons for the next steps of an order (ready, fulfilled, cancel, refund). */
export function OrderActions({ orderId, status, fulfillment }: { orderId: string; status: OrderStatus; fulfillment: "pickup" | "shipping" }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState<AdminTransition | null>(null);
  const [reason, setReason] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const next = nextStatuses(status, fulfillment);
  const needsReason = next.some((s) => s === "cancelled" || s === "refunded");
  if (!next.length) return null;

  async function run(s: AdminTransition) {
    if ((s === "cancelled" || s === "refunded") && !window.confirm(t(`shop.orders.confirm.${s}`))) return;
    setBusy(s); setErr(null);
    const res = await setOrderStatus({ orderId, status: s, reason });
    setBusy(null);
    if (!res.ok) return setErr(res.error);
    setReason("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {needsReason && (
        <div className="max-w-md"><Label htmlFor="ord-reason">{t("shop.orders.reason")}</Label>
          <Input id="ord-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} /></div>
      )}
      <div className="flex flex-wrap gap-2">
        {next.map((s) => (
          <Button key={s} size="sm" variant={s === "cancelled" || s === "refunded" ? "ghost" : "primary"} loading={busy === s} disabled={busy !== null}
            onClick={() => run(s)}>{t(`shop.orders.actions.${s}`)}</Button>
        ))}
      </div>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
