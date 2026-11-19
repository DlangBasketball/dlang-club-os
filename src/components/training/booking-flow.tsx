"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Coins, CreditCard, MapPin, Package, Users } from "lucide-react";
import { Avatar, Badge, Button, Card, CardBody, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { bookTrainingSession } from "@/lib/actions/training";
import { useFormat, useT } from "@/lib/i18n/client";
import { packageSavings, perSessionPrice, pickLot, remainingSessions, sortPackages } from "@/lib/training/pricing";
import type { Slot } from "@/lib/training/slots";
import type { TrainingService, TrainingWizardData } from "@/lib/training/data";
import { ANY_COACH, SlotPicker, slotsFor, venueLine } from "./slot-picker";
import { TrainingPromo } from "./promo-preview";

type Pay = { kind: "credits"; purchaseId: string | null } | { kind: "package"; packageId: string } | { kind: "invoice" };

/**
 * Book a training: athlete -> service -> credits / package / single session
 * -> coach (or any coach) -> time from real availability -> confirm.
 * Parents book for their own children; admins for any athlete (mode="admin"),
 * may sell the package as paid / free and may book outside availability.
 */
export function TrainingBookingFlow({ data, mode, coachPhotos = {}, initialAthleteId }: {
  data: TrainingWizardData; mode: "parent" | "admin"; coachPhotos?: Record<string, string>; initialAthleteId?: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [step, setStep] = React.useState(data.athletes.length === 1 || initialAthleteId ? 1 : 0);
  const [athleteId, setAthleteId] = React.useState(initialAthleteId ?? data.athletes[0]?.id ?? "");
  const [service, setService] = React.useState<TrainingService | null>(null);
  const [pay, setPay] = React.useState<Pay | null>(null);
  const [coachId, setCoachId] = React.useState<string>(ANY_COACH);
  const [slot, setSlot] = React.useState<Slot | null>(null);
  const [saleMode, setSaleMode] = React.useState<"invoice" | "paid" | "comp">("invoice");
  const [override, setOverride] = React.useState(false);
  const [promo, setPromo] = React.useState("");
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [done, setDone] = React.useState<{ bookingId: string; purchaseId: string | null; invoiceId: string | null; count: number } | null>(null);

  const athlete = data.athletes.find((a) => a.id === athleteId) ?? null;
  const currency = service?.currency ?? f.currency;
  const now = React.useMemo(() => new Date(), []);
  const lots = React.useMemo(() => data.lots.filter((l) => l.athleteId === athleteId && l.serviceId === service?.id), [data.lots, athleteId, service]);
  const credits = remainingSessions(lots, now);
  const legacy = service && service.creditsRequired > 0 ? (data.legacyCredits[athleteId]?.[service.creditCategory] ?? 0) : 0;
  const canLegacy = !!service && service.creditsRequired > 0 && legacy >= service.creditsRequired;

  const slots = React.useMemo(() => service ? slotsFor({
    service, coachId, availability: data.availability, busy: data.busy, venues: data.venues, settings: data.settings, timeZone: f.timeZone, now,
  }) : [], [service, coachId, data, f.timeZone, now]);

  const steps = [t("training.book.stepAthlete"), t("training.book.stepService"), t("training.book.stepPayment"), t("training.book.stepTime"), t("training.book.stepConfirm")];

  async function confirm() {
    if (!athlete || !service || !slot || !pay) return;
    setPending(true); setErr(null);
    const res = await bookTrainingSession({
      athleteId: athlete.id, serviceId: service.id, coachId: slot.coachId, start: slot.start,
      payWith: pay.kind, purchaseId: pay.kind === "credits" ? pay.purchaseId : null, packageId: pay.kind === "package" ? pay.packageId : null,
      mode: mode === "admin" ? saleMode : "invoice", override: mode === "admin" && override,
      promoCode: pay.kind !== "credits" && !(mode === "admin" && saleMode === "comp") ? promo : "",
    });
    setPending(false);
    if (!res.ok) { setErr(res.error); return; }
    setDone({ bookingId: res.data!.bookingId, purchaseId: res.data!.purchaseId, invoiceId: res.data!.invoiceId, count: (done?.count ?? 0) + 1 });
    router.refresh();
  }

  /** Book another session from the package just bought (or the same lot). */
  function another() {
    if (!done) return;
    setPay(done.purchaseId ? { kind: "credits", purchaseId: done.purchaseId } : pay);
    setSlot(null);
    setStep(3);
    setDone({ ...done, bookingId: "" });
  }

  if (!data.enabled && mode === "parent") return <Card><CardBody className="py-6 text-center text-sm text-ink-3">{t("training.book.closed")}</CardBody></Card>;
  if (!data.athletes.length) return <Card><CardBody className="py-6 text-center text-sm text-ink-3">{mode === "parent" ? t("training.book.noChildren") : t("training.book.noAthletes")}</CardBody></Card>;

  if (done?.bookingId) {
    return (
      <Card><CardBody className="space-y-4 py-6">
        <div className="flex items-start gap-3"><Check className="mt-0.5 h-5 w-5 text-success" />
          <div><p className="font-medium text-ink">{t("training.book.booked")}</p>
            <p className="text-sm text-ink-3">{slot ? `${f.date(slot.start, { weekday: true })} · ${f.time(slot.start)}` : ""}</p>
            {done.invoiceId && <p className="mt-1 text-sm text-ink-3">{t("training.book.invoiceIssued")}</p>}
          </div></div>
        <div className="flex flex-wrap gap-2">
          {done.purchaseId && <Button size="sm" onClick={another}>{t("training.book.bookAnother")}</Button>}
          {done.invoiceId && mode === "parent" && <Link href={`/parent/invoices/${done.invoiceId}`}><Button size="sm" variant="secondary">{t("training.book.payInvoice")}</Button></Link>}
          {done.invoiceId && mode === "admin" && <Link href={`/admin/invoices/${done.invoiceId}`}><Button size="sm" variant="secondary">{t("training.book.viewInvoice")}</Button></Link>}
          <Link href={mode === "parent" ? `/parent/bookings/${done.bookingId}` : `/admin/bookings/${done.bookingId}`}><Button size="sm" variant="ghost">{t("training.book.viewBooking")}</Button></Link>
        </div>
        {done.purchaseId && done.invoiceId && <p className="text-xs text-ink-4">{t("training.book.packagePendingHint")}</p>}
      </CardBody></Card>
    );
  }

  const packages = service ? sortPackages(service.packages) : [];

  return (
    <div className="space-y-5">
      <ol className="flex items-center gap-2" aria-label={t("training.book.progress")}>
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <li className={`flex items-center gap-1.5 text-xs ${i === step ? "text-ink" : i < step ? "text-success" : "text-ink-4"}`} aria-current={i === step ? "step" : undefined}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i === step ? "bg-maroon text-on-brand" : i < step ? "bg-success text-on-brand" : "bg-surface-elevated"}`}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
            </li>
            {i < steps.length - 1 && <li aria-hidden className="h-px flex-1 bg-line" />}
          </React.Fragment>
        ))}
      </ol>

      {step > 0 && <button type="button" onClick={() => { setErr(null); setStep((s) => s - 1); }} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> {t("common.back")}</button>}

      {step === 0 && (
        mode === "admin" ? (
          <div className="max-w-md space-y-3">
            <Label htmlFor="tb-athlete">{t("training.book.athlete")}</Label>
            <Select id="tb-athlete" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              {data.athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Button onClick={() => setStep(1)} disabled={!athleteId}>{t("common.continue")}</Button>
          </div>
        ) : (
          <div className="space-y-2">
            {data.athletes.map((a) => (
              <button key={a.id} type="button" onClick={() => { setAthleteId(a.id); setStep(1); }} className={`block w-full rounded-xl border p-4 text-left transition active:scale-[0.99] ${athleteId === a.id ? "border-maroon" : "border-line"}`}>
                <div className="font-medium text-ink">{a.name}</div>
              </button>
            ))}
          </div>
        )
      )}

      {step === 1 && (
        <div className="space-y-2">
          {data.services.length === 0 && <p className="text-sm text-ink-3">{t("training.book.noServices")}</p>}
          {data.services.map((s) => {
            const bal = remainingSessions(data.lots.filter((l) => l.athleteId === athleteId && l.serviceId === s.id), now);
            const v = data.venues.find((x) => x.id === s.venueId);
            return (
              <button key={s.id} type="button" onClick={() => { setService(s); setPay(null); setSlot(null); setCoachId(ANY_COACH); setStep(2); }}
                className={`block w-full rounded-xl border p-4 text-left transition active:scale-[0.99] ${service?.id === s.id ? "border-maroon" : "border-line"}`}
                style={s.color ? { borderLeftColor: s.color, borderLeftWidth: 4 } : undefined}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-ink">{s.name}</div>
                  <span className="tnum text-sm text-ink-2">{s.sessionType === "group" ? t("training.common.perPerson", { price: f.money(s.price, s.currency ?? undefined) }) : f.money(s.price, s.currency ?? undefined)}</span>
                </div>
                {s.description && <div className="mt-0.5 text-xs text-ink-3">{s.description}</div>}
                <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-ink-3">
                  <Badge tone="neutral">{t("training.common.minutes", { count: s.durationMin })}</Badge>
                  {s.sessionType === "group"
                    ? <Badge tone="accent"><Users className="h-3 w-3" /> {t("training.common.groupRange", { min: s.minParticipants, max: s.maxParticipants })}</Badge>
                    : <Badge tone="neutral">{t("training.common.individual")}</Badge>}
                  {bal > 0 && <Badge tone="success">{t("training.common.sessionsLeft", { count: bal })}</Badge>}
                  {(v || s.locationText) && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{s.locationText || v?.name}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {step === 2 && service && (
        <div className="space-y-2">
          {(credits > 0 || canLegacy) && (
            <button type="button" onClick={() => { setPay({ kind: "credits", purchaseId: null }); setStep(3); }} className="flex w-full items-center gap-3 rounded-xl border border-line p-4 text-left hover:border-maroon/40">
              <Coins className="h-5 w-5 text-maroon" />
              <div><div className="text-sm font-medium text-ink">{t("training.book.useCredits")}</div>
                <div className="text-xs text-ink-3">{credits > 0 ? t("training.common.sessionsLeft", { count: credits }) : t("training.book.legacyCredits", { count: legacy })}
                  {credits > 0 && pickLot(lots, now)?.expiresAt ? ` · ${t("training.common.expires", { date: f.date(pickLot(lots, now)!.expiresAt!) })}` : ""}</div></div>
            </button>
          )}
          {packages.map((p) => {
            const save = packageSavings(p, service.price, currency);
            return (
              <button key={p.id} type="button" onClick={() => { setPay({ kind: "package", packageId: p.id }); setStep(3); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line p-4 text-left hover:border-maroon/40">
                <div className="flex items-center gap-3"><Package className="h-5 w-5 text-maroon" />
                  <div><div className="text-sm font-medium text-ink">{p.name || t("training.packages.defaultName", { count: p.sessions })}</div>
                    <div className="text-xs text-ink-3">{t("training.common.perSession", { price: f.money(perSessionPrice(p, currency), currency) })}
                      {p.validityDays ? ` · ${t("training.common.validDays", { count: p.validityDays })}` : ""}</div></div></div>
                <div className="text-right"><div className="tnum text-sm font-medium text-ink">{f.money(p.price, currency)}</div>
                  {save.percent > 0 && <div className="text-[11px] text-success">{t("training.common.save", { percent: save.percent })}</div>}</div>
              </button>
            );
          })}
          <button type="button" onClick={() => { setPay({ kind: "invoice" }); setStep(3); }} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line p-4 text-left hover:border-maroon/40">
            <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-maroon" />
              <div><div className="text-sm font-medium text-ink">{t("training.book.single")}</div><div className="text-xs text-ink-3">{t("training.book.singleHint")}</div></div></div>
            <div className="tnum text-sm font-medium text-ink">{f.money(service.price, currency)}</div>
          </button>
        </div>
      )}

      {step === 3 && service && (
        <div className="space-y-4">
          <div className="max-w-sm">
            <Label htmlFor="tb-coach">{t("training.book.coach")}</Label>
            <Select id="tb-coach" value={coachId} onChange={(e) => { setCoachId(e.target.value); setSlot(null); }}>
              <option value={ANY_COACH}>{t("training.book.anyCoach")}</option>
              {data.coaches.filter((c) => service.coachIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <SlotPicker service={service} slots={slots} coaches={data.coaches} venues={data.venues} selected={slot} coachPhotos={coachPhotos}
            onSelect={(s) => { setSlot(s); setStep(4); }} />
          {mode === "admin" && (
            <label className="flex items-center gap-2 text-sm text-ink-2"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" /> {t("training.book.override")}</label>
          )}
        </div>
      )}

      {step === 4 && service && slot && athlete && pay && (
        <div className="space-y-4">
          <Card><CardBody className="space-y-1.5 text-sm">
            <Row label={t("training.book.athlete")} value={athlete.name} />
            <Row label={t("training.book.stepService")} value={service.name} />
            <Row label={t("training.book.when")} value={`${f.date(slot.start, { weekday: true })} · ${f.time(slot.start)} – ${f.time(slot.end)}`} />
            <div className="flex items-center justify-between"><span className="text-ink-3">{t("training.book.coach")}</span>
              <span className="flex items-center gap-2 text-ink"><Avatar name={data.coaches.find((c) => c.id === slot.coachId)?.name ?? ""} src={coachPhotos[slot.coachId] ?? null} size="sm" />{data.coaches.find((c) => c.id === slot.coachId)?.name}</span></div>
            <Row label={t("training.book.location")} value={service.locationText || venueLine(data.venues.find((v) => v.id === slot.venueId)) || "—"} />
            <Row label={t("training.book.payment")} value={
              pay.kind === "credits" ? t("training.book.payCredits")
                : pay.kind === "package" ? `${packages.find((p) => p.id === pay.packageId)?.name ?? ""} · ${f.money(packages.find((p) => p.id === pay.packageId)?.price ?? 0, currency)}`
                  : `${t("training.book.single")} · ${f.money(service.price, currency)}`} />
            {service.sessionType === "group" && service.minParticipants > slot.booked + 1 && (
              <p className="pt-1 text-xs text-warning">{t("training.book.groupPending", { count: service.minParticipants - slot.booked - 1 })}</p>
            )}
          </CardBody></Card>
          {mode === "admin" && pay.kind === "package" && (
            <div className="max-w-xs">
              <Label htmlFor="tb-sale">{t("training.sell.mode")}</Label>
              <Select id="tb-sale" value={saleMode} onChange={(e) => setSaleMode(e.target.value as typeof saleMode)}>
                <option value="invoice">{t("training.sell.modes.invoice")}</option>
                <option value="paid">{t("training.sell.modes.paid")}</option>
                <option value="comp">{t("training.sell.modes.comp")}</option>
              </Select>
            </div>
          )}
          {pay.kind !== "credits" && !(mode === "admin" && saleMode === "comp") && (
            <TrainingPromo serviceId={service.id} packageId={pay.kind === "package" ? pay.packageId : null} start={slot.start} athleteId={athlete.id} code={promo} onCode={setPromo} />
          )}
          {pay.kind !== "credits" && <p className="text-xs text-ink-3">{pay.kind === "package" ? t("training.book.packageInvoiceHint") : t("training.book.singleInvoiceHint")}</p>}
          <p className="text-xs text-ink-4">{t("training.book.cancellationRule", { hours: data.settings.cancellationHours })}</p>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <Button onClick={confirm} disabled={pending} className="w-full sm:w-auto">{pending ? t("training.book.booking") : t("training.book.confirm")}</Button>
        </div>
      )}
      {err && step !== 4 && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><span className="text-ink-3">{label}</span><span className="text-right text-ink">{value}</span></div>;
}
