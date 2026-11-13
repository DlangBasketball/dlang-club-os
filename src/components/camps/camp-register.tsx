"use client";
import * as React from "react";
import { CalendarDays, Clock, ExternalLink, MapPin, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select } from "@/components/ui";
import { quoteCamp, submitCampParent, submitCampPublic, type QuoteView } from "@/lib/actions/camp-registration";
import type { PublicCamp } from "@/lib/camps/data";
import { ageFits, ageOn, defaultDays, editionDays, rowsForEdition } from "@/lib/camps/logic";
import { mapsUrl } from "@/lib/sportsops/location";
import { useFormat, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translator";
import { ChildExtrasFields, requiredMark, shows } from "@/components/forms/registration-extras";
import { resolveConfig, validateRegistrationExtras, type BuiltinField, type RegistrationConfig } from "@/lib/registration-form/config";

type Choice = { ageGroupId: string; daysCount: string; lunch: "" | "yes" | "no"; days: string[] };
type Extras = { extras: Partial<Record<BuiltinField, string>>; answers: Record<string, unknown> };
type PublicChild = Choice & Extras & { firstName: string; lastName: string; dob: string; gender: string; allergies: string; conditions: string; medicalNotes: string };
type ParentChild = Choice & { athleteId: string; answers: Record<string, unknown> };
type Parent = { name: string; email: string; phone: string; address: string; emergencyName: string; emergencyPhone: string };
type Edition = PublicCamp["editions"][number];

const emptyChoice = (): Choice => ({ ageGroupId: "", daysCount: "", lunch: "", days: [] });
const emptyChild = (): PublicChild => ({ ...emptyChoice(), firstName: "", lastName: "", dob: "", gender: "", allergies: "", conditions: "", medicalNotes: "", extras: {}, answers: {} });

const consentCopy = (t: Translator, key: string) => t.dynamic(`registration.consents.${key}`, undefined, t("registration.consents.default"));

function placeOf(e: Edition): { label: string; query: string } {
  const v = e.venue;
  const label = v ? [v.name, v.address, [v.postalCode, v.city ?? e.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : [e.locationName, e.address, e.city].filter(Boolean).join(", ");
  return { label, query: label };
}

export function CampRegister(props:
  | { mode: "public"; camp: PublicCamp; slug: string; config?: RegistrationConfig }
  | { mode: "parent"; camp: PublicCamp; kids: { id: string; name: string; dob: string | null }[]; config?: RegistrationConfig }) {
  const { camp } = props;
  // Registration form editor config (omitted = the default form).
  const config = React.useMemo(() => props.config ?? resolveConfig(null), [props.config]);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const t = useT();
  const f = useFormat();
  const money = (n: number) => f.money(n, camp.program.currency);
  const [editionId, setEditionId] = React.useState(camp.editions.find((e) => e.open)?.id ?? "");
  const edition = camp.editions.find((e) => e.id === editionId) ?? null;
  const options = React.useMemo(() => (edition ? rowsForEdition(camp.options, edition.id) : []), [camp.options, edition]);
  const slots = React.useMemo(() => (edition ? rowsForEdition(camp.timeSlots.map((s) => ({ ...s, isActive: true })), edition.id) : []), [camp.timeSlots, edition]);
  const allDays = edition ? editionDays(edition.startsOn, edition.endsOn) : [];
  const dayCounts = Array.from(new Set(options.map((o) => o.daysCount))).sort((a, b) => a - b);

  const [parent, setParent] = React.useState<Parent>({ name: "", email: "", phone: "", address: "", emergencyName: "", emergencyPhone: "" });
  const [pubKids, setPubKids] = React.useState<PublicChild[]>([emptyChild()]);
  const [parKids, setParKids] = React.useState<ParentChild[]>([]);
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [promo, setPromo] = React.useState("");
  const [account, setAccount] = React.useState<"none" | "password" | "link">("link");
  const [password, setPassword] = React.useState("");
  const [quote, setQuote] = React.useState<QuoteView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const optionFor = (c: Choice) => {
    const n = Number(c.daysCount);
    const matches = options.filter((o) => o.daysCount === n && (c.lunch === "" || o.includesLunch === (c.lunch === "yes")));
    return matches.length === 1 ? matches[0] : c.lunch ? matches[0] : undefined;
  };
  const kids: (Choice & { key: string; dob: string | null; athleteId: string | null })[] = props.mode === "public"
    ? pubKids.map((c, i) => ({ ...c, key: String(i), dob: c.dob || null, athleteId: null }))
    : parKids.map((c) => ({ ...c, key: c.athleteId, dob: props.kids.find((k) => k.id === c.athleteId)?.dob ?? null, athleteId: c.athleteId }));

  // Live price breakdown (server-computed; the same function prices the invoice).
  const quoteKey = JSON.stringify({ editionId, promo, k: kids.map((k) => [k.key, optionFor(k)?.id ?? "", k.ageGroupId, k.days, k.dob, k.athleteId]) });
  React.useEffect(() => {
    if (!editionId) return;
    const handle = setTimeout(async () => {
      const q = await quoteCamp({
        slug: props.mode === "public" ? props.slug : undefined,
        programId: props.mode === "parent" ? camp.program.id : undefined,
        editionId, promoCode: promo,
        children: kids.map((k) => ({ key: k.key, priceOptionId: optionFor(k)?.id ?? "", ageGroupId: k.ageGroupId, days: k.days, dob: k.dob, athleteId: k.athleteId })),
      });
      setQuote(q);
    }, 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  function updateChoice(key: string, patch: Partial<Choice>) {
    const apply = <T extends Choice>(c: T): T => {
      const next = { ...c, ...patch };
      if (patch.daysCount !== undefined && edition) {
        next.days = defaultDays(Number(patch.daysCount), edition.startsOn, edition.endsOn);
        const lunches = options.filter((o) => o.daysCount === Number(patch.daysCount));
        if (lunches.length === 1) next.lunch = lunches[0].includesLunch ? "yes" : "no";
      }
      return next;
    };
    if (props.mode === "public") setPubKids((arr) => arr.map((c, i) => (String(i) === key ? apply(c) : c)));
    else setParKids((arr) => arr.map((c) => (c.athleteId === key ? apply(c) : c)));
  }
  function toggleDay(key: string, day: string, max: number) {
    const k = kids.find((x) => x.key === key);
    if (!k) return;
    const has = k.days.includes(day);
    const days = has ? k.days.filter((d) => d !== day) : k.days.length < max ? [...k.days, day].sort() : k.days;
    updateChoice(key, { days });
  }
  function pickEdition(id: string) {
    setEditionId(id);
    setPubKids((arr) => arr.map((c) => ({ ...c, ...emptyChoice(), ageGroupId: c.ageGroupId })));
    setParKids((arr) => arr.map((c) => ({ ...c, ...emptyChoice(), ageGroupId: c.ageGroupId })));
  }

  function validate(): string | null {
    if (!edition || !edition.open) return t("camps.register.pickEdition");
    if (!kids.length) return t("camps.errors.noChildren");
    for (const k of kids) {
      const o = optionFor(k);
      if (!k.ageGroupId) return t("camps.register.pickAgeGroup");
      if (!o) return t("camps.register.pickOption");
      if (k.days.length !== o.daysCount) return t("camps.register.pickDays", { count: o.daysCount });
    }
    const missing = camp.consents.filter((c) => c.required && !accepted.has(c.key));
    if (missing.length) return t("registration.consents.missing");
    if (props.mode === "public" && account === "password" && password.length < 10) return t("camps.errors.password");
    const fe: Record<string, string> = {};
    if (props.mode === "public") {
      const pc = validateRegistrationExtras(config, { address: parent.address }, {}, "parent");
      for (const [k, key] of Object.entries(pc.errors)) fe[`parent.${k}`] = t.dynamic(key);
      pubKids.forEach((c, i) => {
        const r = validateRegistrationExtras(config, { ...c.extras, gender: c.gender, allergies: c.allergies, conditions: c.conditions, medicalNotes: c.medicalNotes }, c.answers, "child");
        for (const [k, key] of Object.entries(r.errors)) fe[`${i}.${k}`] = t.dynamic(key);
      });
    } else {
      for (const c of parKids) {
        const r = validateRegistrationExtras({ ...config, builtin: resolveConfig(null).builtin }, {}, c.answers, "child");
        for (const [k, key] of Object.entries(r.errors)) if (k.startsWith("q.")) fe[`${c.athleteId}.${k}`] = t.dynamic(key);
      }
    }
    setFieldErrors(fe);
    if (Object.keys(fe).length) return t("forms.errors.fixFields");
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) { setError(v); return; }
    setSubmitting(true); setError(null);
    const consents = Array.from(accepted);
    const res = props.mode === "public"
      ? await submitCampPublic({
          programSlug: props.slug, editionId, promoCode: promo, consents, parent,
          children: pubKids.map((c) => ({ ...c, priceOptionId: optionFor(c)?.id ?? "", ageGroupId: c.ageGroupId, days: c.days })),
        }, account === "password" ? { mode: "password", password } : { mode: account })
      : await submitCampParent({
          programId: camp.program.id, editionId, promoCode: promo, consents,
          children: parKids.map((c) => ({ athleteId: c.athleteId, priceOptionId: optionFor(c)?.id ?? "", ageGroupId: c.ageGroupId, days: c.days, answers: c.answers })),
        });
    // Success redirects server-side; only failures come back.
    if (res && !res.ok) {
      setSubmitting(false);
      setError(res.error);
      if (res.errors) setFieldErrors(res.errors);
    }
  }
  const errorsFor = (prefix: string) =>
    Object.fromEntries(Object.entries(fieldErrors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
  const setExtra = (i: number) => (k: BuiltinField, v: string) =>
    setPubKids((arr) => arr.map((c, idx) => (idx === i ? { ...c, extras: { ...c.extras, [k]: v } } : c)));
  const setAnswer = (i: number) => (id: string, v: unknown) =>
    setPubKids((arr) => arr.map((c, idx) => (idx === i ? { ...c, answers: { ...c.answers, [id]: v } } : c)));
  const setParentAnswer = (athleteId: string) => (id: string, v: unknown) =>
    setParKids((arr) => arr.map((c) => (c.athleteId === athleteId ? { ...c, answers: { ...c.answers, [id]: v } } : c)));

  const setP = (k: keyof Parent) => (e: React.ChangeEvent<HTMLInputElement>) => setParent((s) => ({ ...s, [k]: e.target.value }));
  const setC = (i: number, k: keyof PublicChild) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setPubKids((arr) => arr.map((c, idx) => (idx === i ? { ...c, [k]: e.target.value } : c)));

  function renderChoice(k: (typeof kids)[number], label: string) {
    const age = k.dob && edition ? ageOn(k.dob, edition.startsOn) : null;
    const groups = camp.ageGroups.filter((g) => g.isActive);
    const opt = optionFor(k);
    const lunchOpts = options.filter((o) => o.daysCount === Number(k.daysCount));
    const item = quote?.items.find((i) => i.key === k.key);
    return (
      <div className="space-y-3 rounded-md border border-line bg-surface-elevated/40 p-3">
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><Label htmlFor={`ag-${k.key}`}>{t("camps.register.ageGroup")}</Label>
            <Select id={`ag-${k.key}`} value={k.ageGroupId} onChange={(e) => updateChoice(k.key, { ageGroupId: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id} disabled={age !== null && !ageFits(age, g.minAge, g.maxAge)}>{g.label}</option>
              ))}
            </Select>
            {age !== null && <p className="mt-1 text-xs text-ink-3">{t("common.ageYears", { age })}</p>}
          </div>
          <div><Label htmlFor={`dc-${k.key}`}>{t("camps.register.daysCount")}</Label>
            <Select id={`dc-${k.key}`} value={k.daysCount} onChange={(e) => updateChoice(k.key, { daysCount: e.target.value })}>
              <option value="">{t("common.select")}</option>
              {dayCounts.map((n) => <option key={n} value={n}>{t("camps.register.daysOption", { count: n })}</option>)}
            </Select>
          </div>
          <div><Label htmlFor={`lu-${k.key}`}>{t("camps.register.lunch")}</Label>
            <Select id={`lu-${k.key}`} value={k.lunch} disabled={!k.daysCount} onChange={(e) => updateChoice(k.key, { lunch: e.target.value as Choice["lunch"] })}>
              <option value="">{t("common.select")}</option>
              {lunchOpts.some((o) => o.includesLunch) && <option value="yes">{t("camps.register.withLunch", { price: money(lunchOpts.find((o) => o.includesLunch)!.price) })}</option>}
              {lunchOpts.some((o) => !o.includesLunch) && <option value="no">{t("camps.register.withoutLunch", { price: money(lunchOpts.find((o) => !o.includesLunch)!.price) })}</option>}
            </Select>
          </div>
        </div>
        {opt && (
          <div>
            <div className="mb-1 text-xs text-ink-3">{opt.daysCount >= allDays.length ? t("camps.register.allDays") : t("camps.register.chooseDays", { count: opt.daysCount, chosen: k.days.length })}</div>
            <div className="flex flex-wrap gap-2">
              {allDays.map((d) => {
                const on = k.days.includes(d);
                return (
                  <button key={d} type="button" onClick={() => toggleDay(k.key, d, opt.daysCount)} aria-pressed={on}
                    className={`rounded border px-3 py-1.5 text-xs ${on ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
                    {f.date(d, { weekday: true, style: "short" })}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {item && (
          <div className="space-y-0.5 border-t border-line-soft pt-2 text-sm">
            <Row label={opt?.label ?? ""} value={money(item.listAmount)} />
            {item.discounts.map((d, i) => <Row key={i} label={d.name} value={`– ${money(d.amount)}`} tone="success" />)}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Editions */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("camps.register.editionsTitle")}</h2>
        {camp.editions.length === 0 && <p className="text-sm text-ink-3">{t("camps.register.noEditions")}</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {camp.editions.map((e) => {
            const place = placeOf(e);
            const url = mapsUrl(place.query);
            const selected = e.id === editionId;
            return (
              <label key={e.id} className={`block cursor-pointer rounded-md border p-4 ${selected ? "border-maroon ring-1 ring-maroon" : "border-line hover:border-maroon/40"} ${e.open ? "" : "cursor-not-allowed opacity-60"}`}>
                <input type="radio" name="edition" className="sr-only" disabled={!e.open} checked={selected} onChange={() => pickEdition(e.id)} />
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-ink">{e.name || f.dateRange(e.startsOn, e.endsOn)}</div>
                  {!e.open ? <Badge tone="neutral">{e.spotsLeft === 0 ? t("camps.register.full") : t("camps.register.closed")}</Badge>
                    : e.spotsLeft !== null && e.spotsLeft <= 5 ? <Badge tone="warning">{t("camps.register.spotsLeft", { count: e.spotsLeft })}</Badge> : null}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3"><CalendarDays className="h-3.5 w-3.5" />{f.dateRange(e.startsOn, e.endsOn)}</div>
                {place.label && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
                    <MapPin className="h-3.5 w-3.5" />{place.label}
                    {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-maroon hover:underline"><ExternalLink className="h-3 w-3" />{t("camps.register.map")}</a>}
                  </div>
                )}
                {e.registrationClosesAt && e.open && <div className="mt-1 text-xs text-ink-3">{t("camps.register.closesOn", { date: f.date(e.registrationClosesAt) })}</div>}
              </label>
            );
          })}
        </div>
      </section>

      {edition && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card><CardBody className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium text-ink"><Clock className="h-4 w-4" />{t("camps.register.timesTitle")}</div>
            {slots.map((s) => <div key={s.id} className="flex justify-between text-ink-2"><span>{s.label}</span><span className="tnum">{s.startsAt}–{s.endsAt}</span></div>)}
            {camp.ageGroups.map((g) => {
              const s = camp.timeSlots.find((x) => x.id === g.timeSlotId);
              return <div key={g.id} className="flex justify-between text-xs text-ink-3"><span><Users className="mr-1 inline h-3 w-3" />{g.label}</span><span>{s ? `${s.startsAt}–${s.endsAt}` : ""}</span></div>;
            })}
          </CardBody></Card>
          <Card><CardBody className="space-y-1 text-sm">
            <div className="font-medium text-ink">{t("camps.register.pricesTitle")}</div>
            {options.map((o) => <Row key={o.id} label={o.label} value={money(o.price)} />)}
          </CardBody></Card>
        </section>
      )}

      {edition && props.mode === "public" && (
        <Card><CardBody className="space-y-4">
          <h2 className="text-lg font-semibold">{t("registration.parent.title")}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="p-name">{t("registration.parent.fullName")}</Label><Input id="p-name" autoComplete="name" value={parent.name} onChange={setP("name")} /></div>
            <div><Label htmlFor="p-email">{t("registration.parent.email")}</Label><Input id="p-email" type="email" autoComplete="email" value={parent.email} onChange={setP("email")} /></div>
            <div><Label htmlFor="p-phone">{t("registration.parent.phone")}</Label><Input id="p-phone" autoComplete="tel" value={parent.phone} onChange={setP("phone")} /></div>
            {shows(config, "address") && <div><Label htmlFor="p-addr">{t("registration.parent.address")}{requiredMark(config, "address")}</Label><Input id="p-addr" autoComplete="street-address" value={parent.address} onChange={setP("address")} />{fieldErrors["parent.address"] && <p className="mt-1 text-xs text-danger">{fieldErrors["parent.address"]}</p>}</div>}
            <div><Label htmlFor="p-en">{t("registration.parent.emergencyName")}</Label><Input id="p-en" value={parent.emergencyName} onChange={setP("emergencyName")} /></div>
            <div><Label htmlFor="p-ep">{t("registration.parent.emergencyPhone")}</Label><Input id="p-ep" value={parent.emergencyPhone} onChange={setP("emergencyPhone")} /></div>
          </div>
        </CardBody></Card>
      )}

      {edition && props.mode === "public" && pubKids.map((c, i) => (
        <Card key={i}><CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{t("registration.child.title", { index: i + 1 })}</h3>
            {pubKids.length > 1 && (
              <button type="button" onClick={() => setPubKids((arr) => arr.filter((_, idx) => idx !== i))} className="flex items-center gap-1 text-xs text-ink-3 hover:text-danger">
                <Trash2 className="h-3.5 w-3.5" /> {t("common.remove")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor={`c-fn-${i}`}>{t("registration.child.firstName")}</Label><Input id={`c-fn-${i}`} value={c.firstName} onChange={setC(i, "firstName")} /></div>
            <div><Label htmlFor={`c-ln-${i}`}>{t("registration.child.lastName")}</Label><Input id={`c-ln-${i}`} value={c.lastName} onChange={setC(i, "lastName")} /></div>
            <div><Label htmlFor={`c-dob-${i}`}>{t("registration.child.dob")}</Label><Input id={`c-dob-${i}`} type="date" value={c.dob} onChange={setC(i, "dob")} /></div>
            {shows(config, "gender") && <div><Label htmlFor={`c-g-${i}`}>{t("registration.child.gender")}{requiredMark(config, "gender")}</Label>
              <Select id={`c-g-${i}`} value={c.gender} onChange={setC(i, "gender")}>
                <option value="">{t("common.select")}</option><option value="Male">{t("registration.child.genderMale")}</option><option value="Female">{t("registration.child.genderFemale")}</option><option value="Other">{t("registration.child.genderOther")}</option>
              </Select>
              {fieldErrors[`${i}.gender`] && <p className="mt-1 text-xs text-danger">{fieldErrors[`${i}.gender`]}</p>}
            </div>}
            {shows(config, "allergies") && <div><Label htmlFor={`c-al-${i}`}>{t("registration.child.allergies")}{requiredMark(config, "allergies")}</Label><Input id={`c-al-${i}`} value={c.allergies} placeholder={t("registration.child.allergiesPlaceholder")} onChange={setC(i, "allergies")} />{fieldErrors[`${i}.allergies`] && <p className="mt-1 text-xs text-danger">{fieldErrors[`${i}.allergies`]}</p>}</div>}
            {shows(config, "conditions") && <div><Label htmlFor={`c-co-${i}`}>{t("registration.child.conditions")}{requiredMark(config, "conditions")}</Label><Input id={`c-co-${i}`} value={c.conditions} placeholder={t("registration.child.conditionsPlaceholder")} onChange={setC(i, "conditions")} />{fieldErrors[`${i}.conditions`] && <p className="mt-1 text-xs text-danger">{fieldErrors[`${i}.conditions`]}</p>}</div>}
            {config.builtin.medicalNotes.required && <div><Label htmlFor={`c-mn-${i}`}>{t("registration.child.otherNotes")}{requiredMark(config, "medicalNotes")}</Label><Input id={`c-mn-${i}`} value={c.medicalNotes} onChange={setC(i, "medicalNotes")} />{fieldErrors[`${i}.medicalNotes`] && <p className="mt-1 text-xs text-danger">{fieldErrors[`${i}.medicalNotes`]}</p>}</div>}
          </div>
          <ChildExtrasFields config={config} extras={c.extras} answers={c.answers} onExtras={setExtra(i)} onAnswers={setAnswer(i)} errors={errorsFor(`${i}.`)} idPrefix={`camp-c${i}`} />
          {renderChoice(kids[i], t("camps.register.choicesTitle"))}
        </CardBody></Card>
      ))}
      {edition && props.mode === "public" && (
        <Button variant="secondary" onClick={() => setPubKids((arr) => [...arr, emptyChild()])}><Plus className="h-4 w-4" /> {t("registration.child.add")}</Button>
      )}

      {edition && props.mode === "parent" && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("camps.register.whichChildren")}</h2>
          {props.kids.length === 0 && <p className="text-sm text-ink-3">{t("camps.register.noChildren")}</p>}
          {props.kids.map((k) => {
            const on = parKids.some((c) => c.athleteId === k.id);
            return (
              <div key={k.id} className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={on} className="h-4 w-4 accent-[var(--red-primary)]"
                    onChange={() => setParKids((arr) => (on ? arr.filter((c) => c.athleteId !== k.id) : [...arr, { ...emptyChoice(), athleteId: k.id, answers: {} }]))} />
                  {k.name}
                </label>
                {on && renderChoice(kids.find((x) => x.key === k.id)!, k.name)}
                {on && (
                  <ChildExtrasFields config={config} extras={{}} builtins={false} answers={parKids.find((c) => c.athleteId === k.id)?.answers ?? {}}
                    onExtras={() => undefined} onAnswers={setParentAnswer(k.id)} errors={errorsFor(`${k.id}.`)} idPrefix={`camp-k${k.id.slice(0, 8)}`} />
                )}
              </div>
            );
          })}
        </CardBody></Card>
      )}

      {edition && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("registration.consents.title")}</h2>
          {camp.consents.length === 0 && <p className="text-sm text-ink-3">{t("camps.register.noConsents")}</p>}
          {camp.consents.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-elevated/40 px-4 py-3 hover:border-maroon/40">
              <input type="checkbox" checked={accepted.has(c.key)} className="mt-1 h-4 w-4 accent-[var(--red-primary)]"
                onChange={() => setAccepted((s) => { const n = new Set(s); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {c.title}
                  {c.required ? <Badge tone="danger">{t("registration.consents.required")}</Badge> : <Badge tone="neutral">{t("registration.consents.optional")}</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-ink-3">{consentCopy(t, c.key)}</span>
              </span>
            </label>
          ))}
        </CardBody></Card>
      )}

      {edition && props.mode === "public" && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("camps.account.title")}</h2>
          <p className="text-xs text-ink-3">{t("camps.account.intro")}</p>
          {(["link", "password", "none"] as const).map((m) => (
            <label key={m} className="flex items-start gap-2 text-sm text-ink-2">
              <input type="radio" name="account" checked={account === m} onChange={() => setAccount(m)} className="mt-1 h-4 w-4 accent-[var(--red-primary)]" />
              <span>{t(`camps.account.${m}`)}</span>
            </label>
          ))}
          {account === "password" && (
            <div className="max-w-sm"><Label htmlFor="acc-pw">{t("camps.account.password")}</Label><Input id="acc-pw" type="password" autoComplete="new-password" minLength={10} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="mt-1 text-xs text-ink-3">{t("camps.account.passwordHint")}</p></div>
          )}
        </CardBody></Card>
      )}

      {edition && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("registration.review.cost")}</h2>
          <div className="max-w-sm"><Label htmlFor="promo">{t("camps.register.promo")}</Label><Input id="promo" className="font-mono uppercase" maxLength={40} value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} /></div>
          {quote?.promo === "applied" && <p className="text-xs text-success">{t("camps.register.promoApplied")}</p>}
          {quote?.promo === "rejected" && <p className="text-xs text-danger">{quote.promoMessage}</p>}
          {quote && quote.ok && quote.items.length > 0 && (
            <div className="space-y-1 rounded-md bg-surface-elevated/50 p-4">
              <Row label={t("common.subtotal")} value={money(quote.listTotal)} />
              {quote.discountTotal > 0 && <Row label={t("camps.register.discounts")} value={`– ${money(quote.discountTotal)}`} tone="success" />}
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-base font-semibold"><span>{t("common.total")}</span><span className="tnum">{money(quote.total)}</span></div>
            </div>
          )}
          {quote && !quote.ok && quote.error && <p className="text-sm text-danger">{quote.error}</p>}
          <p className="flex items-center gap-2 text-xs text-ink-3"><ShieldCheck className="h-4 w-4 shrink-0 text-success" />{t("camps.register.privacy")}</p>
          {error && <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
          <Button onClick={submit} disabled={submitting || !edition.open}>{submitting ? t("registration.submitting") : t("camps.register.submit")}</Button>
        </CardBody></Card>
      )}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={tone === "success" ? "text-success" : "text-ink-2"}>{label}</span>
      <span className={`tnum ${tone === "success" ? "text-success" : "text-ink"}`}>{value}</span>
    </div>
  );
}
