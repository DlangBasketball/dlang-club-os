"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy, Link2, RefreshCw, XCircle } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle, Input } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { createCalendarFeed, revokeCalendarFeed } from "@/lib/actions/calendar";

/** Personal read-only calendar subscription link (ICS). The URL is shown once. */
export function FeedLink({ active }: { active: boolean }) {
  const t = useT();
  const router = useRouter();
  const [url, setUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function create() {
    setBusy(true);
    setMsg(null);
    const res = await createCalendarFeed();
    setBusy(false);
    if (res.ok && res.data) {
      setUrl(res.data.url);
      router.refresh();
    } else if (!res.ok) setMsg({ ok: false, text: res.error });
  }
  async function revoke() {
    setBusy(true);
    setMsg(null);
    const res = await revokeCalendarFeed();
    setBusy(false);
    setUrl(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    router.refresh();
  }
  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* the field stays selectable */
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-4 w-4" /> {t("staff.calendar.subscribe.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-text-muted">{t("staff.calendar.subscribe.description")}</p>
        {url ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label={t("staff.calendar.subscribe.title")} />
              <Button type="button" variant="secondary" onClick={copy}><Copy className="h-4 w-4" /> {copied ? t("staff.calendar.subscribe.copied") : t("staff.calendar.subscribe.copy")}</Button>
            </div>
            <p className="text-xs text-warning">{t("staff.calendar.subscribe.shownOnce")}</p>
          </div>
        ) : (
          <p className="text-sm text-text">{active ? t("staff.calendar.subscribe.active") : t("staff.calendar.subscribe.none")}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" loading={busy} disabled={busy} onClick={create}>
            {active ? <RefreshCw className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            {active ? t("staff.calendar.subscribe.rotate") : t("staff.calendar.subscribe.create")}
          </Button>
          {active && (
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={revoke}>
              <XCircle className="h-4 w-4" /> {t("staff.calendar.subscribe.revoke")}
            </Button>
          )}
        </div>
        {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </CardBody>
    </Card>
  );
}
