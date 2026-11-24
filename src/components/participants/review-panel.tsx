"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { decideChangeRequest } from "@/lib/actions/participants";
import type { ReviewQueue } from "@/lib/participants/server";
import { LinkDecision } from "./link-requests";

function ChangeDecision({ c }: { c: ReviewQueue["changes"][number] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState<"approve" | "decline" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const sex = (v: string | null | undefined) => (v ? t.dynamic(`participants.sex.${v.toLowerCase()}`, undefined, v) : "—");
  async function decide(d: "approve" | "decline") {
    setBusy(d); setMsg(null);
    const res = await decideChangeRequest(c.id, d, note);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  const kinds = Array.from(new Set(c.impact.map((i) => i.kind)));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/admin/athletes/${c.athleteId}`} className="text-sm font-medium text-text hover:text-brand-primary">{c.athleteName}</Link>
        {kinds.map((k) => <Badge key={k} tone="info">{t.dynamic(`participants.review.impact.${k}`, undefined, k)}</Badge>)}
      </div>
      <ul className="text-sm text-text">
        {c.changes.dob && <li>{t("participants.review.dobChange", { from: c.previous.dob ? f.date(c.previous.dob) : "—", to: f.date(c.changes.dob) })}</li>}
        {c.changes.gender && <li>{t("participants.review.sexChange", { from: sex(c.previous.gender), to: sex(c.changes.gender) })}</li>}
      </ul>
      <p className="text-xs text-text-muted">{t("participants.review.requestedBy", { name: c.requestedByName ?? "—", date: f.dateTime(c.createdAt) })}</p>
      <div>
        <Label htmlFor={`cd-note-${c.id}`}>{t("participants.review.note")}</Label>
        <Input id={`cd-note-${c.id}`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("participants.review.notePlaceholder")} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" loading={busy === "approve"} disabled={busy !== null} onClick={() => void decide("approve")}>{t("participants.review.approve")}</Button>
        <Button type="button" size="sm" variant="secondary" loading={busy === "decline"} disabled={busy !== null} onClick={() => void decide("decline")}>{t("participants.review.decline")}</Button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/**
 * Data review (admins): profile corrections that could change a child's
 * eligibility, and requests to be linked to an existing child (full match
 * visible to staff only).
 */
export function ParticipantReviewPanel({ queue }: { queue: ReviewQueue }) {
  const t = useT();
  if (!queue.changes.length && !queue.links.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {queue.changes.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("participants.review.changesTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-5 divide-y divide-border-soft">
            {queue.changes.map((c) => <div key={c.id} className="pt-4 first:pt-0"><ChangeDecision c={c} /></div>)}
          </CardBody>
        </Card>
      )}
      {queue.links.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t("participants.review.linksTitle")}</CardTitle></CardHeader>
          <CardBody className="space-y-5 divide-y divide-border-soft">
            {queue.links.map((l) => (
              <div key={l.id} className="pt-4 first:pt-0">
                <LinkDecision staff item={{
                  id: l.id, athleteFirstName: l.athleteName, athleteName: l.athleteName, familyName: l.familyName,
                  requesterName: l.requesterName, requesterEmail: l.requesterEmail, relation: l.relation, createdAt: l.createdAt,
                  athleteHref: `/admin/athletes/${l.athleteId}`,
                }} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
