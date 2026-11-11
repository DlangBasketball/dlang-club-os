"use client";

import * as React from "react";
import { Plus, Trash2, Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Card, CardBody, Button, Input, Label, Badge } from "@/components/ui";
import { submitRegistration, type SubmitResult } from "@/lib/actions/registration";
import { formatCHF } from "@/lib/utils";
import type { PublicConsent } from "@/lib/data/public-registration";

type Parent = { name: string; email: string; phone: string; address: string; emergencyName: string; emergencyPhone: string };
type Child = { firstName: string; lastName: string; dob: string; gender: string; allergies: string; conditions: string; medicalNotes: string };

const emptyChild = (): Child => ({ firstName: "", lastName: "", dob: "", gender: "", allergies: "", conditions: "", medicalNotes: "" });

const CONSENT_COPY: Record<string, string> = {
  liability: "I accept the liability waiver and assumption-of-risk terms.",
  terms: "I accept the club terms & conditions.",
  privacy: "I have read the privacy policy and consent to data processing (Swiss FADP / GDPR).",
  media: "I consent to photos/video of my child being used in club media.",
  health: "I authorize the club to arrange emergency medical care if needed.",
  transport: "I consent to club-organized transport to and from activities.",
};

const STEPS = ["Your details", "Children", "Agreements", "Review"];

export function RegisterStepper({
  programSlug, programName, priceChf, siblingDiscountPct, consents,
}: {
  programSlug: string;
  programName: string;
  priceChf: number;
  siblingDiscountPct: number;
  consents: PublicConsent[];
}) {
  const [step, setStep] = React.useState(0);
  const [parent, setParent] = React.useState<Parent>({ name: "", email: "", phone: "", address: "", emergencyName: "", emergencyPhone: "" });
  const [children, setChildren] = React.useState<Child[]>([emptyChild()]);
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const requiredKeys = consents.filter((c) => c.required).map((c) => c.key);
  const setP = (k: keyof Parent) => (v: string) => setParent((s) => ({ ...s, [k]: v }));
  const setC = (i: number, k: keyof Child) => (v: string) =>
    setChildren((arr) => arr.map((c, idx) => (idx === i ? { ...c, [k]: v } : c)));
  const toggleConsent = (key: string) =>
    setAccepted((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const discountEach = Math.round((priceChf * siblingDiscountPct) / 100 * 100) / 100;
  const n = children.length;
  const discountTotal = n > 1 ? discountEach * (n - 1) : 0;
  const total = priceChf * n - discountTotal;

  function validateStep(s: number): boolean {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (!parent.name.trim()) e["parent.name"] = "Required";
      if (!/.+@.+\..+/.test(parent.email)) e["parent.email"] = "Enter a valid email";
      if (parent.phone.trim().length < 3) e["parent.phone"] = "Required";
      if (!parent.emergencyName.trim()) e["parent.emergencyName"] = "Required";
      if (parent.emergencyPhone.trim().length < 3) e["parent.emergencyPhone"] = "Required";
    }
    if (s === 1) {
      children.forEach((c, i) => {
        if (!c.firstName.trim()) e[`children.${i}.firstName`] = "Required";
        if (!c.lastName.trim()) e[`children.${i}.lastName`] = "Required";
        if (!c.dob.trim()) e[`children.${i}.dob`] = "Required";
      });
    }
    if (s === 2) {
      const missing = requiredKeys.filter((k) => !accepted.has(k));
      if (missing.length) e["consents"] = "Please accept all required agreements.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() { if (validateStep(step)) { setFormError(null); setStep((s) => Math.min(s + 1, STEPS.length - 1)); } }
  function back() { setFormError(null); setStep((s) => Math.max(s - 1, 0)); }

  async function onSubmit() {
    // re-validate all steps client-side
    for (let s = 0; s <= 2; s++) if (!validateStep(s)) { setStep(s); return; }
    setSubmitting(true);
    setFormError(null);
    const res: SubmitResult | void = await submitRegistration({
      programSlug,
      parent,
      children,
      consents: Array.from(accepted),
    });
    // Only reached on failure (success redirects server-side)
    if (res && !res.ok) {
      setSubmitting(false);
      if (res.errors) {
        setErrors(res.errors);
        const firstKey = Object.keys(res.errors)[0] ?? "";
        setStep(firstKey.startsWith("children") ? 1 : firstKey === "consents" ? 2 : 0);
      }
      if (res.formError) setFormError(res.formError);
    }
  }

  const err = (k: string) => errors[k];

  return (
    <div className="space-y-6">
      {/* Stepper header */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${i < step ? "bg-maroon text-inverse" : i === step ? "bg-maroon/20 text-maroon ring-1 ring-maroon" : "bg-surface-elevated text-ink-3"}`}>
              {i < step ? <Check className="h-4 w-4" /> : i + 1}
            </span>
            <span className={`hidden text-xs sm:block ${i === step ? "text-ink" : "text-ink-3"}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-line" />}
          </li>
        ))}
      </ol>

      {formError && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{formError}</div>
      )}

      {/* STEP 1 — Parent */}
      {step === 0 && (
        <Card><CardBody className="space-y-4">
          <h2 className="text-lg font-semibold">Your details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Full name" error={err("parent.name")}><Input value={parent.name} onChange={(e) => setP("name")(e.target.value)} /></Field>
            <Field label="Email" error={err("parent.email")}><Input type="email" value={parent.email} onChange={(e) => setP("email")(e.target.value)} /></Field>
            <Field label="Phone" error={err("parent.phone")}><Input value={parent.phone} onChange={(e) => setP("phone")(e.target.value)} /></Field>
            <Field label="Address (optional)"><Input value={parent.address} onChange={(e) => setP("address")(e.target.value)} /></Field>
          </div>
          <div className="rounded-md border border-line bg-surface-elevated/50 p-4">
            <div className="mb-3 text-sm font-medium text-ink">Emergency contact</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Contact name" error={err("parent.emergencyName")}><Input value={parent.emergencyName} onChange={(e) => setP("emergencyName")(e.target.value)} /></Field>
              <Field label="Contact phone" error={err("parent.emergencyPhone")}><Input value={parent.emergencyPhone} onChange={(e) => setP("emergencyPhone")(e.target.value)} /></Field>
            </div>
          </div>
        </CardBody></Card>
      )}

      {/* STEP 2 — Children */}
      {step === 1 && (
        <div className="space-y-4">
          {children.map((c, i) => (
            <Card key={i}><CardBody className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">Child {i + 1}</h3>
                {children.length > 1 && (
                  <button onClick={() => setChildren((arr) => arr.filter((_, idx) => idx !== i))} className="flex items-center gap-1 text-xs text-ink-3 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="First name" error={err(`children.${i}.firstName`)}><Input value={c.firstName} onChange={(e) => setC(i, "firstName")(e.target.value)} /></Field>
                <Field label="Last name" error={err(`children.${i}.lastName`)}><Input value={c.lastName} onChange={(e) => setC(i, "lastName")(e.target.value)} /></Field>
                <Field label="Date of birth" error={err(`children.${i}.dob`)}><Input type="date" value={c.dob} onChange={(e) => setC(i, "dob")(e.target.value)} /></Field>
                <Field label="Gender (optional)">
                  <select value={c.gender} onChange={(e) => setC(i, "gender")(e.target.value)} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
                    <option value="">Select…</option><option>Male</option><option>Female</option><option>Other</option>
                  </select>
                </Field>
              </div>
              <Field label="Allergies (optional)"><Input value={c.allergies} onChange={(e) => setC(i, "allergies")(e.target.value)} placeholder="e.g. Peanuts · EpiPen in bag" /></Field>
              <Field label="Medical conditions (optional)"><Input value={c.conditions} onChange={(e) => setC(i, "conditions")(e.target.value)} placeholder="e.g. Asthma · inhaler" /></Field>
              <Field label="Other notes (optional)"><Input value={c.medicalNotes} onChange={(e) => setC(i, "medicalNotes")(e.target.value)} /></Field>
            </CardBody></Card>
          ))}
          <Button variant="secondary" onClick={() => setChildren((arr) => [...arr, emptyChild()])}>
            <Plus className="h-4 w-4" /> Add another child
          </Button>
          {n > 1 && siblingDiscountPct > 0 && (
            <p className="text-xs text-success">A {siblingDiscountPct}% sibling discount will be applied to each additional child.</p>
          )}
        </div>
      )}

      {/* STEP 3 — Consents */}
      {step === 2 && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">Agreements &amp; consent</h2>
          {err("consents") && <p className="text-sm text-danger">{err("consents")}</p>}
          {consents.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-elevated/40 px-4 py-3 hover:border-maroon/40">
              <input type="checkbox" checked={accepted.has(c.key)} onChange={() => toggleConsent(c.key)} className="mt-1 h-4 w-4 accent-[var(--red-primary)]" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {c.title}
                  {c.required ? <Badge tone="danger">required</Badge> : <Badge tone="neutral">optional</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-ink-3">{CONSENT_COPY[c.key] ?? "I accept this agreement."}</span>
              </span>
            </label>
          ))}
        </CardBody></Card>
      )}

      {/* STEP 4 — Review */}
      {step === 3 && (
        <Card><CardBody className="space-y-5">
          <h2 className="text-lg font-semibold">Review &amp; confirm</h2>

          <Section title="Program"><Row label={programName} value={`${formatCHF(priceChf)} / participant`} /></Section>

          <Section title="Parent / guardian">
            <Row label="Name" value={parent.name} />
            <Row label="Email" value={parent.email} />
            <Row label="Phone" value={parent.phone} />
            <Row label="Emergency" value={`${parent.emergencyName} · ${parent.emergencyPhone}`} />
          </Section>

          <Section title={`Children (${n})`}>
            {children.map((c, i) => (
              <Row key={i} label={`${c.firstName} ${c.lastName}`} value={c.dob} />
            ))}
          </Section>

          <Section title="Cost">
            <Row label={`${n} × ${formatCHF(priceChf)}`} value={formatCHF(priceChf * n)} />
            {discountTotal > 0 && <Row label={`Sibling discount (${siblingDiscountPct}%)`} value={`– ${formatCHF(discountTotal)}`} />}
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
              <span>Total</span><span className="tnum">{formatCHF(total)}</span>
            </div>
          </Section>

          <p className="flex items-center gap-2 text-xs text-ink-3">
            <ShieldCheck className="h-4 w-4 text-success" /> You accepted {accepted.size} agreement{accepted.size === 1 ? "" : "s"}. An invoice will be issued; payment instructions follow by email.
          </p>
        </CardBody></Card>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || submitting}><ChevronLeft className="h-4 w-4" /> Back</Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>Next <ChevronRight className="h-4 w-4" /></Button>
        ) : (
          <Button onClick={onSubmit} disabled={submitting}>{submitting ? "Submitting…" : "Submit registration"}</Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md bg-surface-elevated/50 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-ink-3">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-2">{label}</span>
      <span className="text-ink">{value}</span>
    </div>
  );
}
