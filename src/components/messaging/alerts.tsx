"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Megaphone, Siren, X } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label, Select, Textarea } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { cancelAlert, createAlert, dismissAlert } from "@/lib/actions/alerts";
import { broadcastShareText, whatsappShareUrl } from "@/lib/messaging/whatsapp";
import { ALERT_SEVERITIES, SCOPED_AUDIENCES, type AlertAudience, type AlertSeverity } from "@/lib/messaging/validation";
import type { AlertListItem, BannerAlert, ScopeOption } from "@/lib/messaging/data";

const TONE: Record<AlertSeverity, string> = {
  info: "border-info/30 bg-info-soft",
  warning: "border-warning/30 bg-warning-soft",
  urgent: "border-danger/40 bg-danger-soft",
};
const ICON = { info: Info, warning: AlertTriangle, urgent: Siren } as const;

/** Live alerts for the signed-in user, shown above every page of the app. */
export function AlertBanner({ alerts }: { alerts: BannerAlert[] }) {
  const t = useT();
  const router = useRouter();
  const [hidden, setHidden] = React.useState<string[]>([]);
  const visible = alerts.filter((a) => !hidden.includes(a.id));
  if (!visible.length) return null;
  return (
    <div className="mb-4 space-y-2" aria-label={t("messaging.alerts.bannerLabel")}>
      {visible.map((a) => {
        const Icon = ICON[a.severity];
        return (
          <div key={a.id} role={a.severity === "urgent" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border p-3 text-sm text-text", TONE[a.severity])}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{a.title}</div>
              {a.body && <p className="mt-0.5 whitespace-pre-wrap text-text-secondary">{a.body}</p>}
            </div>
            <button type="button" aria-label={t("messaging.alerts.dismiss")}
              onClick={async () => {
                setHidden((h) => [...h, a.id]);
                await dismissAlert(a.id);
                router.refresh();
              }}
              className="touch-target -m-1 rounded p-1 text-text-muted hover:text-text focus-visible:outline-none focus-visible:shadow-focus">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Create an alert: admins for any audience, coaches for their teams / programmes / camps. */
export function AlertForm({ scopes, isAdmin }: { scopes: ScopeOption[]; isAdmin: boolean }) {
  const t = useT();
  const router = useRouter();
  const audiences: AlertAudience[] = isAdmin ? ["all", "staff", "parents", "team", "program", "camp_edition"] : ["team", "program", "camp_edition"];
  const available = audiences.filter((a) => !SCOPED_AUDIENCES.includes(a) || scopes.some((s) => s.scope === a));
  const [audience, setAudience] = React.useState<AlertAudience>(available[0] ?? "all");
  const [scopeId, setScopeId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [severity, setSeverity] = React.useState<AlertSeverity>("info");
  const [when, setWhen] = React.useState<"now" | "later">("now");
  const [startsAt, setStartsAt] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [alsoEmail, setAlsoEmail] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  if (!available.length) return <p className="text-sm text-text-muted">{t("messaging.compose.noScopes")}</p>;
  const scoped = SCOPED_AUDIENCES.includes(audience);
  const options = scopes.filter((s) => s.scope === audience);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await createAlert({
      title, body, severity, audience,
      scopeId: scoped ? scopeId || options[0]?.id || null : null,
      startsAt: when === "later" ? startsAt : null,
      expiresAt: expiresAt || null,
      alsoEmail,
    });
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    if (res.ok) {
      setTitle("");
      setBody("");
      router.refresh();
    }
  }

  const share = title.trim() ? whatsappShareUrl(broadcastShareText({ title, body })) : null;

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Megaphone className="h-4 w-4" /> {t("messaging.alerts.new")}</CardTitle></CardHeader>
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="al-aud">{t("messaging.alerts.audience")}</Label>
              <Select id="al-aud" value={audience} onChange={(e) => { setAudience(e.target.value as AlertAudience); setScopeId(""); }}>
                {available.map((a) => <option key={a} value={a}>{t(`messaging.alerts.audiences.${a}`)}</option>)}
              </Select>
            </div>
            {scoped && (
              <div>
                <Label htmlFor="al-scope">{t(`messaging.scope.${audience as "team" | "program" | "camp_edition"}`)}</Label>
                <Select id="al-scope" value={scopeId || options[0]?.id || ""} onChange={(e) => setScopeId(e.target.value)}>
                  {options.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="al-sev">{t("messaging.alerts.severityLabel")}</Label>
              <Select id="al-sev" value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>
                {ALERT_SEVERITIES.map((s) => <option key={s} value={s}>{t(`messaging.alerts.severity.${s}`)}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="al-title">{t("messaging.alerts.title")}</Label>
            <Input id="al-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required />
          </div>
          <div>
            <Label htmlFor="al-body">{t("messaging.alerts.body")}</Label>
            <Textarea id="al-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">{t("messaging.alerts.schedule")}</legend>
            <div>
              <Label htmlFor="al-when">{t("messaging.alerts.schedule")}</Label>
              <Select id="al-when" value={when} onChange={(e) => setWhen(e.target.value as "now" | "later")}>
                <option value="now">{t("messaging.alerts.sendNow")}</option>
                <option value="later">{t("messaging.alerts.sendLater")}</option>
              </Select>
            </div>
            {when === "later" && (
              <div>
                <Label htmlFor="al-start">{t("messaging.alerts.startsAt")}</Label>
                <Input id="al-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
              </div>
            )}
            <div>
              <Label htmlFor="al-exp">{t("messaging.alerts.expiresAt")}</Label>
              <Input id="al-exp" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              <FieldHint>{t("messaging.alerts.expiresHint")}</FieldHint>
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={alsoEmail} onChange={(e) => setAlsoEmail(e.target.checked)} />
            {t("messaging.alerts.alsoEmail")}
          </label>
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={busy} disabled={busy}>{when === "now" ? t("messaging.alerts.sendNow") : t("messaging.alerts.scheduleButton")}</Button>
            {share && (
              <a href={share} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-primary underline-offset-4 hover:underline">
                {t("messaging.whatsapp.share")}
              </a>
            )}
          </div>
          <p className="text-xs text-text-muted">{t("messaging.whatsapp.hint")}</p>
        </form>
      </CardBody>
    </Card>
  );
}

export function AlertList({ alerts }: { alerts: AlertListItem[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const now = Date.now();
  if (!alerts.length) return <div className="px-5 py-8 text-center text-sm text-text-muted">{t("messaging.alerts.none")}</div>;
  return (
    <>
      {err && <p role="alert" className="px-4 pt-3 text-xs text-danger">{err}</p>}
      <ul className="divide-y divide-border">
        {alerts.map((a) => {
          const state = a.cancelled_at ? "cancelled" : new Date(a.starts_at).getTime() > now ? "scheduled" : a.expires_at && new Date(a.expires_at).getTime() <= now ? "expired" : "live";
          return (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-text">{a.title}</span>
                  <Badge tone={a.severity === "urgent" ? "danger" : a.severity === "warning" ? "warning" : "info"}>{t(`messaging.alerts.severity.${a.severity}`)}</Badge>
                  <Badge tone={state === "live" ? "success" : "neutral"}>{t(`messaging.alerts.state.${state}`)}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  {t(`messaging.alerts.audiences.${a.audience}`)}{a.scopeLabel ? ` · ${a.scopeLabel}` : ""} · {f.dateTime(a.starts_at, "short")}
                  {a.expires_at ? ` → ${f.dateTime(a.expires_at, "short")}` : ""}
                </div>
              </div>
              {state !== "cancelled" && state !== "expired" && (
                <Button type="button" size="sm" variant="ghost" loading={busy === a.id} disabled={busy !== null}
                  onClick={async () => {
                    setBusy(a.id);
                    setErr(null);
                    const res = await cancelAlert(a.id);
                    setBusy(null);
                    if (!res.ok) setErr(res.error);
                    router.refresh();
                  }}>
                  {t("messaging.alerts.cancel")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
