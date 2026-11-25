"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { inviteRelative, revokeRelativeInvite } from "@/lib/actions/relative-invites";
import { DEFAULT_CHILD_LINK, type ChildLinkPermissions } from "@/lib/participants/validation";
import type { ChildLinkInvite } from "@/lib/participants/server";
import { ChildLinkPermissionFields } from "./child-links";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "");

/**
 * A family guardian invites a relative or friend by e-mail for ONE child:
 * relation + per-child permissions (same defaults as an approved "This child
 * only" link). The invitee accepts with the invited e-mail address.
 */
export function InviteRelativeForm({ kids, carerConsent = false, defaultOpen = false }: {
  kids: { id: string; firstName: string }[]; carerConsent?: boolean; defaultOpen?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(defaultOpen);
  const [athleteId, setAthleteId] = React.useState(kids[0]?.id ?? "");
  const [email, setEmail] = React.useState("");
  const [perm, setPerm] = React.useState<ChildLinkPermissions>(DEFAULT_CHILD_LINK);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  // One id per intent: a double click / retry never creates two invitations.
  const requestId = React.useRef<string>(newId());
  if (!kids.length) return null;
  const child = kids.find((k) => k.id === athleteId) ?? kids[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await inviteRelative(child.id, { email, permissions: perm }, requestId.current);
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) {
      requestId.current = newId();
      setEmail(""); setPerm(DEFAULT_CHILD_LINK);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("participants.invite.title")}</CardTitle>
        {!open && <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>{t("participants.invite.open")}</Button>}
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-xs text-text-muted">{t("participants.invite.description")}</p>
        {open && (
          <form className="space-y-3" onSubmit={(e) => void submit(e)}>
            {kids.length > 1 && (
              <div className="max-w-xs">
                <Label htmlFor="ri-child">{t("participants.invite.child")}</Label>
                <Select id="ri-child" value={child.id} onChange={(e) => setAthleteId(e.target.value)}>
                  {kids.map((k) => <option key={k.id} value={k.id}>{k.firstName}</option>)}
                </Select>
              </div>
            )}
            <div className="max-w-sm">
              <Label htmlFor="ri-email">{t("participants.invite.emailAddress")}</Label>
              <Input id="ri-email" type="email" autoComplete="off" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <ChildLinkPermissionFields value={perm} onChange={setPerm} idPrefix="ri" carerConsent={carerConsent} />
            <p className="text-xs text-text-muted">{t("participants.invite.emailHint", { child: child.firstName })}</p>
            {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
            <Button type="submit" size="sm" loading={busy} disabled={busy || !email.trim()}>{t("participants.invite.send")}</Button>
          </form>
        )}
        {!open && msg && <p role="status" className="text-sm text-success">{msg.text}</p>}
      </CardBody>
    </Card>
  );
}

function InviteRow({ inv, showChild, canRevoke }: { inv: ChildLinkInvite; showChild: boolean; canRevoke: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  async function revoke() {
    if (!window.confirm(t("participants.invite.revokeConfirm", { email: inv.email }))) return;
    setBusy(true); setErr(null);
    const res = await revokeRelativeInvite(inv.id);
    setBusy(false);
    if (!res.ok) { setErr(res.error); return; }
    router.refresh();
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm text-text">
          <span className="font-medium">{inv.email}</span>
          <Badge tone="info">{t.dynamic(`participants.childLinks.relations.${inv.relation}`, undefined, inv.relation)}</Badge>
          <Badge tone={inv.status === "pending" ? "warning" : inv.status === "accepted" ? "success" : "neutral"}>
            {t.dynamic(`participants.invite.status.${inv.status}`, undefined, inv.status)}
          </Badge>
        </div>
        <p className="text-xs text-text-muted">
          {[showChild && inv.athleteFirstName ? t("participants.childLinks.forChild", { child: inv.athleteFirstName }) : null,
            inv.invitedByName ? t("participants.invite.by", { name: inv.invitedByName }) : null,
            inv.status === "pending" ? t("participants.invite.expiresOn", { date: f.date(inv.expiresAt) }) : f.date(inv.createdAt)]
            .filter(Boolean).join(" · ")}
        </p>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      </div>
      {canRevoke && inv.status === "pending" && (
        <Button type="button" size="sm" variant="ghost" loading={busy} onClick={() => void revoke()}>{t("participants.invite.revoke")}</Button>
      )}
    </li>
  );
}

/** Invitations sent for the family's children (parent app) or one child (admin athlete page). */
export function RelativeInvitesList({ invites, showChild = true, canRevoke = true, title }: {
  invites: ChildLinkInvite[]; showChild?: boolean; canRevoke?: boolean; title?: string;
}) {
  const t = useT();
  if (!invites.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{title ?? t("participants.invite.pendingTitle")}</CardTitle></CardHeader>
      <CardBody>
        <ul className="divide-y divide-border-soft">
          {invites.map((i) => <InviteRow key={i.id} inv={i} showChild={showChild} canRevoke={canRevoke} />)}
        </ul>
      </CardBody>
    </Card>
  );
}
