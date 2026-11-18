"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, CalendarPlus, Scissors, ShoppingBasket } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { duplicateCampForNextYear, moveCampEdition, setCampSeason, splitCampBySeason } from "@/lib/actions/camp-seasons";
import { CAMP_SEASONS, planSeasonSplit, type CampSeason, type SeasonOfYear } from "@/lib/camps/seasons";
import { useFormat, useT } from "@/lib/i18n/client";

type Week = { id: string; name: string | null; startsOn: string; endsOn: string; registrations: number };

/**
 * Camp admin: season of the camp, "Split by season", "Duplicate for next
 * year" and "Move week to another camp". Every action re-checks the admin
 * role and the org on the server.
 */
export function CampSeasonTools({ programId, season, seasonYear, derived, weeks, otherCamps }: {
  programId: string;
  season: CampSeason | null;
  seasonYear: number | null;
  derived: SeasonOfYear | null;
  weeks: Week[];
  otherCamps: { id: string; name: string }[];
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [s, setS] = React.useState<string>(season ?? "");
  const [y, setY] = React.useState<string>(seasonYear ? String(seasonYear) : derived ? String(derived.year) : "");
  const [week, setWeek] = React.useState(weeks[0]?.id ?? "");
  const [target, setTarget] = React.useState(otherCamps[0]?.id ?? "");
  const [withRegs, setWithRegs] = React.useState(false);
  const plan = planSeasonSplit(weeks);
  const seasonLabel = (x: SeasonOfYear) => t("camps.seasons.label", { season: t(`camps.seasons.names.${x.season}`), year: x.year });
  const chosenWeek = weeks.find((w) => w.id === week);

  async function run(fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, ok: (r: Record<string, unknown>) => string, after?: (r: Record<string, unknown>) => void) {
    setBusy(true); setMsg(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setMsg({ tone: "err", text: String(res.error ?? "") }); return; }
    setMsg({ tone: "ok", text: ok(res) });
    if (after) after(res); else router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("camps.seasons.toolsTitle")}</CardTitle></CardHeader>
      <CardBody className="space-y-6">
        {/* Season */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-ink">{t("camps.seasons.seasonOfCamp")}</div>
          <div className="flex flex-wrap items-end gap-3">
            <div><Label htmlFor="cs-season">{t("camps.seasons.season")}</Label>
              <Select id="cs-season" value={s} onChange={(e) => setS(e.target.value)}>
                <option value="">{derived ? t("camps.seasons.auto", { season: seasonLabel(derived) }) : t("camps.seasons.autoNone")}</option>
                {CAMP_SEASONS.map((x) => <option key={x} value={x}>{t(`camps.seasons.names.${x}`)}</option>)}
              </Select>
            </div>
            {s && <div className="w-28"><Label htmlFor="cs-year">{t("camps.seasons.year")}</Label><Input id="cs-year" type="number" min={2000} max={2100} value={y} onChange={(e) => setY(e.target.value)} /></div>}
            <Button size="sm" variant="secondary" disabled={busy}
              onClick={() => run(() => setCampSeason(programId, { season: s as CampSeason | "", year: s && y ? Number(y) : "" }), () => t("camps.seasons.saved"))}>{t("common.save")}</Button>
          </div>
        </div>

        {/* Split */}
        <div className="space-y-2 border-t border-line-soft pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><Scissors className="h-4 w-4" />{t("camps.seasons.splitTitle")}</div>
          {plan ? (
            <>
              <p className="text-xs text-ink-3">{t("camps.seasons.splitIntro")}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                <li>{t("camps.seasons.splitKeep", { season: seasonLabel(plan.keep), count: plan.keep.editionIds.length })}</li>
                {plan.create.map((g) => <li key={`${g.season}-${g.year}`}>{t("camps.seasons.splitNew", { season: seasonLabel(g), count: g.editionIds.length })}</li>)}
              </ul>
              <Button size="sm" disabled={busy} onClick={() => {
                if (!window.confirm(t("camps.seasons.splitConfirm"))) return;
                run(() => splitCampBySeason(programId), (r) => t("camps.seasons.splitDone", { count: Number(r.created ?? 0) }));
              }}><Scissors className="h-4 w-4" /> {t("camps.seasons.splitButton")}</Button>
            </>
          ) : <p className="text-xs text-ink-3">{t("camps.seasons.splitNothing")}</p>}
        </div>

        {/* Duplicate */}
        <div className="space-y-2 border-t border-line-soft pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><CalendarPlus className="h-4 w-4" />{t("camps.seasons.duplicateTitle")}</div>
          <p className="text-xs text-ink-3">{t("camps.seasons.duplicateIntro")}</p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => duplicateCampForNextYear(programId), () => t("camps.seasons.duplicated"),
            (r) => { if (r.id) router.push(`/admin/programs/${String(r.id)}`); })}>
            <CalendarPlus className="h-4 w-4" /> {t("camps.seasons.duplicateButton")}
          </Button>
        </div>

        {/* Move a week */}
        <div className="space-y-2 border-t border-line-soft pt-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><ArrowRightLeft className="h-4 w-4" />{t("camps.seasons.moveTitle")}</div>
          {weeks.length === 0 || otherCamps.length === 0 ? <p className="text-xs text-ink-3">{t("camps.seasons.moveNothing")}</p> : (
            <>
              <p className="text-xs text-ink-3">{t("camps.seasons.moveIntro")}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><Label htmlFor="cs-week">{t("camps.seasons.week")}</Label>
                  <Select id="cs-week" value={week} onChange={(e) => { setWeek(e.target.value); setWithRegs(false); }}>
                    {weeks.map((w) => <option key={w.id} value={w.id}>{`${w.name ? `${w.name} · ` : ""}${f.dateRange(w.startsOn, w.endsOn)}`}</option>)}
                  </Select>
                </div>
                <div><Label htmlFor="cs-target">{t("camps.seasons.targetCamp")}</Label>
                  <Select id="cs-target" value={target} onChange={(e) => setTarget(e.target.value)}>
                    {otherCamps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </div>
              </div>
              {chosenWeek && chosenWeek.registrations > 0 && (
                <label className="flex items-start gap-2 text-sm text-warning">
                  <input type="checkbox" checked={withRegs} onChange={(e) => setWithRegs(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--red-primary)]" />
                  {t("camps.seasons.moveWithRegistrations", { count: chosenWeek.registrations })}
                </label>
              )}
              <Button size="sm" variant="secondary" disabled={busy || !week || !target || (!!chosenWeek && chosenWeek.registrations > 0 && !withRegs)}
                onClick={() => run(() => moveCampEdition(week, target, withRegs), (r) => t("camps.seasons.moved", { count: Number(r.moved ?? 0) }))}>
                <ArrowRightLeft className="h-4 w-4" /> {t("camps.seasons.moveButton")}
              </Button>
            </>
          )}
        </div>

        <div className="border-t border-line-soft pt-4">
          <Link href="/admin/camps/basket" className="inline-flex items-center gap-1.5 text-sm text-maroon hover:underline">
            <ShoppingBasket className="h-4 w-4" /> {t("camps.basket.adminLink")}
          </Link>
        </div>
        {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
