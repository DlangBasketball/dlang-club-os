"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ExternalLink, Mail, MessageCircle, Pencil, Phone, Send, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  deleteAlumni, deleteAlumniContact, deleteAlumniPlacement, saveAlumniContact, saveAlumniPlacement, sendAlumniEmailAction, setFollowUpDone,
} from "@/lib/actions/alumni";
import {
  CONTACT_KINDS, DIRECTIONS, INSTITUTION_TYPES, PLACEMENT_STATUSES, SCHOLARSHIPS, contactTarget, sendBlockReason, telHref,
  type ContactPerson,
} from "@/lib/alumni/rules";
import type { AlumniPlacementRow } from "@/lib/alumni/db";
import type { AlumniContactView } from "@/lib/alumni/data";
import { confirmationMatches } from "@/lib/people/person-delete";
import { PersonDialog } from "@/components/people/delete-person";
import { StatusLine, useFamilyAction } from "@/components/family/use-family-action";

export const PLACEMENT_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger" | "accent"> = {
  committed: "info", signed: "accent", enrolled: "success", transferred: "warning", graduated: "neutral", turned_pro: "accent", left: "danger",
};

// ---------------------------------------------------------------------------
// Placements timeline
// ---------------------------------------------------------------------------
function PlacementForm({ alumniId, initial, onDone }: { alumniId: string; initial?: AlumniPlacementRow; onDone: () => void }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [v, setV] = React.useState({
    institution: initial?.institution ?? "", institutionType: initial?.institution_type ?? "ncaa_d1", country: initial?.country ?? "",
    region: initial?.region ?? "", league: initial?.league ?? "", level: initial?.level ?? "", sport: initial?.sport ?? "",
    position: initial?.position ?? "", startDate: initial?.start_date ?? "", endYear: initial?.end_year ? String(initial.end_year) : "",
    scholarship: initial?.scholarship ?? "unknown", status: initial?.status ?? "committed", isCurrent: initial?.is_current ?? true,
    sourceNote: initial?.source_note ?? "", rosterUrl: initial?.roster_url ?? "",
  });
  const id = initial?.id ?? "new";
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => saveAlumniPlacement({ ...v, id: initial?.id ?? null, alumniId, endYear: v.endYear as never }));
      if (ok) onDone();
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor={`ap-inst-${id}`}>{t("alumni.placement.institution")}</Label><Input id={`ap-inst-${id}`} required maxLength={160} value={v.institution} onChange={(e) => set("institution", e.target.value)} /></div>
        <div>
          <Label htmlFor={`ap-type-${id}`}>{t("alumni.placement.type")}</Label>
          <Select id={`ap-type-${id}`} value={v.institutionType} onChange={(e) => set("institutionType", e.target.value as typeof v.institutionType)}>
            {INSTITUTION_TYPES.map((k) => <option key={k} value={k}>{t(`alumni.types.${k}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`ap-status-${id}`}>{t("alumni.placement.status")}</Label>
          <Select id={`ap-status-${id}`} value={v.status} onChange={(e) => set("status", e.target.value as typeof v.status)}>
            {PLACEMENT_STATUSES.map((k) => <option key={k} value={k}>{t(`alumni.placementStatuses.${k}`)}</option>)}
          </Select>
        </div>
        <div><Label htmlFor={`ap-country-${id}`}>{t("alumni.placement.country")}</Label><Input id={`ap-country-${id}`} maxLength={80} value={v.country} onChange={(e) => set("country", e.target.value)} /></div>
        <div><Label htmlFor={`ap-region-${id}`}>{t("alumni.placement.region")}</Label><Input id={`ap-region-${id}`} maxLength={120} value={v.region} onChange={(e) => set("region", e.target.value)} /></div>
        <div><Label htmlFor={`ap-league-${id}`}>{t("alumni.placement.league")}</Label><Input id={`ap-league-${id}`} maxLength={120} value={v.league} onChange={(e) => set("league", e.target.value)} /></div>
        <div><Label htmlFor={`ap-level-${id}`}>{t("alumni.placement.level")}</Label><Input id={`ap-level-${id}`} maxLength={120} value={v.level} onChange={(e) => set("level", e.target.value)} /></div>
        <div><Label htmlFor={`ap-sport-${id}`}>{t("alumni.placement.sport")}</Label><Input id={`ap-sport-${id}`} maxLength={60} value={v.sport} onChange={(e) => set("sport", e.target.value)} /></div>
        <div><Label htmlFor={`ap-pos-${id}`}>{t("alumni.placement.position")}</Label><Input id={`ap-pos-${id}`} maxLength={60} value={v.position} onChange={(e) => set("position", e.target.value)} /></div>
        <div><Label htmlFor={`ap-start-${id}`}>{t("alumni.placement.startDate")}</Label><Input id={`ap-start-${id}`} type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
        <div><Label htmlFor={`ap-end-${id}`}>{t("alumni.placement.endYear")}</Label><Input id={`ap-end-${id}`} inputMode="numeric" maxLength={4} value={v.endYear} onChange={(e) => set("endYear", e.target.value.replace(/\D/g, ""))} /></div>
        <div>
          <Label htmlFor={`ap-sch-${id}`}>{t("alumni.placement.scholarship")}</Label>
          <Select id={`ap-sch-${id}`} value={v.scholarship} onChange={(e) => set("scholarship", e.target.value as typeof v.scholarship)}>
            {SCHOLARSHIPS.map((k) => <option key={k} value={k}>{t(`alumni.scholarships.${k}`)}</option>)}
          </Select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-text-secondary">
          <input type="checkbox" checked={v.isCurrent} onChange={(e) => set("isCurrent", e.target.checked)} /> {t("alumni.placement.isCurrent")}
        </label>
        <div className="sm:col-span-2"><Label htmlFor={`ap-roster-${id}`}>{t("alumni.placement.rosterUrl")}</Label><Input id={`ap-roster-${id}`} type="url" maxLength={500} value={v.rosterUrl} onChange={(e) => set("rosterUrl", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`ap-src-${id}`}>{t("alumni.placement.sourceNote")}</Label><Input id={`ap-src-${id}`} maxLength={1000} value={v.sourceNote} onChange={(e) => set("sourceNote", e.target.value)} /></div>
      </div>
      <StatusLine msg={msg} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>{t("common.save")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={busy}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

export function PlacementTimeline({ alumniId, placements }: { alumniId: string; placements: AlumniPlacementRow[] }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  const [adding, setAdding] = React.useState(placements.length === 0);
  const [editing, setEditing] = React.useState<string | null>(null);
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("alumni.profile.placements")}</CardTitle>
        {!adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{t("alumni.placement.add")}</Button>}
      </CardHeader>
      <CardBody className="space-y-4 text-sm">
        {adding && <PlacementForm alumniId={alumniId} onDone={() => setAdding(false)} />}
        {placements.length === 0 && !adding && <p className="text-text-muted">{t("alumni.placement.none")}</p>}
        <ol className="relative space-y-4 border-s border-border ps-5">
          {placements.map((p) => (
            <li key={p.id} className="relative">
              <span aria-hidden className={`absolute -start-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-surface ${p.is_current ? "bg-brand-primary" : "bg-border"}`} />
              {editing === p.id ? <PlacementForm alumniId={alumniId} initial={p} onDone={() => setEditing(null)} /> : (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">{p.institution}</span>
                    <Badge>{t(`alumni.types.${p.institution_type}`)}</Badge>
                    <Badge tone={PLACEMENT_TONE[p.status] ?? "neutral"}>{t(`alumni.placementStatuses.${p.status}`)}</Badge>
                    {p.is_current && <Badge tone="brand">{t("alumni.placement.current")}</Badge>}
                  </div>
                  <p className="text-xs text-text-muted">
                    {[
                      p.start_date ? t("alumni.placement.since", { date: f.date(p.start_date, { style: "medium" }) }) : null,
                      p.end_year ? t("alumni.placement.classOf", { year: p.end_year }) : null,
                      [p.region, p.country].filter(Boolean).join(", ") || null,
                      p.league, p.level, [p.sport, p.position].filter(Boolean).join(" · ") || null,
                      p.scholarship !== "unknown" ? t(`alumni.scholarships.${p.scholarship}`) : null,
                    ].filter(Boolean).join(" · ")}
                  </p>
                  {p.source_note && <p className="text-xs text-text-muted">{t("alumni.placement.sourceValue", { note: p.source_note })}</p>}
                  <div className="flex flex-wrap gap-2">
                    {p.roster_url && (
                      <a href={p.roster_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-primary hover:underline">
                        <ExternalLink className="h-3 w-3" aria-hidden /> {t("alumni.placement.roster")}
                      </a>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}><Pencil className="h-3.5 w-3.5" aria-hidden /> {t("common.edit")}</Button>
                    <Button size="sm" variant="ghost" disabled={busy}
                      onClick={() => { if (window.confirm(t("alumni.placement.confirmDelete", { name: p.institution }))) void run(() => deleteAlumniPlacement({ id: p.id, alumniId })); }}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("common.delete")}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
        <StatusLine msg={msg} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Contact card: one-click actions, send from the club, log a call
// ---------------------------------------------------------------------------
export function ContactCard({ alumniId, person, socials }: {
  alumniId: string;
  person: ContactPerson;
  socials: { instagram: string | null; xHandle: string | null; linkedinUrl: string | null; highlightUrl: string | null };
}) {
  const t = useT();
  const target = contactTarget(person);
  const blocked = sendBlockReason(person);
  const [compose, setCompose] = React.useState(false);
  const [logCall, setLogCall] = React.useState(false);
  const linkCls = "inline-flex h-8 items-center gap-1.5 rounded border border-border bg-surface px-3 text-[12.5px] text-text hover:border-brand-primary";
  const ig = socials.instagram?.replace(/^@/, "");
  const x = socials.xHandle?.replace(/^@/, "");
  return (
    <Card>
      <CardHeader><CardTitle>{t("alumni.profile.contact")}</CardTitle></CardHeader>
      <CardBody className="space-y-4 text-sm">
        {person.status === "do_not_contact" && <p role="alert" className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-danger">{t("alumni.blocked.do_not_contact")}</p>}
        {target.via === "guardian" && <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-warning">{t("alumni.profile.viaGuardian", { name: target.name || t("alumni.profile.guardianUnknown") })}</p>}
        {!person.contactConsent && person.status !== "do_not_contact" && <p className="text-xs text-text-muted">{t("alumni.blocked.no_consent")}</p>}
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="text-xs text-text-muted">{t("alumni.fields.email")}</dt><dd className="break-all text-text">{target.email ?? "—"}</dd></div>
          <div><dt className="text-xs text-text-muted">{t("alumni.fields.phone")}</dt><dd className="text-text">{target.phone ?? "—"}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {!target.emailBlocked && target.email && <a className={linkCls} href={`mailto:${target.email}`}><Mail className="h-3.5 w-3.5" aria-hidden /> {t("alumni.actions.mailto")}</a>}
          {!target.phoneBlocked && target.phone && <a className={linkCls} href={telHref(target.phone)}><Phone className="h-3.5 w-3.5" aria-hidden /> {t("alumni.actions.call")}</a>}
          {target.whatsapp && <a className={linkCls} href={`https://wa.me/${target.whatsapp}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" aria-hidden /> {t("alumni.actions.whatsapp")}</a>}
          <Button size="sm" variant="primary" disabled={Boolean(blocked)} title={blocked ? t(`alumni.blocked.${blocked}`) : undefined} onClick={() => { setCompose(true); setLogCall(false); }}>
            <Send className="h-3.5 w-3.5" aria-hidden /> {t("alumni.actions.sendFromClub")}
          </Button>
          <Button size="sm" variant="secondary" disabled={person.status === "do_not_contact"} onClick={() => { setLogCall(true); setCompose(false); }}>
            <Phone className="h-3.5 w-3.5" aria-hidden /> {t("alumni.actions.logCall")}
          </Button>
        </div>
        {blocked && blocked !== "do_not_contact" && <FieldHint>{t(`alumni.blocked.${blocked}`)}</FieldHint>}
        {compose && <ComposeEmail alumniId={alumniId} to={target.email ?? ""} onDone={() => setCompose(false)} />}
        {logCall && <ContactForm alumniId={alumniId} preset="call" onDone={() => setLogCall(false)} />}
        {(ig || x || socials.linkedinUrl || socials.highlightUrl) && (
          <div className="flex flex-wrap gap-3 border-t border-border pt-3 text-xs">
            {ig && <a className="text-brand-primary hover:underline" href={`https://instagram.com/${encodeURIComponent(ig)}`} target="_blank" rel="noopener noreferrer">{t("alumni.fields.instagram")}: @{ig}</a>}
            {x && <a className="text-brand-primary hover:underline" href={`https://x.com/${encodeURIComponent(x)}`} target="_blank" rel="noopener noreferrer">{t("alumni.fields.xHandle")}: @{x}</a>}
            {socials.linkedinUrl && <a className="text-brand-primary hover:underline" href={socials.linkedinUrl} target="_blank" rel="noopener noreferrer">{t("alumni.fields.linkedinUrl")}</a>}
            {socials.highlightUrl && <a className="text-brand-primary hover:underline" href={socials.highlightUrl} target="_blank" rel="noopener noreferrer">{t("alumni.fields.highlightUrl")}</a>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ComposeEmail({ alumniId, to, onDone }: { alumniId: string; to: string; onDone: () => void }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [followUpOn, setFollowUpOn] = React.useState("");
  return (
    <form className="space-y-3 rounded border border-border p-3" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => sendAlumniEmailAction({ alumniId, subject, body, followUpOn }));
      if (ok) onDone();
    }}>
      <p className="text-xs text-text-muted">{t("alumni.compose.to", { email: to })}</p>
      <div><Label htmlFor="ac-subject">{t("alumni.compose.subject")}</Label><Input id="ac-subject" required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div><Label htmlFor="ac-body">{t("alumni.compose.body")}</Label><Textarea id="ac-body" required rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
      <div><Label htmlFor="ac-fu">{t("alumni.contact.followUpOn")}</Label><Input id="ac-fu" type="date" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} /></div>
      <FieldHint>{t("alumni.compose.hint")}</FieldHint>
      <StatusLine msg={msg} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}><Send className="h-3.5 w-3.5" aria-hidden /> {t("alumni.compose.send")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={busy}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ContactForm({ alumniId, preset, onDone }: { alumniId: string; preset?: (typeof CONTACT_KINDS)[number]; onDone: () => void }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [kind, setKind] = React.useState<(typeof CONTACT_KINDS)[number]>(preset ?? "note");
  const [direction, setDirection] = React.useState<(typeof DIRECTIONS)[number]>("outbound");
  const [summary, setSummary] = React.useState("");
  const [happenedAt, setHappenedAt] = React.useState(nowLocal);
  const [followUpOn, setFollowUpOn] = React.useState("");
  return (
    <form className="space-y-3 rounded border border-border p-3" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => saveAlumniContact({ alumniId, kind, direction, summary, happenedAt: new Date(happenedAt).toISOString(), followUpOn }));
      if (ok) onDone();
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="cl-kind">{t("alumni.contact.kind")}</Label>
          <Select id="cl-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {CONTACT_KINDS.map((k) => <option key={k} value={k}>{t(`alumni.contactKinds.${k}`)}</option>)}
          </Select>
        </div>
        {kind !== "note" && (
          <div>
            <Label htmlFor="cl-dir">{t("alumni.contact.direction")}</Label>
            <Select id="cl-dir" value={direction} onChange={(e) => setDirection(e.target.value as typeof direction)}>
              {DIRECTIONS.filter((d) => d !== "none").map((d) => <option key={d} value={d}>{t(`alumni.directions.${d}`)}</option>)}
            </Select>
          </div>
        )}
        <div><Label htmlFor="cl-when">{t("alumni.contact.happenedAt")}</Label><Input id="cl-when" type="datetime-local" value={happenedAt} onChange={(e) => setHappenedAt(e.target.value)} /></div>
      </div>
      <div><Label htmlFor="cl-sum">{t("alumni.contact.summary")}</Label><Textarea id="cl-sum" required rows={3} maxLength={4000} value={summary} onChange={(e) => setSummary(e.target.value)} /></div>
      <div className="max-w-xs"><Label htmlFor="cl-fu">{t("alumni.contact.followUpOn")}</Label><Input id="cl-fu" type="date" value={followUpOn} onChange={(e) => setFollowUpOn(e.target.value)} /><FieldHint>{t("alumni.contact.followUpHint")}</FieldHint></div>
      <StatusLine msg={msg} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={busy} disabled={busy}>{t("common.save")}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={busy}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

export function ContactLog({ alumniId, contacts, today }: { alumniId: string; contacts: AlumniContactView[]; today: string }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  const [adding, setAdding] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t("alumni.profile.contactLog")}</CardTitle>
        {!adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{t("alumni.contact.add")}</Button>}
      </CardHeader>
      <CardBody className="space-y-3 text-sm">
        {adding && <ContactForm alumniId={alumniId} onDone={() => setAdding(false)} />}
        {contacts.length === 0 && !adding && <p className="text-text-muted">{t("alumni.contact.none")}</p>}
        <ul className="divide-y divide-border">
          {contacts.map((c) => {
            const due = c.follow_up_on && !c.follow_up_done && c.follow_up_on <= today;
            return (
              <li key={c.id} className="space-y-1 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{t(`alumni.contactKinds.${c.kind}`)}</Badge>
                  {c.direction !== "none" && <span className="text-xs text-text-muted">{t(`alumni.directions.${c.direction}`)}</span>}
                  <span className="text-xs text-text-muted">{f.dateTime(c.happened_at, "medium")}</span>
                  {c.by_name && <span className="text-xs text-text-muted">· {c.by_name}</span>}
                </div>
                <p className="whitespace-pre-line text-text-secondary">{c.summary}</p>
                {c.follow_up_on && (
                  <p className={`flex flex-wrap items-center gap-2 text-xs ${due ? "text-warning" : "text-text-muted"}`}>
                    <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                    {t(c.follow_up_done ? "alumni.contact.followUpDoneOn" : "alumni.contact.followUpValue", { date: f.date(c.follow_up_on) })}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setFollowUpDone({ id: c.id, alumniId, done: !c.follow_up_done }))}>
                      {t(c.follow_up_done ? "alumni.contact.reopen" : "alumni.contact.markDone")}
                    </Button>
                  </p>
                )}
                <Button size="sm" variant="ghost" disabled={busy}
                  onClick={() => { if (window.confirm(t("alumni.contact.confirmDelete"))) void run(() => deleteAlumniContact({ id: c.id, alumniId })); }}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden /> {t("common.delete")}
                </Button>
              </li>
            );
          })}
        </ul>
        <StatusLine msg={msg} />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Permanent delete (typed name)
// ---------------------------------------------------------------------------
export function DeleteAlumniButton({ id, name, redirectTo }: { id: string; name: string; redirectTo: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await deleteAlumni({ id, confirmName: typed });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.push(redirectTo as never);
    router.refresh();
  };
  return (
    <>
      <Button type="button" size="sm" variant="danger" onClick={() => { setOpen(true); setTyped(""); setError(null); }}>
        <Trash2 className="h-4 w-4" aria-hidden /> {t("alumni.delete.button")}
      </Button>
      {open && (
        <PersonDialog title={t("alumni.delete.title", { name })} busy={busy} onClose={() => setOpen(false)}>
          <p className="text-sm text-text-muted">{t("alumni.delete.body")}</p>
          <label className="block space-y-1 text-sm">
            <span className="text-text">{t("alumni.delete.typeName", { name })}</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
              className="h-10 w-full rounded border border-border bg-bg px-3 text-text focus-visible:shadow-focus focus-visible:outline-none" />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" variant="danger" size="sm" onClick={submit} disabled={busy || !confirmationMatches(typed, name)} aria-busy={busy}>{t("alumni.delete.confirm")}</Button>
          </div>
        </PersonDialog>
      )}
    </>
  );
}
