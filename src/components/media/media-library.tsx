"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImageUp, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardBody, EmptyState, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { deleteMediaAsset, updateMediaAsset, uploadMediaAssets } from "@/lib/actions/media";
import { resizeCover } from "@/lib/media/resize-cover";
import { COVER_INPUT_ACCEPT, MEDIA_KINDS, MEDIA_MAX_BATCH, type MediaKind } from "@/lib/media/cover";
import type { MediaAssetView } from "@/lib/media/server";

type Msg = { ok: boolean; text: string } | null;

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>;
}

/** Upload many images at once: each is resized in the browser (EXIF stripped) first. */
function Uploader() {
  const t = useT();
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [kind, setKind] = React.useState<MediaKind>("cover");
  const [busy, setBusy] = React.useState<null | "processing" | "uploading">(null);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = React.useState<Msg>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    if (files.length > MEDIA_MAX_BATCH) {
      setMsg({ ok: false, text: t("media.errors.tooMany", { max: MEDIA_MAX_BATCH }) });
      return;
    }
    setMsg(null);
    // One request per image: each stays well under the server-action body
    // limit (5 MB after the resize), and one bad file does not fail the batch.
    let added = 0;
    let failed = 0;
    let lastError: string | null = null;
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length });
      setBusy("processing");
      const r = await resizeCover(files[i]);
      if ("error" in r) {
        failed++;
        lastError = t.dynamic(r.error);
        continue;
      }
      const fd = new FormData();
      fd.set("kind", kind);
      fd.append("files", r.file);
      fd.set("width_0", String(r.width));
      fd.set("height_0", String(r.height));
      setBusy("uploading");
      const res = await uploadMediaAssets(fd);
      if (res.ok) added += res.data?.count ?? 1;
      else {
        failed++;
        lastError = res.error;
      }
    }
    setProgress(null);
    setBusy(null);
    if (!added) {
      setMsg({ ok: false, text: lastError ?? t("media.errors.uploadFailed") });
      return;
    }
    setMsg({
      ok: true,
      text: failed ? t("media.library.uploadedPartial", { count: added, failed }) : t("media.library.uploaded", { count: added }),
    });
    router.refresh();
  }

  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_auto] sm:items-end">
          <div>
            <Label htmlFor="media-kind">{t("media.library.kind")}</Label>
            <Select id="media-kind" value={kind} onChange={(e) => setKind(e.target.value as MediaKind)} disabled={!!busy}>
              {MEDIA_KINDS.map((k) => <option key={k} value={k}>{t(`media.kinds.${k}`)}</option>)}
            </Select>
          </div>
          <div>
            <input ref={ref} type="file" multiple accept={COVER_INPUT_ACCEPT} className="sr-only" id="media-files" onChange={onPick} disabled={!!busy} />
            <Button type="button" onClick={() => ref.current?.click()} loading={!!busy} disabled={!!busy}>
              <ImageUp className="h-4 w-4" aria-hidden />
              {busy && progress
                ? t("media.library.processing", { done: progress.done + 1, total: progress.total })
                : busy === "uploading" ? t("media.library.uploading") : t("media.library.upload")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-text-muted">{t("media.library.uploadHint", { max: MEDIA_MAX_BATCH })}</p>
        <Status msg={msg} />
      </CardBody>
    </Card>
  );
}

function AssetCard({ asset }: { asset: MediaAssetView }) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [alt, setAlt] = React.useState(asset.altText ?? "");
  const [note, setNote] = React.useState(asset.consentNote ?? "");
  const [kind, setKind] = React.useState<MediaKind>(asset.kind);
  const [busy, setBusy] = React.useState<null | "saving" | "deleting">(null);
  const [msg, setMsg] = React.useState<Msg>(null);
  const dirty = alt !== (asset.altText ?? "") || note !== (asset.consentNote ?? "") || kind !== asset.kind;
  const id = asset.id;

  async function save() {
    setBusy("saving");
    setMsg(null);
    const res = await updateMediaAsset({ id, altText: alt, consentNote: note, kind });
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("media.library.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function remove() {
    if (!window.confirm(t("media.library.confirmDelete"))) return;
    setBusy("deleting");
    setMsg(null);
    const res = await deleteMediaAsset(id);
    setBusy(null);
    if (res.ok) router.refresh();
    else setMsg({ ok: false, text: res.error });
  }

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className="relative aspect-video bg-bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element -- public library image */}
        <img src={asset.url} alt={asset.altText ?? ""} className="h-full w-full object-cover" loading="lazy" decoding="async" />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <Badge tone={asset.uses ? "brand" : "neutral"}>{asset.uses ? t("media.library.usedCount", { count: asset.uses }) : t("media.library.unused")}</Badge>
          {asset.publicUseConfirmedAt && (
            <Badge tone="success"><ShieldCheck className="h-3 w-3" aria-hidden /> {t("media.library.publicConfirmed")}</Badge>
          )}
        </div>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>{t(`media.kinds.${asset.kind}`)}{asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}</span>
          <span>{f.date(asset.createdAt)}</span>
        </div>
        <div>
          <Label htmlFor={`alt-${id}`}>{t("media.library.altLabel")}</Label>
          <Input id={`alt-${id}`} maxLength={300} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder={t("media.cover.altPlaceholder")} />
        </div>
        <div>
          <Label htmlFor={`note-${id}`}>{t("media.library.consentNote")}</Label>
          <Textarea id={`note-${id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("media.library.consentNotePlaceholder")} />
        </div>
        <div>
          <Label htmlFor={`kind-${id}`}>{t("media.library.kind")}</Label>
          <Select id={`kind-${id}`} value={kind} onChange={(e) => setKind(e.target.value as MediaKind)}>
            {MEDIA_KINDS.map((k) => <option key={k} value={k}>{t(`media.kinds.${k}`)}</option>)}
          </Select>
        </div>
        <Status msg={msg} />
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={remove}
            loading={busy === "deleting"}
            disabled={!!busy || asset.uses > 0}
            title={asset.uses > 0 ? t("media.library.inUseHint") : undefined}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> {t("common.delete")}
          </Button>
          <Button type="button" size="sm" onClick={save} loading={busy === "saving"} disabled={!dirty || !!busy}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Admin media library: upload many images, alt text, consent note, delete unused. */
export function MediaLibrary({ assets }: { assets: MediaAssetView[] }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-text">{t("media.consent.title")}</p>
          <p className="text-text-secondary">{t("media.consent.libraryNotice")}</p>
        </div>
      </div>
      <Uploader />
      {assets.length === 0 ? (
        <EmptyState icon={<ImageUp className="h-5 w-5" />} title={t("media.library.emptyTitle")} description={t("media.library.emptyText")} />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => <AssetCard key={a.id} asset={a} />)}
        </ul>
      )}
    </div>
  );
}
