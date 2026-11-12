"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, CreditCard, Coins, CalendarClock } from "lucide-react";
import { Card, CardBody, Button, Badge } from "@/components/ui";
import { bookSession } from "@/lib/actions/booking";
import { useFormat } from "@/lib/i18n/client";
import type { WizardData, WizardService, WizardSlot } from "@/lib/data/booking";

export function BookingWizard({ data }: { data: WizardData }) {
  const f = useFormat();
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [childId, setChildId] = React.useState(data.children[0]?.id ?? "");
  const [service, setService] = React.useState<WizardService | null>(null);
  const [slot, setSlot] = React.useState<WizardSlot | null>(null);
  const [pay, setPay] = React.useState<"credits" | "invoice">("invoice");
  const [err, setErr] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const child = data.children.find((c) => c.id === childId) ?? null;
  const creditBalance = child && service ? child.credits[service.creditCategory] : 0;
  const canUseCredits = !!service && service.creditsRequired > 0 && creditBalance >= service.creditsRequired;

  React.useEffect(() => { setPay(canUseCredits ? "credits" : "invoice"); }, [canUseCredits]);

  const steps = ["Child", "Service", "Time", "Payment"];

  async function confirm() {
    if (!child || !service || !slot) return;
    setPending(true); setErr(null);
    const res = await bookSession(child.id, service.id, slot.id, pay);
    setPending(false);
    if (res.ok) router.push(`/parent/bookings/${res.data?.bookingId}?confirmed=1`);
    else setErr(res.error);
  }

  if (!data.enabled) return <Card><CardBody className="py-6 text-center text-sm text-ink-3">Online booking is currently closed. Please check back soon.</CardBody></Card>;
  if (data.children.length === 0) return <Card><CardBody className="py-6 text-center text-sm text-ink-3">Add a child to your account to book sessions.</CardBody></Card>;

  return (
    <div className="space-y-5">
      {/* stepper */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-1.5 text-xs ${i === step ? "text-ink" : i < step ? "text-success" : "text-ink-4"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${i === step ? "bg-maroon text-white" : i < step ? "bg-success text-white" : "bg-surface-elevated"}`}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
            </div>
            {i < steps.length - 1 && <div className="h-px flex-1 bg-line" />}
          </React.Fragment>
        ))}
      </div>

      {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"><ChevronLeft className="h-3.5 w-3.5" /> Back</button>}

      {/* Step 0: child */}
      {step === 0 && (
        <div className="space-y-2">
          {data.children.map((c) => (
            <button key={c.id} onClick={() => { setChildId(c.id); setStep(1); }} className={`block w-full rounded-xl border p-4 text-left transition active:scale-[0.99] ${childId === c.id ? "border-maroon" : "border-line"}`}>
              <div className="font-medium text-ink">{c.name}</div>
              <div className="mt-0.5 text-xs text-ink-3">Credits — personal {c.credits.personal} · nutrition {c.credits.nutrition} · mental {c.credits.mental}</div>
            </button>
          ))}
        </div>
      )}

      {/* Step 1: service */}
      {step === 1 && (
        <div className="space-y-2">
          {data.services.length === 0 && <p className="text-sm text-ink-3">No services available.</p>}
          {data.services.map((s) => (
            <button key={s.id} onClick={() => { setService(s); setStep(2); }} className={`block w-full rounded-xl border p-4 text-left transition active:scale-[0.99] ${service?.id === s.id ? "border-maroon" : "border-line"}`}>
              <div className="flex items-center justify-between">
                <div className="font-medium text-ink">{s.name}</div>
                <span className="tnum text-sm text-ink-2">{f.money(s.priceChf)}</span>
              </div>
              {s.description && <div className="mt-0.5 text-xs text-ink-3">{s.description}</div>}
              <div className="mt-1 flex gap-2 text-[11px] text-ink-3">
                <span>{s.durationMin} min</span>
                {s.creditsRequired > 0 && <Badge tone="neutral">{s.creditsRequired} {s.creditCategory} credit{s.creditsRequired > 1 ? "s" : ""}</Badge>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: slot */}
      {step === 2 && (
        <div className="space-y-2">
          {data.slots.length === 0 && <p className="text-sm text-ink-3">No open slots right now.</p>}
          {data.slots.map((s) => (
            <button key={s.id} onClick={() => { setSlot(s); setStep(3); }} className={`flex w-full items-center justify-between rounded-xl border p-4 text-left transition active:scale-[0.99] ${slot?.id === s.id ? "border-maroon" : "border-line"}`}>
              <div><div className="text-sm font-medium text-ink">{f.date(s.start)} · {f.time(s.start)}</div><div className="text-xs text-ink-3">with {s.coachName}</div></div>
              <CalendarClock className="h-4 w-4 text-ink-4" />
            </button>
          ))}
        </div>
      )}

      {/* Step 3: payment + confirm */}
      {step === 3 && service && slot && child && (
        <div className="space-y-4">
          <Card><CardBody className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-ink-3">Child</span><span className="text-ink">{child.name}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Service</span><span className="text-ink">{service.name}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">When</span><span className="text-ink">{f.date(slot.start)} · {f.time(slot.start)}</span></div>
            <div className="flex justify-between"><span className="text-ink-3">Coach</span><span className="text-ink">{slot.coachName}</span></div>
          </CardBody></Card>

          <div className="space-y-2">
            <button onClick={() => setPay("invoice")} className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left ${pay === "invoice" ? "border-maroon" : "border-line"}`}>
              <CreditCard className="h-5 w-5 text-maroon" />
              <div><div className="text-sm font-medium text-ink">Pay by invoice</div><div className="text-xs text-ink-3">An invoice for {f.money(service.priceChf)} will be issued.</div></div>
            </button>
            <button disabled={!canUseCredits} onClick={() => setPay("credits")} className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left disabled:opacity-50 ${pay === "credits" ? "border-maroon" : "border-line"}`}>
              <Coins className="h-5 w-5 text-maroon" />
              <div>
                <div className="text-sm font-medium text-ink">Use training credits</div>
                <div className="text-xs text-ink-3">{service.creditsRequired > 0 ? `Costs ${service.creditsRequired} ${service.creditCategory} credit(s) · you have ${creditBalance}` : "Not available for this service"}</div>
              </div>
            </button>
          </div>

          {err && <p className="text-sm text-danger">{err}</p>}
          <Button onClick={confirm} disabled={pending} className="w-full">{pending ? "Booking…" : "Confirm booking"}</Button>
        </div>
      )}
    </div>
  );
}
