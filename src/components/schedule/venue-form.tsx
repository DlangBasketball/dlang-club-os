"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { FormError } from "@/components/teams/fields";
import { addVenueSpace, createVenue, setVenueActive, updateVenue } from "@/lib/sportsops/actions";
import { useT } from "@/lib/i18n/client";

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

/** Inline edit of a venue's name, address, city and capacity (admin). */
export function VenueEditButton({ venue }: { venue: { id: string; name: string; address: string | null; city: string | null; capacity: number | null } }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [v, setV] = React.useState({ name: venue.name, address: venue.address ?? "", city: venue.city ?? "", capacity: venue.capacity?.toString() ?? "" });
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const res = await updateVenue(venue.id, { name: v.name, address: v.address, city: v.city, capacity: v.capacity ? Number(v.capacity) : null });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    setOpen(false); router.refresh();
  }
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Pencil className="h-3.5 w-3.5" /> {t("common.edit")}</Button>;
  return (
    <form onSubmit={onSubmit} className="grid w-full grid-cols-1 gap-2 rounded-md border border-line p-3 sm:grid-cols-2">
      <div><Label htmlFor={`ve-n-${venue.id}`}>{t("common.name")}</Label><Input id={`ve-n-${venue.id}`} required maxLength={120} value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} /></div>
      <div><Label htmlFor={`ve-a-${venue.id}`}>{t("editOps.venues.address")}</Label><Input id={`ve-a-${venue.id}`} maxLength={200} value={v.address} onChange={(e) => setV((s) => ({ ...s, address: e.target.value }))} /></div>
      <div><Label htmlFor={`ve-c-${venue.id}`}>{t("editOps.venues.city")}</Label><Input id={`ve-c-${venue.id}`} maxLength={100} value={v.city} onChange={(e) => setV((s) => ({ ...s, city: e.target.value }))} /></div>
      <div><Label htmlFor={`ve-k-${venue.id}`}>{t("editOps.venues.capacity")}</Label><Input id={`ve-k-${venue.id}`} inputMode="numeric" value={v.capacity} onChange={(e) => setV((s) => ({ ...s, capacity: e.target.value.replace(/\D/g, "").slice(0, 6) }))} /></div>
      <FormError message={err} />
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
