"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { decideLinkRequest, withdrawLinkRequest } from "@/lib/actions/participants";
import type { LinkPermissions } from "@/lib/participants/validation";

export type InboxItem = {
  id: string; athleteFirstName: string; requesterName: string | null; requesterEmail: string | null; relation: string; createdAt: string;
  /** Staff queue only. */
  athleteName?: string; familyName?: string | null; athleteHref?: string;
};

/** Approve / decline one link request; the approver chooses what the new guardian may do. */
export function LinkDecision({ item, staff = false }: { item: InboxItem; staff?: boolean }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [perm, setPerm] = React.useState<LinkPermissions>({ canPay: false, canSeeMedical: false, receivesEmails: true });
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function decide(d: "approve" | "decline") {
    setBusy(d); setMsg(null);
    const res = await decideLinkRequest(item.id, d, perm, note);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  const box = (k: keyof LinkPermissions, label: string) => (
    <label className="flex items-center gap-2 text-sm text-text">
      <input type="checkbox" className="h-4 w-4 accent-[var(--red-primary)]" checked={perm[k]} onChange={(e) => setPerm((p) => ({ ...p, [k]: e.target.checked }))} />
      {label}
    </label>
  );
  return (
    <div className="space-y-3">
      <p className="text-sm text-text">
        {t("participants.link.inboxLine", {
          name: item.requesterName ?? item.requesterEmail ?? "—",
          relation: t.dynamic(`participants.relations.${item.relation}`, undefined, item.relation),
          child: staff && item.athleteName ? item.athleteName : item.athleteFirstName,
        })}
      </p>
      <p className="text-xs text-text-muted">
        {[item.requesterEmail, staff && item.familyName ? item.familyName : null, f.date(item.createdAt)].filter(Boolean).join(" · ")}
        {staff && item.athleteHref && <> · <a href={item.athleteHref} className="text-brand-primary hover:underline">{t("participants.review.openAthlete")}</a></>}
      </p>
      <p className="text-xs text-text-muted">{staff ? t("participants.link.staffVerifyHint") : t("participants.link.verifyHint")}</p>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-text-muted">{t("participants.link.permissions")}</legend>
        {box("receivesEmails", t("participants.link.receivesEmails"))}
        {box("canPay", t("participants.link.canPay"))}
        {box("canSeeMedical", t("participants.link.canSeeMedical"))}
      </fieldset>
      <div>
        <Label htmlFor={`ld-note-${item.id}`}>{t("participants.review.note")}</Label>
        <Input id={`ld-note-${item.id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" loading={busy === "approve"} disabled={busy !== null} onClick={() => void decide("approve")}>{t("participants.link.approve")}</Button>
        <Button type="button" size="sm" variant="secondary" loading={busy === "decline"} disabled={busy !== null} onClick={() => void decide("decline")}>{t("participants.link.decline")}</Button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/** Parent app (My family): requests from adults who say they care for one of the family's children. */
export function LinkInbox({ items }: { items: InboxItem[] }) {
  const t = useT();
  if (!items.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("participants.link.inboxTitle")}</CardTitle></CardHeader>
      <CardBody className="space-y-5 divide-y divide-border-soft">
        {items.map((i) => <div key={i.id} className="pt-4 first:pt-0"><LinkDecision item={i} /></div>)}
      </CardBody>
    </Card>
  );
}

export type MyLink = { id: string; firstName: string; lastName: string; status: string; createdAt: string };

/** The adult's own link requests: status only (never the matched record). */
export function MyLinkRequests({ items }: { items: MyLink[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!items.length) return null;
  const tone = (s: string) => (s === "approved" ? "success" : s === "pending" ? "info" : "neutral") as "success" | "info" | "neutral";
  return (
    <Card>
      <CardHeader><CardTitle>{t("participants.link.myTitle")}</CardTitle></CardHeader>
      <CardBody>
        <ul className="divide-y divide-border-soft text-sm">
          {items.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="text-text">{l.firstName} {l.lastName}<span className="ml-2 text-xs text-text-muted">{f.date(l.createdAt)}</span></span>
              <span className="flex items-center gap-2">
                <Badge tone={tone(l.status)}>{t.dynamic(`participants.link.status.${l.status}`, undefined, l.status)}</Badge>
                {l.status === "pending" && (
                  <Button type="button" size="sm" variant="ghost" loading={busy === l.id}
                    onClick={async () => { setBusy(l.id); await withdrawLinkRequest(l.id); setBusy(null); router.refresh(); }}>
                    {t("participants.link.withdraw")}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
