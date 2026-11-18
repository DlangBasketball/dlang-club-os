"use client";

import * as React from "react";
import { Download, FilePen, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/components/ui";
import { FieldHint, Label, Select, Textarea } from "@/components/ui/input";
import { useFormat, useT } from "@/lib/i18n/client";
import { generateFamilyExport, requestCorrection, requestErasure, setFamilyConsent } from "@/lib/actions/privacy-self-service";
import type { PrivacyPanel } from "@/lib/family/data";
import { StatusLine, useFamilyAction } from "./use-family-action";

function ExportCard() {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  const [links, setLinks] = React.useState<{ jsonUrl: string; htmlUrl: string; expiresAt: string } | null>(null);
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Download aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.privacy.export.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3 text-sm text-text-secondary">
        <p>{t("family.privacy.export.intro")}</p>
        <Button onClick={() => run(() => generateFamilyExport(), (r) => setLinks(r.data ?? null))} loading={busy} disabled={busy}>
          {t("family.privacy.export.button")}
        </Button>
        {links && (
          <div className="space-y-1.5 rounded-md border border-border bg-surface p-3">
            <a className="block text-brand-primary underline-offset-4 hover:underline" href={links.htmlUrl} rel="noopener noreferrer" target="_blank">{t("family.privacy.export.html")}</a>
            <a className="block text-brand-primary underline-offset-4 hover:underline" href={links.jsonUrl} rel="noopener noreferrer" target="_blank">{t("family.privacy.export.json")}</a>
            <p className="text-xs text-text-muted">{t("family.privacy.export.expires", { time: f.dateTime(links.expiresAt) })}</p>
          </div>
        )}
        <StatusLine msg={msg} />
      </CardBody>
    </Card>
  );
}

function ConsentsCard({ panel }: { panel: PrivacyPanel }) {
  const t = useT();
  const f = useFormat();
  const { busy, msg, run } = useFamilyAction();
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><ShieldCheck aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.privacy.consents.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-4 text-sm">
        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("family.privacy.consents.media")}</h3>
          <p className="text-xs text-text-muted">{t("family.privacy.consents.mediaHint")}</p>
          {panel.children.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
              <span className="text-text">{c.name}
                <span className="block text-xs text-text-muted">
                  {c.media === null ? t("family.privacy.consents.notDecided") : t(c.media ? "family.privacy.consents.givenOn" : "family.privacy.consents.withdrawnOn", { date: f.date(c.mediaAt ?? "") })}
                </span>
              </span>
              <input type="checkbox" checked={c.media === true} disabled={busy}
                aria-label={t("family.privacy.consents.mediaFor", { name: c.name })}
                onChange={(e) => run(() => setFamilyConsent({ kind: "media", athleteId: c.id, granted: e.target.checked }))} />
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("family.privacy.consents.marketing")}</h3>
          <label className="flex items-center justify-between gap-3">
            <span className="text-text-secondary">{t("family.privacy.consents.marketingHint")}</span>
            <input type="checkbox" checked={panel.marketing === true} disabled={busy}
              aria-label={t("family.privacy.consents.marketing")}
              onChange={(e) => run(() => setFamilyConsent({ kind: "marketing", granted: e.target.checked }))} />
          </label>
        </div>
        <StatusLine msg={msg} />
        {panel.history.length > 0 && (
          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer text-text-secondary">{t("family.privacy.consents.history")}</summary>
            <ul className="mt-2 space-y-1">
              {panel.history.map((h, i) => (
                <li key={i}>
                  {f.dateTime(h.at)} · {t(`family.privacy.consents.kinds.${h.kind}`)}{h.childName ? ` · ${h.childName}` : ""} · {t(h.granted ? "family.privacy.consents.given" : "family.privacy.consents.withdrawn")}
                  {h.byMe ? ` · ${t("family.guardians.you")}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardBody>
    </Card>
  );
}

function CorrectionCard({ panel }: { panel: PrivacyPanel }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [details, setDetails] = React.useState("");
  const [athleteId, setAthleteId] = React.useState("");
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><FilePen aria-hidden className="h-4 w-4 text-brand-primary" /><CardTitle>{t("family.privacy.correction.title")}</CardTitle></CardHeader>
      <CardBody>
        <form className="space-y-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => requestCorrection({ details, athleteId: athleteId || null }))) setDetails("");
        }}>
          <div>
            <Label htmlFor="corr-about">{t("family.privacy.correction.about")}</Label>
            <Select id="corr-about" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
              <option value="">{t("family.privacy.correction.aboutFamily")}</option>
              {panel.children.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="corr-details">{t("family.privacy.correction.details")}</Label>
            <Textarea id="corr-details" required minLength={5} maxLength={2000} rows={4} value={details} onChange={(e) => setDetails(e.target.value)} />
            <FieldHint>{t("family.privacy.correction.hint")}</FieldHint>
          </div>
          <StatusLine msg={msg} />
          <Button type="submit" variant="secondary" loading={busy} disabled={busy}>{t("family.privacy.correction.send")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ErasureCard({ panel }: { panel: PrivacyPanel }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  const [reason, setReason] = React.useState("");
  const [confirm, setConfirm] = React.useState(false);
  return (
    <Card>
      <CardHeader className="flex items-center gap-2"><Trash2 aria-hidden className="h-4 w-4 text-danger" /><CardTitle>{t("family.privacy.erasure.title")}</CardTitle></CardHeader>
      <CardBody className="space-y-3 text-sm text-text-secondary">
        <p>{t("family.privacy.erasure.intro")}</p>
        <p className="text-xs text-text-muted">{t("family.privacy.erasure.retention")}</p>
        {panel.erasurePending ? (
          <Badge tone="warning">{t("family.privacy.erasure.pending")}</Badge>
        ) : (
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            await run(() => requestErasure({ reason, confirm }));
          }}>
            <div>
              <Label htmlFor="erase-reason">{t("family.privacy.erasure.reason")}</Label>
              <Textarea id="erase-reason" maxLength={1000} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              <span>{t("family.privacy.erasure.confirm")}</span>
            </label>
            <StatusLine msg={msg} />
            <Button type="submit" variant="danger" loading={busy} disabled={busy || !confirm}>{t("family.privacy.erasure.send")}</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function RequestsCard({ panel }: { panel: PrivacyPanel }) {
  const t = useT();
  const f = useFormat();
  if (!panel.requests.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>{t("family.privacy.requests.title")}</CardTitle></CardHeader>
      <CardBody>
        <ul className="space-y-2 text-sm">
          {panel.requests.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0">
              <span className="text-text">{t.dynamic(`family.privacy.requests.types.${r.type}`, {}, r.type)} <span className="text-xs text-text-muted">· {f.date(r.receivedAt)}</span></span>
              <span className="flex items-center gap-2">
                {r.dueAt && !["completed", "rejected", "withdrawn"].includes(r.status) && <span className="text-xs text-text-muted">{t("family.privacy.requests.due", { date: f.date(r.dueAt) })}</span>}
                <Badge tone={r.status === "completed" ? "success" : r.status === "rejected" ? "danger" : "info"}>{t.dynamic(`family.privacy.requests.status.${r.status}`, {}, r.status)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Parent app "Privacy & data": export, consents, correction, erasure, request history. */
export function PrivacyPanelView({ panel }: { panel: PrivacyPanel }) {
  return (
    <div className="space-y-5">
      <ExportCard />
      <ConsentsCard panel={panel} />
      <CorrectionCard panel={panel} />
      <ErasureCard panel={panel} />
      <RequestsCard panel={panel} />
    </div>
  );
}
