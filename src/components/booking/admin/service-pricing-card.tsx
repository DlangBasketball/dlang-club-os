"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Badge, Button, FieldHint, Input, Label } from "@/components/ui";
import { Textarea } from "@/components/teams/fields";
import { saveServicePricing } from "@/lib/actions/booking-orders";
import { optionLabel, type PricingOption } from "@/lib/booking/orders";
import type { ServiceKind } from "@/lib/booking/types";
import { currencySymbol } from "@/lib/format";
import { useFormat, useT } from "@/lib/i18n/client";

type Row = { key: string; id: string | null; name: string; sessions: string; total: string; validityDays: string; isActive: boolean };

/**
 * Services -> service page "Pricing" card (admin + finance): the catalogue
 * the booking form offers. "1 Session" at the single-session price, the
 * session packages (sessions + TOTAL per athlete), the customer-facing short
 * description, and for group services the group rate (per player per
 * session). Saved with service_pricing_save; existing orders keep their
 * agreed prices (snapshots).
 */
export function ServicePricingCard({ serviceId, kind, currency, initial, canEdit }: {
  serviceId: string; kind: ServiceKind; currency: string; canEdit: boolean;
  initial: {
    price: number; groupRate: number | null; shortDescription: string | null; options: PricingOption[];
    packages: { id: string; name: string; sessions: number; total: number; isActive: boolean; validityDays: number | null }[];
    pricingMissing: string[];
  };
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const isGroup = kind === "group";
  const [price, setPrice] = React.useState(String(initial.price ?? 0));
  const [rate, setRate] = React.useState(initial.groupRate === null ? "" : String(initial.groupRate));
  const [desc, setDesc] = React.useState(initial.shortDescription ?? "");
  const [rows, setRows] = React.useState<Row[]>(() => initial.packages.map((p) => ({
    key: p.id, id: p.id, name: p.name, sessions: String(p.sessions), total: String(p.total),
    validityDays: p.validityDays ? String(p.validityDays) : "", isActive: p.isActive,
  })));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const update = (key: string, patch: Partial<Row>) => { setMsg(null); setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r))); };
  const money = (n: number) => f.money(n, currency);
  const sessionsLabel = (n: number) => t("bookingOrders.option.sessions", { count: n });

  // Live preview of what the booking form will offer.
  const preview: Pick<PricingOption, "sessions" | "total">[] = isGroup ? [] : [
    ...(kind === "package" ? [] : [{ sessions: 1, total: Number(price) || 0 }]),
    ...rows.filter((r) => r.isActive && Number(r.sessions) > 0).map((r) => ({ sessions: Number(r.sessions), total: Number(r.total) || 0 })),
  ];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await saveServicePricing({
      serviceId, price: price.trim() === "" ? null : Number(price), groupRate: rate.trim() === "" ? null : Number(rate),
      shortDescription: desc, pricingBasis: "per_player_per_session",
      packages: rows.map((r) => ({
        id: r.id, name: r.name.trim() || null, sessions: Number(r.sessions), total: Number(r.total),
        validityDays: r.validityDays.trim() === "" ? null : Number(r.validityDays), isActive: r.isActive,
      })),
    });
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? t("common.saved") : res.error });
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {initial.pricingMissing.length > 0 && (
        <p role="alert" className="flex items-center gap-2 rounded border border-warning/30 bg-warning-soft p-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {initial.pricingMissing.map((c) => t.dynamic(`bookingOrders.pricingMissing.${c}`, undefined, c)).join(" ")}
        </p>
      )}
      <fieldset disabled={!canEdit || busy} className="space-y-4">
        <div>
          <Label htmlFor="sp-desc">{t("bookingOrders.pricing.shortDescription")}</Label>
          <Textarea id="sp-desc" maxLength={280} rows={2} value={desc} onChange={(e) => { setMsg(null); setDesc(e.target.value); }} />
          <FieldHint>{t("bookingOrders.pricing.shortDescriptionHint")}</FieldHint>
        </div>

        {isGroup ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="sp-rate">{t("bookingOrders.pricing.groupRate", { currency: currencySymbol(currency, f.locale) })}</Label>
              <Input id="sp-rate" type="number" min={0} step="0.05" inputMode="decimal" value={rate} onChange={(e) => { setMsg(null); setRate(e.target.value); }} />
              <FieldHint>{t("bookingOrders.pricing.groupRateHint")}</FieldHint>
            </div>
            <div>
              <Label>{t("bookingOrders.pricing.basis")}</Label>
              <p className="pt-2 text-sm text-ink">{t("bookingOrders.pricing.basisPerPlayerPerSession")}</p>
              <FieldHint>{t("bookingOrders.pricing.basisHint")}</FieldHint>
            </div>
          </div>
        ) : (
          <>
            {kind !== "package" && (
              <div className="max-w-xs">
                <Label htmlFor="sp-price">{t("bookingOrders.pricing.singlePrice", { currency: currencySymbol(currency, f.locale) })}</Label>
                <Input id="sp-price" type="number" min={0} step="0.05" inputMode="decimal" value={price} onChange={(e) => { setMsg(null); setPrice(e.target.value); }} />
              </div>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.pricing.packages")}</legend>
              {rows.length === 0 && <p className="text-sm text-ink-3">{t("bookingOrders.pricing.noPackages")}</p>}
              {rows.map((r) => (
                <div key={r.key} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-3 sm:grid-cols-[0.7fr_0.9fr_0.8fr_1.2fr_auto_auto]">
                  <div><Label htmlFor={`sp-s-${r.key}`}>{t("bookingOrders.pricing.sessions")}</Label>
                    <Input id={`sp-s-${r.key}`} type="number" min={1} max={1000} value={r.sessions} onChange={(e) => update(r.key, { sessions: e.target.value })} /></div>
                  <div><Label htmlFor={`sp-t-${r.key}`}>{t("bookingOrders.pricing.total", { currency: currencySymbol(currency, f.locale) })}</Label>
                    <Input id={`sp-t-${r.key}`} type="number" min={0} step="0.05" inputMode="decimal" value={r.total} onChange={(e) => update(r.key, { total: e.target.value })} /></div>
                  <div><Label htmlFor={`sp-v-${r.key}`}>{t("bookingOrders.pricing.validity")}</Label>
                    <Input id={`sp-v-${r.key}`} type="number" min={1} max={3650} value={r.validityDays} placeholder={t("bookingOrders.pricing.noExpiry")} onChange={(e) => update(r.key, { validityDays: e.target.value })} /></div>
                  <div className="col-span-2 sm:col-span-1"><Label htmlFor={`sp-n-${r.key}`}>{t("bookingOrders.pricing.name")}</Label>
                    <Input id={`sp-n-${r.key}`} maxLength={120} value={r.name} placeholder={sessionsLabel(Number(r.sessions) || 0)} onChange={(e) => update(r.key, { name: e.target.value })} /></div>
                  <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-2">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={r.isActive} onChange={(e) => update(r.key, { isActive: e.target.checked })} />
                    {t("bookingOrders.pricing.active")}
                  </label>
                  <Button type="button" size="sm" variant="ghost" aria-label={t("bookingOrders.pricing.remove")} onClick={() => { setMsg(null); setRows((rs) => rs.filter((x) => x.key !== r.key)); }}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="secondary"
                onClick={() => { setMsg(null); setRows((rs) => [...rs, { key: `new-${Date.now()}`, id: null, name: "", sessions: "5", total: "", validityDays: "", isActive: true }]); }}>
                <Plus className="h-4 w-4" aria-hidden /> {t("bookingOrders.pricing.addPackage")}
              </Button>
              <FieldHint>{t("bookingOrders.pricing.totalHint")}</FieldHint>
            </fieldset>
          </>
        )}
      </fieldset>

      {preview.length > 0 && (
        <div className="rounded-lg border border-line p-3">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("bookingOrders.pricing.preview")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {preview.map((o, i) => <li key={`${o.sessions}-${i}`}><Badge tone="neutral">{optionLabel(o, sessionsLabel, money)}</Badge></li>)}
          </ul>
        </div>
      )}
      {isGroup && rate.trim() !== "" && (
        <p className="text-sm text-ink-2">{t("bookingOrders.pricing.groupPreview", { rate: money(Number(rate) || 0) })}</p>
      )}

      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      {canEdit ? <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("bookingOrders.pricing.save")}</Button>
        : <p className="text-xs text-ink-3">{t("bookingOrders.pricing.readOnly")}</p>}
    </form>
  );
}
