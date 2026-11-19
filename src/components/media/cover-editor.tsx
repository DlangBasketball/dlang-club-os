"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Crosshair, ImageUp, Images, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { listCoverLibrary, setCover, type CoverLibraryItem } from "@/lib/actions/media";
import { resizeCover } from "@/lib/media/resize-cover";
import {
  COVER_INPUT_ACCEPT,
  checkCoverFile,
  coverFormData,
  focalFromPoint,
  isPublicCoverTarget,
  nudgeFocal,
  objectPosition,
  type CoverTarget,
  type CoverView,
  type Focal,
} from "@/lib/media/cover";

type Pending = { kind: "upload"; file: File; previewUrl: string; width: number; height: number } | { kind: "asset"; item: CoverLibraryItem };

/**
 * "Edit cover" dialog: upload a new image (resized in the browser, EXIF
 * stripped), or choose one from the club library; click the preview to set
 * the focal point; remove the cover. On a public surface a new image needs
 * the explicit consent confirmation (CLAUDE.md section 8).
 */
export function CoverEditorDialog({
  open,
  onClose,
  target,
  id,
  canUseLibrary,
  publicSurface,
  current,
}: {
  open: boolean;
  onClose: () => void;
  target: CoverTarget;
  id: string;
  canUseLibrary: boolean;
  publicSurface?: boolean;
  current: CoverView | null;
}) {
  const t = useT();
  const router = useRouter();
  const ref = React.useRef<HTMLDialogElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const isPublic = publicSurface ?? isPublicCoverTarget(target);
  const allowLibrary = canUseLibrary;

  const [tab, setTab] = React.useState<"upload" | "library">("upload");
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [focal, setFocal] = React.useState<Focal>({ x: current?.focalX ?? 50, y: current?.focalY ?? 50 });
  const [consent, setConsent] = React.useState(false);
  const [alt, setAlt] = React.useState("");
  const [busy, setBusy] = React.useState<null | "processing" | "saving" | "removing">(null);
  const [error, setError] = React.useState<string | null>(null);
  const [library, setLibrary] = React.useState<CoverLibraryItem[] | null>(null);
  const [libraryError, setLibraryError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  // Revoke the local preview URL when it changes / on close.
  React.useEffect(() => {
    const url = pending?.kind === "upload" ? pending.previewUrl : null;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [pending]);

  React.useEffect(() => {
    if (tab !== "library" || library !== null || !allowLibrary) return;
    let alive = true;
    listCoverLibrary().then((res) => {
      if (!alive) return;
      if (res.ok) setLibrary(res.data ?? []);
      else {
        setLibrary([]);
        setLibraryError(res.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [tab, library, allowLibrary]);

  function close() {
    // The <dialog> "close" event calls onClose.
    if (ref.current?.open) ref.current.close();
    else onClose();
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setError(null);
    setBusy("processing");
    const resized = await resizeCover(picked);
    setBusy(null);
    if ("error" in resized) {
      setError(t.dynamic(resized.error));
      return;
    }
    const bad = checkCoverFile(resized.file);
    if (bad) {
      setError(t.dynamic(bad));
      return;
    }
    setPending({ kind: "upload", file: resized.file, previewUrl: URL.createObjectURL(resized.file), width: resized.width, height: resized.height });
    setFocal({ x: 50, y: 50 });
    setConsent(false);
  }

  const previewUrl = pending?.kind === "upload" ? pending.previewUrl : pending?.kind === "asset" ? pending.item.url : current?.url ?? null;
  const isNewImage = !!pending;
  const needsConsent = isPublic && isNewImage;
  const focalChanged = focal.x !== (current?.focalX ?? 50) || focal.y !== (current?.focalY ?? 50);
  const canSave = !busy && (isNewImage || (!!current?.path && focalChanged)) && (!needsConsent || consent);

  async function save() {
    if (!canSave) return;
    setBusy("saving");
    setError(null);
    const fd =
      pending?.kind === "upload"
        ? coverFormData({ target, id, mode: "upload", focalX: focal.x, focalY: focal.y, publicConsent: consent, alt: alt.trim() || undefined, width: pending.width, height: pending.height, file: pending.file })
        : pending?.kind === "asset"
          ? coverFormData({ target, id, mode: "asset", assetId: pending.item.id, focalX: focal.x, focalY: focal.y, publicConsent: consent })
          : coverFormData({ target, id, mode: "focal", focalX: focal.x, focalY: focal.y });
    const res = await setCover(fd);
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(t("media.cover.confirmRemove"))) return;
    setBusy("removing");
    setError(null);
    const res = await setCover(coverFormData({ target, id, mode: "remove" }));
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    close();
    router.refresh();
  }

  function onPreviewClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (!previewUrl) return;
    setFocal(focalFromPoint(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY));
  }
  function onPreviewKey(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    setFocal((f) => nudgeFocal(f, e.key));
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      className="w-[min(40rem,calc(100vw-1rem))] rounded-lg border border-border bg-surface p-0 text-text shadow-lg backdrop:bg-black/60"
    >
      <div className="max-h-[calc(100dvh-2rem)] space-y-4 overflow-y-auto p-4 sm:p-5">
        <div>
          <h2 id={titleId} className="font-display text-lg text-text">{t("media.cover.dialogTitle")}</h2>
          <p className="mt-0.5 text-xs text-text-muted">{t("media.cover.dialogHint")}</p>
        </div>

        {/* Preview + focal point */}
        <div>
          <button
            type="button"
            onClick={onPreviewClick}
            onKeyDown={onPreviewKey}
            disabled={!previewUrl}
            aria-label={t("media.cover.focalAria", { x: focal.x, y: focal.y })}
            className={cn(
              "relative block aspect-[16/7] w-full overflow-hidden rounded-md border border-border bg-cover-fallback",
              previewUrl ? "cursor-crosshair" : "cursor-default",
            )}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview / library URL
              <img src={previewUrl} alt="" className="h-full w-full object-cover" style={{ objectPosition: objectPosition(focal.x, focal.y) }} />
            ) : (
              <span className="absolute inset-0 bg-cover-pattern" aria-hidden />
            )}
            {previewUrl && (
              <span
                aria-hidden
                className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cover-text bg-cover-chip shadow-md"
                style={{ left: `${focal.x}%`, top: `${focal.y}%` }}
              />
            )}
          </button>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
            <Crosshair className="h-3.5 w-3.5" aria-hidden />
            {previewUrl ? t("media.cover.focalHint") : t("media.cover.noImageYet")}
          </p>
        </div>

        {/* Source tabs */}
        {allowLibrary && (
          <div role="tablist" aria-label={t("media.cover.sourceLabel")} className="flex gap-1 rounded-md border border-border bg-bg-secondary p-1">
            {(["upload", "library"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "flex min-h-tap flex-1 items-center justify-center gap-1.5 rounded px-3 text-sm transition sm:min-h-0 sm:py-1.5",
                  tab === k ? "bg-surface text-text shadow-sm" : "text-text-muted hover:text-text",
                )}
              >
                {k === "upload" ? <ImageUp className="h-4 w-4" aria-hidden /> : <Images className="h-4 w-4" aria-hidden />}
                {k === "upload" ? t("media.cover.tabUpload") : t("media.cover.tabLibrary")}
              </button>
            ))}
          </div>
        )}

        {tab === "upload" || !allowLibrary ? (
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept={COVER_INPUT_ACCEPT} className="sr-only" onChange={onPick} disabled={!!busy} id={`${titleId}-file`} />
            <Button type="button" variant="secondary" size="sm" loading={busy === "processing"} disabled={!!busy} onClick={() => fileRef.current?.click()}>
              <ImageUp className="h-4 w-4" aria-hidden />
              {busy === "processing" ? t("media.cover.processing") : t("media.cover.chooseFile")}
            </Button>
            <p className="text-xs text-text-muted">{t("media.cover.uploadHint")}</p>
            {pending?.kind === "upload" && target !== "athlete" && (
              <div>
                <Label htmlFor={`${titleId}-alt`}>{t("media.cover.altLabel")}</Label>
                <Input id={`${titleId}-alt`} maxLength={300} value={alt} onChange={(e) => setAlt(e.target.value)} placeholder={t("media.cover.altPlaceholder")} />
              </div>
            )}
          </div>
        ) : (
          <div>
            {library === null ? (
              <p className="text-sm text-text-muted">{t("media.cover.libraryLoading")}</p>
            ) : library.length === 0 ? (
              <p className="text-sm text-text-muted">{libraryError ?? t("media.cover.libraryEmpty")}</p>
            ) : (
              <ul className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                {library.map((item) => {
                  const selected = pending?.kind === "asset" && pending.item.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => {
                          setPending({ kind: "asset", item });
                          setFocal({ x: 50, y: 50 });
                          setConsent(false);
                        }}
                        className={cn(
                          "block aspect-video w-full overflow-hidden rounded border-2 transition",
                          selected ? "border-brand-primary" : "border-transparent hover:border-border-strong",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- public library thumbnail */}
                        <img src={item.url} alt={item.alt ?? ""} className="h-full w-full object-cover" loading="lazy" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Consent (public surfaces) / privacy (athlete) */}
        {isPublic ? (
          <div className="rounded-md border border-warning/40 bg-warning-soft p-3">
            <p className="flex items-start gap-2 text-xs text-text">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              {t("media.consent.publicNotice")}
            </p>
            {isNewImage && (
              <label className="mt-2 flex items-start gap-2 text-sm text-text">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-primary" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
                <span>{t("media.consent.checkbox")}</span>
              </label>
            )}
          </div>
        ) : target === "athlete" ? (
          <p className="flex items-start gap-2 text-xs text-text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("media.cover.athletePrivacy")}
          </p>
        ) : null}

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {current?.path && (
              <Button type="button" variant="ghost" size="sm" onClick={remove} loading={busy === "removing"} disabled={!!busy}>
                <Trash2 className="h-4 w-4" aria-hidden />
                {t("media.cover.remove")}
              </Button>
            )}
          </div>
          <div className="flex gap-2 sm:justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy === "saving"}>
              {t("common.cancel")}
            </Button>
            <Button type="button" size="sm" onClick={save} loading={busy === "saving"} disabled={!canSave}>
              {busy === "saving" ? t("media.cover.saving") : t("media.cover.save")}
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
