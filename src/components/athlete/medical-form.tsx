"use client";

import * as React from "react";
import { ShieldAlert } from "lucide-react";
import { upsertMedical, type MedicalInput } from "@/lib/actions/athlete";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label, Badge } from "@/components/ui";

export function MedicalForm({
  athleteId,
  initial,
}: {
  athleteId: string;
  initial?: Partial<MedicalInput>;
}) {
  const [f, setF] = React.useState<MedicalInput>({
    allergies: initial?.allergies ?? "",
    conditions: initial?.conditions ?? "",
    medications: initial?.medications ?? "",
    insurance: initial?.insurance ?? "",
    emergencyContactName: initial?.emergencyContactName ?? "",
    emergencyContactPhone: initial?.emergencyContactPhone ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof MedicalInput) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await upsertMedical(athleteId, f);
    setPending(false);
    if (res && !res.ok) setError(res.error);
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-maroon" /> Medical information</CardTitle>
        <Badge tone="danger">Sensitive</Badge>
      </CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div><Label htmlFor="alg">Allergies</Label><Input id="alg" value={f.allergies} onChange={(e) => set("allergies")(e.target.value)} placeholder="e.g. Peanuts · EpiPen in kit bag" /></div>
          <div><Label htmlFor="cond">Conditions</Label><Input id="cond" value={f.conditions} onChange={(e) => set("conditions")(e.target.value)} placeholder="e.g. Mild asthma · inhaler at camp" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="med">Medications</Label><Input id="med" value={f.medications} onChange={(e) => set("medications")(e.target.value)} /></div>
            <div><Label htmlFor="ins">Insurance</Label><Input id="ins" value={f.insurance} onChange={(e) => set("insurance")(e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="ecn">Emergency contact</Label><Input id="ecn" value={f.emergencyContactName} onChange={(e) => set("emergencyContactName")(e.target.value)} placeholder="Name (relation)" /></div>
            <div><Label htmlFor="ecp">Emergency phone</Label><Input id="ecp" value={f.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone")(e.target.value)} placeholder="+41 …" /></div>
          </div>
          <div>
            <Label htmlFor="mnotes">Medical notes</Label>
            <textarea id="mnotes" value={f.notes} onChange={(e) => set("notes")(e.target.value)} rows={3}
              className="w-full rounded border border-line bg-surface-input px-3 py-2 text-sm text-ink" />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save medical info"}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
