"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { Select, Textarea } from "@/components/teams/fields";
import { createService, updateService, type ServiceInput } from "@/lib/actions/booking";
import type { ServiceRow } from "@/lib/data/training-admin";
import { useFormat, useT } from "@/lib/i18n/client";
import { currencySymbol } from "@/lib/format";

const CATEGORIES = ["personal", "nutrition", "mental"] as const;

export function ServiceForm({ existing }: { existing?: ServiceRow }) {
  const t = useT();
  const fmt = useFormat();
  const router = useRouter();
  const [f, setF] = React.useState({
    name: existing?.name ?? "", description: existing?.description ?? "", durationMin: String(existing?.durationMin ?? 60),
    priceChf: String(existing?.priceChf ?? 0), creditCategory: (existing?.creditCategory as ServiceInput["creditCategory"]) ?? "personal",
    creditsRequired: String(existing?.creditsRequired ?? 0), isActive: existing?.isActive ?? true,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (existing && existing.isActive && !f.isActive && !window.confirm(t("editOps.services.confirmDeactivate"))) return;
    setPending(true); setErr(null);
    const input: ServiceInput = {
      name: f.name, description: f.description, durationMin: Number(f.durationMin), priceChf: Number(f.priceChf),
      creditCategory: f.creditCategory, creditsRequired: Number(f.creditsRequired), isActive: f.isActive,
    };
    const res = existing ? await updateService(existing.id, input) : await createService(input);
    setPending(false);
    if (res.ok) { router.push("/admin/services"); router.refresh(); } else setErr(res.error);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div><Label htmlFor="n">{t("common.name")}</Label><Input id="n" required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div><Label htmlFor="d">{t("editOps.services.description")}</Label><Textarea id="d" maxLength={2000} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="dur">{t("editOps.services.duration")}</Label><Input id="dur" type="number" min={15} max={480} step={5} value={f.durationMin} onChange={(e) => set("durationMin", e.target.value)} /></div>
        <div><Label htmlFor="pr">{t("editOps.services.price", { currency: currencySymbol(fmt.currency, fmt.locale) })}</Label><Input id="pr" type="number" min={0} step="0.01" inputMode="decimal" value={f.priceChf} onChange={(e) => set("priceChf", e.target.value)} /></div>
        <div>
          <Label htmlFor="cc">{t("editOps.services.creditCategory")}</Label>
          <Select id="cc" value={f.creditCategory} onChange={(e) => set("creditCategory", e.target.value as ServiceInput["creditCategory"])}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{t(`editOps.services.categories.${c}`)}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="cr">{t("editOps.services.creditsRequired")}</Label><Input id="cr" type="number" min={0} max={99} step={1} value={f.creditsRequired} onChange={(e) => set("creditsRequired", e.target.value)} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("editOps.services.active")}</label>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? t("common.saving") : existing ? t("common.save") : t("common.create")}</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => router.push("/admin/services")}>{t("common.cancel")}</Button></div>
    </form>
  );
}
