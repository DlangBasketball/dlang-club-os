"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { askFamilyForConsent, giveCarerConsent } from "@/lib/actions/relative-invites";
import type { CarerConsentForm } from "@/lib/participants/carer-consent";

/**
 * A linked relative the club lets consent (setting ON, can_consent) accepts
 * the activity consents of their own held booking, or asks the family after
 * all. Health forms they may not accept (no medical access) are not offered;
 * when one is required the database refuses and the family must be asked.
 */
export function CarerConsentPanel({ requestId, forms }: { requestId: string; forms: CarerConsentForm[] }) {
  const t = useT();
  const router = useRouter();
  const allowed = forms.filter((f) => f.allowed);
  const [keys, setKeys] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<"give" | "ask" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const missing = allowed.some((f) => f.required && !keys.includes(f.key));
  const toggle = (k: string) => setKeys((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  async function give() {
    setBusy("give"); setMsg(null);
    const res = await giveCarerConsent(requestId, keys);
    setBusy(null);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) router.refresh();
  }
  async function ask() {
    setBusy("ask"); setMsg(null);
    const res = await askFamilyForConsent(requestId);
    setBusy(null);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-sm text-text">{t("participants.carerConsent.panelIntro")}</p>
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("participants.carerConsent.forms")}</legend>
        {allowed.map((f) => (
          <div key={f.key}>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-text">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={keys.includes(f.key)} onChange={() => toggle(f.key)} />
              <span className="flex-1">
                <span className="font-medium">{f.title}</span>{" "}
                <Badge tone={f.required ? "warning" : "neutral"}>{f.required ? t("consentRequest.page.required") : t("consentRequest.page.optional")}</Badge>
              </span>
            </label>
            {f.body && (
              <details className="ml-6 mt-1 text-xs text-text-muted">
                <summary className="cursor-pointer">{t("consentRequest.page.readForm")}</summary>
                <p className="mt-1 whitespace-pre-wrap">{f.body}</p>
              </details>
            )}
          </div>
        ))}
      </fieldset>
      {forms.some((f) => !f.allowed) && <p className="text-xs text-text-muted">{t("participants.carerConsent.healthHint")}</p>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void give()} loading={busy === "give"} disabled={missing || busy !== null}>
          {t("participants.carerConsent.give")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void ask()} loading={busy === "ask"} disabled={busy !== null}>
          {t("participants.carerConsent.askFamily")}
        </Button>
      </div>
    </div>
  );
}
