"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Input, Label } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { hideMessage, resolveReport, saveMessagingSettings, saveNotificationPreferences } from "@/lib/actions/messaging";
import { IN_APP_LOCKED, NOTIFICATION_CATEGORIES, type NotificationCategory } from "@/lib/messaging/preferences";
import type { MessagingSettings, ReportItem } from "@/lib/messaging/data";

function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="flex items-start gap-2 text-sm text-text-secondary">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1" />
      <span>{label}{hint && <span className="block text-xs text-text-muted">{hint}</span>}</span>
    </label>
  );
}

/** Club-wide messaging rules (admins). */
export function MessagingSettingsForm({ initial }: { initial: MessagingSettings }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof MessagingSettings>(k: K, val: MessagingSettings[K]) => setV((s) => ({ ...s, [k]: val }));
  return (
    <Card>
      <CardHeader><CardTitle>{t("messaging.settings.title")}</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await saveMessagingSettings(v);
          setBusy(false);
          setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        }}>
          <Toggle checked={v.parentsCanStart} onChange={(x) => set("parentsCanStart", x)} label={t("messaging.settings.parentsCanStart")} hint={t("messaging.settings.parentsCanStartHint")} />
          <Toggle checked={v.parentRepliesInChannels} onChange={(x) => set("parentRepliesInChannels", x)} label={t("messaging.settings.parentReplies")} />
          <Toggle checked={v.readReceipts} onChange={(x) => set("readReceipts", x)} label={t("messaging.settings.readReceipts")} hint={t("messaging.settings.readReceiptsHint")} />
          <Toggle checked={v.emailNotifications} onChange={(x) => set("emailNotifications", x)} label={t("messaging.settings.emailNotifications")} hint={t("messaging.settings.emailNotificationsHint")} />
          <QuietHours start={v.quietStart} end={v.quietEnd} onChange={(s, e2) => setV((x) => ({ ...x, quietStart: s, quietEnd: e2 }))} hint={t("messaging.settings.quietHoursHint")} />
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <Button type="submit" loading={busy} disabled={busy}>{t("common.save")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function QuietHours({ start, end, onChange, hint }: { start: string | null; end: string | null; onChange: (s: string | null, e: string | null) => void; hint: string }) {
  const t = useT();
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("messaging.settings.quietHours")}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="qh-start">{t("messaging.settings.quietFrom")}</Label>
          <Input id="qh-start" type="time" value={start ?? ""} onChange={(e) => onChange(e.target.value || null, end)} className="w-32" />
        </div>
        <div>
          <Label htmlFor="qh-end">{t("messaging.settings.quietTo")}</Label>
          <Input id="qh-end" type="time" value={end ?? ""} onChange={(e) => onChange(start, e.target.value || null)} className="w-32" />
        </div>
        {(start || end) && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null, null)}>{t("messaging.settings.quietClear")}</Button>}
      </div>
      <FieldHint>{hint}</FieldHint>
    </fieldset>
  );
}

/** Per-user notification preferences (in-app / email per category + quiet hours). */
export function PreferencesForm({
  initial, categories,
}: {
  initial: { channels: Record<NotificationCategory, { in_app: boolean; email: boolean }>; quietStart: string | null; quietEnd: string | null };
  categories?: readonly NotificationCategory[];
}) {
  const t = useT();
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const shown = categories ?? NOTIFICATION_CATEGORIES;
  const setCh = (c: NotificationCategory, k: "in_app" | "email", val: boolean) =>
    setV((s) => ({ ...s, channels: { ...s.channels, [c]: { ...s.channels[c], [k]: val } } }));
  return (
    <Card>
      <CardHeader><CardTitle>{t("messaging.preferences.title")}</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-5" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const res = await saveNotificationPreferences({ channels: v.channels, quietStart: v.quietStart, quietEnd: v.quietEnd });
          setBusy(false);
          setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
        }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-text-muted">
                <th className="py-2 font-medium">{t("messaging.preferences.category")}</th>
                <th className="py-2 text-center font-medium">{t("messaging.preferences.inApp")}</th>
                <th className="py-2 text-center font-medium">{t("messaging.preferences.email")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c} className="border-b border-border last:border-0">
                  <td className="py-2.5 text-text">
                    {t(`messaging.preferences.categories.${c}`)}
                    {IN_APP_LOCKED.includes(c) && <span className="block text-xs text-text-muted">{t("messaging.preferences.inAppLocked")}</span>}
                  </td>
                  <td className="py-2.5 text-center">
                    <input type="checkbox" aria-label={`${t(`messaging.preferences.categories.${c}`)} — ${t("messaging.preferences.inApp")}`}
                      checked={v.channels[c].in_app} disabled={IN_APP_LOCKED.includes(c)} onChange={(e) => setCh(c, "in_app", e.target.checked)} />
                  </td>
                  <td className="py-2.5 text-center">
                    <input type="checkbox" aria-label={`${t(`messaging.preferences.categories.${c}`)} — ${t("messaging.preferences.email")}`}
                      checked={v.channels[c].email} onChange={(e) => setCh(c, "email", e.target.checked)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <QuietHours start={v.quietStart} end={v.quietEnd} onChange={(s, e2) => setV((x) => ({ ...x, quietStart: s, quietEnd: e2 }))} hint={t("messaging.preferences.quietHint")} />
          {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
          <Button type="submit" loading={busy} disabled={busy}>{t("common.save")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

/** Open abuse reports (admins): open the thread, hide the message, or dismiss. */
export function ReportQueue({ reports }: { reports: ReportItem[] }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!reports.length) return <div className="px-5 py-6 text-sm text-text-muted">{t("messaging.moderation.noReports")}</div>;
  return (
    <ul className="divide-y divide-border">
      {reports.map((r) => (
        <li key={r.id} className="space-y-1.5 px-4 py-3">
          <div className="text-xs text-text-muted">{f.dateTime(r.createdAt, "short")} · {r.reason}</div>
          {r.excerpt && <p className="line-clamp-2 text-sm text-text">{r.excerpt}</p>}
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/messages/${r.conversationId}` as never} className="text-xs text-brand-primary underline-offset-4 hover:underline">{t("messaging.moderation.openThread")}</Link>
            {!r.hidden && (
              <Button type="button" size="sm" variant="danger" loading={busy === r.id} disabled={busy !== null}
                onClick={async () => { setBusy(r.id); await hideMessage({ messageId: r.messageId, hidden: true, reason: r.reason }); setBusy(null); router.refresh(); }}>
                {t("messaging.moderation.hide")}
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" disabled={busy !== null}
              onClick={async () => { setBusy(r.id); await resolveReport(r.id, "dismissed"); setBusy(null); router.refresh(); }}>
              {t("messaging.moderation.dismiss")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
