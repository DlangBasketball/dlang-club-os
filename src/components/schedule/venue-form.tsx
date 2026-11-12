"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { FormError } from "@/components/teams/fields";
import { addVenueSpace, createVenue, setVenueActive } from "@/lib/sportsops/actions";

export function VenueForm() {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [city, setCity] = React.useState("");
  const [capacity, setCapacity] = React.useState("");
  const [spaces, setSpaces] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const res = await createVenue({
      name, address, city, capacity: capacity ? Number(capacity) : null,
      spaces: spaces.split(",").map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setName(""); setAddress(""); setCity(""); setCapacity(""); setSpaces("");
    router.refresh();
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div><Label htmlFor="v-name">Name</Label><Input id="v-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main arena, School gym, Field complex" /></div>
      <div><Label htmlFor="v-addr">Address</Label><Input id="v-addr" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="v-city">City</Label><Input id="v-city" maxLength={100} value={city} onChange={(e) => setCity(e.target.value)} /></div>
        <div><Label htmlFor="v-cap">Capacity</Label><Input id="v-cap" inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
      </div>
      <div><Label htmlFor="v-spaces">Courts / fields (comma separated)</Label><Input id="v-spaces" maxLength={600} value={spaces} onChange={(e) => setSpaces(e.target.value)} placeholder="Court A, Court B" /></div>
      <FormError message={err} />
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Saving…" : "Add venue"}</Button>
    </form>
  );
}

export function VenueRowActions({ venueId, isActive }: { venueId: string; isActive: boolean }) {
  const router = useRouter();
  const [space, setSpace] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!space.trim()) return;
    setBusy(true); setErr(null);
    const res = await addVenueSpace(venueId, space);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setSpace(""); router.refresh();
  }
  async function toggle() {
    setBusy(true);
    const res = await setVenueActive(venueId, !isActive);
    setBusy(false);
    if (!res.ok) setErr(res.error); else router.refresh();
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={add} className="flex gap-2">
        <Input aria-label="New court or field" className="h-8 w-40" maxLength={80} value={space} onChange={(e) => setSpace(e.target.value)} placeholder="Add court/field" />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}><Plus className="h-3.5 w-3.5" /></Button>
      </form>
      <Button size="sm" variant="ghost" onClick={toggle} disabled={busy}>{isActive ? "Deactivate" : "Activate"}</Button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  );
}
