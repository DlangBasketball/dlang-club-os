"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, MapPin, Plus, ShieldCheck, ShoppingBasket, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, Input, Label, Select } from "@/components/ui";
import type { PublicCamp } from "@/lib/camps/data";
import {
  autoAgeGroup, copyLineToChild, dayCountsFor, removeLine, updateLine, upsertChild, type BasketLine, type BasketLunch,
} from "@/lib/camps/basket";
import { ageFits, ageOn, editionDays, rowsForEdition } from "@/lib/camps/logic";
import {
  checkoutCampBasketAdmin, checkoutCampBasketParent, checkoutCampBasketPublic, quoteCampBasket,
  type BasketQuoteView, type BasketSubmitResult,
} from "@/lib/actions/camp-basket";
import type { PlanSettings } from "@/lib/payments/plans";
import { InstalmentChooser } from "@/components/plans/instalment-chooser";
import { useFormat, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translator";
import { BasketAdder, type BasketKid } from "./basket-adder";
import { useCampBasket } from "./use-camp-basket";

type Parent = { name: string; email: string; phone: string; address: string; emergencyName: string; emergencyPhone: string };
type PlanRules = { settings: PlanSettings; today: string } | null;

const consentCopy = (t: Translator, key: string) => t.dynamic(`registration.consents.${key}`, undefined, t("registration.consents.default"));

/**
 * The camp basket: every child-week chosen so far (from any camp / season),
 * editable inline, priced live by the server (sibling, multi-week, promo,
 * early-bird with the shared stacking rules), then ONE checkout: one invoice,
 * one registration per child-week, optional instalments.
 */
export function CampBasket(props: {
  mode: "public" | "parent" | "admin";
  scope: string;
  camps: PublicCamp[];
  kids?: BasketKid[];
  /** public: a camp slug of the club (org resolution on the platform host). */
  slug?: string | null;
  /** admin: the family the booking is for. */
  familyId?: string;
  consents: PublicCamp["consents"];
  planRules?: PlanRules;
  currency: string;
  browseHref?: string;
}) {
  const router = useRouter();
  const api = useCampBasket(props.scope);
  const { basket, ready, update, clear } = api;
  const t = useT();
  const f = useFormat();
  const kids = React.useMemo(() => props.kids ?? [], [props.kids]);
  const campsById = React.useMemo(() => new Map(props.camps.map((c) => [c.program.id, c])), [props.camps]);

  const [quote, setQuote] = React.useState<BasketQuoteView | null>(null);
  const [lineErrors, setLineErrors] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ invoiceId: string; invoiceNumber: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [instalments, setInstalments] = React.useState(0);
  const [parent, setParent] = React.useState<Parent>({ name: "", email: "", phone: "", address: "", emergencyName: "", emergencyPhone: "" });
  const [account, setAccount] = React.useState<"none" | "password" | "link">("link");
  const [password, setPassword] = React.useState("");
  const [adderFor, setAdderFor] = React.useState<string | null | undefined>(undefined);
  const adderRef = React.useRef<HTMLDivElement>(null);

  const ctx = React.useMemo(() => ({ mode: props.mode, slug: props.slug ?? null, familyId: props.familyId ?? null }), [props.mode, props.slug, props.familyId]);
  const usedRefs = new Set(basket.lines.map((l) => l.childRef));
  const children = basket.children.filter((c) => usedRefs.has(c.ref));
  const money = (n: number) => f.money(n, quote?.currency || props.currency);

  const input = () => ({
    children: children.map((c) => ({ ...c, athleteId: c.athleteId ?? null })),
    lines: basket.lines,
    promoCode: basket.promo,
  });

  // Live, server-computed price (the same function prices the invoice).
  const quoteKey = JSON.stringify({ c: children.map((c) => [c.ref, c.athleteId, c.dob]), l: basket.lines, p: basket.promo });
  React.useEffect(() => {
    if (!ready || !basket.lines.length) { setQuote(null); return; }
    const h = setTimeout(async () => setQuote(await quoteCampBasket(ctx, input())), 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, ready, ctx]);

  const childName = (ref: string) => {
    const c = basket.children.find((x) => x.ref === ref);
    if (!c) return "";
    if (c.athleteId) return kids.find((k) => k.id === c.athleteId)?.name ?? c.firstName;
    return `${c.firstName} ${c.lastName}`.trim();
  };
  const childDob = (ref: string) => {
    const c = basket.children.find((x) => x.ref === ref);
    if (!c) return null;
    if (c.athleteId) return kids.find((k) => k.id === c.athleteId)?.dob ?? c.dob ?? null;
    return c.dob || null;
  };

  function setChoice(l: BasketLine, patch: Partial<BasketLine>) {
    const camp = campsById.get(l.programId);
    const ed = camp?.editions.find((e) => e.id === l.editionId);
    update((b) => {
      const next = { ...patch };
      if (patch.daysCount !== undefined && ed && camp) {
        const all = editionDays(ed.startsOn, ed.endsOn);
        next.days = patch.daysCount && patch.daysCount >= all.length ? all : [];
        const lunches = rowsForEdition(camp.options, ed.id).filter((o) => o.daysCount === patch.daysCount);
        next.lunch = lunches.length === 1 ? (lunches[0].includesLunch ? "yes" : "no") : "";
      }
      return updateLine(b, l.key, next);
    });
  }

  function toggleDay(l: BasketLine, day: string, max: number) {
    const has = l.days.includes(day);
    const days = has ? l.days.filter((d) => d !== day) : l.days.length < max ? [...l.days, day].sort() : l.days;
    update((b) => updateLine(b, l.key, { days }));
  }

  /** "Copy to sibling": same week + choices, age group re-picked for that child. */
  function copyTo(l: BasketLine, target: string) {
    update((b) => {
      let next = b;
      let ref = target;
      if (props.mode !== "public") {
        const kid = kids.find((k) => k.id === target);
        if (!kid) return b;
        const r = upsertChild(next, { athleteId: kid.id, firstName: kid.name, lastName: "", dob: kid.dob ?? "" });
        if (!r.ref) return b;
        next = r.basket; ref = r.ref;
      }
      const before = next.lines.length;
      next = copyLineToChild(next, l.key, ref);
      if (next.lines.length === before) return b;
      const added = next.lines[next.lines.length - 1];
      const camp = campsById.get(l.programId);
      const ed = camp?.editions.find((e) => e.id === l.editionId);
      const dob = props.mode === "public" ? next.children.find((c) => c.ref === ref)?.dob : kids.find((k) => k.id === target)?.dob;
      return camp && ed ? updateLine(next, added.key, { ageGroupId: autoAgeGroup(camp, ed.startsOn, dob ?? null) }) : next;
    });
  }

  function openAdder(ref: string | null) {
    setAdderFor(ref);
    setTimeout(() => adderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function validate(): string | null {
    if (!basket.lines.length) return t("camps.basket.errors.empty");
    for (const l of basket.lines) {
      const camp = campsById.get(l.programId);
      const ed = camp?.editions.find((e) => e.id === l.editionId);
      if (!camp || !ed) return t("camps.basket.errors.fixLines");
      if (!l.ageGroupId) return t("camps.register.pickAgeGroup");
      if (!l.daysCount || !l.lunch && rowsForEdition(camp.options, ed.id).filter((o) => o.daysCount === l.daysCount).length > 1) return t("camps.register.pickOption");
      if (l.days.length !== l.daysCount) return t("camps.register.pickDays", { count: l.daysCount });
    }
    if (props.consents.some((c) => c.required && !accepted.has(c.key))) return t("registration.consents.missing");
    if (props.mode === "public") {
      if (children.some((c) => !c.firstName.trim() || !c.lastName.trim() || !c.dob)) return t("camps.basket.errors.childDetails");
      if (account === "password" && password.length < 10) return t("camps.errors.password");
    }
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) { setError(v); return; }
    setSubmitting(true); setError(null); setLineErrors({});
    const consents = Array.from(accepted);
    let res: BasketSubmitResult | undefined;
    if (props.mode === "parent") res = await checkoutCampBasketParent(input(), consents, instalments);
    else if (props.mode === "admin") res = await checkoutCampBasketAdmin(props.familyId ?? "", input(), consents, instalments);
    else res = await checkoutCampBasketPublic(props.slug ?? null, input(), parent, consents, account === "password" ? { mode: "password", password } : { mode: account }, instalments);
    if (res?.ok) {
      clear();
      if (res.redirectTo) { router.push(res.redirectTo); return; }
      setDone({ invoiceId: res.invoiceId, invoiceNumber: res.invoiceNumber });
      setSubmitting(false);
      return;
    }
    if (!res) { setSubmitting(false); setError(t("camps.errors.generic")); return; }
    setSubmitting(false);
    setError(res.error);
    setLineErrors(res.lineErrors ?? {});
  }

  const setP = (k: keyof Parent) => (e: React.ChangeEvent<HTMLInputElement>) => setParent((s) => ({ ...s, [k]: e.target.value }));
  const setChild = (ref: string, k: "firstName" | "lastName" | "dob" | "gender" | "allergies" | "conditions" | "medicalNotes") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      update((b) => ({ ...b, children: b.children.map((c) => (c.ref === ref ? { ...c, [k]: e.target.value } : c)) }));

  if (done) {
    return (
      <Card><CardBody className="space-y-3">
        <p role="status" className="text-sm text-success">{t("camps.basket.adminDone", { invoice: done.invoiceNumber })}</p>
        {done.invoiceId && <Link href={`/admin/invoices/${done.invoiceId}`}><Button variant="secondary">{t("camps.basket.openInvoice")}</Button></Link>}
      </CardBody></Card>
    );
  }

  const refsInOrder: string[] = [];
  for (const l of basket.lines) if (!refsInOrder.includes(l.childRef)) refsInOrder.push(l.childRef);
  const siblingTargets = (ref: string): { id: string; name: string }[] => props.mode === "public"
    ? basket.children.filter((c) => c.ref !== ref).map((c) => ({ id: c.ref, name: `${c.firstName} ${c.lastName}`.trim() }))
    : kids.filter((k) => k.id !== basket.children.find((c) => c.ref === ref)?.athleteId).map((k) => ({ id: k.id, name: k.name }));

  return (
    <div className="space-y-6">
      {!ready ? <p className="text-sm text-ink-3">{t("common.loading")}</p> : basket.lines.length === 0 ? (
        <Card><CardBody className="space-y-2 text-center">
          <ShoppingBasket className="mx-auto h-6 w-6 text-ink-3" />
          <p className="text-sm text-ink-2">{t("camps.basket.empty")}</p>
          {props.browseHref && <Link href={props.browseHref} className="text-sm text-maroon hover:underline">{t("camps.basket.browse")}</Link>}
        </CardBody></Card>
      ) : refsInOrder.map((ref) => {
        const dob = childDob(ref);
        const child = basket.children.find((c) => c.ref === ref);
        return (
          <section key={ref} className="space-y-3" aria-label={childName(ref)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-ink">{childName(ref) || t("camps.basket.child")}</h2>
              <Button size="sm" variant="secondary" onClick={() => openAdder(ref)}><Plus className="h-4 w-4" /> {t("camps.basket.addSameChild")}</Button>
            </div>
            {props.mode === "public" && child && (
              <details className="rounded-md border border-line p-3 text-sm">
                <summary className="cursor-pointer text-ink-2">{t("camps.basket.childDetails")}</summary>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><Label htmlFor={`bc-fn-${ref}`}>{t("registration.child.firstName")}</Label><Input id={`bc-fn-${ref}`} maxLength={80} value={child.firstName} onChange={setChild(ref, "firstName")} /></div>
                  <div><Label htmlFor={`bc-ln-${ref}`}>{t("registration.child.lastName")}</Label><Input id={`bc-ln-${ref}`} maxLength={80} value={child.lastName} onChange={setChild(ref, "lastName")} /></div>
                  <div><Label htmlFor={`bc-dob-${ref}`}>{t("registration.child.dob")}</Label><Input id={`bc-dob-${ref}`} type="date" value={child.dob} onChange={setChild(ref, "dob")} /></div>
                  <div><Label htmlFor={`bc-g-${ref}`}>{t("registration.child.gender")}</Label>
                    <Select id={`bc-g-${ref}`} value={child.gender ?? ""} onChange={setChild(ref, "gender")}>
                      <option value="">{t("common.select")}</option><option value="Male">{t("registration.child.genderMale")}</option><option value="Female">{t("registration.child.genderFemale")}</option><option value="Other">{t("registration.child.genderOther")}</option>
                    </Select>
                  </div>
                  <div><Label htmlFor={`bc-al-${ref}`}>{t("registration.child.allergies")}</Label><Input id={`bc-al-${ref}`} maxLength={1000} value={child.allergies ?? ""} placeholder={t("registration.child.allergiesPlaceholder")} onChange={setChild(ref, "allergies")} /></div>
                  <div><Label htmlFor={`bc-co-${ref}`}>{t("registration.child.conditions")}</Label><Input id={`bc-co-${ref}`} maxLength={1000} value={child.conditions ?? ""} placeholder={t("registration.child.conditionsPlaceholder")} onChange={setChild(ref, "conditions")} /></div>
                </div>
                <p className="mt-2 text-xs text-ink-3">{t("camps.basket.healthNotStored")}</p>
              </details>
            )}
            {basket.lines.filter((l) => l.childRef === ref).map((l) => {
              const camp = campsById.get(l.programId);
              const ed = camp?.editions.find((e) => e.id === l.editionId);
              const item = quote?.lines.find((x) => x.key === l.key);
              const lineError = lineErrors[l.key] ?? quote?.lineErrors[l.key];
              if (!camp || !ed) {
                return (
                  <Card key={l.key}><CardBody className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-danger">{t("camps.basket.unavailable")}</span>
                    <Button size="sm" variant="ghost" onClick={() => update((b) => removeLine(b, l.key))}><Trash2 className="h-4 w-4" /> {t("common.remove")}</Button>
                  </CardBody></Card>
                );
              }
              const all = editionDays(ed.startsOn, ed.endsOn);
              const counts = dayCountsFor(camp, ed.id);
              const lunchOpts = rowsForEdition(camp.options, ed.id).filter((o) => o.daysCount === l.daysCount);
              const age = dob ? ageOn(dob, ed.startsOn) : null;
              const place = ed.venue ? [ed.venue.name, ed.venue.city ?? ed.city].filter(Boolean).join(", ") : [ed.locationName, ed.city].filter(Boolean).join(", ");
              const targets = siblingTargets(ref);
              return (
                <Card key={l.key} className={lineError ? "border-danger/50" : undefined}>
                  <CardBody className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{camp.program.name}</div>
                        <div className="flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
                          <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{f.dateRange(ed.startsOn, ed.endsOn)}</span>
                          {place && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{place}</span>}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {targets.length > 0 && (
                          <Select aria-label={t("camps.basket.copyToSibling")} className="h-8 w-auto text-xs" value=""
                            onChange={(e) => { if (e.target.value) copyTo(l, e.target.value); }}>
                            <option value="">{t("camps.basket.copyToSibling")}</option>
                            {targets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </Select>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => update((b) => removeLine(b, l.key))} aria-label={t("common.remove")}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div><Label htmlFor={`bl-ag-${l.key}`}>{t("camps.register.ageGroup")}</Label>
                        <Select id={`bl-ag-${l.key}`} value={l.ageGroupId} onChange={(e) => setChoice(l, { ageGroupId: e.target.value })}>
                          <option value="">{t("common.select")}</option>
                          {camp.ageGroups.filter((g) => g.isActive).map((g) => (
                            <option key={g.id} value={g.id} disabled={age !== null && !ageFits(age, g.minAge, g.maxAge)}>{g.label}</option>
                          ))}
                        </Select>
                        {age !== null && <p className="mt-1 text-xs text-ink-3">{t("common.ageYears", { age })}</p>}
                      </div>
                      <div><Label htmlFor={`bl-dc-${l.key}`}>{t("camps.register.daysCount")}</Label>
                        <Select id={`bl-dc-${l.key}`} value={l.daysCount ?? ""} onChange={(e) => setChoice(l, { daysCount: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">{t("common.select")}</option>
                          {counts.map((n) => <option key={n} value={n}>{t("camps.register.daysOption", { count: n })}</option>)}
                        </Select>
                      </div>
                      <div><Label htmlFor={`bl-lu-${l.key}`}>{t("camps.register.lunch")}</Label>
                        <Select id={`bl-lu-${l.key}`} value={l.lunch} disabled={!l.daysCount} onChange={(e) => setChoice(l, { lunch: e.target.value as BasketLunch })}>
                          <option value="">{t("common.select")}</option>
                          {lunchOpts.some((o) => o.includesLunch) && <option value="yes">{t("camps.register.withLunch", { price: f.money(lunchOpts.find((o) => o.includesLunch)!.price, camp.program.currency) })}</option>}
                          {lunchOpts.some((o) => !o.includesLunch) && <option value="no">{t("camps.register.withoutLunch", { price: f.money(lunchOpts.find((o) => !o.includesLunch)!.price, camp.program.currency) })}</option>}
                        </Select>
                      </div>
                    </div>
                    {l.daysCount ? (
                      <div>
                        <div className="mb-1 text-xs text-ink-3">{l.daysCount >= all.length ? t("camps.register.allDays") : t("camps.register.chooseDays", { count: l.daysCount, chosen: l.days.length })}</div>
                        <div className="flex flex-wrap gap-2">
                          {all.map((d) => {
                            const on = l.days.includes(d);
                            return (
                              <button key={d} type="button" onClick={() => toggleDay(l, d, l.daysCount ?? 0)} aria-pressed={on}
                                className={`rounded border px-3 py-1.5 text-xs ${on ? "border-maroon bg-maroon/15 text-ink" : "border-line text-ink-3 hover:border-maroon/40"}`}>
                                {f.date(d, { weekday: true, style: "short" })}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                    {item && (
                      <div className="space-y-0.5 border-t border-line-soft pt-2 text-sm">
                        <Row label={t("camps.basket.weekPrice")} value={money(item.listAmount)} />
                        {item.discounts.map((d, i) => <Row key={i} label={d.name} value={`– ${money(d.amount)}`} tone="success" />)}
                        {item.discounts.length > 0 && <Row label={t("common.total")} value={money(item.total)} />}
                      </div>
                    )}
                    {lineError && <p role="alert" className="text-sm text-danger">{lineError}</p>}
                  </CardBody>
                </Card>
              );
            })}
          </section>
        );
      })}

      <div ref={adderRef}>
        {adderFor !== undefined || basket.lines.length === 0 ? (
          <BasketAdder mode={props.mode} scope={props.scope} camps={props.camps} kids={kids} api={api}
            presetChildRef={adderFor ?? null} onAdded={() => setAdderFor(undefined)} />
        ) : (
          <Button variant="secondary" onClick={() => openAdder(null)}><Plus className="h-4 w-4" /> {t("camps.basket.addWeeks")}</Button>
        )}
      </div>

      {basket.lines.length > 0 && props.mode === "public" && (
        <Card><CardBody className="space-y-4">
          <h2 className="text-lg font-semibold">{t("registration.parent.title")}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><Label htmlFor="bp-name">{t("registration.parent.fullName")}</Label><Input id="bp-name" autoComplete="name" value={parent.name} onChange={setP("name")} /></div>
            <div><Label htmlFor="bp-email">{t("registration.parent.email")}</Label><Input id="bp-email" type="email" autoComplete="email" value={parent.email} onChange={setP("email")} /></div>
            <div><Label htmlFor="bp-phone">{t("registration.parent.phone")}</Label><Input id="bp-phone" autoComplete="tel" value={parent.phone} onChange={setP("phone")} /></div>
            <div><Label htmlFor="bp-addr">{t("registration.parent.address")}</Label><Input id="bp-addr" autoComplete="street-address" value={parent.address} onChange={setP("address")} /></div>
            <div><Label htmlFor="bp-en">{t("registration.parent.emergencyName")}</Label><Input id="bp-en" value={parent.emergencyName} onChange={setP("emergencyName")} /></div>
            <div><Label htmlFor="bp-ep">{t("registration.parent.emergencyPhone")}</Label><Input id="bp-ep" value={parent.emergencyPhone} onChange={setP("emergencyPhone")} /></div>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">{t("camps.account.title")}</h3>
            <p className="text-xs text-ink-3">{t("camps.account.intro")}</p>
            {(["link", "password", "none"] as const).map((m) => (
              <label key={m} className="flex items-start gap-2 text-sm text-ink-2">
                <input type="radio" name="basket-account" checked={account === m} onChange={() => setAccount(m)} className="mt-1 h-4 w-4 accent-[var(--red-primary)]" />
                <span>{t(`camps.account.${m}`)}</span>
              </label>
            ))}
            {account === "password" && (
              <div className="max-w-sm"><Label htmlFor="bp-pw">{t("camps.account.password")}</Label><Input id="bp-pw" type="password" autoComplete="new-password" minLength={10} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="mt-1 text-xs text-ink-3">{t("camps.account.passwordHint")}</p></div>
            )}
          </div>
        </CardBody></Card>
      )}

      {basket.lines.length > 0 && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("registration.consents.title")}</h2>
          {props.consents.length === 0 && <p className="text-sm text-ink-3">{t("camps.register.noConsents")}</p>}
          {props.consents.map((c) => (
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

      {basket.lines.length > 0 && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("camps.basket.summary")}</h2>
          <div className="max-w-sm"><Label htmlFor="basket-promo">{t("camps.register.promo")}</Label>
            <Input id="basket-promo" className="font-mono uppercase" maxLength={40} value={basket.promo}
              onChange={(e) => { const v = e.target.value.toUpperCase(); update((b) => ({ ...b, promo: v })); }} /></div>
          {quote?.promo === "applied" && <p className="text-xs text-success">{t("camps.register.promoApplied")}</p>}
          {quote?.promo === "rejected" && <p className="text-xs text-danger">{quote.promoMessage}</p>}
          {quote && quote.ok && quote.lines.length > 0 && (
            <div className="space-y-1 rounded-md bg-surface-elevated/50 p-4">
              <Row label={t("camps.basket.weeksCount", { count: quote.lines.length })} value={money(quote.listTotal)} />
              {quote.discountTotal > 0 && <Row label={t("camps.register.discounts")} value={`– ${money(quote.discountTotal)}`} tone="success" />}
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-base font-semibold"><span>{t("common.total")}</span><span className="tnum">{money(quote.total)}</span></div>
            </div>
          )}
          {quote && !quote.ok && quote.error && <p className="text-sm text-danger">{quote.error}</p>}
          {quote && quote.ok && quote.total > 0 && (
            <InstalmentChooser rules={props.planRules} productType="camp" total={quote.total} currency={quote.currency || props.currency}
              activityStart={quote.firstStart} value={instalments} onChange={setInstalments} idPrefix="basket-inst" />
          )}
          <p className="flex items-center gap-2 text-xs text-ink-3"><ShieldCheck className="h-4 w-4 shrink-0 text-success" />{t("camps.register.privacy")}</p>
          {error && <div role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
          <div className="flex flex-wrap gap-3">
            <Button onClick={submit} disabled={submitting}>{submitting ? t("registration.submitting") : t("camps.basket.checkout", { count: basket.lines.length })}</Button>
            <Button variant="ghost" disabled={submitting} onClick={() => { if (window.confirm(t("camps.basket.confirmClear"))) clear(); }}>{t("camps.basket.clear")}</Button>
          </div>
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
