"use client";

import * as React from "react";
import { Plus, Trash2, Check, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { Card, CardBody, Button, Input, Label, Badge } from "@/components/ui";
import { submitRegistration, type SubmitResult } from "@/lib/actions/registration";
import { useFormat, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translator";
import type { PublicConsent } from "@/lib/data/public-registration";

type Parent = { name: string; email: string; phone: string; address: string; emergencyName: string; emergencyPhone: string };
type Child = { firstName: string; lastName: string; dob: string; gender: string; allergies: string; conditions: string; medicalNotes: string };

const emptyChild = (): Child => ({ firstName: "", lastName: "", dob: "", gender: "", allergies: "", conditions: "", medicalNotes: "" });

/** Consent copy lives in the catalog under registration.consents.<key>. */
const consentCopy = (t: Translator, key: string) =>
  t.dynamic(`registration.consents.${key}`, undefined, t("registration.consents.default"));

const STEP_KEYS = ["details", "children", "agreements", "review"] as const;

export function RegisterStepper({
  programSlug, programName, priceChf, siblingDiscountPct, consents,
}: {
  programSlug: string;
  programName: string;
  priceChf: number;
  siblingDiscountPct: number;
  consents: PublicConsent[];
}) {
  const t = useT();
  const f = useFormat();
  const STEPS = STEP_KEYS.map((k) => t(`registration.steps.${k}`));
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
      const req = t("registration.errors.required");
      if (!parent.name.trim()) e["parent.name"] = req;
      if (!/.+@.+\..+/.test(parent.email)) e["parent.email"] = t("registration.errors.email");
      if (parent.phone.trim().length < 3) e["parent.phone"] = req;
      if (!parent.emergencyName.trim()) e["parent.emergencyName"] = req;
      if (parent.emergencyPhone.trim().length < 3) e["parent.emergencyPhone"] = req;
    }
    if (s === 1) {
      children.forEach((c, i) => {
        const req = t("registration.errors.required");
        if (!c.firstName.trim()) e[`children.${i}.firstName`] = req;
        if (!c.lastName.trim()) e[`children.${i}.lastName`] = req;
        if (!c.dob.trim()) e[`children.${i}.dob`] = req;
      });
    }
    if (s === 2) {
      const missing = requiredKeys.filter((k) => !accepted.has(k));
      if (missing.length) e["consents"] = t("registration.consents.missing");
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
          <h2 className="text-lg font-semibold">{t("registration.parent.title")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("registration.parent.fullName")} error={err("parent.name")}><Input value={parent.name} onChange={(e) => setP("name")(e.target.value)} /></Field>
            <Field label={t("registration.parent.email")} error={err("parent.email")}><Input type="email" value={parent.email} onChange={(e) => setP("email")(e.target.value)} /></Field>
            <Field label={t("registration.parent.phone")} error={err("parent.phone")}><Input value={parent.phone} onChange={(e) => setP("phone")(e.target.value)} /></Field>
            <Field label={t("registration.parent.address")}><Input value={parent.address} onChange={(e) => setP("address")(e.target.value)} /></Field>
          </div>
          <div className="rounded-md border border-line bg-surface-elevated/50 p-4">
            <div className="mb-3 text-sm font-medium text-ink">{t("registration.parent.emergencyContact")}</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={t("registration.parent.emergencyName")} error={err("parent.emergencyName")}><Input value={parent.emergencyName} onChange={(e) => setP("emergencyName")(e.target.value)} /></Field>
              <Field label={t("registration.parent.emergencyPhone")} error={err("parent.emergencyPhone")}><Input value={parent.emergencyPhone} onChange={(e) => setP("emergencyPhone")(e.target.value)} /></Field>
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
                <h3 className="text-sm font-semibold text-ink">{t("registration.child.title", { index: i + 1 })}</h3>
                {children.length > 1 && (
                  <button onClick={() => setChildren((arr) => arr.filter((_, idx) => idx !== i))} className="flex items-center gap-1 text-xs text-ink-3 hover:text-danger">
                    <Trash2 className="h-3.5 w-3.5" /> {t("common.remove")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={t("registration.child.firstName")} error={err(`children.${i}.firstName`)}><Input value={c.firstName} onChange={(e) => setC(i, "firstName")(e.target.value)} /></Field>
                <Field label={t("registration.child.lastName")} error={err(`children.${i}.lastName`)}><Input value={c.lastName} onChange={(e) => setC(i, "lastName")(e.target.value)} /></Field>
                <Field label={t("registration.child.dob")} error={err(`children.${i}.dob`)}><Input type="date" value={c.dob} onChange={(e) => setC(i, "dob")(e.target.value)} /></Field>
                <Field label={t("registration.child.gender")}>
                  <select value={c.gender} onChange={(e) => setC(i, "gender")(e.target.value)} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
                    <option value="">{t("common.select")}</option><option value="Male">{t("registration.child.genderMale")}</option><option value="Female">{t("registration.child.genderFemale")}</option><option value="Other">{t("registration.child.genderOther")}</option>
                  </select>
                </Field>
              </div>
              <Field label={t("registration.child.allergies")}><Input value={c.allergies} onChange={(e) => setC(i, "allergies")(e.target.value)} placeholder={t("registration.child.allergiesPlaceholder")} /></Field>
              <Field label={t("registration.child.conditions")}><Input value={c.conditions} onChange={(e) => setC(i, "conditions")(e.target.value)} placeholder={t("registration.child.conditionsPlaceholder")} /></Field>
              <Field label={t("registration.child.otherNotes")}><Input value={c.medicalNotes} onChange={(e) => setC(i, "medicalNotes")(e.target.value)} /></Field>
            </CardBody></Card>
          ))}
          <Button variant="secondary" onClick={() => setChildren((arr) => [...arr, emptyChild()])}>
            <Plus className="h-4 w-4" /> {t("registration.child.add")}
          </Button>
          {n > 1 && siblingDiscountPct > 0 && (
            <p className="text-xs text-success">{t("registration.child.siblingHint", { pct: siblingDiscountPct })}</p>
          )}
        </div>
      )}

      {/* STEP 3 — Consents */}
      {step === 2 && (
        <Card><CardBody className="space-y-3">
          <h2 className="text-lg font-semibold">{t("registration.consents.title")}</h2>
          {err("consents") && <p className="text-sm text-danger">{err("consents")}</p>}
          {consents.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface-elevated/40 px-4 py-3 hover:border-maroon/40">
              <input type="checkbox" checked={accepted.has(c.key)} onChange={() => toggleConsent(c.key)} className="mt-1 h-4 w-4 accent-[var(--red-primary)]" />
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

      {/* STEP 4 — Review */}
      {step === 3 && (
        <Card><CardBody className="space-y-5">
          <h2 className="text-lg font-semibold">{t("registration.review.title")}</h2>

          <Section title={t("registration.review.program")}><Row label={programName} value={t("common.perParticipant", { price: f.money(priceChf) })} /></Section>

          <Section title={t("registration.review.guardian")}>
            <Row label={t("common.name")} value={parent.name} />
            <Row label={t("common.email")} value={parent.email} />
            <Row label={t("common.phone")} value={parent.phone} />
            <Row label={t("registration.review.emergency")} value={`${parent.emergencyName} · ${parent.emergencyPhone}`} />
          </Section>

          <Section title={t("registration.review.children", { count: n })}>
            {children.map((c, i) => (
              <Row key={i} label={`${c.firstName} ${c.lastName}`} value={f.date(c.dob)} />
            ))}
          </Section>

          <Section title={t("registration.review.cost")}>
            <Row label={t("registration.review.lineItem", { count: n, price: f.money(priceChf) })} value={f.money(priceChf * n)} />
            {discountTotal > 0 && <Row label={t("registration.review.siblingDiscount", { pct: siblingDiscountPct })} value={`– ${f.money(discountTotal)}`} />}
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-base font-semibold">
              <span>{t("common.total")}</span><span className="tnum">{f.money(total)}</span>
            </div>
          </Section>

          <p className="flex items-center gap-2 text-xs text-ink-3">
            <ShieldCheck className="h-4 w-4 shrink-0 text-success" /> {t("registration.review.accepted", { count: accepted.size })}
          </p>
        </CardBody></Card>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || submitting}><ChevronLeft className="h-4 w-4" /> {t("common.back")}</Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>{t("common.next")} <ChevronRight className="h-4 w-4" /></Button>
        ) : (
          <Button onClick={onSubmit} disabled={submitting}>{submitting ? t("registration.submitting") : t("registration.submit")}</Button>
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
