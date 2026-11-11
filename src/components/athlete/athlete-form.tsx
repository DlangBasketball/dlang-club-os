"use client";

import * as React from "react";
import { createAthlete, updateAthlete, type AthleteInput } from "@/lib/actions/athlete";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";

const JERSEY = ["YS", "YM", "YL", "S", "M", "L", "XL"];
const HANDS = ["Right", "Left", "Ambidextrous"];
const STATUS = ["active", "inactive", "archived"];

function Select({ id, value, onChange, options, placeholder }: {
  id: string; value: string; onChange: (v: string) => void; options: string[]; placeholder?: string;
}) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function AthleteForm({
  familyId,
  athleteId,
  initial,
}: {
  familyId: string;
  athleteId?: string;
  initial?: Partial<AthleteInput>;
}) {
  const [f, setF] = React.useState<AthleteInput>({
    familyId,
    firstName: initial?.firstName ?? "",
    lastName: initial?.lastName ?? "",
    dob: initial?.dob ?? "",
    gender: initial?.gender ?? "",
    nationality: initial?.nationality ?? "",
    school: initial?.school ?? "",
    jerseySize: initial?.jerseySize ?? "",
    dominantHand: initial?.dominantHand ?? "",
    positionPref: initial?.positionPref ?? "",
    status: initial?.status ?? "active",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof AthleteInput) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = athleteId ? await updateAthlete(athleteId, f) : await createAthlete(f);
    setPending(false);
    if (res && !res.ok) setError(res.error);
  }

  return (
    <Card className="max-w-2xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="fn">First name</Label><Input id="fn" required value={f.firstName} onChange={(e) => set("firstName")(e.target.value)} /></div>
            <div><Label htmlFor="ln">Last name</Label><Input id="ln" required value={f.lastName} onChange={(e) => set("lastName")(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="dob">Date of birth</Label><Input id="dob" type="date" required value={f.dob} onChange={(e) => set("dob")(e.target.value)} /></div>
            <div><Label htmlFor="gender">Gender</Label><Select id="gender" value={f.gender ?? ""} onChange={set("gender")} options={["Male", "Female", "Other"]} placeholder="Select…" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="nat">Nationality</Label><Input id="nat" value={f.nationality} onChange={(e) => set("nationality")(e.target.value)} /></div>
            <div><Label htmlFor="school">School</Label><Input id="school" value={f.school} onChange={(e) => set("school")(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><Label htmlFor="jersey">Jersey size</Label><Select id="jersey" value={f.jerseySize ?? ""} onChange={set("jerseySize")} options={JERSEY} placeholder="—" /></div>
            <div><Label htmlFor="hand">Dominant hand</Label><Select id="hand" value={f.dominantHand ?? ""} onChange={set("dominantHand")} options={HANDS} placeholder="—" /></div>
            <div><Label htmlFor="status">Status</Label><Select id="status" value={f.status ?? "active"} onChange={set("status")} options={STATUS} /></div>
          </div>
          <div><Label htmlFor="pos">Preferred position</Label><Input id="pos" value={f.positionPref} onChange={(e) => set("positionPref")(e.target.value)} placeholder="Point guard" /></div>
          <div>
            <Label htmlFor="notes">Notes</Label>
            <textarea id="notes" value={f.notes} onChange={(e) => set("notes")(e.target.value)} rows={3}
              className="w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink" placeholder="General notes (non-medical)…" />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : athleteId ? "Save changes" : "Add athlete"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
