"use client";

import * as React from "react";
import { inviteUser } from "@/lib/auth/invitations";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";
import type { AppRole } from "@/lib/auth/roles";
import { useT } from "@/lib/i18n/client";

export function InviteForm({
  families,
  coaches = [],
  defaultRole,
  defaultCoachId,
}: {
  families: { id: string; name: string }[];
  /** Coaches without a login; a coach invite links the chosen coach row on acceptance. */
  coaches?: { id: string; name: string }[];
  defaultRole?: AppRole;
  defaultCoachId?: string;
}) {
  const t = useT();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<AppRole>(defaultRole ?? "parent");
  const [familyId, setFamilyId] = React.useState("");
  const [coachId, setCoachId] = React.useState(defaultCoachId ?? "");
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
      coachId: role === "coach" ? coachId || null : null,
    });
    setPending(false);
    if (res.ok) {
      setMsg({ ok: true, text: `Invitation sent to ${email}.` });
      setEmail("");
      setFamilyId("");
      setCoachId("");
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
          {role === "coach" && coaches.length > 0 && (
            <div>
              <Label htmlFor="inv-coach">{t("coaches.invite.coach")}</Label>
              <select
                id="inv-coach"
                value={coachId}
                onChange={(e) => setCoachId(e.target.value)}
                className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink"
              >
                <option value="">{t("coaches.invite.selectCoach")}</option>
                {coaches.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-3">{t("coaches.invite.hint")}</p>
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
