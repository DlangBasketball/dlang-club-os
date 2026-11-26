"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { createCreditPackage, grantCredits } from "@/lib/actions/booking";

type Cat = "personal" | "nutrition" | "mental";
export function PackageForm() {
  const router = useRouter();
  const [f, setF] = React.useState({ name: "", creditCategory: "personal" as Cat, credits: 5, priceChf: 0 });
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  async function save() {
    setPending(true); setMsg(null);
    const res = await createCreditPackage(f); setPending(false);
    if (res.ok) { setMsg("Package created"); setF({ ...f, name: "" }); router.refresh(); } else setMsg(res.error);
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div><label className="text-xs text-ink-3">Name</label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-44" /></div>
      <div><label className="text-xs text-ink-3">Category</label>
        <select value={f.creditCategory} onChange={(e) => setF({ ...f, creditCategory: e.target.value as Cat })} className="h-10 w-32 rounded border border-line bg-surface-input px-2 text-sm text-ink">
          <option value="personal">personal</option><option value="nutrition">nutrition</option><option value="mental">mental</option></select></div>
      <div><label className="text-xs text-ink-3">Credits</label><Input type="number" value={f.credits} onChange={(e) => setF({ ...f, credits: Number(e.target.value) })} className="w-24" /></div>
      <div><label className="text-xs text-ink-3">Price (CHF)</label><Input type="number" step="0.01" value={f.priceChf} onChange={(e) => setF({ ...f, priceChf: Number(e.target.value) })} className="w-28" /></div>
      <Button size="sm" disabled={pending} onClick={save}>{pending ? "…" : "Add package"}</Button>
      {msg && <span className="pb-2 text-xs text-success">{msg}</span>}
    </div>
  );
}

export function GrantCreditsForm({ athletes }: { athletes: { athleteId: string; name: string }[] }) {
  const router = useRouter();
  const [athleteId, setAthleteId] = React.useState(athletes[0]?.athleteId ?? "");
  const [cat, setCat] = React.useState<Cat>("personal");
  const [credits, setCredits] = React.useState(1);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  async function grant() {
    setPending(true); setMsg(null);
    const res = await grantCredits(athleteId, cat, credits); setPending(false);
    if (res.ok) { setMsg("Credits granted"); router.refresh(); } else setMsg(res.error);
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div><label className="text-xs text-ink-3">Athlete</label>
        <select value={athleteId} onChange={(e) => setAthleteId(e.target.value)} className="h-10 w-48 rounded border border-line bg-surface-input px-2 text-sm text-ink">
          {athletes.map((a) => <option key={a.athleteId} value={a.athleteId}>{a.name}</option>)}</select></div>
      <div><label className="text-xs text-ink-3">Category</label>
        <select value={cat} onChange={(e) => setCat(e.target.value as Cat)} className="h-10 w-32 rounded border border-line bg-surface-input px-2 text-sm text-ink">
          <option value="personal">personal</option><option value="nutrition">nutrition</option><option value="mental">mental</option></select></div>
      <div><label className="text-xs text-ink-3">Credits</label><Input type="number" value={credits} onChange={(e) => setCredits(Number(e.target.value))} className="w-24" /></div>
      <Button size="sm" disabled={pending} onClick={grant}>{pending ? "…" : "Grant"}</Button>
      {msg && <span className="pb-2 text-xs text-success">{msg}</span>}
    </div>
  );
}
