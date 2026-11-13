"use client";

import * as React from "react";
import { Download, Nfc, QrCode, RefreshCw } from "lucide-react";
import { Button, Input, Label, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { assignMemberTag, getMemberCard, rotateMemberCard } from "@/lib/actions/member-cards";
import { nfcReader, type NdefReadingEvent } from "@/lib/member-cards/browser";

/**
 * Member card of one athlete: QR code (opaque token, no personal data),
 * printable PDF, rotation when a card is lost. Admins also link an NFC
 * bracelet (serial number) or write the token onto a writable tag.
 */
export function MemberCardPanel({ athleteId, pdfHref, admin = false, initialTag = null }: {
  athleteId: string; pdfHref: string; admin?: boolean; initialTag?: string | null;
}) {
  const t = useT();
  const [card, setCard] = React.useState<{ token: string; qrSvg: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [tag, setTag] = React.useState(initialTag ?? "");
  const [nfc, setNfc] = React.useState(false);
  React.useEffect(() => setNfc(nfcReader() !== null), []);

  async function show() {
    setBusy(true); setMsg(null);
    const res = await getMemberCard(athleteId);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setCard(res.data ?? null);
  }
  async function rotate() {
    if (!window.confirm(t("sports.cards.rotateConfirm"))) return;
    setBusy(true); setMsg(null);
    const res = await rotateMemberCard(athleteId);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setCard(res.data ?? null);
    setMsg({ ok: true, text: t("sports.cards.rotated") });
  }
  async function saveTag(value: string | null) {
    setBusy(true); setMsg(null);
    const res = await assignMemberTag(athleteId, value);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setTag(res.data?.tag ?? "");
    setMsg({ ok: true, text: t("sports.cards.tagSaved") });
  }
  async function readTag() {
    const reader = nfcReader();
    if (!reader) return setMsg({ ok: false, text: t("sports.cards.nfcUnsupported") });
    const ctrl = new AbortController();
    setMsg({ ok: true, text: t("sports.cards.nfcHold") });
    try {
      await reader.scan({ signal: ctrl.signal });
      reader.addEventListener("reading", (e) => {
        const serial = (e as NdefReadingEvent).serialNumber ?? "";
        ctrl.abort();
        if (serial) void saveTag(serial);
      }, { once: true });
    } catch {
      setMsg({ ok: false, text: t("sports.cards.nfcFailed") });
    }
  }
  async function writeTag() {
    const reader = nfcReader();
    if (!reader) return setMsg({ ok: false, text: t("sports.cards.nfcUnsupported") });
    let token = card?.token;
    if (!token) {
      const res = await getMemberCard(athleteId);
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setCard(res.data ?? null);
      token = res.data?.token;
    }
    if (!token) return;
    setMsg({ ok: true, text: t("sports.cards.nfcHold") });
    try {
      await reader.write({ records: [{ recordType: "text", data: token }] });
      setMsg({ ok: true, text: t("sports.cards.nfcWritten") });
    } catch {
      setMsg({ ok: false, text: t("sports.cards.nfcFailed") });
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{t("sports.cards.intro")}</p>
      {card ? (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          {/* QR markup is generated server-side by the qrcode library from the opaque token. */}
          <div className="w-44 rounded-md bg-white p-2" aria-label={t("sports.cards.qrAlt")} role="img"
            dangerouslySetInnerHTML={{ __html: card.qrSvg }} />
          <p className="text-xs text-text-muted">{t("sports.cards.qrHint")}</p>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={show} loading={busy}><QrCode className="h-4 w-4" aria-hidden /> {t("sports.cards.show")}</Button>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={pdfHref} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[12.5px] hover:border-brand-primary">
          <Download className="h-4 w-4" aria-hidden /> {t("sports.cards.print")}
        </a>
        <Button variant="ghost" size="sm" onClick={rotate} disabled={busy}><RefreshCw className="h-4 w-4" aria-hidden /> {t("sports.cards.rotate")}</Button>
      </div>
      {admin && (
        <div className="space-y-2 border-t border-border pt-4">
          <Label htmlFor={`tag-${athleteId}`}>{t("sports.cards.tagLabel")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input id={`tag-${athleteId}`} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="04:A2:2B:1C:5D:80" className="max-w-xs font-mono" maxLength={60} />
            <Button size="sm" variant="secondary" onClick={() => saveTag(tag.trim() || null)} disabled={busy}>{t("common.save")}</Button>
            {nfc && <Button size="sm" variant="outline" onClick={readTag} disabled={busy}><Nfc className="h-4 w-4" aria-hidden /> {t("sports.cards.readTag")}</Button>}
            {nfc && <Button size="sm" variant="outline" onClick={writeTag} disabled={busy}><Nfc className="h-4 w-4" aria-hidden /> {t("sports.cards.writeTag")}</Button>}
          </div>
          <FieldHint>{nfc ? t("sports.cards.tagHint") : t("sports.cards.nfcUnsupported")}</FieldHint>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
