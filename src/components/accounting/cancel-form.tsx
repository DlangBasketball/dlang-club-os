"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, FieldHint, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { createRefundRequest } from "@/lib/actions/accounting";
import { allowedResolutions, isValidIban, quoteRefund, type MedicalMode, type Resolution } from "@/lib/accounting/refunds";
import type { QuoteView } from "@/lib/accounting/data";

/**
 * Cancel + refund request (parent or finance). Shows the club's policy and the
 * refund computed from it BEFORE the family confirms; the medical switch
 * recomputes locally with the same rules as the database.
 */
export function CancelForm({ subject, quote, today, backHref }: {
  subject: { registrationId?: string; bookingId?: string; invoiceId?: string };
  quote: QuoteView; today: string; backHref: string;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [medical, setMedical] = React.useState(false);
  const policy = quote.policy ? {
    fullUntilDays: quote.policy.full_until_days, partialPercent: quote.policy.partial_percent, partialUntilDays: quote.policy.partial_until_days,
    medicalMode: quote.policy.medical_mode as MedicalMode, medicalPercent: quote.policy.medical_percent,
  } : null;
  const q = quoteRefund({ policy, startsOn: quote.startsOn, on: today, medical, base: quote.base, amountDue: quote.amountDue, paid: quote.paid, currency: quote.currency });
  const options = allowedResolutions(policy, medical, quote.stripeAvailable);
  const [pref, setPref] = React.useState<Resolution>(options[0]);
  const effectivePref = options.includes(pref) ? pref : options[0];
  const [iban, setIban] = React.useState("");
  const [holder, setHolder] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const money = (n: number) => f.money(n, quote.currency);
  const ibanBad = effectivePref === "bank_refund" && iban.length > 0 && !isValidIban(iban);

  return (
    <form className="space-y-5" onSubmit={async (e) => {
      e.preventDefault();
      if (!window.confirm(t("accounting.cancel.confirmPrompt"))) return;
      setBusy(true); setError(null);
      const res = await createRefundRequest({
        ...subject, medical, reason: reason || null, preference: q.payout > 0 ? effectivePref : null,
        iban: effectivePref === "bank_refund" ? iban : null, accountHolder: effectivePref === "bank_refund" ? holder : null,
      });
      setBusy(false);
      if (!res.ok) { setError(res.error); return; }
      router.push(backHref);
      router.refresh();
    }}>
      <section aria-labelledby="policy-h" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="policy-h" className="text-sm font-medium text-ink">{t("accounting.cancel.policyTitle")}</h2>
        {quote.policy ? (
          <ul className="mt-2 space-y-1 text-sm text-ink-2">
            {quote.policy.full_until_days != null && <li>{t("accounting.cancel.policyFull", { days: quote.policy.full_until_days })}</li>}
            {quote.policy.partial_until_days != null && quote.policy.partial_percent > 0 && (
              <li>{t("accounting.cancel.policyPartial", { percent: quote.policy.partial_percent, days: quote.policy.partial_until_days })}</li>
            )}
            <li>{t("accounting.cancel.policyNone")}</li>
            {quote.policy.medical_mode !== "none" && (
              <li>{t.dynamic(`accounting.cancel.policyMedical.${quote.policy.medical_mode}`, { percent: quote.policy.medical_percent })}</li>
            )}
            {quote.policy.notes && <li className="whitespace-pre-line text-ink-3">{quote.policy.notes}</li>}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-3">{t("accounting.cancel.noPolicy")}</p>
        )}
      </section>

      <section aria-labelledby="quote-h" className="rounded-lg border border-border bg-surface p-4">
        <h2 id="quote-h" className="text-sm font-medium text-ink">{t("accounting.cancel.quoteTitle")}</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {quote.startsOn && (<><dt className="text-ink-3">{t("accounting.cancel.startsOn")}</dt><dd className="text-ink">{f.date(quote.startsOn)}</dd></>)}
          {q.daysBefore != null && (<><dt className="text-ink-3">{t("accounting.cancel.daysBefore")}</dt><dd className="tnum text-ink">{f.number(q.daysBefore)}</dd></>)}
          <dt className="text-ink-3">{t("accounting.cancel.price")}</dt><dd className="tnum text-ink">{money(quote.base)}</dd>
          <dt className="text-ink-3">{t("accounting.cancel.refundAmount", { percent: q.percent })}</dt><dd className="tnum font-medium text-ink">{money(q.refund)}</dd>
          <dt className="text-ink-3">{t("accounting.cancel.paid")}</dt><dd className="tnum text-ink">{money(quote.paid)}</dd>
          <dt className="text-ink-3">{t("accounting.cancel.payout")}</dt><dd className="tnum font-medium text-success">{money(q.payout)}</dd>
          {q.stillOwed > 0 && (<><dt className="text-ink-3">{t("accounting.cancel.stillOwed")}</dt><dd className="tnum text-warning">{money(q.stillOwed)}</dd></>)}
        </dl>
        {q.needsReview && <p className="mt-2 text-xs text-ink-3">{t("accounting.cancel.needsReview")}</p>}
      </section>

      {quote.policy?.medical_mode && quote.policy.medical_mode !== "none" && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={medical} onChange={(e) => setMedical(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" />
          <span>{t("accounting.cancel.medicalLabel")}<FieldHint>{t("accounting.cancel.medicalHint")}</FieldHint></span>
        </label>
      )}

      {q.payout > 0 && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="cancel-pref">{t("accounting.cancel.preference")}</Label>
            <Select id="cancel-pref" value={effectivePref} onChange={(e) => setPref(e.target.value as Resolution)} className="w-64">
              {options.map((o) => <option key={o} value={o}>{t(`accounting.refunds.resolutions.${o}`)}</option>)}
            </Select>
          </div>
          {effectivePref === "bank_refund" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="cancel-holder">{t("accounting.cancel.accountHolder")}</Label>
                <Input id="cancel-holder" value={holder} maxLength={140} autoComplete="name" onChange={(e) => setHolder(e.target.value)} required /></div>
              <div><Label htmlFor="cancel-iban">{t("accounting.cancel.iban")}</Label>
                <Input id="cancel-iban" value={iban} maxLength={40} autoComplete="off" spellCheck={false} onChange={(e) => setIban(e.target.value)} aria-invalid={ibanBad || undefined} required />
                <FieldHint error={ibanBad}>{ibanBad ? t("accounting.errors.codes.INVALID_IBAN") : t("accounting.cancel.ibanHint")}</FieldHint></div>
            </div>
          )}
        </div>
      )}

      <div>
        <Label htmlFor="cancel-reason">{t("accounting.cancel.reasonLabel")}</Label>
        <Textarea id="cancel-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="danger" disabled={busy || ibanBad}>{busy ? t("accounting.cancel.submitting") : t("accounting.cancel.confirm")}</Button>
    </form>
  );
}
