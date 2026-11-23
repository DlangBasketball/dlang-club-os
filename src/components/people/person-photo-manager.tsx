"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, ImagePlus, Trash2, ShieldCheck } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translator";
import type { ActionResult } from "@/lib/people/server";
import { uploadAthletePhoto, removeAthletePhoto } from "@/lib/actions/athlete-photo";
import { uploadCoachPhoto, removeCoachPhoto } from "@/lib/actions/coach-photo";
import { resizePhoto } from "@/lib/people/resize-image";
import { PHOTO_INPUT_ACCEPT, checkPhotoFile } from "@/lib/people/validation";
import { PhotoCropDialog } from "./photo-crop-dialog";

export type PhotoSubject = "athlete" | "coach";

type Config = {
  /** FormData field that carries the record id. */
  idField: string;
  upload: (fd: FormData) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
  privacy: MessageKey;
  saved: MessageKey;
  removed: MessageKey;
};

/** Per-subject wiring: the actions and the texts that differ (privacy note). */
const CONFIG: Record<PhotoSubject, Config> = {
  athlete: {
    idField: "athleteId",
    upload: uploadAthletePhoto,
    remove: removeAthletePhoto,
    privacy: "athletePhoto.privacy",
    saved: "athletePhoto.saved",
    removed: "athletePhoto.removed",
  },
  coach: {
    idField: "coachId",
    upload: uploadCoachPhoto,
    remove: removeCoachPhoto,
    privacy: "coaches.photo.privacy",
    saved: "coaches.photo.saved",
    removed: "coaches.photo.removed",
  },
};

/**
 * Upload / replace / remove a person's photo (athlete identification photo,
 * coach profile photo). The picked image is previewed and cropped (square or
 * portrait), then resized in the browser before upload; the server re-checks
 * type and size, and Storage RLS decides who may write. Replacing uploads the
 * new photo first and then switches the pointer (see the upload action); on
 * failure the current photo stays and a retry message is shown.
 *
 * `variant="card"` (member card): buttons only with "Add photo" wording; the
 * card itself shows the photo.
 */
export function PersonPhotoManager({
  subject,
  id,
  name,
  photoUrl,
  compact = false,
  variant = "default",
}: {
  subject: PhotoSubject;
  id: string;
  name: string;
  photoUrl: string | null;
  compact?: boolean;
  variant?: "default" | "card";
}) {
  const t = useT();
  const router = useRouter();
  const cfg = CONFIG[subject];
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [state, setState] = React.useState<"idle" | "processing" | "uploading" | "removing">("idle");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [picked, setPicked] = React.useState<File | null>(null);
  const busy = state !== "idle";

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(null);
    if (!file.type.startsWith("image/")) {
      setMsg({ ok: false, text: t("athletePhoto.errors.type") });
      return;
    }
    setPicked(file);
  }

  async function onCropped(cropped: File) {
    setPicked(null);
    setState("processing");
    const resized = await resizePhoto(cropped);
    if ("error" in resized) {
      setState("idle");
      setMsg({ ok: false, text: t.dynamic(resized.error) });
      return;
    }
    const bad = checkPhotoFile(resized.file);
    if (bad) {
      setState("idle");
      setMsg({ ok: false, text: t.dynamic(bad) });
      return;
    }
    setState("uploading");
    const fd = new FormData();
    fd.append(cfg.idField, id);
    fd.append("file", resized.file);
    let res: ActionResult;
    try {
      res = await cfg.upload(fd);
    } catch {
      res = { ok: false, error: t("athletePhoto.errors.uploadFailed") };
    }
    setState("idle");
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t(cfg.saved) });
      router.refresh();
    } else {
      setMsg({ ok: false, text: photoUrl ? `${res.error} ${t("memberCard.photo.keptRetry")}` : res.error });
    }
  }

  async function onRemove() {
    if (!window.confirm(t("athletePhoto.confirmRemove"))) return;
    setMsg(null);
    setState("removing");
    let res: ActionResult;
    try {
      res = await cfg.remove(id);
    } catch {
      res = { ok: false, error: t("athletePhoto.errors.removeFailed") };
    }
    setState("idle");
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t(cfg.removed) });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  const card = variant === "card";
  const label =
    state === "processing" ? t("athletePhoto.processing")
    : state === "uploading" ? t("athletePhoto.uploading")
    : photoUrl ? t("athletePhoto.replace") : card ? t("memberCard.photo.add") : t("athletePhoto.upload");

  const controls = (
    <div className="min-w-0 space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_INPUT_ACCEPT}
        className="sr-only"
        id={`photo-${variant}-${subject}-${id}`}
        onChange={onPick}
        disabled={busy}
      />
      <div className={card ? "flex flex-wrap gap-2" : "flex flex-wrap justify-center gap-2 sm:justify-start"}>
        <Button type="button" size="sm" variant="secondary" loading={state === "processing" || state === "uploading"} onClick={() => inputRef.current?.click()} disabled={busy}>
          {photoUrl ? <Camera className="h-4 w-4" /> : <ImagePlus className="h-4 w-4" />} {label}
        </Button>
        {photoUrl && (
          <Button type="button" size="sm" variant="ghost" loading={state === "removing"} onClick={onRemove} disabled={busy}>
            <Trash2 className="h-4 w-4" /> {state === "removing" ? t("athletePhoto.removing") : t("athletePhoto.remove")}
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-3">{card ? t("memberCard.photo.hint") : t("athletePhoto.hint")}</p>
      <p className="flex items-start gap-1.5 text-xs text-ink-3">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {card ? t("memberCard.photo.privacy") : t(cfg.privacy)}
      </p>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>
          {msg.text}
        </p>
      )}
      <PhotoCropDialog file={picked} onCancel={() => setPicked(null)} onConfirm={onCropped}
        defaultAspect={subject === "athlete" ? "portrait" : "square"} />
    </div>
  );

  if (card) return controls;
  return (
    <div className={compact ? "flex items-center gap-4" : "flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left"}>
      <Avatar name={name} src={photoUrl} alt={t("athletePhoto.alt", { name })} size={compact ? "xl" : "2xl"} />
      {controls}
    </div>
  );
}
