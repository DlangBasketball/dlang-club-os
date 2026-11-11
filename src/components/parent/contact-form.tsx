"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label } from "@/components/ui";
import { updateContact } from "@/lib/actions/parent";

type Props = {
  fullName: string; email: string; profilePhone: string;
  familyId: string | null; familyPhone: string; familyAddress: string; contactEmail: string;
};
export function ContactForm(p: Props) {
  const router = useRouter();
  const [f, setF] = React.useState(p);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const set = (k: keyof Props) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setMsg(null); setErr(null);
    const res = await updateContact({
      fullName: f.fullName, profilePhone: f.profilePhone,
      familyId: f.familyId ?? undefined, familyPhone: f.familyPhone, familyAddress: f.familyAddress, contactEmail: f.contactEmail || "",
    });
    setPending(false);
    if (res.ok) { setMsg("Saved"); router.refresh(); } else setErr(res.error);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div><Label htmlFor="n">Your name</Label><Input id="n" value={f.fullName} onChange={(e) => set("fullName")(e.target.value)} /></div>
        <div><Label htmlFor="e">Email</Label><Input id="e" value={f.email} disabled className="opacity-60" /></div>
        <div><Label htmlFor="pp">Your phone</Label><Input id="pp" value={f.profilePhone} onChange={(e) => set("profilePhone")(e.target.value)} /></div>
      </div>
      {f.familyId && (
        <div className="rounded-md border border-line bg-surface-elevated/50 p-4">
          <div className="mb-3 text-sm font-medium text-ink">Household</div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="fp">Family phone</Label><Input id="fp" value={f.familyPhone} onChange={(e) => set("familyPhone")(e.target.value)} /></div>
            <div><Label htmlFor="ce">Billing email</Label><Input id="ce" value={f.contactEmail} onChange={(e) => set("contactEmail")(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="fa">Address</Label><Input id="fa" value={f.familyAddress} onChange={(e) => set("familyAddress")(e.target.value)} /></div>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        {msg && <span className="text-sm text-success">{msg}</span>}
      </div>
    </form>
  );
}
