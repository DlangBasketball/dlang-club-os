"use client";

import * as React from "react";
import { Button, Input, Label } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import type { OpsActionResult } from "./ops-form";

const PRESETS = [20, 50, 100, 250];

/** Public donation form: amount, name, email, anonymous flag -> Stripe Checkout. */
export function DonateForm({ campaignId, currency, action }: {
  campaignId: string;
  currency: string;
  action: (values: Record<string, unknown>) => Promise<OpsActionResult>;
}) {
  const t = useT();
  const f = useFormat();
  const [amount, setAmount] = React.useState("50");
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setErr(null);
        start(async () => {
          const res = await action({ campaignId, amount, name: fd.get("name") ?? "", email: fd.get("email") ?? "", anonymous: fd.get("anonymous") === "on" });
          const url = res.ok ? (res.data as { url?: string } | undefined)?.url : null;
          if (url) window.location.assign(url);
          else setErr(res.ok ? t("operations.errors.onlineUnavailable") : res.error);
        });
      }}
    >
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button key={p} type="button" variant={amount === String(p) ? "primary" : "secondary"} size="sm" onClick={() => setAmount(String(p))}>
            {f.money(p, currency, { compactZeros: true })}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="donate-amount">{t("operations.donate.amount", { currency })}</Label>
          <Input id="donate-amount" type="number" min={1} step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="donate-name">{t("common.name")}</Label>
          <Input id="donate-name" name="name" required autoComplete="name" />
        </div>
        <div>
          <Label htmlFor="donate-email">{t("common.email")}</Label>
          <Input id="donate-email" name="email" type="email" required autoComplete="email" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="anonymous" className="h-4 w-4 accent-brand-primary" />
        {t("operations.donate.anonymous")}
      </label>
      <p className="text-xs text-text-muted">{t("operations.donate.privacy")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? t("common.saving") : t("operations.donate.submit")}</Button>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </div>
    </form>
  );
}
