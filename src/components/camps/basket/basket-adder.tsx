"use client";
import * as React from "react";
import Link from "next/link";
import { CalendarDays, MapPin, Plus, ShoppingBasket, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select } from "@/components/ui";
import type { PublicCamp } from "@/lib/camps/data";
import { addWeeks, autoAgeGroup, dayCountsFor, hasLine, upsertChild, type BasketLunch } from "@/lib/camps/basket";
import { editionDays, rowsForEdition } from "@/lib/camps/logic";
import { groupBySeason } from "@/lib/camps/seasons";
import { useFormat, useT } from "@/lib/i18n/client";
import { useCampBasket } from "./use-camp-basket";
import { AthletePickerField, type AthleteChoices } from "@/components/participants/athlete-picker-field";

export type BasketKid = { id: string; name: string; dob: string | null };
type Api = ReturnType<typeof useCampBasket>;

/**
 * "Add to basket": one child, one or more weeks (across the given camps),
 * days count and lunch. The age group is picked from the child's age; days
 * of a part-week are chosen in the basket. Used on camp pages, the parent
 * "Camps" page, the public season page and inside the basket itself.
 */
export function BasketAdder(props: {
  mode: "public" | "parent" | "admin";
  scope: string;
  camps: PublicCamp[];
  kids?: BasketKid[];
  basketHref?: string;
  api?: Api;
  /** Pre-selected child (basket ref) — "Add same child to another week". */
  presetChildRef?: string | null;
  onAdded?: () => void;
  title?: string;
  /** Parent mode: the shared athlete picker (children; a child added inline is selected at once). */
  choices?: AthleteChoices;
  /** Parent mode: athlete preselected (the active athlete of the switcher). */
  presetAthleteId?: string | null;
}) {
  const own = useCampBasket(props.scope);
  const { basket, update } = props.api ?? own;
  const t = useT();
  const f = useFormat();
  const [addedKids, setAddedKids] = React.useState<BasketKid[]>([]);
  const kids = React.useMemo(() => [...(props.kids ?? []), ...addedKids.filter((a) => !(props.kids ?? []).some((k) => k.id === a.id))], [props.kids, addedKids]);

  // who: parent/admin -> athlete id; public -> basket child ref ("" = none, "new" = new child form)
  const presetKid = props.presetChildRef ? basket.children.find((c) => c.ref === props.presetChildRef) : undefined;
  const [who, setWho] = React.useState<string>(presetKid ? (props.mode === "public" ? presetKid.ref : presetKid.athleteId ?? "")
    : props.mode === "parent" && props.presetAthleteId && (props.kids ?? []).some((k) => k.id === props.presetAthleteId) ? props.presetAthleteId : "");
  React.useEffect(() => {
    if (presetKid) setWho(props.mode === "public" ? presetKid.ref : presetKid.athleteId ?? "");
  }, [presetKid, props.mode]);
  const [newKid, setNewKid] = React.useState({ firstName: "", lastName: "", dob: "" });
  const [weeks, setWeeks] = React.useState<Set<string>>(new Set());
  const [daysCount, setDaysCount] = React.useState("");
  const [lunch, setLunch] = React.useState<BasketLunch>("");
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const editionCamp = React.useMemo(() => {
    const m = new Map<string, PublicCamp>();
    for (const c of props.camps) for (const e of c.editions) m.set(e.id, c);
    return m;
  }, [props.camps]);

  const childRef = props.mode === "public" ? (who !== "new" ? who : "") : basket.children.find((c) => c.athleteId === who)?.ref ?? "";
  const chosen = Array.from(weeks).filter((id) => editionCamp.has(id));
  const counts = Array.from(new Set(chosen.flatMap((id) => dayCountsFor(editionCamp.get(id)!, id)))).sort((a, b) => a - b);
  const lunchChoices = new Set(chosen.flatMap((id) => rowsForEdition(editionCamp.get(id)!.options, id)
    .filter((o) => o.daysCount === Number(daysCount)).map((o) => (o.includesLunch ? "yes" : "no"))));

  function toggleWeek(id: string) {
    setWeeks((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function add() {
    setMsg(null);
    let ref = childRef;
    let dob: string | null = null;
    let next = basket;
    if (props.mode === "public") {
      if (!who && basket.children.length > 0) return setMsg({ tone: "err", text: t("camps.basket.adder.pickChild") });
      if (who === "new" || !who) {
        if (!newKid.firstName.trim() || !newKid.lastName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(newKid.dob)) {
          return setMsg({ tone: "err", text: t("camps.basket.adder.childRequired") });
        }
        const r = upsertChild(next, { firstName: newKid.firstName.trim(), lastName: newKid.lastName.trim(), dob: newKid.dob });
        if (!r.ref) return setMsg({ tone: "err", text: t("camps.errors.tooMany") });
        next = r.basket; ref = r.ref; dob = newKid.dob;
      } else {
        dob = next.children.find((c) => c.ref === who)?.dob ?? null;
      }
    } else {
      const kid = kids.find((k) => k.id === who);
      if (!kid) return setMsg({ tone: "err", text: t("camps.basket.adder.pickChild") });
      const r = upsertChild(next, { athleteId: kid.id, firstName: kid.name, lastName: "", dob: kid.dob ?? "" });
      if (!r.ref) return setMsg({ tone: "err", text: t("camps.errors.tooMany") });
      next = r.basket; ref = r.ref; dob = kid.dob;
    }
    if (!chosen.length) return setMsg({ tone: "err", text: t("camps.basket.adder.pickWeeks") });
    if (!daysCount) return setMsg({ tone: "err", text: t("camps.register.pickOption") });
    const before = next.lines.length;
    for (const id of chosen) {
      const camp = editionCamp.get(id)!;
      const ed = camp.editions.find((e) => e.id === id)!;
      const n = Number(daysCount);
      const all = editionDays(ed.startsOn, ed.endsOn);
      const hasCount = dayCountsFor(camp, id).includes(n);
      next = addWeeks(next, ref, [{ programId: camp.program.id, editionId: id, days: hasCount && n >= all.length ? all : [] }],
        { ageGroupId: autoAgeGroup(camp, ed.startsOn, dob), daysCount: hasCount ? n : null, lunch });
    }
    const added = next.lines.length - before;
    const finalBasket = next;
    update(() => finalBasket);
    setWeeks(new Set());
    if (props.mode === "public" && who !== ref) setWho(ref);
    setNewKid({ firstName: "", lastName: "", dob: "" });
    setMsg(added > 0 ? { tone: "ok", text: t("camps.basket.adder.added", { count: added }) } : { tone: "err", text: t("camps.basket.adder.nothingAdded") });
    if (added > 0) props.onAdded?.();
  }

  const groups = groupBySeason(props.camps, (c) => c.program.season ?? null);
  const multiCamp = props.camps.length > 1;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShoppingBasket className="h-5 w-5 text-maroon" />{props.title ?? t("camps.basket.adder.title")}</h2>
          {props.basketHref && (
            <Link href={props.basketHref} className="inline-flex items-center gap-1 text-sm text-maroon hover:underline">
              {t("camps.basket.viewBasket", { count: basket.lines.length })}
            </Link>
          )}
        </div>
        <p className="text-xs text-ink-3">{t("camps.basket.adder.intro")}</p>

        {/* 1. who */}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">{t("camps.basket.adder.who")}</legend>
          <div className="flex flex-wrap gap-2">
            {props.mode === "parent" && props.choices && (
              <AthletePickerField idPrefix={`ba-who-${props.scope}`} choices={props.choices} value={who} activityDate={new Date().toISOString().slice(0, 10)}
                onChange={(id, pt) => {
                  if (pt && !kids.some((k) => k.id === pt.id)) setAddedKids((x) => [...x, { id: pt.id, name: pt.name, dob: pt.dob }]);
                  setWho(id);
                }} />
            )}
            {props.mode !== "public" && !(props.mode === "parent" && props.choices) && kids.map((k) => (
              <button key={k.id} type="button" onClick={() => setWho(k.id)} aria-pressed={who === k.id}
                className={`rounded-full border px-3 py-1.5 text-sm ${who === k.id ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-2 hover:border-maroon/40"}`}>{k.name}</button>
            ))}
            {props.mode !== "public" && !(props.mode === "parent" && props.choices) && kids.length === 0 && <p className="text-sm text-ink-3">{t("camps.register.noChildren")}</p>}
            {props.mode === "public" && basket.children.map((c) => (
              <button key={c.ref} type="button" onClick={() => setWho(c.ref)} aria-pressed={who === c.ref}
                className={`rounded-full border px-3 py-1.5 text-sm ${who === c.ref ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-2 hover:border-maroon/40"}`}>{`${c.firstName} ${c.lastName}`.trim()}</button>
            ))}
            {props.mode === "public" && (
              <button type="button" onClick={() => setWho("new")} aria-pressed={who === "new" || (!who && basket.children.length === 0)}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm ${who === "new" || (!who && basket.children.length === 0) ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-2 hover:border-maroon/40"}`}>
                <UserPlus className="h-3.5 w-3.5" />{t("camps.basket.adder.newChild")}
              </button>
            )}
          </div>
          {props.mode === "public" && (who === "new" || (!who && basket.children.length === 0)) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><Label htmlFor={`ba-fn-${props.scope}`}>{t("registration.child.firstName")}</Label><Input id={`ba-fn-${props.scope}`} value={newKid.firstName} maxLength={80} onChange={(e) => setNewKid((s) => ({ ...s, firstName: e.target.value }))} /></div>
              <div><Label htmlFor={`ba-ln-${props.scope}`}>{t("registration.child.lastName")}</Label><Input id={`ba-ln-${props.scope}`} value={newKid.lastName} maxLength={80} onChange={(e) => setNewKid((s) => ({ ...s, lastName: e.target.value }))} /></div>
              <div><Label htmlFor={`ba-dob-${props.scope}`}>{t("registration.child.dob")}</Label><Input id={`ba-dob-${props.scope}`} type="date" value={newKid.dob} onChange={(e) => setNewKid((s) => ({ ...s, dob: e.target.value }))} /></div>
            </div>
          )}
        </fieldset>

        {/* 2. weeks */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-ink">{t("camps.basket.adder.weeks")}</legend>
          {props.camps.every((c) => c.editions.length === 0) && <p className="text-sm text-ink-3">{t("camps.register.noEditions")}</p>}
          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
              {multiCamp && g.season && <div className="text-xs uppercase tracking-[0.14em] text-ink-3">{t("camps.seasons.label", { season: t(`camps.seasons.names.${g.season}`), year: g.year ?? "" })}</div>}
              {g.items.map((camp) => (
                <div key={camp.program.id} className="space-y-1.5">
                  {multiCamp && <div className="text-sm font-medium text-ink">{camp.program.name}</div>}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {camp.editions.map((e) => {
                      const inBasket = !!childRef && hasLine(basket, childRef, e.id);
                      const disabled = (!e.open && props.mode !== "admin") || inBasket;
                      const on = weeks.has(e.id);
                      const place = e.venue?.city ?? e.city ?? e.locationName;
                      return (
                        <label key={e.id} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${on ? "border-maroon ring-1 ring-maroon" : "border-line hover:border-maroon/40"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}>
                          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={on} disabled={disabled} onChange={() => toggleWeek(e.id)} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5 text-ink"><CalendarDays className="h-3.5 w-3.5 text-ink-3" />{f.dateRange(e.startsOn, e.endsOn)}</span>
                            {place && <span className="flex items-center gap-1.5 text-xs text-ink-3"><MapPin className="h-3 w-3" />{place}</span>}
                          </span>
                          {inBasket ? <Badge tone="info">{t("camps.basket.inBasket")}</Badge>
                            : !e.open ? <Badge tone="neutral">{e.spotsLeft === 0 ? t("camps.register.full") : t("camps.register.closed")}</Badge>
                              : e.spotsLeft !== null && e.spotsLeft <= 5 ? <Badge tone="warning">{t("camps.register.spotsLeft", { count: e.spotsLeft })}</Badge> : null}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </fieldset>

        {/* 3. days + lunch */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><Label htmlFor={`ba-dc-${props.scope}`}>{t("camps.register.daysCount")}</Label>
            <Select id={`ba-dc-${props.scope}`} value={daysCount} disabled={!chosen.length} onChange={(e) => { setDaysCount(e.target.value); setLunch(""); }}>
              <option value="">{t("common.select")}</option>
              {counts.map((n) => <option key={n} value={n}>{t("camps.register.daysOption", { count: n })}</option>)}
            </Select>
          </div>
          <div><Label htmlFor={`ba-lu-${props.scope}`}>{t("camps.register.lunch")}</Label>
            <Select id={`ba-lu-${props.scope}`} value={lunch} disabled={!daysCount} onChange={(e) => setLunch(e.target.value as BasketLunch)}>
              <option value="">{t("common.select")}</option>
              {lunchChoices.has("yes") && <option value="yes">{t("camps.basket.withLunch")}</option>}
              {lunchChoices.has("no") && <option value="no">{t("camps.basket.withoutLunch")}</option>}
            </Select>
          </div>
        </div>

        {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={add}><Plus className="h-4 w-4" /> {t("camps.basket.adder.add", { count: chosen.length })}</Button>
          {props.basketHref && basket.lines.length > 0 && (
            <Link href={props.basketHref}><Button type="button" variant="secondary"><ShoppingBasket className="h-4 w-4" /> {t("camps.basket.checkoutCta", { count: basket.lines.length })}</Button></Link>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
