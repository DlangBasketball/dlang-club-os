"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { updateDocumentMeta, replaceDocumentFile } from "@/lib/actions/documents";
import { DOCUMENT_KINDS, DOCUMENT_SCOPES, MAX_DOCUMENT_BYTES, type DocumentScope } from "@/lib/people/validation";
import type { AdminDoc, Opt } from "@/lib/data/documents";

/** Inline editor for one document: metadata (title, type, expiry, visibility) and file replacement. */
export function DocumentEditPanel({
  doc,
  targets,
  onClose,
}: {
  doc: AdminDoc;
  targets: { programs: Opt[]; families: Opt[]; athletes: Opt[] };
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = React.useState(doc.title ?? "");
  const [kind, setKind] = React.useState<(typeof DOCUMENT_KINDS)[number]>(
    (DOCUMENT_KINDS as readonly string[]).includes(doc.kind) ? (doc.kind as (typeof DOCUMENT_KINDS)[number]) : "other",
  );
  const [expiresAt, setExpiresAt] = React.useState(doc.expiresAt ?? "");
  const [scope, setScope] = React.useState<DocumentScope>(doc.scope);
  const [targetId, setTargetId] = React.useState(doc.targetId ?? "");
  const [busy, setBusy] = React.useState<"meta" | "file" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const targetOpts = scope === "program" ? targets.programs : scope === "family" ? targets.families : scope === "athlete" ? targets.athletes : [];
  const sel = "mt-1";

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setBusy("meta");
    setMsg(null);
    const res = await updateDocumentMeta(doc.id, { title, kind, expiresAt: expiresAt || null, scope, targetId: scope === "global" ? null : targetId });
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  async function replace() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setMsg({ ok: false, text: t("editPeople.documents.chooseFile") }); return; }
    if (file.size > MAX_DOCUMENT_BYTES) { setMsg({ ok: false, text: t("editPeople.documents.tooLarge") }); return; }
    setBusy("file");
    setMsg(null);
    const fd = new FormData();
    fd.append("id", doc.id);
    fd.append("file", file);
    const res = await replaceDocumentFile(fd);
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("editPeople.documents.replaced") });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <div className="space-y-4 border-t border-line-soft bg-surface-elevated/40 px-5 py-4">
      <form onSubmit={saveMeta} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`dt-${doc.id}`}>{t("editPeople.documents.title")}</Label>
          <Input id={`dt-${doc.id}`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`dk-${doc.id}`}>{t("editPeople.documents.kind")}</Label>
          <Select id={`dk-${doc.id}`} className={sel} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{t(`editPeople.documentKind.${k}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`ds-${doc.id}`}>{t("editPeople.documents.scope")}</Label>
          <Select id={`ds-${doc.id}`} className={sel} value={scope} onChange={(e) => { setScope(e.target.value as DocumentScope); setTargetId(""); }}>
            {DOCUMENT_SCOPES.map((s) => <option key={s} value={s}>{t(`editPeople.documentScope.${s}`)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`dg-${doc.id}`}>{t("editPeople.documents.target")}</Label>
          <Select id={`dg-${doc.id}`} className={sel} value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={scope === "global"} required={scope !== "global"}>
            <option value="">{scope === "global" ? "—" : t("common.select")}</option>
            {targetOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`de-${doc.id}`}>{t("editPeople.documents.expiresAt")} ({t("editPeople.optional")})</Label>
          <Input id={`de-${doc.id}`} type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" loading={busy === "meta"} disabled={busy !== null}>{t("editPeople.saveChanges")}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>{t("editPeople.documents.close")}</Button>
        </div>
      </form>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <Label htmlFor={`df-${doc.id}`}>{t("editPeople.documents.replaceFile")}</Label>
          <input id={`df-${doc.id}`} ref={fileRef} type="file" className="mt-1 w-full text-sm text-ink" />
        </div>
        <Button type="button" size="sm" variant="secondary" loading={busy === "file"} disabled={busy !== null} onClick={replace}>{t("editPeople.documents.replace")}</Button>
      </div>
      {msg && <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
