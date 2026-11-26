"use client";

import * as React from "react";
import { setAddonPrice, setPlanFeature } from "@/lib/upgrades/platform-actions";

/** One plan <-> feature cell (checkbox, saved on change). */
export function MatrixCell({ plan, feature, included, disabled }: { plan: string; feature: string; included: boolean; disabled?: boolean }) {
  const [on, setOn] = React.useState(included);
  const [pending, start] = React.useTransition();
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-center">
      <input
        type="checkbox"
        aria-label={`${feature} in ${plan}`}
        className="h-4 w-4 accent-brand-primary"
        checked={on}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          start(async () => {
            const r = await setPlanFeature(plan, feature, next);
            if (!r.ok) {
              setOn(!next);
              setErr(r.error);
            } else setErr(null);
          });
        }}
      />
      {err && <span className="max-w-[120px] text-[10px] text-danger">{err}</span>}
    </span>
  );
}

/** Add-on price per currency (blur saves; empty = not sold in that currency). */
export function PriceCell({ feature, currency, amount }: { feature: string; currency: string; amount: number | null }) {
  const [value, setValue] = React.useState(amount === null ? "" : String(amount));
  const [saved, setSaved] = React.useState(amount === null ? "" : String(amount));
  const [pending, start] = React.useTransition();
  const [state, setState] = React.useState<"idle" | "ok" | "err">("idle");
  return (
    <input
      aria-label={`${feature} price ${currency}`}
      className={`h-8 w-20 rounded border bg-surface px-2 text-right text-xs tnum ${state === "err" ? "border-danger" : state === "ok" ? "border-success" : "border-line"}`}
      value={value}
      inputMode="decimal"
      placeholder="—"
      disabled={pending}
      onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, "").slice(0, 9))}
      onBlur={() => {
        if (value === saved) return;
        start(async () => {
          const r = await setAddonPrice(feature, currency, value);
          setState(r.ok ? "ok" : "err");
          if (r.ok) setSaved(value);
        });
      }}
    />
  );
}
