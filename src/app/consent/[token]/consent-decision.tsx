"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { acceptGuardianConsent, declineGuardianConsent } from "@/lib/actions/public-entry";

type Form = { key: string; title: string; version: number; required: boolean; body: string | null };

/** Accept (forms ticked; required ones mandatory) or decline, as the signed-in guardian. */
export function ConsentDecision({ token, forms, signedInAs }: { token: string; forms: Form[]; signedInAs: string }) {
  const t = useT();
  const router = useRouter();
  const [keys, setKeys] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState<"accept" | "decline" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const missing = forms.some((f) => f.required && !keys.includes(f.key));
  const toggle = (k: string) => setKeys((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  async function accept() {
    setBusy("accept"); setMsg(null);
    const res = await acceptGuardianConsent(token, keys);
    setBusy(null);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) router.refresh();
  }
  async function decline() {
    if (!window.confirm(t("consentRequest.page.declineConfirm"))) return;
    setBusy("decline"); setMsg(null);
    const res = await declineGuardianConsent(token);
    setBusy(null);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">{t("consentRequest.page.signedInAs", { email: signedInAs })}</p>
      {forms.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-text">{t("consentRequest.page.forms")}</legend>
          {forms.map((f) => (
            <div key={f.key} className="rounded-md border border-border p-3">
              <label className="flex cursor-pointer items-start gap-2 text-sm text-text">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={keys.includes(f.key)} onChange={() => toggle(f.key)} />
                <span className="flex-1">
                  <span className="font-medium">{f.title}</span>{" "}
                  <Badge tone={f.required ? "warning" : "neutral"}>{f.required ? t("consentRequest.page.required") : t("consentRequest.page.optional")}</Badge>
                </span>
              </label>
              {f.body && (
                <details className="mt-2 text-xs text-text-muted">
                  <summary className="cursor-pointer">{t("consentRequest.page.readForm")}</summary>
                  <p className="mt-1 whitespace-pre-wrap">{f.body}</p>
                </details>
              )}
            </div>
          ))}
        </fieldset>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void accept()} loading={busy === "accept"} disabled={missing || busy !== null}>
          {t("consentRequest.page.accept")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => void decline()} loading={busy === "decline"} disabled={busy !== null}>
          {t("consentRequest.page.decline")}
        </Button>
      </div>
      {missing && <p className="text-xs text-text-muted">{t("consentRequest.page.requiredHint")}</p>}
    </div>
  );
}

/** Decline without an account (the link is the credential). */
export function DeclineOnly({ token }: { token: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function decline() {
    if (!window.confirm(t("consentRequest.page.declineConfirm"))) return;
    setBusy(true);
    const res = await declineGuardianConsent(token);
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? "" : res.error });
    if (res.ok) router.refresh();
  }
  return (
    <div className="space-y-2">
      <Button type="button" variant="ghost" size="sm" loading={busy} onClick={() => void decline()}>{t("consentRequest.page.decline")}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
