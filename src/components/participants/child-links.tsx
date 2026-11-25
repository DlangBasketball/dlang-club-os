"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { revokeChildLink, updateChildLink } from "@/lib/actions/participants";
import {
  CHILD_LINK_RELATIONS, normaliseChildLink, type ChildLinkPermissions, type ChildLinkRelation,
} from "@/lib/participants/validation";
import type { ChildLink } from "@/lib/participants/server";

/**
 * Permissions of an adult linked to one child only ("This child only"):
 * relation + what they may do. Booking implies paying (a linker's bookings
 * are invoiced to them, never to the family).
 */
export function ChildLinkPermissionFields({ value, onChange, idPrefix, carerConsent = false }: {
  value: ChildLinkPermissions; onChange: (v: ChildLinkPermissions) => void; idPrefix: string;
  /** Club setting "Linked relatives may give activity consent": the permission is offered only while ON. */
  carerConsent?: boolean;
}) {
  const t = useT();
  const set = <K extends keyof ChildLinkPermissions>(k: K, v: ChildLinkPermissions[K]) => onChange(normaliseChildLink({ ...value, [k]: v }, k));
  const box = (k: "canRegister" | "canPay" | "canSeeMedical" | "receivesEmails" | "canEditProfile" | "canConsent") => (
    <label className="flex items-start gap-2 text-sm text-text">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={value[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>{t(`participants.childLinks.perm.${k}`)}</span>
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="max-w-xs">
        <Label htmlFor={`${idPrefix}-relation`}>{t("participants.childLinks.relation")}</Label>
        <Select id={`${idPrefix}-relation`} value={value.relation} onChange={(e) => set("relation", e.target.value as ChildLinkRelation)}>
          {CHILD_LINK_RELATIONS.map((r) => <option key={r} value={r}>{t(`participants.childLinks.relations.${r}`)}</option>)}
        </Select>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-text-muted">{t("participants.link.permissions")}</legend>
        {box("canRegister")}
        {box("canPay")}
        {box("receivesEmails")}
        {box("canSeeMedical")}
        {box("canEditProfile")}
        {carerConsent && box("canConsent")}
      </fieldset>
      {carerConsent && <p className="text-xs text-text-muted">{t("participants.carerConsent.permissionHint")}</p>}
      <p className="text-xs text-text-muted">{t(carerConsent ? "participants.childLinks.privacyHintCarer" : "participants.childLinks.privacyHint")}</p>
    </div>
  );
}

const toPerm = (l: ChildLink): ChildLinkPermissions => ({
  relation: (CHILD_LINK_RELATIONS as readonly string[]).includes(l.relation) ? (l.relation as ChildLinkRelation) : "other_carer",
  canRegister: l.canRegister, canPay: l.canPay, canSeeMedical: l.canSeeMedical, receivesEmails: l.receivesEmails, canEditProfile: l.canEditProfile,
  canConsent: l.canConsent,
});

function ChildLinkRow({ link, showChild, carerConsent }: { link: ChildLink; showChild: boolean; carerConsent: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [perm, setPerm] = React.useState<ChildLinkPermissions>(() => toPerm(link));
  const [busy, setBusy] = React.useState<"save" | "revoke" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const active = link.status === "active";
  // A stored consent permission is ignored (and not shown) while the club setting is OFF.
  const granted = (["canRegister", "canPay", "receivesEmails", "canSeeMedical", "canEditProfile", "canConsent"] as const)
    .filter((k) => link[k] && (k !== "canConsent" || carerConsent));

  async function save() {
    setBusy("save"); setMsg(null);
    const res = await updateChildLink(link.id, perm);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) { setEditing(false); router.refresh(); }
  }
  async function revoke() {
    if (!window.confirm(t("participants.childLinks.revokeConfirm", { name: link.name ?? link.email ?? "—" }))) return;
    setBusy("revoke"); setMsg(null);
    const res = await revokeChildLink(link.id);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-text">
            <span className="font-medium">{link.name ?? link.email ?? "—"}</span>
            <Badge tone="info">{t.dynamic(`participants.childLinks.relations.${link.relation}`, undefined, link.relation)}</Badge>
            {!active && <Badge tone="neutral">{t("participants.childLinks.revokedBadge")}</Badge>}
            {link.viaInvitation && <Badge tone="neutral">{t("participants.invite.badge")}</Badge>}
          </div>
          <p className="text-xs text-text-muted">
            {[showChild && link.athleteFirstName ? t("participants.childLinks.forChild", { child: link.athleteFirstName }) : null,
              link.email, f.date(link.grantedAt)].filter(Boolean).join(" · ")}
          </p>
          {active && (
            <p className="text-xs text-text-muted">
              {granted.length ? granted.map((k) => t(`participants.childLinks.short.${k}`)).join(", ") : t("participants.childLinks.viewOnly")}
            </p>
          )}
        </div>
        {active && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing((e) => !e)} disabled={busy !== null}>
              {t("participants.childLinks.edit")}
            </Button>
            <Button type="button" size="sm" variant="ghost" loading={busy === "revoke"} disabled={busy !== null} onClick={() => void revoke()}>
              {t("participants.childLinks.revoke")}
            </Button>
          </div>
        )}
      </div>
      {editing && active && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <ChildLinkPermissionFields value={perm} onChange={setPerm} idPrefix={`cl-${link.id}`} carerConsent={carerConsent} />
          <Button type="button" size="sm" loading={busy === "save"} disabled={busy !== null} onClick={() => void save()}>
            {t("participants.childLinks.save")}
          </Button>
        </div>
      )}
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </li>
  );
}

/**
 * Adults linked to one child only (aunts, uncles, grandparents, friends):
 * the child's family guardians (parent app, My family) and staff (admin
 * athlete page) see, adjust and revoke them. Revocation is immediate.
 */
export function ChildLinksManager({ links, showChild = true, title, carerConsent = false }: {
  links: ChildLink[]; showChild?: boolean; title?: string; carerConsent?: boolean;
}) {
  const t = useT();
  if (!links.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{title ?? t("participants.childLinks.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-1">
        <p className="text-xs text-text-muted">{t("participants.childLinks.description")}</p>
        <ul className="divide-y divide-border-soft">
          {links.map((l) => <ChildLinkRow key={l.id} link={l} showChild={showChild} carerConsent={carerConsent} />)}
        </ul>
      </CardBody>
    </Card>
  );
}

/** The linked adult ends their own link (child page). */
export function LeaveChildLinkButton({ linkId }: { linkId: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="ghost" loading={busy} onClick={async () => {
        if (!window.confirm(t("participants.childLinks.leaveConfirm"))) return;
        setBusy(true); setErr(null);
        const res = await revokeChildLink(linkId);
        setBusy(false);
        if (!res.ok) { setErr(res.error); return; }
        router.push("/parent/athletes");
        router.refresh();
      }}>{t("participants.childLinks.leave")}</Button>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
