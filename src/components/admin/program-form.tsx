"use client";
import * as React from "react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { createProgram, type ProgramInput } from "@/lib/actions/programs";

type Kind = ProgramInput["kind"];

export function ProgramForm({ kinds, currencyLabel }: { kinds: { value: Kind; label: string }[]; currencyLabel: string }) {
  const [v, setV] = React.useState({ name: "", kind: kinds[0]?.value ?? "camp", price: "0", capacity: "", startsOn: "", endsOn: "", location: "", description: "", isPublic: false });
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    startTransition(async () => {
      const res = await createProgram({ ...v, kind: v.kind as Kind, price: Number(v.price), capacity: v.capacity === "" ? "" : Number(v.capacity) });
      // On success the action redirects; only errors come back.
      if (res && !res.ok) setErr(res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div><Label htmlFor="p-name">Name</Label><Input id="p-name" required value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div><Label htmlFor="p-kind">Type</Label>
          <Select id="p-kind" value={v.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
            {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
        </div>
        <div><Label htmlFor="p-price">Price ({currencyLabel})</Label><Input id="p-price" type="number" min="0" step="0.01" inputMode="decimal" value={v.price} onChange={(e) => set("price", e.target.value)} /></div>
        <div><Label htmlFor="p-cap">Capacity</Label><Input id="p-cap" type="number" min="1" step="1" value={v.capacity} onChange={(e) => set("capacity", e.target.value)} /></div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="p-start">Starts</Label><Input id="p-start" type="date" value={v.startsOn} onChange={(e) => set("startsOn", e.target.value)} /></div>
        <div><Label htmlFor="p-end">Ends</Label><Input id="p-end" type="date" value={v.endsOn} onChange={(e) => set("endsOn", e.target.value)} /></div>
      </div>
      <div><Label htmlFor="p-loc">Location</Label><Input id="p-loc" value={v.location} onChange={(e) => set("location", e.target.value)} /></div>
      <div><Label htmlFor="p-desc">Description</Label><Textarea id="p-desc" value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={v.isPublic} onChange={(e) => set("isPublic", e.target.checked)} /> Public (open for online registration)
      </label>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Create"}</Button>
    </form>
  );
}
