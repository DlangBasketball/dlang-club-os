"use client";
import * as React from "react";
import Link from "next/link";
import { Check, ChevronLeft, CreditCard, MapPin, Package, Users } from "lucide-react";
import { Badge, Button, Card, CardBody, FieldHint, Input, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { guestCheckout } from "@/lib/actions/training";
import { useFormat, useT } from "@/lib/i18n/client";
import { packageSavings, perSessionPrice, sortPackages } from "@/lib/training/pricing";
import type { Slot } from "@/lib/training/slots";
import type { PublicCatalog, TrainingService } from "@/lib/training/data";
import { ANY_COACH, SlotPicker, slotsFor, venueLine } from "./slot-picker";

/**
 * Public booking for non-members: browse services, packages, coaches and
 * real availability without an account; at checkout the parent creates an
 * account (password or magic link) and the child profile for this club.
 * Existing members are sent to the parent app.
 */
export function PublicBookingFlow({ catalog }: { catalog: PublicCatalog }) {
  const t = useT();
  const f = useFormat();
  const [step, setStep] = React.useState(0);
  const [service, setService] = React.useState<TrainingService | null>(null);
  const [packageId, setPackageId] = React.useState<string | null>(null);
  const [coachId, setCoachId] = React.useState(ANY_COACH);
  const [slot, setSlot] = React.useState<Slot | null>(null);
  const [form, setForm] = React.useState({ name: "", email: "", phone: "", password: "", authMode: "password" as "password" | "magic_link", first: "", last: "", dob: "", guardian: false });
  const [consents, setConsents] = React.useState<string[]>([]);
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState<{ signedIn: boolean; authMode: string } | null>(null);
  const now = React.useMemo(() => new Date(), []);
  const currency = service?.currency ?? catalog.org.currency;
  const slots = React.useMemo(() => service ? slotsFor({
    service, coachId, availability: catalog.availability, busy: catalog.busy, venues: catalog.venues, settings: catalog.settings, timeZone: catalog.org.timezone, now,
  }) : [], [service, coachId, catalog, now]);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((s) => ({ ...s, [k]: v }));
  const requiredMissing = catalog.consents.filter((c) => c.required && !consents.includes(c.key));
  const pkg = service?.packages.find((p) => p.id === packageId) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !slot) return;
    setPending(true); setErr(null);
    const res = await guestCheckout({
      clubSlug: catalog.org.slug, serviceId: service.id, coachId: slot.coachId, start: slot.start,
      payWith: packageId ? "package" : "invoice", packageId, authMode: form.authMode,
      parent: { name: form.name, email: form.email, phone: form.phone, password: form.password },
      child: { firstName: form.first, lastName: form.last, dob: form.dob },
      consents, guardianConfirmed: form.guardian as true,
    });
    setPending(false);
    if (!res.ok) { setErr(res.error); return; }
    setDone({ signedIn: res.data.signedIn, authMode: res.data.authMode });
  }

  if (done) {
    return (
      <Card><CardBody className="space-y-3 py-6">
        <div className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 text-success" />
          <div>
            <p className="font-medium text-ink">{t("training.public.doneTitle")}</p>
            {slot && <p className="text-sm text-ink-3">{service?.name} · {f.date(slot.start, { weekday: true })} · {f.time(slot.start)}</p>}
            <p className="mt-2 text-sm text-ink-2">{done.signedIn ? t("training.public.doneSignedIn") : done.authMode === "magic_link" ? t("training.public.doneMagicLink") : t("training.public.doneConfirmEmail")}</p>
            <p className="mt-1 text-sm text-ink-3">{t("training.public.donePayment")}</p>
          </div>
        </div>
        {done.signedIn && <Link href="/parent/bookings"><Button size="sm">{t("training.public.openApp")}</Button></Link>}
      </CardBody></Card>
    );
  }

  return (
    <div className="space-y-5">
      {step > 0 && <button type="button" onClick={() => { setErr(null); setStep((s) => s - 1); }} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("common.back")}</button>}

      {step === 0 && (
        <div className="space-y-2">
          {catalog.services.length === 0 && <p className="text-sm text-ink-3">{t("training.book.noServices")}</p>}
          {catalog.services.map((s) => {
            const v = catalog.venues.find((x) => x.id === s.venueId);
            return (
              <button key={s.id} type="button" onClick={() => { setService(s); setPackageId(null); setSlot(null); setStep(1); }}
                className="block w-full rounded-xl border border-line p-4 text-left transition hover:border-maroon/40 active:scale-[0.99]"
                style={s.color ? { borderLeftColor: s.color, borderLeftWidth: 4 } : undefined}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-ink">{s.name}</div>
                  <span className="tnum text-sm text-ink-2">{s.sessionType === "group" ? t("training.common.perPerson", { price: f.money(s.price, s.currency ?? undefined) }) : t("training.common.from", { price: f.money(Math.min(s.price, ...s.packages.map((p) => perSessionPrice(p, s.currency ?? catalog.org.currency))), s.currency ?? undefined) })}</span>
                </div>
                {s.description && <p className="mt-1 text-sm text-ink-3">{s.description}</p>}
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-3">
                  <Badge tone="neutral">{t("training.common.minutes", { count: s.durationMin })}</Badge>
                  {s.sessionType === "group" ? <Badge tone="accent"><Users className="h-3 w-3" /> {t("training.common.groupRange", { min: s.minParticipants, max: s.maxParticipants })}</Badge> : <Badge tone="neutral">{t("training.common.individual")}</Badge>}
                  {(s.locationText || v) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.locationText || venueLine(v)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {step === 1 && service && (
        <div className="space-y-2">
          <p className="text-sm text-ink-2">{t("training.public.howMany")}</p>
          <button type="button" onClick={() => { setPackageId(null); setStep(2); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line p-4 text-left hover:border-maroon/40">
            <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-maroon" /><div className="text-sm font-medium text-ink">{t("training.packages.defaultName", { count: 1 })}</div></div>
            <div className="tnum text-sm font-medium text-ink">{f.money(service.price, currency)}</div>
          </button>
          {sortPackages(service.packages).map((p) => {
            const save = packageSavings(p, service.price, currency);
            return (
              <button key={p.id} type="button" onClick={() => { setPackageId(p.id); setStep(2); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line p-4 text-left hover:border-maroon/40">
                <div className="flex items-center gap-3"><Package className="h-5 w-5 text-maroon" />
                  <div><div className="text-sm font-medium text-ink">{p.name || t("training.packages.defaultName", { count: p.sessions })}</div>
                    <div className="text-xs text-ink-3">{t("training.common.perSession", { price: f.money(perSessionPrice(p, currency), currency) })}{p.validityDays ? ` · ${t("training.common.validDays", { count: p.validityDays })}` : ""}</div></div></div>
                <div className="text-right"><div className="tnum text-sm font-medium text-ink">{f.money(p.price, currency)}</div>
                  {save.percent > 0 && <div className="text-[11px] text-success">{t("training.common.save", { percent: save.percent })}</div>}</div>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && service && (
        <div className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="pb-coach">{t("training.public.pickCoach")}</Label>
            <Select id="pb-coach" value={coachId} onChange={(e) => { setCoachId(e.target.value); setSlot(null); }}>
              <option value={ANY_COACH}>{t("training.book.anyCoach")}</option>
              {catalog.coaches.filter((c) => service.coachIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}{c.title ? ` · ${c.title}` : ""}</option>)}
            </Select>
          </div>
          <p className="text-sm text-ink-2">{t("training.public.pickTime")}</p>
          <SlotPicker service={service} slots={slots} coaches={catalog.coaches} venues={catalog.venues} selected={slot} onSelect={(s) => { setSlot(s); setStep(3); }} />
          {packageId && <p className="text-xs text-ink-4">{t("training.public.restLater")}</p>}
        </div>
      )}

      {step === 3 && service && slot && (
        <form onSubmit={submit} className="space-y-5">
          <Card><CardBody className="space-y-1 text-sm">
            <div className="flex justify-between gap-3"><span className="text-ink-3">{t("training.book.stepService")}</span><span className="text-right text-ink">{service.name}</span></div>
            <div className="flex justify-between gap-3"><span className="text-ink-3">{t("training.book.when")}</span><span className="text-right text-ink">{f.date(slot.start, { weekday: true })} · {f.time(slot.start)} – {f.time(slot.end)}</span></div>
            <div className="flex justify-between gap-3"><span className="text-ink-3">{t("training.book.coach")}</span><span className="text-right text-ink">{catalog.coaches.find((c) => c.id === slot.coachId)?.name}</span></div>
            <div className="flex justify-between gap-3"><span className="text-ink-3">{t("training.book.location")}</span><span className="text-right text-ink">{service.locationText || venueLine(catalog.venues.find((v) => v.id === slot.venueId)) || "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-ink-3">{t("training.public.total")}</span><span className="tnum text-right font-medium text-ink">{f.money(pkg ? pkg.price : service.price, currency)}</span></div>
          </CardBody></Card>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-ink-2">{t("training.public.parentTitle")}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label htmlFor="pb-name">{t("training.public.parentName")}</Label><Input id="pb-name" required autoComplete="name" maxLength={120} value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div><Label htmlFor="pb-phone">{t("training.public.phone")}</Label><Input id="pb-phone" autoComplete="tel" maxLength={40} value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
              <div><Label htmlFor="pb-email">{t("training.public.email")}</Label><Input id="pb-email" type="email" required autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div>
                <Label htmlFor="pb-auth">{t("training.public.signIn")}</Label>
                <Select id="pb-auth" value={form.authMode} onChange={(e) => set("authMode", e.target.value as typeof form.authMode)}>
                  <option value="password">{t("training.public.withPassword")}</option>
                  <option value="magic_link">{t("training.public.withMagicLink")}</option>
                </Select>
              </div>
              {form.authMode === "password" && <div><Label htmlFor="pb-pw">{t("training.public.password")}</Label><Input id="pb-pw" type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} /><FieldHint>{t("training.public.passwordHint")}</FieldHint></div>}
            </div>
            <p className="text-xs text-ink-4">{t("training.public.memberHint")} <Link href="/login?redirect=/parent/bookings/new" className="text-maroon underline">{t("training.public.login")}</Link></p>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-ink-2">{t("training.public.childTitle")}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div><Label htmlFor="pb-first">{t("training.public.firstName")}</Label><Input id="pb-first" required maxLength={80} value={form.first} onChange={(e) => set("first", e.target.value)} /></div>
              <div><Label htmlFor="pb-last">{t("training.public.lastName")}</Label><Input id="pb-last" required maxLength={80} value={form.last} onChange={(e) => set("last", e.target.value)} /></div>
              <div><Label htmlFor="pb-dob">{t("training.public.dob")}</Label><Input id="pb-dob" type="date" required value={form.dob} onChange={(e) => set("dob", e.target.value)} /></div>
            </div>
            <p className="text-xs text-ink-4">{t("training.public.minimumData")}</p>
            {catalog.requiresVpc && <p className="text-xs text-warning">{t("training.public.vpcNotice")}</p>}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-ink-2">{t("training.public.consentTitle")}</legend>
            <label className="flex items-start gap-2 text-sm text-ink-2"><input type="checkbox" required checked={form.guardian} onChange={(e) => set("guardian", e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" /> {t("training.public.guardianConfirm")}</label>
            {catalog.consents.map((c) => (
              <label key={c.key} className="flex items-start gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={consents.includes(c.key)} onChange={(e) => setConsents((cs) => e.target.checked ? [...cs, c.key] : cs.filter((x) => x !== c.key))} className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" />
                <span>{c.title} <span className="text-xs text-ink-4">v{c.version}{c.required ? ` · ${t("training.public.required")}` : ""}</span></span>
              </label>
            ))}
          </fieldset>

          <p className="text-xs text-ink-4">{t("training.public.paymentHint")} {t("training.book.cancellationRule", { hours: catalog.settings.cancellationHours })}</p>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button type="submit" disabled={pending || !form.guardian || requiredMissing.length > 0} className="w-full sm:w-auto">{pending ? t("training.book.booking") : t("training.public.submit")}</Button>
          {requiredMissing.length > 0 && <p className="text-xs text-ink-4">{t("training.public.consentMissing")}</p>}
        </form>
      )}
    </div>
  );
}
