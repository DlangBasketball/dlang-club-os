"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AthletePickerField, initialAthlete, type AthleteChoices } from "@/components/participants/athlete-picker-field";
import { CreditCard } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { applyAsParent, changePackage, choosePackagePlan, withdrawApplication } from "@/lib/actions/selection";
import { normaliseCounts, packageChangeAllowed, packageSchedule, suggestDivision, type ApplicationStatus, type DivisionRule } from "@/lib/selection/rules";
import { ApplicationStatusBadge, Field, Notice, PackagePicker, type PackageOption } from "./shared";

export type ExtrasState = { currentClub: string; position: string; notes: string; videoUrl: string };

/** Current club, position, notes, tryout video (shared by the public page and the parent app). */
export function ApplicationExtras({ value, onChange, errors, askClub }: {
  value: ExtrasState; onChange: (v: ExtrasState) => void; errors: Record<string, string>; askClub: boolean;
}) {
  const t = useT();
  const set = (k: keyof ExtrasState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {askClub && (
        <Field label={t("selection.apply.currentClub")} htmlFor="sel-club" error={errors.currentClub} hint={t("selection.apply.currentClubHint")}>
          <Input id="sel-club" value={value.currentClub} maxLength={120} onChange={set("currentClub")} />
        </Field>
      )}
      <Field label={t("selection.apply.position")} htmlFor="sel-pos" error={errors.position}>
        <Input id="sel-pos" value={value.position} maxLength={60} onChange={set("position")} />
      </Field>
      <div className="sm:col-span-2">
        <Field label={t("selection.apply.video")} htmlFor="sel-video" error={errors.videoUrl} hint={t("selection.apply.videoHint")}>
          <Input id="sel-video" type="url" inputMode="url" placeholder="https://" value={value.videoUrl} maxLength={500} onChange={set("videoUrl")} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label={t("selection.apply.notes")} htmlFor="sel-notes" error={errors.notes} hint={t("selection.apply.notesHint")}>
          <Textarea id="sel-notes" value={value.notes} maxLength={2000} onChange={set("notes")} />
        </Field>
      </div>
    </div>
  );
}

/** Division select, auto-suggested from the date of birth (the club can override later). */
export function DivisionChooser({ divisions, dob, value, onChange, today }: {
  divisions: DivisionRule[]; dob: string | null; value: string; onChange: (id: string) => void; today: string;
}) {
  const t = useT();
  const suggested = suggestDivision(divisions, dob, today);
  React.useEffect(() => { if (suggested && !value) onChange(suggested); }, [suggested]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!divisions.length) return null;
  return (
    <Field label={t("selection.apply.division")} htmlFor="sel-div" hint={suggested ? t("selection.apply.divisionSuggested") : t("selection.apply.divisionPick")}>
      <Select id="sel-div" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("selection.apply.divisionChoose")}</option>
        {divisions.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </Select>
    </Field>
  );
}

const emptyExtras: ExtrasState = { currentClub: "", position: "", notes: "", videoUrl: "" };

/** Parent app: apply with an existing child in two taps (child, package). */
export function ParentApplyForm({ programId, kids, divisions, packages, currency, today, appliedIds, choices, active }: {
  programId: string; kids: { id: string; name: string; dob: string | null }[]; divisions: DivisionRule[]; packages: PackageOption[];
  currency: string; today: string; appliedIds: string[];
  /** Shared athlete picker data (children of the family; a child added inline is selected at once). */
  choices: AthleteChoices; active: string | null;
}) {
  const t = useT();
  const router = useRouter();
  // A child added in the picker joins the list at once (before the page data refreshes).
  const [added, setAdded] = React.useState<{ id: string; name: string; dob: string | null }[]>([]);
  const all = React.useMemo(() => [...kids, ...added.filter((a) => !kids.some((k) => k.id === a.id))], [kids, added]);
  const free = all.filter((k) => !appliedIds.includes(k.id));
  const [athleteId, setAthleteId] = React.useState(() => initialAthlete(active, kids.filter((k) => !appliedIds.includes(k.id)).map((k) => k.id)) || (kids.find((k) => !appliedIds.includes(k.id))?.id ?? ""));
  const [divisionId, setDivisionId] = React.useState("");
  const [packageId, setPackageId] = React.useState(packages[0]?.id ?? "");
  const [extras, setExtras] = React.useState<ExtrasState>(emptyExtras);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const kid = free.find((k) => k.id === athleteId) ?? null;


  async function submit() {
    setBusy(true); setMsg(null); setErrors({});
    const res = await applyAsParent({ programId, athleteId, divisionId, packageId, ...extras });
    setBusy(false);
    if (!res.ok) { setErrors(res.errors ?? {}); setMsg({ tone: "err", text: res.error }); return; }
    setMsg({ tone: "ok", text: res.message ?? "" });
    setExtras(emptyExtras);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("selection.apply.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        {!free.length && <p className="text-sm text-text-muted">{kids.length ? t("selection.apply.allApplied") : t("selection.apply.noChildren")}</p>}
        <AthletePickerField idPrefix="sel-kid" legend={t("selection.apply.child")} choices={choices} value={athleteId}
          exclude={appliedIds} activityDate={today}
          onChange={(id, p) => {
            if (p && !all.some((k) => k.id === p.id)) setAdded((a) => [...a, { id: p.id, name: p.name, dob: p.dob }]);
            setAthleteId(id); setDivisionId("");
          }} />
        <DivisionChooser key={athleteId} divisions={divisions} dob={kid?.dob ?? null} value={divisionId} onChange={setDivisionId} today={today} />
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("selection.apply.package")}</p>
          <PackagePicker name="sel-pkg" packages={packages} value={packageId} onChange={setPackageId} currency={currency} />
        </div>
        <details className="text-sm">
          <summary className="cursor-pointer text-text-muted">{t("selection.apply.more")}</summary>
          <div className="mt-3"><ApplicationExtras value={extras} onChange={setExtras} errors={errors} askClub={false} /></div>
        </details>
        <div className="flex items-center gap-3">
          <Button disabled={busy || !athleteId || !packageId} onClick={submit}>{t("selection.apply.submit")}</Button>
          <Notice msg={msg} />
        </div>
      </CardBody>
    </Card>
  );
}

export type FamilyApplicationView = {
  id: string; status: ApplicationStatus; athleteName: string; divisionName: string | null; packageId: string | null; packageName: string | null;
  decisionNote: string | null; invoiceId: string | null; invoiceStatus: string | null; currency: string; amountDue: number; paid: number;
  hasPlan: boolean; installmentCount: number | null;
};

/** One application in the parent app: status, message, package change, pay in full or instalments, withdraw. */
export function FamilyApplicationCard({ app, packages, today }: { app: FamilyApplicationView; packages: PackageOption[]; today: string }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const pkg = packages.find((p) => p.id === app.packageId) ?? null;
  const counts = normaliseCounts(pkg?.allowedCounts ?? [1]);
  const [count, setCount] = React.useState<number>(counts[counts.length - 1] ?? 1);
  const [newPkg, setNewPkg] = React.useState(app.packageId ?? "");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const balance = Math.max(app.amountDue - app.paid, 0);
  const canChange = packageChangeAllowed({ status: app.status, paid: app.paid, hasPlan: app.hasPlan }) && packages.length > 1;
  const choosing = (app.status === "accepted" || app.status === "enrolled") && !!app.invoiceId && !app.hasPlan && app.installmentCount == null
    && balance > 0 && app.invoiceStatus !== "paid";
  const schedule = choosing && count > 1 ? packageSchedule(balance, count, app.currency, today) : [];

  async function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? { tone: "ok", text: res.message ?? "" } : { tone: "err", text: res.error ?? "" });
    if (res.ok) { after?.(); router.refresh(); }
  }

  return (
    <Card>
      <CardBody className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium text-text">{app.athleteName}</span>
          <ApplicationStatusBadge status={app.status} />
        </div>
        <p className="text-xs text-text-muted">{[app.divisionName, app.packageName].filter(Boolean).join(" · ")}</p>
        <p className="text-text-muted">{t(`selection.family.statusHelp.${app.status}`)}</p>
        {app.decisionNote && <blockquote className="whitespace-pre-wrap border-l-2 border-brand-primary pl-3 text-text">{app.decisionNote}</blockquote>}

        {canChange && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label={t("selection.family.changePackage")} htmlFor={`pk-${app.id}`}>
              <Select id={`pk-${app.id}`} value={newPkg} onChange={(e) => setNewPkg(e.target.value)}>
                {packages.map((p) => <option key={p.id} value={p.id}>{p.name} · {f.money(p.price, app.currency)}</option>)}
              </Select>
            </Field>
            <Button size="sm" variant="secondary" disabled={busy || newPkg === app.packageId} onClick={() => act(() => changePackage(app.id, newPkg))}>{t("selection.family.change")}</Button>
          </div>
        )}

        {choosing && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="font-medium text-text">{t("selection.family.howToPay", { amount: f.money(balance, app.currency) })}</p>
            <div role="radiogroup" className="flex flex-wrap gap-2">
              {counts.map((n) => (
                <label key={n} className={`cursor-pointer rounded border px-3 py-1.5 text-xs ${count === n ? "border-brand-primary bg-brand-primary-soft text-text" : "border-border text-text-muted"}`}>
                  <input type="radio" className="sr-only" name={`cnt-${app.id}`} checked={count === n} onChange={() => setCount(n)} />
                  {n === 1 ? t("selection.family.payInFull") : t("selection.family.nMonths", { count: n, amount: f.money(packageSchedule(balance, n, app.currency, today)[0].amount, app.currency) })}
                </label>
              ))}
            </div>
            {schedule.length > 0 && (
              <ol className="grid gap-1 text-xs text-text-muted sm:grid-cols-2">
                {schedule.map((l) => <li key={l.seq} className="tnum">{t("selection.family.scheduleLine", { seq: l.seq, date: f.date(l.dueDate), amount: f.money(l.amount, app.currency) })}</li>)}
              </ol>
            )}
            <Button size="sm" disabled={busy} onClick={() => act(() => choosePackagePlan(app.id, count))}>
              {count === 1 ? t("selection.family.confirmFull") : t("selection.family.confirmPlan", { count })}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {app.invoiceId && app.invoiceStatus !== "cancelled" && (
            <Link href={`/parent/invoices/${app.invoiceId}`}><Button size="sm" variant={choosing ? "secondary" : "primary"}><CreditCard className="h-4 w-4" /> {t("selection.family.openInvoice")}</Button></Link>
          )}
          {app.status !== "withdrawn" && app.status !== "declined" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => window.confirm(t("selection.family.confirmWithdraw")) && act(() => withdrawApplication(app.id))}>
              {t("selection.family.withdraw")}
            </Button>
          )}
        </div>
        <Notice msg={msg} />
      </CardBody>
    </Card>
  );
}
