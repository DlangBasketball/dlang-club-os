"use client";

import * as React from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { savePlan } from "@/lib/platform/actions";
import { CURRENCIES, FEATURES, INTERVALS } from "@/lib/platform/catalog";
import type { PlanWithPrices } from "@/lib/platform/data";

type Draft = {
  code: string;
  name: string;
  tagline: string;
  audience: string;
  description: string;
  sort_order: string;
  is_public: boolean;
  is_active: boolean;
  is_custom: boolean;
  trial_days: string;
  max_athletes: string;
  max_staff: string;
  features: Record<string, boolean>;
  prices: Record<string, { amount: string; stripe_price_id: string }>;
  /** One-time onboarding fee per currency (charged on monthly plans only). */
  onboarding: Record<string, string>;
};

const key = (c: string, i: string) => `${c}:${i}`;

function toDraft(p: PlanWithPrices | null): Draft {
  const prices: Draft["prices"] = {};
  const onboarding: Draft["onboarding"] = {};
  for (const c of CURRENCIES) {
    const fee = p?.prices.find((x) => x.currency === c && Number(x.onboarding_fee ?? 0) > 0)?.onboarding_fee;
    onboarding[c] = fee != null ? String(Number(fee)) : "";
  }
  for (const c of CURRENCIES)
    for (const i of INTERVALS) {
      const row = p?.prices.find((x) => x.currency === c && x.billing_interval === i);
      prices[key(c, i)] = { amount: row ? String(Number(row.amount)) : "", stripe_price_id: row?.stripe_price_id ?? "" };
    }
  return {
    code: p?.code ?? "",
    name: p?.name ?? "",
    tagline: p?.tagline ?? "",
    audience: p?.audience ?? "",
    description: p?.description ?? "",
    sort_order: String(p?.sort_order ?? 50),
    is_public: p?.is_public ?? true,
    is_active: p?.is_active ?? true,
    is_custom: p?.is_custom ?? false,
    trial_days: String(p?.trial_days ?? 14),
    max_athletes: p?.max_athletes == null ? "" : String(p.max_athletes),
    max_staff: p?.max_staff == null ? "" : String(p.max_staff),
    features: { ...(p?.features ?? {}) },
    prices,
    onboarding,
  };
}

export function PlanEditor({ plan }: { plan: PlanWithPrices | null }) {
  const isNew = plan === null;
  const [d, setD] = React.useState<Draft>(() => toDraft(plan));
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await savePlan({
        code: d.code,
        name: d.name,
        tagline: d.tagline,
        audience: d.audience,
        description: d.description,
        sort_order: d.sort_order,
        is_public: d.is_public,
        is_active: d.is_active,
        is_custom: d.is_custom,
        trial_days: d.trial_days,
        max_athletes: d.max_athletes,
        max_staff: d.max_staff,
        features: d.features,
        prices: CURRENCIES.flatMap((c) =>
          INTERVALS.map((i) => ({
            currency: c,
            billing_interval: i,
            amount: d.is_custom ? "" : d.prices[key(c, i)].amount,
            onboarding_fee: d.onboarding[c] ?? "",
            stripe_price_id: d.prices[key(c, i)].stripe_price_id,
          })),
        ),
      });
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
      if (r.ok && isNew) setD(toDraft(null));
    });
  }

  const summary = plan
    ? `${plan.is_custom ? "Custom pricing" : plan.prices.filter((p) => p.billing_interval === "month").map((p) => `${p.currency} ${Number(p.amount)}`).join(" · ") || "no prices"} · ${plan.max_athletes ?? "∞"} athletes · ${plan.max_staff ?? "∞"} staff`
    : "Create a new sellable plan";

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div>
          <CardTitle>
            {isNew ? "New plan" : plan.name}{" "}
            {!isNew && <span className="font-mono text-xs text-ink-3">({plan.code})</span>}
            {!isNew && !plan.is_active && <span className="ml-2 text-xs text-danger">inactive</span>}
            {!isNew && !plan.is_public && <span className="ml-2 text-xs text-warning">hidden</span>}
          </CardTitle>
          <p className="mt-0.5 text-xs text-ink-3">{summary}</p>
        </div>
        <span className="text-xs text-[#C19A45]">{open ? "Close" : "Edit"}</span>
      </CardHeader>
      {open && (
        <CardBody>
          <form onSubmit={submit} className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label>Code</Label>
                <Input
                  value={d.code}
                  onChange={(e) => set("code", e.target.value)}
                  disabled={!isNew}
                  placeholder="e.g. school"
                  required
                />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={d.name} onChange={(e) => set("name", e.target.value)} required />
              </div>
              <div>
                <Label>Audience</Label>
                <Input value={d.audience} onChange={(e) => set("audience", e.target.value)} />
              </div>
              <div>
                <Label>Sort order</Label>
                <Input type="number" value={d.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>Tagline</Label>
                <Input value={d.tagline} onChange={(e) => set("tagline", e.target.value)} />
              </div>
              <div>
                <Label>Max athletes (blank = unlimited)</Label>
                <Input inputMode="numeric" value={d.max_athletes} onChange={(e) => set("max_athletes", e.target.value)} />
              </div>
              <div>
                <Label>Max staff (blank = unlimited)</Label>
                <Input inputMode="numeric" value={d.max_staff} onChange={(e) => set("max_staff", e.target.value)} />
              </div>
              <div>
                <Label>Trial days</Label>
                <Input inputMode="numeric" value={d.trial_days} onChange={(e) => set("trial_days", e.target.value)} />
              </div>
              <div className="flex flex-wrap items-end gap-4 sm:col-span-3">
                {(
                  [
                    ["is_active", "Active (can be sold)"],
                    ["is_public", "Public (pricing / signup)"],
                    ["is_custom", "Custom pricing (contact sales)"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-ink-2">
                    <input type="checkbox" checked={d[k]} onChange={(e) => set(k, e.target.checked)} className="accent-[#C19A45]" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {!d.is_custom && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Prices</h4>
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-3">
                        <th className="pr-4">Currency</th>
                        <th className="pr-4">Monthly</th>
                        <th className="pr-4">Yearly</th>
                        <th className="pr-4">Onboarding (one-time)</th>
                        <th className="pr-4">Stripe price id (monthly / yearly, optional)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CURRENCIES.map((c) => (
                        <tr key={c}>
                          <td className="pr-4 font-mono text-ink-2">{c}</td>
                          {INTERVALS.map((i) => (
                            <td key={i} className="py-1 pr-4">
                              <Input
                                className="w-28"
                                inputMode="decimal"
                                value={d.prices[key(c, i)].amount}
                                onChange={(e) =>
                                  set("prices", { ...d.prices, [key(c, i)]: { ...d.prices[key(c, i)], amount: e.target.value } })
                                }
                                placeholder="—"
                              />
                            </td>
                          ))}
                          <td className="py-1 pr-4">
                            <Input
                              className="w-28"
                              inputMode="decimal"
                              value={d.onboarding[c] ?? ""}
                              onChange={(e) => set("onboarding", { ...d.onboarding, [c]: e.target.value })}
                              placeholder="0"
                            />
                          </td>
                          <td className="flex gap-2 py-1">
                            {INTERVALS.map((i) => (
                              <Input
                                key={i}
                                className="w-44 font-mono text-xs"
                                value={d.prices[key(c, i)].stripe_price_id}
                                onChange={(e) =>
                                  set("prices", {
                                    ...d.prices,
                                    [key(c, i)]: { ...d.prices[key(c, i)], stripe_price_id: e.target.value },
                                  })
                                }
                                placeholder={`price_… (${i})`}
                              />
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ink-3">
                  Without a Stripe price id, checkout creates the price inline from these amounts (works in test mode with no
                  dashboard setup). Blank amount = not sold in that currency/period. The onboarding fee is added once to the
                  first monthly checkout; annual prepay and founding clubs (waived per tenant) skip it.
                </p>
              </div>
            )}

            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Features</h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(FEATURES).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2 text-sm text-ink-2">
                    <input
                      type="checkbox"
                      className="accent-[#C19A45]"
                      checked={Boolean(d.features[k])}
                      onChange={(e) => set("features", { ...d.features, [k]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : isNew ? "Create plan" : "Save changes"}
              </Button>
              {msg && <span className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>}
            </div>
          </form>
        </CardBody>
      )}
    </Card>
  );
}
