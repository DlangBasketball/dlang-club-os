"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, MapPin, Search, UserPlus } from "lucide-react";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import {
  athleteAgeGroup, divisionFits, packageForTournamentCount, tryArrangementSchedule, type ArrangementKind,
} from "@/lib/selection/arrangement";
import type { SeasonProgram, TournamentView } from "@/lib/selection/roster";
import {
  addRosterPlayer, createRosterAthlete, saveRosterEnrollment, searchRosterAthletes, setRosterArrangement,
  type DirectoryAthlete, type EnrollmentInput,
} from "@/lib/actions/selection-roster";

export type EnrollmentInitial = {
  applicationId: string; athlete: { id: string; name: string; dob: string | null; licenceCategory: string | null };
  programId: string; divisionId: string | null; packageId: string | null; tournamentIds: string[]; tournamentOverrideReason: string | null;
  kind: ArrangementKind | null; agreedFee: number | null; monthlyAmount: number | null; firstDueOn: string | null;
  status: "accepted" | "enrolled" | "waitlisted" | "withdrawn" | string; jerseyNumber: number | null; staffNotes: string | null;
  received: number; currency: string | null;
};

type Mode = { kind: "add"; athlete?: DirectoryAthlete | null; divisionId?: string | null } | { kind: "edit"; initial: EnrollmentInitial };

/**
 * The single enrolment form (add player / edit enrolment), in the order the
 * club works: Season · Programme (programme + age group) · Player ·
 * Tournaments · Fee and payment arrangement · Save. Admins edit everything;
 * finance edits only the fee arrangement. Values stay on error; SQL re-checks
 * every rule (one live enrolment per player, tournament per age group and once
 * per player, age group, fee reason / confirmation).
 */
export function EnrollmentForm({
  mode, seasons, tournaments, canEditDetails, canEditFee, today, defaultProgramId, manageTournamentsHref, recordHref,
}: {
  mode: Mode;
  seasons: SeasonProgram[];
  tournaments: TournamentView[];
  canEditDetails: boolean;
  canEditFee: boolean;
  today: string;
  defaultProgramId: string;
  /** Set-up page of a programme (tournament schedule), for authorized staff; "{id}" is replaced. */
  manageTournamentsHref: string | null;
  /** Enrolment page after saving; "{program}" and "{application}" are replaced. */
  recordHref: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const init = mode.kind === "edit" ? mode.initial : null;
  const id = React.useId();

  const [programId, setProgramId] = React.useState(init?.programId ?? defaultProgramId);
  const program = seasons.find((s) => s.id === programId) ?? seasons[0];
  const activeDivisions = (program?.divisions ?? []).filter((d) => d.isActive || d.id === init?.divisionId);
  const [divisionId, setDivisionId] = React.useState(init?.divisionId ?? (mode.kind === "add" ? mode.divisionId ?? "" : ""));
  const division = activeDivisions.find((d) => d.id === divisionId) ?? null;

  // Player
  const [athlete, setAthlete] = React.useState<DirectoryAthlete | null>(init ? {
    id: init.athlete.id, name: init.athlete.name, dob: init.athlete.dob, licenceCategory: init.athlete.licenceCategory,
    familyName: null, status: "active", enrolled: [],
  } : mode.kind === "add" ? mode.athlete ?? null : null);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<DirectoryAthlete[] | null>(null);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [newAth, setNewAth] = React.useState({ firstName: "", lastName: "", dob: "", guardianName: "", guardianEmail: "", guardianPhone: "" });

  // Tournaments
  const [tournamentIds, setTournamentIds] = React.useState<string[]>(init?.tournamentIds ?? []);
  const [overrideReason, setOverrideReason] = React.useState(init?.tournamentOverrideReason ?? "");

  // Fee
  const [packageId, setPackageId] = React.useState(init?.packageId ?? "");
  const pkg = program?.packages.find((p) => p.id === packageId) ?? null;
  const [kind, setKind] = React.useState<ArrangementKind>(init?.kind ?? "full");
  const [fee, setFee] = React.useState(init?.agreedFee != null ? String(init.agreedFee) : "");
  const [feeTouched, setFeeTouched] = React.useState(!!init);
  const [feeReason, setFeeReason] = React.useState("");
  const [feeConfirmed, setFeeConfirmed] = React.useState(false);
  const [monthly, setMonthly] = React.useState(init?.monthlyAmount != null ? String(init.monthlyAmount) : "");
  // Default first due date: the programme's payment period start (e.g. September).
  const [firstDueOn, setFirstDueOn] = React.useState(init?.firstDueOn ?? program?.paymentStartsOn ?? today);

  // Details
  const [status, setStatus] = React.useState(init?.status && init.status !== "withdrawn" ? init.status : "enrolled");
  const [jersey, setJersey] = React.useState(init?.jerseyNumber != null ? String(init.jerseyNumber) : "");
  const [notes, setNotes] = React.useState(init?.staffNotes ?? "");
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);

  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);

  const currency = program?.currency ?? init?.currency ?? f.currency;
  const fmt = (n: number) => f.money(n, currency);

  // Tournaments available for the season and age group.
  const available = tournaments.filter((x) => x.programId === programId && x.status !== "cancelled" && (!x.divisionId || x.divisionId === divisionId));
  const known = new Map(tournaments.map((x) => [x.id, x]));
  const mismatched = tournamentIds.filter((tid) => !available.some((a) => a.id === tid));

  // Default package from the number of tournaments (not after a manual choice).
  const [pkgTouched, setPkgTouched] = React.useState(!!init?.packageId);
  React.useEffect(() => {
    if (pkgTouched || !program) return;
    const n = tournamentIds.filter((tid) => !mismatched.includes(tid)).length;
    const match = packageForTournamentCount(program.packages, Math.max(n, 1));
    if (match && match.id !== packageId) setPackageId(match.id);
  }, [tournamentIds, program, pkgTouched, packageId, mismatched]);
  // Fee and monthly amount follow the package until staff type their own.
  React.useEffect(() => {
    if (!pkg) return;
    if (!feeTouched) setFee(String(pkg.price));
    if (!init?.monthlyAmount && pkg.monthlyAmount != null) setMonthly((m) => (m === "" ? String(pkg.monthlyAmount) : m));
  }, [pkg, feeTouched, init?.monthlyAmount]);

  const feeNum = Number(fee);
  const monthlyNum = monthly === "" ? null : Number(monthly);
  const preview = Number.isFinite(feeNum) && feeNum > 0 ? tryArrangementSchedule(feeNum, kind, monthlyNum, firstDueOn, currency) : null;
  const lastDue = preview?.ok ? preview.rows[preview.rows.length - 1]?.dueOn ?? null : null;
  const pastPaymentEnd = !!program?.paymentEndsOn && !!lastDue && lastDue > program.paymentEndsOn;
  const feeDiffersFromPackage = !!pkg && Number.isFinite(feeNum) && Math.abs(feeNum - pkg.price) > 0.0001;
  const feeChanged = init?.agreedFee != null && Number.isFinite(feeNum) && Math.abs(feeNum - init.agreedFee) > 0.0001;
  const hasPayments = (init?.received ?? 0) > 0;

  // Age group check.
  const fits = athlete && division ? divisionFits(division, athlete.dob, today) : null;
  const ageGroup = athlete ? athleteAgeGroup(athlete.dob, program?.seasonYear ?? Number(today.slice(0, 4)), athlete.licenceCategory) : null;
  const ageWarning = !!athlete && !!division && fits !== true && (mode.kind === "add" || divisionId !== init?.divisionId);

  const required = pkg?.tournamentCount ?? null;
  // Same rule as the server: an unchanged or empty selection needs no reason.
  const selectionChanged = [...tournamentIds].sort().join() !== [...(init?.tournamentIds ?? [])].sort().join();
  const countMismatch = required != null && tournamentIds.length > 0 && tournamentIds.length !== required && selectionChanged;

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    const res = await searchRosterAthletes(query.trim(), seasons.map((s) => s.id));
    setSearching(false);
    if (!res.ok) { setSearchError(res.error); setResults(null); return; }
    setResults(res.data ?? []);
  }

  async function createAthlete() {
    setPending(true);
    setError(null);
    const res = await createRosterAthlete(newAth);
    setPending(false);
    if (!res.ok) { setError(res.error); return; }
    if (res.data) { setAthlete(res.data); setCreating(false); setResults(null); }
  }

  function changeProgram(next: string) {
    setProgramId(next);
    const p = seasons.find((s) => s.id === next);
    // Keep the same age group name in the other season when it exists.
    const sameName = p?.divisions.find((d) => d.isActive && d.name.toLowerCase() === (division?.name ?? "").toLowerCase());
    setDivisionId(sameName?.id ?? "");
    setPkgTouched(false);
    setPackageId("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCode(null);
    setSaved(null);
    if (!athlete) { setError(t("roster.form.playerRequired")); return; }
    if (!packageId) { setError(t("roster.errors.PACKAGE_REQUIRED")); return; }
    if (pastPaymentEnd) { setError(t("roster.errors.SCHEDULE_PAST_PAYMENT_END")); return; }
    if (preview && !preview.ok) { setError(t.dynamic(`roster.errors.${preview.code}`, undefined, t("roster.errors.invalid"))); return; }
    const input: EnrollmentInput = {
      programId, divisionId, packageId, tournamentIds, tournamentOverrideReason: overrideReason, ageConfirmed, kind,
      fee: fee === "" ? null : feeNum, feeReason, feeConfirmed, monthly: kind === "monthly" ? monthlyNum : null, firstDueOn,
      status: status as "accepted" | "enrolled" | "waitlisted", jerseyNumber: jersey === "" ? "" : Number(jersey), staffNotes: notes,
    };
    setPending(true);
    if (mode.kind === "add") {
      const res = await addRosterPlayer(athlete.id, input);
      setPending(false);
      if (!res.ok) { setError(res.error); setCode(res.code ?? null); return; }
      router.push(recordHref.replace("{program}", res.data?.programId ?? programId).replace("{application}", res.data?.applicationId ?? ""));
      return;
    }
    const res = canEditDetails
      ? await saveRosterEnrollment(mode.initial.applicationId, input)
      : await setRosterArrangement(mode.initial.applicationId, { kind, packageId, fee: fee === "" ? null : feeNum, monthly: kind === "monthly" ? monthlyNum : null, firstDueOn, reason: feeReason });
    setPending(false);
    if (!res.ok) { setError(res.error); setCode(res.code ?? null); return; }
    setSaved(res.message ?? t("roster.form.saved"));
    setFeeConfirmed(false);
    const newProgram = (res as { data?: { programId?: string } }).data?.programId;
    if (newProgram && newProgram !== mode.initial.programId) {
      router.push(recordHref.replace("{program}", newProgram).replace("{application}", mode.initial.applicationId));
    } else router.refresh();
  }

  const detailsLocked = !canEditDetails;
  const section = "space-y-3 rounded-md border border-border p-4";

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {/* 1 + 2: season and programme (programme + age group) */}
      <fieldset className={section} disabled={detailsLocked}>
        <legend className="px-1 text-sm font-medium text-text">{t("roster.form.seasonProgram")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-season`}>{t("roster.form.season")}</Label>
            <Select id={`${id}-season`} value={programId} onChange={(e) => changeProgram(e.target.value)}>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.seasonYear ? ` (${s.seasonYear})` : ""}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-division`}>{t("roster.form.program")}</Label>
            <Select id={`${id}-division`} value={divisionId} onChange={(e) => { setDivisionId(e.target.value); setAgeConfirmed(false); }}>
              <option value="">{t("roster.form.chooseProgram")}</option>
              {activeDivisions.map((d) => {
                const already = athlete?.enrolled.some((x) => x.programId === programId && x.divisionId === d.id && x.applicationId !== init?.applicationId);
                const range = d.minBirthYear || d.maxBirthYear ? ` · ${d.minBirthYear ?? "…"}–${d.maxBirthYear ?? "…"}` : "";
                return <option key={d.id} value={d.id}>{d.label}{range}{already ? ` · ${t("roster.form.alreadyEnrolled")}` : ""}</option>;
              })}
            </Select>
            {activeDivisions.length === 0 && <p className="mt-1 text-xs text-text-muted">{t("roster.form.noDivisions")}</p>}
          </div>
        </div>
      </fieldset>

      {/* 3: player */}
      <fieldset className={section} disabled={detailsLocked}>
        <legend className="px-1 text-sm font-medium text-text">{t("roster.form.player")}</legend>
        {athlete ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-text">{athlete.name}</span>
            <span className="text-xs text-text-muted">{athlete.dob ? f.date(athlete.dob) : "—"}{ageGroup ? ` · ${ageGroup}` : ""}{athlete.familyName ? ` · ${athlete.familyName}` : ""}</span>
            {athlete.enrolled.filter((x) => x.applicationId !== init?.applicationId).map((x) => {
              const p = seasons.find((s) => s.id === x.programId);
              const d = p?.divisions.find((dd) => dd.id === x.divisionId);
              return <Badge key={x.applicationId} tone="info">{t("roster.form.enrolledIn", { program: d?.label ?? p?.name ?? "—" })}</Badge>;
            })}
            {mode.kind === "add" && <Button type="button" size="sm" variant="ghost" onClick={() => { setAthlete(null); setAgeConfirmed(false); }}>{t("roster.form.changePlayer")}</Button>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
                <Input aria-label={t("roster.form.searchPlayer")} className="pl-8" value={query} placeholder={t("roster.form.searchPlaceholder")}
                  onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runSearch(); } }} />
              </div>
              <Button type="button" variant="secondary" onClick={() => void runSearch()} disabled={searching}>{searching ? t("roster.form.searching") : t("roster.form.search")}</Button>
            </div>
            {searchError && <p role="alert" className="text-sm text-danger">{searchError}</p>}
            {results && (results.length === 0 ? (
              <p className="text-sm text-text-secondary">{t("roster.form.noPlayerFound")}</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {results.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      <span className="font-medium text-text">{r.name}</span>{" "}
                      <span className="text-xs text-text-muted">{r.dob ? r.dob.slice(0, 4) : "—"}{r.familyName ? ` · ${r.familyName}` : ""}{r.licenceCategory ? ` · ${r.licenceCategory}` : ""}</span>
                      {r.enrolled.length > 0 && <span className="ml-2 text-xs text-info">{t("roster.form.alreadyEnrolled")}</span>}
                    </span>
                    <Button type="button" size="sm" variant="secondary" onClick={() => { setAthlete(r); setResults(null); }}>{t("roster.form.select")}</Button>
                  </li>
                ))}
              </ul>
            ))}
            {results && !creating && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(true)}><UserPlus className="h-4 w-4" /> {t("roster.form.createNew")}</Button>
            )}
            {creating && (
              <div className="space-y-3 rounded-md border border-dashed border-border p-3">
                <p className="text-xs text-text-muted">{t("roster.form.createHint")}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(["firstName", "lastName"] as const).map((k) => (
                    <div key={k}><Label htmlFor={`${id}-${k}`}>{t(`roster.form.${k}`)}</Label>
                      <Input id={`${id}-${k}`} value={newAth[k]} maxLength={80} onChange={(e) => setNewAth({ ...newAth, [k]: e.target.value })} /></div>
                  ))}
                  <div><Label htmlFor={`${id}-dob`}>{t("roster.form.dob")}</Label>
                    <Input id={`${id}-dob`} type="date" max={today} value={newAth.dob} onChange={(e) => setNewAth({ ...newAth, dob: e.target.value })} /></div>
                  <div><Label htmlFor={`${id}-gname`}>{t("roster.form.guardianName")}</Label>
                    <Input id={`${id}-gname`} value={newAth.guardianName} maxLength={120} onChange={(e) => setNewAth({ ...newAth, guardianName: e.target.value })} /></div>
                  <div><Label htmlFor={`${id}-gemail`}>{t("roster.form.guardianEmail")}</Label>
                    <Input id={`${id}-gemail`} type="email" value={newAth.guardianEmail} maxLength={200} onChange={(e) => setNewAth({ ...newAth, guardianEmail: e.target.value })} /></div>
                  <div><Label htmlFor={`${id}-gphone`}>{t("roster.form.guardianPhone")}</Label>
                    <Input id={`${id}-gphone`} value={newAth.guardianPhone} maxLength={40} onChange={(e) => setNewAth({ ...newAth, guardianPhone: e.target.value })} /></div>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => void createAthlete()} disabled={pending}>{t("roster.form.createAndSelect")}</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>{t("common.cancel")}</Button>
                </div>
              </div>
            )}
          </div>
        )}
        {ageWarning && (
          <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
            <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              {fits === false
                ? t("roster.form.ageMismatch", { group: ageGroup ?? "—", division: division?.label ?? "" })
                : t("roster.form.ageUnverified", { group: ageGroup ?? "—", division: division?.label ?? "" })}
            </p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} /> {t("roster.form.ageConfirm")}</label>
          </div>
        )}
      </fieldset>

      {/* 4: tournaments */}
      <fieldset className={section} disabled={detailsLocked}>
        <legend className="px-1 text-sm font-medium text-text">{t("roster.form.tournaments")}</legend>
        {!divisionId ? (
          <p className="text-sm text-text-muted">{t("roster.form.chooseProgramFirst")}</p>
        ) : available.length === 0 ? (
          <div className="text-sm text-text-secondary">
            <p>{t("roster.form.noTournaments", { program: division?.label ?? program?.name ?? "" })}</p>
            {manageTournamentsHref && (
              <Link className="text-brand-primary hover:underline" href={manageTournamentsHref.replace("{id}", programId)}>{t("roster.form.manageTournaments")}</Link>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {available.map((x) => (
              <li key={x.id}>
                <label className="flex items-start gap-2 text-sm text-text">
                  <input type="checkbox" className="mt-1" checked={tournamentIds.includes(x.id)}
                    onChange={(e) => setTournamentIds(e.target.checked ? [...tournamentIds, x.id] : tournamentIds.filter((v) => v !== x.id))} />
                  <span>
                    <span className="font-medium">{x.name}</span>{x.stage ? ` · ${x.stage}` : ""}
                    <span className="block text-xs text-text-muted">
                      {x.city || x.location ? <><MapPin className="mr-1 inline h-3 w-3" />{[x.city, x.location].filter(Boolean).join(", ")} </> : null}
                      {x.startsOn ? <><CalendarDays className="mr-1 inline h-3 w-3" />{f.dateRange(x.startsOn, x.endsOn ?? x.startsOn)}</> : t("roster.form.datesTbc")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {mismatched.length > 0 && (
          <div role="alert" className="rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
            <p className="font-medium">{t("roster.form.tournamentsNoLongerMatch")}</p>
            <ul className="mt-1 list-disc pl-5">
              {mismatched.map((tid) => (
                <li key={tid}>{known.get(tid)?.name ?? tid}{" "}
                  <button type="button" className="text-brand-primary hover:underline" onClick={() => setTournamentIds(tournamentIds.filter((v) => v !== tid))}>{t("roster.form.remove")}</button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {countMismatch && divisionId && (
          <div className="space-y-1">
            <p className="text-xs text-warning">{t("roster.form.countMismatch", { count: tournamentIds.length, required: required ?? 0, package: pkg?.name ?? "" })}</p>
            <Label htmlFor={`${id}-override`}>{t("roster.form.overrideReason")}</Label>
            <Input id={`${id}-override`} value={overrideReason} maxLength={500} onChange={(e) => setOverrideReason(e.target.value)} placeholder={t("roster.form.overridePlaceholder")} />
          </div>
        )}
      </fieldset>

      {/* 5: fee and payment arrangement */}
      <fieldset className={section} disabled={!canEditFee}>
        <legend className="px-1 text-sm font-medium text-text">{t("roster.form.fee")}</legend>
        {init?.agreedFee != null && (
          <p className="text-sm text-text-secondary">{t("roster.form.currentFee", { fee: fmt(init.agreedFee), received: fmt(init.received) })}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label htmlFor={`${id}-pkg`}>{t("roster.form.package")}</Label>
            <Select id={`${id}-pkg`} value={packageId} onChange={(e) => { setPackageId(e.target.value); setPkgTouched(true); setFeeTouched(false); }}>
              <option value="">{t("roster.form.choosePackage")}</option>
              {(program?.packages ?? []).filter((p) => p.isActive || p.id === init?.packageId).map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-fee`}>{t("roster.form.agreedFee", { currency })}</Label>
            <Input id={`${id}-fee`} inputMode="decimal" value={fee} onChange={(e) => { setFee(e.target.value); setFeeTouched(true); }} />
            {pkg && <p className="mt-1 text-xs text-text-muted">{t("roster.form.defaultFee", { fee: fmt(pkg.price) })}</p>}
          </div>
          <div>
            <Label htmlFor={`${id}-first`}>{kind === "monthly" ? t("roster.form.firstDue") : t("roster.form.dueDate")}</Label>
            <Input id={`${id}-first`} type="date" value={firstDueOn} onChange={(e) => setFirstDueOn(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-text" role="radiogroup" aria-label={t("roster.form.arrangement")}>
          <label className="flex items-center gap-2"><input type="radio" name={`${id}-kind`} checked={kind === "full"} onChange={() => setKind("full")} /> {t("roster.form.payInFull")}</label>
          <label className="flex items-center gap-2"><input type="radio" name={`${id}-kind`} checked={kind === "monthly"} onChange={() => setKind("monthly")} />
            {t("roster.form.monthly", { amount: monthlyNum ? fmt(monthlyNum) : "…" })}</label>
          {kind === "monthly" && (
            <span className="flex items-center gap-2">
              <Label htmlFor={`${id}-monthly`} className="mb-0">{t("roster.form.monthlyAmount")}</Label>
              <Input id={`${id}-monthly`} className="w-28" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
            </span>
          )}
        </div>
        {(feeDiffersFromPackage || (feeChanged && hasPayments)) && (
          <div>
            <Label htmlFor={`${id}-feereason`}>{t("roster.form.feeReason")}</Label>
            <Input id={`${id}-feereason`} value={feeReason} maxLength={500} onChange={(e) => setFeeReason(e.target.value)} placeholder={t("roster.form.feeReasonPlaceholder")} />
          </div>
        )}
        {feeChanged && (
          <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning-soft p-3 text-sm text-text">
            <input type="checkbox" className="mt-1" checked={feeConfirmed} onChange={(e) => setFeeConfirmed(e.target.checked)} />
            <span>{t(hasPayments ? "roster.form.confirmFeeAdjustment" : "roster.form.confirmFeeChange", { from: fmt(init?.agreedFee ?? 0), to: fmt(feeNum) })}</span>
          </label>
        )}
        {preview && (preview.ok ? (
          <div>
            <p className="text-xs uppercase tracking-[0.1em] text-text-muted">{t("roster.form.schedule")}</p>
            <ol className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
              {preview.rows.map((r) => (
                <li key={r.seq} className="flex justify-between gap-3 border-b border-border py-1 tnum">
                  <span>{r.seq}. {f.date(r.dueOn)}</span><span>{fmt(r.amount)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : <p role="alert" className="text-sm text-danger">{t.dynamic(`roster.errors.${preview.code}`, undefined, t("roster.errors.invalid"))}</p>)}
        {program?.paymentStartsOn && program.paymentEndsOn && (
          <p className={pastPaymentEnd ? "text-sm text-danger" : "text-xs text-text-muted"} role={pastPaymentEnd ? "alert" : undefined}>
            {t(pastPaymentEnd ? "roster.form.pastPaymentEnd" : "roster.form.paymentPeriod", {
              from: f.date(program.paymentStartsOn), to: f.date(program.paymentEndsOn) })}
          </p>
        )}
      </fieldset>

      {canEditDetails && (
        <fieldset className={section}>
          <legend className="px-1 text-sm font-medium text-text">{t("roster.form.details")}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor={`${id}-status`}>{t("roster.form.status")}</Label>
              <Select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
                {(mode.kind === "add" ? ["enrolled", "accepted"] : ["accepted", "enrolled", "waitlisted"]).map((s) => (
                  <option key={s} value={s}>{t.dynamic(`selection.statuses.${s}`, undefined, s)}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-jersey`}>{t("roster.form.jersey")}</Label>
              <Input id={`${id}-jersey`} inputMode="numeric" value={jersey} onChange={(e) => setJersey(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            </div>
          </div>
          <div>
            <Label htmlFor={`${id}-notes`}>{t("roster.form.notes")}</Label>
            <Textarea id={`${id}-notes`} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </fieldset>
      )}

      {error && (
        <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {error}
          {code === "ALREADY_ENROLLED" && <span className="block text-text-secondary">{t("roster.form.alreadyEnrolledHint")}</span>}
        </div>
      )}
      {saved && <p role="status" className="text-sm text-success">{saved}</p>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || (!canEditDetails && !canEditFee)}>{pending ? t("roster.form.saving") : t("roster.form.save")}</Button>
      </div>
    </form>
  );
}
