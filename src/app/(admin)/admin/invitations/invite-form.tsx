"use client";

import * as React from "react";
import { inviteUser } from "@/lib/auth/invitations";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";
import type { AppRole } from "@/lib/auth/roles";

export function InviteForm({ families }: { families: { id: string; name: string }[] }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<AppRole>("parent");
  const [familyId, setFamilyId] = React.useState("");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await inviteUser({
      email,
      role,
      familyId: role === "parent" ? familyId || null : null,
    });
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Invitation sent to ${email}.` });
      setEmail("");
      setFamilyId("");
    } else {
      setMsg({ ok: false, text: res.error });
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-4 sm:items-end">
          <div className="sm:col-span-2">
            <Label htmlFor="inv-email">Email</Label>
            <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="parent@example.com" />
          </div>
          <div>
            <Label htmlFor="inv-role">Role</Label>
            <select
              id="inv-role"
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink"
            >
              <option value="parent">Parent</option>
              <option value="coach">Coach</option>
              <option value="finance">Finance</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {role === "parent" && (
            <div>
              <Label htmlFor="inv-family">Family</Label>
              <select
                id="inv-family"
                value={familyId}
                onChange={(e) => setFamilyId(e.target.value)}
                className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink"
              >
                <option value="">Select family…</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="sm:col-span-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send invitation"}
            </Button>
            {msg && (
              <span className={`ml-3 text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
