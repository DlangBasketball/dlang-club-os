"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion, Send, UserPlus } from "lucide-react";
import { Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";
import { convertLeadToFamily, replyToLead, setLeadStatus, submitContactForm } from "@/lib/actions/leads";
import { LEAD_INTERESTS, LEAD_STATUSES, type LeadInterest, type LeadStatus } from "@/lib/messaging/validation";

/**
 * Public "Questions? Contact us" form (club hub, camp and training pages).
 * Captcha-free: a visually hidden honeypot field and a fill-time trap; the
 * server adds a per-IP-hash rate limit. The club is resolved on the server.
 */
export function ContactForm({
  clubSlug, defaultInterest = "other", programId, source, compact,
}: {
  clubSlug?: string | null;
  defaultInterest?: LeadInterest;
  programId?: string | null;
  source?: string;
  compact?: boolean;
}) {
  const t = useT();
  const [renderedAt, setRenderedAt] = React.useState<number | null>(null);
  React.useEffect(() => setRenderedAt(Date.now()), []);
  const [state, setState] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState(!compact);

  if (state?.ok) {
    return (
      <Card><CardBody className="py-6"><p role="status" className="text-sm text-success">{state.text}</p></CardBody></Card>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setState(null);
    const res = await submitContactForm({
      clubSlug: clubSlug ?? null,
      name: String(fd.get("name") ?? ""),
      email: String(fd.get("email") ?? ""),
      phone: String(fd.get("phone") ?? ""),
      message: String(fd.get("message") ?? ""),
      interest: String(fd.get("interest") ?? "other") as LeadInterest,
      consent: fd.get("consent") === "on",
      programId: programId ?? null,
      source: source ?? null,
      website: String(fd.get("website") ?? ""),
      renderedAt: renderedAt ?? undefined,
    } as Parameters<typeof submitContactForm>[0]);
    setBusy(false);
    setState(res.ok ? { ok: true, text: res.message ?? t("messaging.contact.thanks") } : { ok: false, text: res.error });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MessageCircleQuestion className="h-4 w-4" /> {t("messaging.contact.title")}</CardTitle>
      </CardHeader>
      <CardBody>
        {!open ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">{t("messaging.contact.intro")}</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>{t("messaging.contact.open")}</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
            <p className="text-sm text-text-muted">{t("messaging.contact.intro")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="cf-name">{t("messaging.contact.name")}</Label>
                <Input id="cf-name" name="name" autoComplete="name" maxLength={120} required />
              </div>
              <div>
                <Label htmlFor="cf-email">{t("messaging.contact.email")}</Label>
                <Input id="cf-email" name="email" type="email" autoComplete="email" maxLength={254} required />
              </div>
              <div>
                <Label htmlFor="cf-phone">{t("messaging.contact.phoneOptional")}</Label>
                <Input id="cf-phone" name="phone" type="tel" autoComplete="tel" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="cf-interest">{t("messaging.contact.interest")}</Label>
                <Select id="cf-interest" name="interest" defaultValue={defaultInterest}>
                  {LEAD_INTERESTS.map((i) => <option key={i} value={i}>{t(`messaging.leads.interest.${i}`)}</option>)}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="cf-message">{t("messaging.contact.message")}</Label>
              <Textarea id="cf-message" name="message" rows={4} minLength={5} maxLength={3000} required />
            </div>
            {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
            <div aria-hidden="true" className="absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
              <label htmlFor="cf-website">{t("messaging.contact.honeypot")}</label>
              <input id="cf-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <label className="flex items-start gap-2 text-sm text-text-secondary">
              <input type="checkbox" name="consent" required className="mt-1" />
              <span>{t("messaging.contact.consent")}</span>
            </label>
            <p className="text-xs text-text-muted">{t("messaging.contact.noChildData")}</p>
            {state && !state.ok && <p role="alert" className="text-sm text-danger">{state.text}</p>}
            <Button type="submit" loading={busy} disabled={busy}><Send className="h-4 w-4" /> {t("messaging.contact.submit")}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

/** Admin: status, reply by email, convert to family. */
export function LeadActions({ leadId, status, familyId }: { leadId: string; status: LeadStatus; familyId: string | null }) {
  const t = useT();
  const router = useRouter();
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? "" } : { ok: false, text: res.error ?? t("messaging.errors.generic") });
    if (res.ok) router.refresh();
    return res.ok;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader><CardTitle>{t("messaging.leads.replyTitle")}</CardTitle></CardHeader>
        <CardBody>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await run("reply", () => replyToLead({ leadId, body: reply }))) setReply("");
          }}>
            <Label htmlFor="lead-reply">{t("messaging.leads.replyLabel")}</Label>
            <Textarea id="lead-reply" rows={5} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} required />
            <p className="text-xs text-text-muted">{t("messaging.leads.replyHint")}</p>
            <Button type="submit" loading={busy === "reply"} disabled={busy !== null}><Send className="h-4 w-4" /> {t("messaging.leads.sendReply")}</Button>
          </form>
        </CardBody>
      </Card>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="lead-status">{t("messaging.leads.status")}</Label>
          <Select id="lead-status" defaultValue={status} disabled={busy !== null}
            onChange={(e) => run("status", () => setLeadStatus({ leadId, status: e.target.value as LeadStatus }))}>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(`messaging.leads.statuses.${s}`)}</option>)}
          </Select>
        </div>
        {familyId ? (
          <Link href={`/admin/families/${familyId}` as never} className="text-sm text-brand-primary underline-offset-4 hover:underline">{t("messaging.leads.openFamily")}</Link>
        ) : (
          <Button type="button" variant="secondary" loading={busy === "convert"} disabled={busy !== null}
            onClick={() => run("convert", () => convertLeadToFamily(leadId))}>
            <UserPlus className="h-4 w-4" /> {t("messaging.leads.convert")}
          </Button>
        )}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
