"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { createService, updateService, type ServiceInput } from "@/lib/actions/booking";
import type { ServiceRow } from "@/lib/data/training-admin";

export function ServiceForm({ existing }: { existing?: ServiceRow }) {
  const router = useRouter();
  const [f, setF] = React.useState<ServiceInput>({
    name: existing?.name ?? "", description: existing?.description ?? "", durationMin: existing?.durationMin ?? 60,
    priceChf: existing?.priceChf ?? 0, creditCategory: (existing?.creditCategory as ServiceInput["creditCategory"]) ?? "personal",
    creditsRequired: existing?.creditsRequired ?? 0, isActive: existing?.isActive ?? true,
  });
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = <K extends keyof ServiceInput>(k: K) => (v: ServiceInput[K]) => setF((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setErr(null);
    const res = existing ? await updateService(existing.id, f) : await createService(f);
    setPending(false);
    if (res.ok) router.push("/admin/services"); else setErr(res.error);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div><Label htmlFor="n">Name</Label><Input id="n" value={f.name} onChange={(e) => set("name")(e.target.value)} /></div>
      <div><Label htmlFor="d">Description</Label><Input id="d" value={f.description} onChange={(e) => set("description")(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label htmlFor="dur">Duration (min)</Label><Input id="dur" type="number" value={f.durationMin} onChange={(e) => set("durationMin")(Number(e.target.value))} /></div>
        <div><Label htmlFor="pr">Price (CHF)</Label><Input id="pr" type="number" step="0.01" value={f.priceChf} onChange={(e) => set("priceChf")(Number(e.target.value))} /></div>
        <div>
          <Label htmlFor="cc">Credit category</Label>
          <select id="cc" value={f.creditCategory} onChange={(e) => set("creditCategory")(e.target.value as ServiceInput["creditCategory"])} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
            <option value="personal">personal</option><option value="nutrition">nutrition</option><option value="mental">mental</option>
          </select>
        </div>
        <div><Label htmlFor="cr">Credits required</Label><Input id="cr" type="number" value={f.creditsRequired} onChange={(e) => set("creditsRequired")(Number(e.target.value))} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set("isActive")(e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> Active (bookable)</label>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={pending}>{pending ? "Saving…" : existing ? "Save service" : "Create service"}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/admin/services")}>Cancel</Button></div>
    </form>
  );
}
