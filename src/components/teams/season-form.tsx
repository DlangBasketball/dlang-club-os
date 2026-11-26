"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { createSeason } from "@/lib/sportsops/actions";
import { FormError } from "./fields";

/** Suggest the next sports season: mid-August to end of June (school-year style). */
function suggest() {
  const now = new Date();
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return { name: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, startsOn: `${y}-08-17`, endsOn: `${y + 1}-06-30` };
}

export function SeasonForm() {
  const router = useRouter();
  const s = suggest();
  const [name, setName] = React.useState(s.name);
  const [startsOn, setStartsOn] = React.useState(s.startsOn);
  const [endsOn, setEndsOn] = React.useState(s.endsOn);
  const [isCurrent, setIsCurrent] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setErr(null);
    const res = await createSeason({ name, startsOn, endsOn, isCurrent });
    setPending(false);
    if (!res.ok) return setErr(res.error);
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div><Label htmlFor="s-name">Name</Label><Input id="s-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="s-start">Starts</Label><Input id="s-start" type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></div>
        <div><Label htmlFor="s-end">Ends</Label><Input id="s-end" type="date" required value={endsOn} onChange={(e) => setEndsOn(e.target.value)} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={isCurrent} onChange={(e) => setIsCurrent(e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> Current season</label>
      <FormError message={err} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Add season"}</Button>
    </form>
  );
}
