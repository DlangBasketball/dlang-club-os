"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, ExternalLink, HandHeart, Video } from "lucide-react";
import { Badge, Button, Card, CardBody, EmptyState, Input, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { decideApplication, setApplicantSponsorship, withdrawApplication } from "@/lib/actions/selection";
import { reviewerChoices, type ApplicationStatus } from "@/lib/selection/rules";
import { ApplicationStatusBadge, Field, Notice } from "./shared";

export type ReviewEntry = {
  id: string; status: ApplicationStatus; divisionId: string | null; divisionName: string | null; packageName: string | null;
  name: string; birthYear: number | null; position: string | null; currentClub: string | null; notes: string | null; videoUrl: string | null;
  isMember: boolean; decisionNote: string | null; staffNotes: string | null; invoiceId: string | null; installmentCount: number | null;
  sponsorshipKind: string | null; sponsorshipPercent: number | null; appliedAt: string;
};

const FILTERS = ["open", "all", "accepted", "enrolled", "waitlisted", "declined", "withdrawn"] as const;
type Filter = (typeof FILTERS)[number];

export function ReviewBoard({ entries, divisions, canOverrideDivision, canSponsor, canEnroll, invoiceHref }: {
  entries: ReviewEntry[]; divisions: { id: string; name: string }[]; canOverrideDivision: boolean; canSponsor: boolean;
  canEnroll: boolean; invoiceHref: string | null;
}) {
  const t = useT();
  const [filter, setFilter] = React.useState<Filter>("open");
  const [division, setDivision] = React.useState("");
  const [open, setOpen] = React.useState<string | null>(null);
  const shown = entries.filter((e) =>
    (division === "" || e.divisionId === division)
    && (filter === "all" || (filter === "open" ? e.status === "applied" || e.status === "under_review" : e.status === filter)));
  const count = (f: Filter) => entries.filter((e) => f === "all" || (f === "open" ? e.status === "applied" || e.status === "under_review" : e.status === f)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "primary" : "secondary"} onClick={() => setFilter(f)}>
            {t(`selection.review.filters.${f}`)} <span className="tnum opacity-70">{count(f)}</span>
          </Button>
        ))}
        {divisions.length > 1 && (
          <Select aria-label={t("selection.review.division")} className="w-auto" value={division} onChange={(e) => setDivision(e.target.value)}>
            <option value="">{t("selection.review.allDivisions")}</option>
            {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </div>
      {shown.length === 0 && <EmptyState title={t("selection.review.empty")} />}
      {shown.map((e) => (
        <Card key={e.id}>
          <CardBody className="space-y-3">
            <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={open === e.id}
              onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{e.name}</span>
                  <ApplicationStatusBadge status={e.status} />
                  {!e.isMember && <Badge tone="accent">{t("selection.review.nonMember")}</Badge>}
                  {e.sponsorshipKind && <Badge tone="success"><HandHeart className="h-3 w-3" /> {e.sponsorshipKind === "full" ? t("selection.sponsor.full") : t("selection.sponsor.partialPct", { percent: e.sponsorshipPercent ?? 0 })}</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {[e.divisionName, e.packageName, e.birthYear ? t("selection.review.born", { year: e.birthYear }) : null, e.position,
                    e.currentClub ? t("selection.review.club", { club: e.currentClub }) : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              {open === e.id ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>
            {open === e.id && (
              <ReviewDetail entry={e} divisions={divisions} canOverrideDivision={canOverrideDivision} canSponsor={canSponsor}
                canEnroll={canEnroll} invoiceHref={invoiceHref} />
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function ReviewDetail({ entry: e, divisions, canOverrideDivision, canSponsor, canEnroll, invoiceHref }: {
  entry: ReviewEntry; divisions: { id: string; name: string }[]; canOverrideDivision: boolean; canSponsor: boolean;
  canEnroll: boolean; invoiceHref: string | null;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const choices = [...reviewerChoices(e.status), ...(canEnroll && e.status === "accepted" ? (["enrolled"] as const) : [])];
  const [status, setStatus] = React.useState<string>("");
  const [note, setNote] = React.useState("");
  const [staffNotes, setStaffNotes] = React.useState(e.staffNotes ?? "");
  const [divisionId, setDivisionId] = React.useState(e.divisionId ?? "");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [sp, setSp] = React.useState({ kind: e.sponsorshipKind ?? "none", percent: e.sponsorshipPercent ? String(e.sponsorshipPercent) : "", sponsorName: "" });

  async function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? { tone: "ok", text: res.message ?? "" } : { tone: "err", text: res.error ?? "" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4 border-t border-border pt-3 text-sm">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-xs text-text-muted">{t("selection.review.applied")}</dt><dd>{f.dateTime(e.appliedAt)}</dd></div>
        {e.notes && <div className="sm:col-span-2"><dt className="text-xs text-text-muted">{t("selection.review.familyNotes")}</dt><dd className="whitespace-pre-wrap">{e.notes}</dd></div>}
        {e.videoUrl && /^https:\/\//i.test(e.videoUrl) && (
          <div><dt className="text-xs text-text-muted">{t("selection.review.video")}</dt>
            <dd><a href={e.videoUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 text-brand-primary hover:underline"><Video className="h-4 w-4" /> {t("selection.review.openVideo")}</a></dd></div>
        )}
        {e.decisionNote && <div className="sm:col-span-2"><dt className="text-xs text-text-muted">{t("selection.review.lastMessage")}</dt><dd className="whitespace-pre-wrap">{e.decisionNote}</dd></div>}
        {e.invoiceId && invoiceHref && (
          <div><dt className="text-xs text-text-muted">{t("selection.review.invoice")}</dt>
            <dd><Link href={`${invoiceHref}${e.invoiceId}`} className="inline-flex items-center gap-1 text-brand-primary hover:underline"><ExternalLink className="h-3 w-3" /> {t("selection.review.openInvoice")}</Link>
              {e.installmentCount && e.installmentCount > 1 ? <span className="text-text-muted"> · {t("selection.review.instalments", { count: e.installmentCount })}</span> : null}</dd></div>
        )}
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("selection.review.decision")} htmlFor={`st-${e.id}`}>
          <Select id={`st-${e.id}`} value={status} onChange={(x) => setStatus(x.target.value)} disabled={choices.length === 0}>
            <option value="">{t("selection.review.keepStatus")}</option>
            {choices.map((c) => <option key={c} value={c}>{t(`selection.review.actions.${c}`)}</option>)}
          </Select>
        </Field>
        {canOverrideDivision && divisions.length > 0 && (
          <Field label={t("selection.review.division")} htmlFor={`dv-${e.id}`}>
            <Select id={`dv-${e.id}`} value={divisionId} onChange={(x) => setDivisionId(x.target.value)}>
              {!e.divisionId && <option value="">{t("selection.common.none")}</option>}
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field label={t("selection.review.messageToFamily")} htmlFor={`nt-${e.id}`} hint={t("selection.review.messageHint")}>
            <Textarea id={`nt-${e.id}`} value={note} maxLength={2000} onChange={(x) => setNote(x.target.value)} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("selection.review.staffNotes")} htmlFor={`sn-${e.id}`} hint={t("selection.review.staffNotesHint")}>
            <Textarea id={`sn-${e.id}`} value={staffNotes} maxLength={2000} onChange={(x) => setStaffNotes(x.target.value)} />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => act(() => decideApplication(e.id, {
          status: status as "" | "under_review" | "accepted" | "waitlisted" | "declined" | "enrolled", note, staffNotes,
          divisionId: canOverrideDivision && divisionId !== (e.divisionId ?? "") ? divisionId : "",
        }))}>{t("selection.review.save")}</Button>
        {e.status !== "withdrawn" && e.status !== "declined" && (
          <Button size="sm" variant="ghost" disabled={busy}
            onClick={() => window.confirm(t("selection.review.confirmWithdraw")) && act(() => withdrawApplication(e.id, note))}>{t("selection.review.withdraw")}</Button>
        )}
      </div>

      {canSponsor && (e.status === "accepted" || e.status === "enrolled" || e.status === "under_review" || e.status === "applied") && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="flex items-center gap-2 font-medium text-text"><HandHeart className="h-4 w-4" /> {t("selection.sponsor.title")}</p>
          <p className="text-xs text-text-muted">{t("selection.sponsor.hint")}</p>
          <div className="grid gap-2 sm:grid-cols-4">
            <Select aria-label={t("selection.sponsor.kind")} value={sp.kind} onChange={(x) => setSp((s) => ({ ...s, kind: x.target.value }))}>
              <option value="none">{t("selection.sponsor.none")}</option>
              <option value="full">{t("selection.sponsor.full")}</option>
              <option value="partial">{t("selection.sponsor.partial")}</option>
            </Select>
            {sp.kind === "partial" && <Input aria-label={t("selection.sponsor.percent")} inputMode="numeric" placeholder="%" value={sp.percent} onChange={(x) => setSp((s) => ({ ...s, percent: x.target.value }))} />}
            {sp.kind !== "none" && <Input aria-label={t("selection.sponsor.sponsorName")} placeholder={t("selection.sponsor.sponsorName")} value={sp.sponsorName} onChange={(x) => setSp((s) => ({ ...s, sponsorName: x.target.value }))} />}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => act(() => setApplicantSponsorship(e.id, { kind: sp.kind as "none" | "full" | "partial", percent: sp.percent, sponsorName: sp.sponsorName }))}>
              {t("selection.sponsor.apply")}
            </Button>
          </div>
        </div>
      )}
      <Notice msg={msg} />
    </div>
  );
}
