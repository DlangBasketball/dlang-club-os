"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { applyManualDiscount } from "@/lib/actions/discounts";
import { useT } from "@/lib/i18n/client";

/** Admin / finance: apply a discount to one camp registration (credit note when the invoice is issued). */
export function ManualDiscountForm({ registrationId, discounts }: { registrationId: string; discounts: { id: string; label: string }[] }) {
  const t = useT();
  const router = useRouter();
  const [discountId, setDiscountId] = React.useState(discounts[0]?.id ?? "");
  const [reason, setReason] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  if (!discounts.length) return <p className="text-sm text-ink-3">{t("camps.manual.none")}</p>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await applyManualDiscount(registrationId, discountId, reason, amount === "" ? null : Number(amount));
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "err", text: res.error });
    setMsg({ tone: "ok", text: t("camps.manual.applied") });
    setReason(""); setAmount("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div><Label htmlFor="md-discount">{t("camps.manual.discount")}</Label>
          <Select id="md-discount" value={discountId} onChange={(e) => setDiscountId(e.target.value)}>
            {discounts.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="md-amount">{t("camps.manual.amount")}</Label><Input id="md-amount" type="number" min="0.01" step="0.01" value={amount} placeholder={t("camps.manual.amountPlaceholder")} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label htmlFor="md-reason">{t("camps.manual.reason")}</Label><Input id="md-reason" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      </div>
      <p className="text-xs text-ink-3">{t("camps.manual.hint")}</p>
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
      <Button type="submit" size="sm" disabled={busy}>{busy ? t("common.saving") : t("camps.manual.apply")}</Button>
    </form>
  );
}
