"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, Loader2, Upload } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Label, Select } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import {
  addJourneyPlacementToAlumni, importAlumniCsv, moveAthleteToAlumni, previewMoveToAlumni, setCoachAlumniAccess,
  type ImportSummary, type MovePreview,
} from "@/lib/actions/alumni";
import { PersonDialog } from "@/components/people/delete-person";
import { StatusLine, useFamilyAction } from "@/components/family/use-family-action";

/** Admin: which coaches may open alumni & placements. */
export function CoachAccessCard({ coaches }: { coaches: { id: string; name: string; access: boolean }[] }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  return (
    <Card>
      <CardHeader><CardTitle>{t("alumni.access.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3 text-sm">
        <p className="text-text-muted">{t("alumni.access.body")}</p>
        {coaches.length === 0 ? <p className="text-text-muted">{t("alumni.access.none")}</p> : (
          <ul className="divide-y divide-border">
            {coaches.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-text">{c.name}</span>
                <label className="flex items-center gap-2 text-text-secondary">
                  <input type="checkbox" checked={c.access} disabled={busy} onChange={(e) => run(() => setCoachAlumniAccess({ coachId: c.id, access: e.target.checked }))} />
                  {t("alumni.access.toggle")}
                </label>
              </li>
            ))}
          </ul>
        )}
        <StatusLine msg={msg} />
      </CardBody>
    </Card>
  );
}

/** CSV import with a dry run first. */
export function AlumniImportForm({ base, defaultOrder }: { base: string; defaultOrder: "DMY" | "MDY" }) {
  const t = useT();
  const router = useRouter();
  const [csv, setCsv] = React.useState("");
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [order, setOrder] = React.useState<"DMY" | "MDY">(defaultOrder);
  const [summary, setSummary] = React.useState<{ dry: boolean; data: ImportSummary } | null>(null);
  const { busy, msg, run, setMsg } = useFamilyAction();
  const go = (dryRun: boolean) => run(() => importAlumniCsv({ csv, dateOrder: order, dryRun }), (res) => {
    if (res.data) setSummary({ dry: dryRun, data: res.data });
  });
  return (
    <Card>
      <CardHeader><CardTitle>{t("alumni.import.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-4 text-sm">
        <p className="text-text-muted">{t("alumni.import.body")}</p>
        <a href={`${base}/export?template=1`} className="text-brand-primary hover:underline">{t("alumni.import.template")}</a>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ai-file">{t("alumni.import.file")}</Label>
            <input id="ai-file" type="file" accept=".csv,text/csv,text/plain" className="block w-full text-sm text-text-secondary"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setSummary(null);
                setMsg(null);
                if (!file) return;
                if (file.size > 1_000_000) {
                  setMsg({ ok: false, text: t("alumni.import.tooLarge") });
                  return;
                }
                setFileName(file.name);
                setCsv(await file.text());
              }} />
            {fileName && <FieldHint>{fileName}</FieldHint>}
          </div>
          <div>
            <Label htmlFor="ai-order">{t("alumni.import.dateOrder")}</Label>
            <Select id="ai-order" value={order} onChange={(e) => setOrder(e.target.value as "DMY" | "MDY")}>
              <option value="DMY">{t("alumni.import.dmy")}</option>
              <option value="MDY">{t("alumni.import.mdy")}</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!csv || busy} onClick={() => go(true)}>{t("alumni.import.check")}</Button>
          <Button size="sm" disabled={!csv || busy || !summary?.dry} onClick={() => go(false)}><Upload className="h-3.5 w-3.5" aria-hidden /> {t("alumni.import.run")}</Button>
        </div>
        <StatusLine msg={msg} />
        {summary && (
          <div className="space-y-2 rounded border border-border p-3">
            <p className="text-text">{t(summary.dry ? "alumni.import.previewLine" : "alumni.import.resultLine", {
              people: summary.data.people, created: summary.data.created, matched: summary.data.matched, placements: summary.data.placements,
            })}</p>
            {summary.data.issues.length > 0 && (
              <ul className="max-h-60 list-disc space-y-0.5 overflow-y-auto ps-5 text-xs text-warning">
                {summary.data.issues.slice(0, 200).map((i, n) => (
                  <li key={n}>{t("alumni.import.issueRow", { row: i.row })} {t.dynamic(`alumni.import.issues.${i.key}`, { field: i.field ?? "", value: i.value ?? "" }, t("alumni.import.issues.invalid", { field: i.field ?? "", value: i.value ?? "" }))}</li>
                ))}
              </ul>
            )}
            {!summary.dry && <Link href={base as never} className="text-brand-primary hover:underline" onClick={() => router.refresh()}>{t("alumni.import.backToList")}</Link>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Player profile: "Move to alumni" (pre-filled), optionally archiving the player. */
export function MoveToAlumniButton({ athleteId }: { athleteId: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<MovePreview | null>(null);
  const [archive, setArchive] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const openDialog = async () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    setArchive(false);
    const r = await previewMoveToAlumni(athleteId);
    if (r.ok && r.data) setPreview(r.data); else if (!r.ok) setError(r.error);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await moveAthleteToAlumni({ athleteId, archive });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.push(`/admin/alumni/${r.data!.id}` as never);
  };
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={openDialog}><GraduationCap className="h-4 w-4" aria-hidden /> {t("alumni.move.button")}</Button>
      {open && (
        <PersonDialog title={t("alumni.move.title")} busy={busy} onClose={() => setOpen(false)}>
          {!preview && !error && <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("alumni.move.loading")}</p>}
          {preview && (
            <div className="space-y-3 text-sm">
              {preview.existingAlumniId && <p className="text-text-muted">{t("alumni.move.exists")}</p>}
              <ul className="list-disc space-y-1 ps-5 text-text">
                <li>{t("alumni.move.name", { name: preview.name })}</li>
                <li>{preview.birthYear ? t("alumni.move.birthYear", { year: preview.birthYear }) : t("alumni.move.noBirthYear")}</li>
                <li>{preview.guardianName ? t("alumni.move.guardian", { name: preview.guardianName }) : t("alumni.move.noGuardian")}</li>
                <li>{t("alumni.move.placements", { count: preview.placements.filter((p) => p.status === "placed").length })}</li>
              </ul>
              {preview.minor && !preview.guardianName && <p className="text-warning">{t("alumni.move.minorNeedsGuardian")}</p>}
              <label className="flex items-start gap-2 text-text">
                <input type="checkbox" className="mt-1" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
                <span>{t("alumni.move.archive")}<br /><span className="text-xs text-text-muted">{t("alumni.move.archiveHint")}</span></span>
              </label>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>{t("common.cancel")}</Button>
            <Button type="button" size="sm" onClick={submit} disabled={busy || !preview} aria-busy={busy}>{t("alumni.move.confirm")}</Button>
          </div>
        </PersonDialog>
      )}
    </>
  );
}

/** Player journey: a target that became "placed" -> alumni & placements. */
export function AddToAlumniButton({ placementTargetId, linked, app }: { placementTargetId: string; linked: string | null; app: "admin" | "coach" }) {
  const t = useT();
  const router = useRouter();
  const { busy, msg, run } = useFamilyAction();
  if (linked) {
    return <Link href={`/${app}/alumni/${linked}` as never} className="text-xs text-brand-primary hover:underline">{t("alumni.journey.open")}</Link>;
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <Button size="sm" variant="secondary" disabled={busy}
        onClick={() => run(() => addJourneyPlacementToAlumni(placementTargetId), (res) => { if (res.data) router.push(`/${app}/alumni/${res.data.id}` as never); })}>
        <GraduationCap className="h-3.5 w-3.5" aria-hidden /> {t("alumni.journey.add")}
      </Button>
      <StatusLine msg={msg} />
    </span>
  );
}
