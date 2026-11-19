"use client";

import * as React from "react";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { removeCard, setAutopayEnabled, startAutopaySetup } from "@/lib/actions/plans";
import { usePlanAction } from "./plan-widgets";

type Card = { id: string; enabled: boolean; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; consentedAt: string; expiringSoon: boolean };

/**
 * Parent: save a card for autopay on the club's Stripe account (Stripe-hosted
 * page; we never see the card number), switch autopay on/off, replace or
 * remove the card. The consent wording shown here is what gets recorded.
 */
export function AutopayPanel({ familyId, card, consentText, consentedLabel, available }: {
  familyId: string; card: Card | null; consentText: string; consentedLabel: string | null; available: boolean;
}) {
  const t = useT();
  const { busy, run, note } = usePlanAction();
  const [accepted, setAccepted] = React.useState(false);
  const [redirecting, setRedirecting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function setup() {
    setRedirecting(true); setErr(null);
    const r = await startAutopaySetup(familyId, accepted);
    if (r.ok) window.location.href = r.url;
    else { setErr(r.error); setRedirecting(false); }
  }

  const consent = (
    <div className="space-y-2 rounded-md border border-line p-3">
      <p className="text-xs leading-relaxed text-ink-2">{consentText}</p>
      <label htmlFor={`ap-consent-${familyId}`} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input id={`ap-consent-${familyId}`} type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} /> {t("plans.autopay.accept")}
      </label>
    </div>
  );

  return (
    <div className="space-y-3">
      {card ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <CreditCard className="h-5 w-5 text-ink-3" aria-hidden />
            <div>
              <div className="text-sm text-ink">{t("plans.autopay.cardLine", { brand: (card.brand ?? "").toUpperCase(), last4: card.last4 ?? "····" })}</div>
              <div className="text-xs text-ink-3">{t("plans.autopay.expires", { month: String(card.expMonth ?? "").padStart(2, "0"), year: String(card.expYear ?? "") })}</div>
              {consentedLabel && <div className="text-xs text-ink-3">{consentedLabel}</div>}
            </div>
            <Badge tone={card.enabled ? "success" : "neutral"}>{t(card.enabled ? "plans.autopay.on" : "plans.autopay.off")}</Badge>
            {card.expiringSoon && <Badge tone="warning">{t("plans.autopay.expiringSoon")}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setAutopayEnabled(card.id, !card.enabled))}>
              {t(card.enabled ? "plans.autopay.turnOff" : "plans.autopay.turnOn")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(t("plans.autopay.removeConfirm"))) void run(() => removeCard(card.id)); }}>
              {t("plans.autopay.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-2">{t("plans.autopay.none")}</p>
      )}
      {available ? (
        <>
          {consent}
          <Button size="sm" disabled={!accepted || redirecting} onClick={setup}>
            <ShieldCheck className="h-4 w-4" /> {redirecting ? t("payments.redirecting") : t(card ? "plans.autopay.replace" : "plans.autopay.save")}
          </Button>
        </>
      ) : (
        <p className="text-xs text-ink-3">{t("plans.autopay.unavailable")}</p>
      )}
      <p className="text-xs text-ink-3">{t("plans.autopay.twintNote")}</p>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {note}
    </div>
  );
}
