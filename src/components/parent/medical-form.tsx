"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { updateChildMedical } from "@/lib/actions/parent";

type Med = { allergies: string; conditions: string; medications: string; notes: string; emergencyContactName: string; emergencyContactPhone: string };
export function MedicalForm({ athleteId, initial }: { athleteId: string; initial: Med }) {
  const router = useRouter();
  const [m, setM] = React.useState<Med>(initial);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = (k: keyof Med) => (v: string) => setM((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setMsg(null); setErr(null);
    const res = await updateChildMedical(athleteId, m);
    setPending(false);
    if (res.ok) { setMsg("Saved — changes are recorded"); router.refresh(); } else setErr(res.error);
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="al">Allergies</Label><Input id="al" value={m.allergies} onChange={(e) => set("allergies")(e.target.value)} /></div>
        <div><Label htmlFor="co">Conditions</Label><Input id="co" value={m.conditions} onChange={(e) => set("conditions")(e.target.value)} /></div>
        <div><Label htmlFor="md">Medications</Label><Input id="md" value={m.medications} onChange={(e) => set("medications")(e.target.value)} /></div>
        <div><Label htmlFor="no">Notes</Label><Input id="no" value={m.notes} onChange={(e) => set("notes")(e.target.value)} /></div>
        <div><Label htmlFor="en">Emergency contact</Label><Input id="en" value={m.emergencyContactName} onChange={(e) => set("emergencyContactName")(e.target.value)} /></div>
        <div><Label htmlFor="ep">Emergency phone</Label><Input id="ep" value={m.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone")(e.target.value)} /></div>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Update medical info"}</Button>
        {msg && <span className="text-sm text-success">{msg}</span>}
      </div>
      <p className="text-xs text-ink-3">For your child&apos;s safety, all medical changes are logged with a timestamp.</p>
    </form>
  );
}
