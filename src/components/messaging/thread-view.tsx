"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BellOff, Bell, Check, EyeOff, Eye, Flag, Lock, LockOpen, Paperclip, Send, ShieldAlert } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { Textarea } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { hideMessage, reportMessage, sendMessage, setThreadMuted, setThreadStatus } from "@/lib/actions/messaging";
import { broadcastShareText, whatsappShareUrl } from "@/lib/messaging/whatsapp";
import { ATTACHMENT_MAX_BYTES } from "@/lib/messaging/validation";
import type { ThreadView as Thread } from "@/lib/messaging/data";
import { AutoRefresh } from "./auto-refresh";

type Props = {
  thread: Thread;
  meId: string;
  isAdmin: boolean;
  /** Admin, or the coach of a channel: may close / reopen. */
  canClose: boolean;
  /** Staff see the WhatsApp share link on channels. */
  isStaff: boolean;
};

export function ThreadView({ thread, meId, isAdmin, canClose, isStaff }: Props) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const names = React.useMemo(() => new Map(thread.people.map((p) => [p.profile_id, p])), [thread.people]);
  const endRef = React.useRef<HTMLDivElement>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [origin, setOrigin] = React.useState<string | null>(null);
  React.useEffect(() => setOrigin(window.location.origin), []);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  async function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error ?? t("messaging.errors.generic") });
    if (res.ok) router.refresh();
  }

  const lastStaffPost = [...thread.messages].reverse().find((m) => !m.hiddenAt && names.get(m.senderId ?? "")?.side === "staff");
  const shareUrl =
    isStaff && thread.kind === "channel" && lastStaffPost
      ? whatsappShareUrl(broadcastShareText({ title: thread.subject, body: lastStaffPost.body, link: origin }))
      : null;
  const otherReaders = thread.people.filter((p) => p.profile_id !== meId && p.is_participant && p.last_read_at);
  const lastMine = [...thread.messages].reverse().find((m) => m.mine);
  const seen = thread.readReceipts && lastMine ? otherReaders.some((p) => (p.last_read_at ?? "") >= lastMine.createdAt) : false;

  return (
    <div className="space-y-4">
      <AutoRefresh />
      <div className="flex flex-wrap items-center gap-2">
        {thread.kind === "channel" && <Badge tone="info">{t("messaging.inbox.channel")}</Badge>}
        {thread.office && <Badge tone="accent">{t("messaging.inbox.office")}</Badge>}
        {thread.status === "closed" && <Badge tone="neutral"><Lock className="h-3 w-3" aria-hidden /> {t("messaging.thread.closed")}</Badge>}
        {thread.sensitive && <Badge tone="neutral">{t("messaging.thread.sensitive")}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {shareUrl && (
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-primary underline-offset-4 hover:underline">
              {t("messaging.whatsapp.share")}
            </a>
          )}
          {thread.isMember && thread.kind === "direct" && (
            <MuteButton conversationId={thread.id} initial={thread.muted} />
          )}
          {canClose && (
            <Button type="button" size="sm" variant="secondary" disabled={busy}
              onClick={() => run(() => setThreadStatus(thread.id, thread.status === "open" ? "closed" : "open"))}>
              {thread.status === "open" ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
              {thread.status === "open" ? t("messaging.thread.close") : t("messaging.thread.reopen")}
            </Button>
          )}
        </div>
      </div>

      {(thread.familyName || thread.kind === "direct") && (
        <p className="flex items-start gap-2 rounded-md border border-border bg-surface p-3 text-xs text-text-muted">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" aria-hidden />
          <span>{t("messaging.safeguarding.oversight")} {t("messaging.safeguarding.privacy")}</span>
        </p>
      )}

      <Card className="p-0">
        <ol className="max-h-[60vh] space-y-3 overflow-y-auto p-4" aria-live="polite">
          {thread.messages.map((m) => {
            const who = m.senderId ? names.get(m.senderId) : undefined;
            const name = m.mine ? t("messaging.thread.you") : who?.display_name ?? t("messaging.common.someone");
            return (
              <li key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
                  m.mine ? "border-brand-primary/30 bg-brand-primary-soft" : "border-border bg-surface",
                  m.hiddenAt && "opacity-60",
                )}>
                  <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
                    <span className="font-medium text-text-secondary">{name}</span>
                    {who && !m.mine && <span>{who.side === "staff" ? t("messaging.thread.staff") : t("messaging.thread.family")}</span>}
                    <time dateTime={m.createdAt}>{f.dateTime(m.createdAt, "short")}</time>
                    {m.openReports > 0 && <Badge tone="danger">{t("messaging.moderation.reported", { count: m.openReports })}</Badge>}
                  </div>
                  {m.hiddenAt && (
                    <div className="mb-1 text-[11px] italic text-text-muted">
                      {t("messaging.moderation.hiddenNote")}{m.hiddenReason ? ` — ${m.hiddenReason}` : ""}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap break-words text-text">{m.body}</p>
                  {m.attachments.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {m.attachments.map((a) => (
                        <li key={a.id} className="flex items-center gap-1.5 text-xs">
                          <Paperclip className="h-3.5 w-3.5 text-text-subtle" aria-hidden />
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-brand-primary underline-offset-4 hover:underline">{a.name}</a>
                          ) : (
                            <span className="text-text-muted">{a.name}</span>
                          )}
                          <span className="text-text-subtle">{f.number(Math.max(1, Math.round(a.size / 1024)))} KB</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-1 flex justify-end gap-3">
                    {!m.mine && !m.hiddenAt && <ReportButton messageId={m.id} />}
                    {isAdmin && (
                      <button type="button" disabled={busy}
                        onClick={() => run(() => hideMessage({ messageId: m.id, hidden: !m.hiddenAt, reason: null }))}
                        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text focus-visible:outline-none focus-visible:shadow-focus">
                        {m.hiddenAt ? <Eye className="h-3 w-3" aria-hidden /> : <EyeOff className="h-3 w-3" aria-hidden />}
                        {m.hiddenAt ? t("messaging.moderation.unhide") : t("messaging.moderation.hide")}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          {seen && (
            <li className="flex justify-end text-[11px] text-text-muted">
              <Check className="mr-1 h-3 w-3" aria-hidden /> {t("messaging.thread.seen")}
            </li>
          )}
          <div ref={endRef} />
        </ol>
      </Card>

      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</p>}

      {thread.canPost ? (
        <Composer conversationId={thread.id} onSent={() => router.refresh()} />
      ) : (
        <p className="rounded-md border border-border bg-surface p-3 text-sm text-text-muted">
          {thread.status === "closed" ? t("messaging.thread.closedNote") : t("messaging.thread.readOnly")}
        </p>
      )}
    </div>
  );
}

function Composer({ conversationId, onSent }: { conversationId: string; onSent: () => void }) {
  const t = useT();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (file instanceof File && file.size > ATTACHMENT_MAX_BYTES) {
      setErr(t("messaging.errors.fileTooLarge"));
      return;
    }
    setBusy(true);
    setErr(null);
    fd.set("conversationId", conversationId);
    const res = await sendMessage(fd);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    formRef.current?.reset();
    setFileName(null);
    onSent();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-2">
      <label htmlFor="msg-body" className="sr-only">{t("messaging.thread.messageLabel")}</label>
      <Textarea id="msg-body" name="body" rows={3} maxLength={5000} placeholder={t("messaging.thread.placeholder")}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
        }} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-text">
          <Paperclip className="h-4 w-4" aria-hidden />
          <span>{fileName ?? t("messaging.thread.attach")}</span>
          <input type="file" name="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
        </label>
        <Button type="submit" size="sm" loading={busy} disabled={busy}>
          <Send className="h-4 w-4" /> {t("messaging.thread.send")}
        </Button>
      </div>
      <p className="text-[11px] text-text-subtle">{t("messaging.thread.attachHint")}</p>
      {err && <p role="alert" className="text-xs text-danger">{err}</p>}
    </form>
  );
}

function ReportButton({ messageId }: { messageId: string }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [state, setState] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (state?.ok) return <span role="status" className="text-[11px] text-success">{state.text}</span>;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-danger focus-visible:outline-none focus-visible:shadow-focus">
        <Flag className="h-3 w-3" aria-hidden /> {t("messaging.moderation.report")}
      </button>
    );
  }
  return (
    <form className="flex w-full flex-col gap-1" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const res = await reportMessage({ messageId, reason });
      setBusy(false);
      setState(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error });
    }}>
      <label className="text-[11px] text-text-muted" htmlFor={`r-${messageId}`}>{t("messaging.moderation.reportReason")}</label>
      <Textarea id={`r-${messageId}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className="min-h-[56px] text-xs" />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
        <Button type="submit" size="sm" variant="danger" loading={busy} disabled={busy}>{t("messaging.moderation.sendReport")}</Button>
      </div>
      {state && !state.ok && <span role="alert" className="text-[11px] text-danger">{state.text}</span>}
    </form>
  );
}

function MuteButton({ conversationId, initial }: { conversationId: string; initial: boolean }) {
  const t = useT();
  const router = useRouter();
  const [muted, setMuted] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  return (
    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={async () => {
      setBusy(true);
      const res = await setThreadMuted(conversationId, !muted);
      setBusy(false);
      if (res.ok) {
        setMuted(!muted);
        router.refresh();
      }
    }}>
      {muted ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
      {muted ? t("messaging.thread.unmute") : t("messaging.thread.mute")}
    </Button>
  );
}
