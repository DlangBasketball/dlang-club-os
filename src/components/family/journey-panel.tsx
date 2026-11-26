"use client";

import * as React from "react";
import { Award, Globe2, GraduationCap, History, Pencil } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { deletePlacement, deleteSeasonReview, publishScoutProfile, revokeScoutProfile, savePlacement, saveSeasonReview } from "@/lib/actions/journey";
import type { JourneyDetail } from "@/lib/family/data";
import type { PlacementRow } from "@/lib/family/db";
import { PLACEMENT_KINDS, PLACEMENT_STATUSES, SCOUT_FIELDS, type ScoutField } from "@/lib/family/validation";
import { evaluationTrend } from "@/lib/family/journey";
import { StatusLine, useFamilyAction } from "./use-family-action";
import { AddToAlumniButton } from "@/components/alumni/tools";

/** Tiny trend line (currentColor, themed by the parent's text colour). */
function Sparkline({ points, label }: { points: { date: string; score: number }[]; label: string }) {
  if (points.length < 2) return null;
  const w = 120;
  const h = 32;
  const xs = points.map((_, i) => (i / (points.length - 1)) * w);
  const ys = points.map((p) => h - (Math.max(0, Math.min(100, p.score)) / 100) * h);
  const d = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${h}`} className="h-8 w-[120px] text-brand-accent">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReviewForm({ detail, seasonId, initial, onDone }: {
  detail: JourneyDetail; seasonId: string | null;
  initial?: { id: string; comment: string | null; awards: string[]; shared: boolean; label?: string };
  onDone?: () => void;
}) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [sid, setSid] = React.useState(seasonId ?? "");
  const [label, setLabel] = React.useState(initial?.label ?? detail.seasons.find((s) => s.id === seasonId)?.name ?? "");
  const [comment, setComment] = React.useState(initial?.comment ?? "");
  const [awards, setAwards] = React.useState((initial?.awards ?? []).join(", "));
  const [shared, setShared] = React.useState(initial?.shared ?? true);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => saveSeasonReview({
        id: initial?.id ?? null, athleteId: detail.athlete.id, seasonId: sid || null,
        seasonLabel: label || detail.seasons.find((s) => s.id === sid)?.name || "",
        coachComment: comment, awards: awards.split(",").map((a) => a.trim()).filter(Boolean).slice(0, 10), sharedWithFamily: shared,
      }));
      if (ok) onDone?.();
    }}>
      {!initial && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="rev-season">{t("family.journey.season")}</Label>
            <Select id="rev-season" value={sid} onChange={(e) => { setSid(e.target.value); setLabel(detail.seasons.find((s) => s.id === e.target.value)?.name ?? label); }}>
              <option value="">{t("family.journey.otherPeriod")}</option>
              {detail.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="rev-label">{t("family.journey.periodLabel")}</Label>
            <Input id="rev-label" required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
      )}
      <div>
        <Label htmlFor={`rev-comment-${initial?.id ?? "new"}`}>{t("family.journey.coachComment")}</Label>
        <Textarea id={`rev-comment-${initial?.id ?? "new"}`} rows={4} maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div>
        <Label htmlFor={`rev-awards-${initial?.id ?? "new"}`}>{t("family.journey.awards")}</Label>
        <Input id={`rev-awards-${initial?.id ?? "new"}`} value={awards} onChange={(e) => setAwards(e.target.value)} />
        <FieldHint>{t("family.journey.awardsHint")}</FieldHint>
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t("family.journey.sharedWithFamily")}</label>
      <StatusLine msg={msg} />
      <Button type="submit" size="sm" loading={busy} disabled={busy}>{t("common.save")}</Button>
    </form>
  );
}

function SeasonCards({ detail }: { detail: JourneyDetail }) {
  const t = useT();
  const f = useFormat();
  const { busy, run } = useFamilyAction();
  const [editing, setEditing] = React.useState<string | null>(null);
  const seasons = detail.journey.seasons;
  if (!seasons.length && !detail.journey.other_reviews.length) {
    return <p className="text-sm text-text-muted">{t("family.journey.noHistory")}</p>;
  }
  return (
    <div className="space-y-4">
      {seasons.map((s) => {
        const trend = evaluationTrend(s.evaluations);
        const stats = Object.entries(s.stats ?? {}).slice(0, 6);
        return (
          <Card key={s.season_id}>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>{s.season}</CardTitle>
              <span className="text-xs text-text-muted">{f.dateRange(s.starts_on, s.ends_on)}</span>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {s.teams.map((tm) => <Badge key={tm} tone="brand">{tm}</Badge>)}
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-text-muted">{t("family.journey.games")}</dt><dd className="text-text">{f.number(s.games)}</dd></div>
                {s.record && (s.record.wins + s.record.losses + s.record.draws > 0) && (
                  <div><dt className="text-xs text-text-muted">{t("family.journey.record")}</dt><dd className="text-text">{t("family.journey.recordValue", { w: s.record.wins, l: s.record.losses, d: s.record.draws })}</dd></div>
                )}
                <div><dt className="text-xs text-text-muted">{t("family.journey.attendance")}</dt><dd className="text-text">{s.attendance_pct === null ? "—" : f.percent(s.attendance_pct / 100, 0)}</dd></div>
                <div>
                  <dt className="text-xs text-text-muted">{t("family.journey.evaluationTrend")}</dt>
                  <dd className="flex items-center gap-2 text-text">
                    {trend.latest === null ? "—" : f.number(trend.latest)}
                    {trend.delta !== null && <span className={trend.delta >= 0 ? "text-success" : "text-danger"}>{trend.delta >= 0 ? "+" : ""}{f.number(trend.delta)}</span>}
                  </dd>
                </div>
              </dl>
              <Sparkline points={s.evaluations} label={t("family.journey.evaluationTrend")} />
              {stats.length > 0 && (
                <p className="text-xs text-text-muted">{stats.map(([k, v]) => `${k}: ${f.number(v)}`).join(" · ")}</p>
              )}
              {s.review && editing !== s.review.id && (
                <div className="space-y-1 rounded-md border border-border bg-surface p-3">
                  {s.review.comment && <p className="whitespace-pre-line text-text-secondary">{s.review.comment}</p>}
                  {s.review.awards.length > 0 && (
                    <p className="flex flex-wrap items-center gap-1.5"><Award aria-hidden className="h-3.5 w-3.5 text-brand-accent" />{s.review.awards.map((a) => <Badge key={a} tone="accent">{a}</Badge>)}</p>
                  )}
                  {detail.canWrite && !s.review.shared && <Badge>{t("family.journey.notShared")}</Badge>}
                  {detail.canWrite && (
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(s.review!.id)}><Pencil aria-hidden className="h-3.5 w-3.5" /> {t("common.edit")}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => deleteSeasonReview({ id: s.review!.id, athleteId: detail.athlete.id }))}>{t("common.delete")}</Button>
                    </div>
                  )}
                </div>
              )}
              {s.review && editing === s.review.id && (
                <ReviewForm detail={detail} seasonId={s.season_id} initial={s.review} onDone={() => setEditing(null)} />
              )}
            </CardBody>
          </Card>
        );
      })}
      {detail.journey.other_reviews.map((r) => (
        <Card key={r.id}>
          <CardHeader><CardTitle>{r.season}</CardTitle></CardHeader>
          <CardBody className="space-y-2 text-sm">
            {r.comment && <p className="whitespace-pre-line text-text-secondary">{r.comment}</p>}
            {r.awards.length > 0 && <p className="flex flex-wrap gap-1.5">{r.awards.map((a) => <Badge key={a} tone="accent">{a}</Badge>)}</p>}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger" | "accent"> = {
  interested: "neutral", contacted: "info", trial: "warning", offer: "accent", placed: "success", declined: "danger", withdrawn: "neutral",
};

function PlacementForm({ detail, initial, onDone }: { detail: JourneyDetail; initial?: PlacementRow; onDone?: () => void }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [v, setV] = React.useState({
    targetName: initial?.target_name ?? "", targetKind: initial?.target_kind ?? "school", country: initial?.country ?? "",
    level: initial?.level ?? "", status: initial?.status ?? "interested", deadline: initial?.deadline ?? "",
    nextStep: initial?.next_step ?? "", notes: initial?.notes ?? "", documentIds: initial?.document_ids ?? [],
  });
  const id = initial?.id ?? "new";
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      const ok = await run(() => savePlacement({ id: initial?.id ?? null, athleteId: detail.athlete.id, ...v, deadline: v.deadline || null }));
      if (ok) onDone?.();
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor={`pl-name-${id}`}>{t("family.placement.target")}</Label><Input id={`pl-name-${id}`} required maxLength={160} value={v.targetName} onChange={(e) => set("targetName", e.target.value)} /></div>
        <div>
          <Label htmlFor={`pl-kind-${id}`}>{t("family.placement.kind")}</Label>
          <Select id={`pl-kind-${id}`} value={v.targetKind} onChange={(e) => set("targetKind", e.target.value as typeof v.targetKind)}>
            {PLACEMENT_KINDS.map((k) => <option key={k} value={k}>{t(`family.placement.kinds.${k}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`pl-status-${id}`}>{t("family.placement.status")}</Label>
          <Select id={`pl-status-${id}`} value={v.status} onChange={(e) => set("status", e.target.value as typeof v.status)}>
            {PLACEMENT_STATUSES.map((k) => <option key={k} value={k}>{t(`family.placement.statuses.${k}`)}</option>)}
          </Select>
        </div>
        <div><Label htmlFor={`pl-deadline-${id}`}>{t("family.placement.deadline")}</Label><Input id={`pl-deadline-${id}`} type="date" value={v.deadline} onChange={(e) => set("deadline", e.target.value)} /></div>
        <div><Label htmlFor={`pl-country-${id}`}>{t("family.placement.country")}</Label><Input id={`pl-country-${id}`} maxLength={80} value={v.country} onChange={(e) => set("country", e.target.value)} /></div>
        <div><Label htmlFor={`pl-level-${id}`}>{t("family.placement.level")}</Label><Input id={`pl-level-${id}`} maxLength={80} value={v.level} onChange={(e) => set("level", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`pl-next-${id}`}>{t("family.placement.nextStep")}</Label><Input id={`pl-next-${id}`} maxLength={300} value={v.nextStep} onChange={(e) => set("nextStep", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor={`pl-notes-${id}`}>{t("family.placement.notes")}</Label><Textarea id={`pl-notes-${id}`} rows={3} maxLength={4000} value={v.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      {detail.documents.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("family.placement.documents")}</legend>
          {detail.documents.map((d) => (
            <label key={d.id} className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={v.documentIds.includes(d.id)}
                onChange={(e) => set("documentIds", e.target.checked ? [...v.documentIds, d.id] : v.documentIds.filter((x) => x !== d.id))} />
              {d.name}
            </label>
          ))}
        </fieldset>
      )}
      <StatusLine msg={msg} />
      <Button type="submit" size="sm" loading={busy} disabled={busy}>{t("common.save")}</Button>
    </form>
  );
}

function Placements({ detail }: { detail: JourneyDetail }) {
  const t = useT();
  const f = useFormat();
  const { busy, run } = useFamilyAction();
  const [editing, setEditing] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const docName = new Map(detail.documents.map((d) => [d.id, d.name]));
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2"><GraduationCap aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.placement.title")}</CardTitle></span>
        {detail.canWrite && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{t("family.placement.add")}</Button>}
      </CardHeader>
      <CardBody className="space-y-4 text-sm">
        <p className="text-xs text-text-muted">{t("family.placement.pipeline")}</p>
        {adding && <PlacementForm detail={detail} onDone={() => setAdding(false)} />}
        {detail.placements.length === 0 && !adding && <p className="text-text-muted">{t("family.placement.none")}</p>}
        <ul className="space-y-3">
          {detail.placements.map((p) => (
            <li key={p.id} className="space-y-1.5 border-b border-border pb-3 last:border-0">
              {editing === p.id ? <PlacementForm detail={detail} initial={p} onDone={() => setEditing(null)} /> : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">{p.target_name}</span>
                    <Badge>{t(`family.placement.kinds.${p.target_kind}`)}</Badge>
                    <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{t(`family.placement.statuses.${p.status}`)}</Badge>
                    {p.deadline && <span className="text-xs text-text-muted">{t("family.placement.deadlineOn", { date: f.date(p.deadline) })}</span>}
                  </div>
                  {(p.country || p.level) && <p className="text-xs text-text-muted">{[p.country, p.level].filter(Boolean).join(" · ")}</p>}
                  {p.next_step && <p className="text-text-secondary">{t("family.placement.nextStepValue", { step: p.next_step })}</p>}
                  {p.notes && <p className="whitespace-pre-line text-xs text-text-muted">{p.notes}</p>}
                  {p.document_ids.length > 0 && <p className="text-xs text-text-muted">{t("family.placement.documentsValue", { names: p.document_ids.map((d) => docName.get(d) ?? "—").join(", ") })}</p>}
                  {p.history.length > 1 && (
                    <p className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
                      <History aria-hidden className="h-3 w-3" />
                      {p.history.map((h) => `${t(`family.placement.statuses.${h.to_status}`)} (${f.date(h.created_at)})`).join(" → ")}
                    </p>
                  )}
                  {detail.canWrite && (
                    <div className="flex flex-wrap items-center gap-2">
                      {p.status === "placed" && detail.alumni && (
                        <AddToAlumniButton placementTargetId={p.id} linked={detail.alumni.links[p.id] ?? null} app={detail.alumni.app} />
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p.id)}>{t("common.edit")}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => deletePlacement({ id: p.id, athleteId: detail.athlete.id }))}>{t("common.delete")}</Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function ScoutProfileCard({ detail }: { detail: JourneyDetail }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  const s = detail.scout;
  const live = Boolean(s && !s.revoked_at && Date.parse(s.expires_at) > Date.now());
  const [fields, setFields] = React.useState<ScoutField[]>(s ? (s.fields as ScoutField[]) : ["birth_year", "position", "teams", "stats"]);
  const [days, setDays] = React.useState("90");
  const [headline, setHeadline] = React.useState(s?.headline ?? "");
  const [consent, setConsent] = React.useState(false);
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Globe2 aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.scout.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3 text-sm text-text-secondary">
        <p>{t("family.scout.intro")}</p>
        <p>
          {live ? (
            <Badge tone="success">{t("family.scout.live", { date: f.date(s!.expires_at), views: s!.view_count })}</Badge>
          ) : s?.revoked_at ? (
            <Badge tone="neutral">{t("family.scout.revoked")}</Badge>
          ) : s ? (
            <Badge tone="warning">{t("family.scout.expired")}</Badge>
          ) : (
            <Badge>{t("family.scout.off")}</Badge>
          )}
        </p>
        {link && (
          <div className="space-y-2 rounded-md border border-border bg-surface p-3">
            <p className="text-xs text-text-muted">{t("family.scout.linkOnce")}</p>
            <code className="block break-all text-xs text-text">{link}</code>
            <Button size="sm" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link).catch(() => undefined); setCopied(true); }}>
              {copied ? t("family.scout.copied") : t("family.scout.copy")}
            </Button>
          </div>
        )}
        {detail.isGuardian && (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => publishScoutProfile({ athleteId: detail.athlete.id, fields, days: Number(days), headline, consent: consent as true }), (r) => {
              setLink(r.data?.url ?? null);
              setConsent(false);
            });
          }}>
            <fieldset className="grid gap-1.5 sm:grid-cols-2">
              <legend className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("family.scout.fields")}</legend>
              {SCOUT_FIELDS.map((k) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={fields.includes(k)} onChange={(e) => setFields((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} />
                  {t(`family.scout.fieldNames.${k}`)}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-text-muted">{t("family.scout.neverMedical")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="scout-days">{t("family.scout.validity")}</Label>
                <Select id="scout-days" value={days} onChange={(e) => setDays(e.target.value)}>
                  {["7", "30", "90", "180", "365"].map((d) => <option key={d} value={d}>{t("family.scout.days", { count: Number(d) })}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="scout-headline">{t("family.scout.headline")}</Label>
                <Input id="scout-headline" maxLength={200} value={headline} onChange={(e) => setHeadline(e.target.value)} />
              </div>
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t("family.scout.consent")}</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={busy} disabled={busy || !consent || fields.length === 0}>{live ? t("family.scout.republish") : t("family.scout.publish")}</Button>
              {live && <Button type="button" variant="ghost" disabled={busy} onClick={() => run(() => revokeScoutProfile(detail.athlete.id), () => setLink(null))}>{t("family.scout.revoke")}</Button>}
            </div>
          </form>
        )}
        {!detail.isGuardian && (
          <>
            <p className="text-xs text-text-muted">{t("family.scout.guardianOnly")}</p>
            {live && <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => revokeScoutProfile(detail.athlete.id))}>{t("family.scout.revoke")}</Button>}
          </>
        )}
        <StatusLine msg={msg} />
      </CardBody>
    </Card>
  );
}

/** Player journey: season history, coach reviews, placement tracker, scout profile. */
export function JourneyPanel({ detail }: { detail: JourneyDetail }) {
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl text-text">{t("family.journey.history")}</h2>
          {detail.canWrite && !adding && <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>{t("family.journey.addReview")}</Button>}
        </div>
        {adding && <Card><CardBody><ReviewForm detail={detail} seasonId={detail.seasons[0]?.id ?? null} onDone={() => setAdding(false)} /></CardBody></Card>}
        <SeasonCards detail={detail} />
      </section>
      <Placements detail={detail} />
      <ScoutProfileCard detail={detail} />
    </div>
  );
}
