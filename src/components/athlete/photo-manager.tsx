"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, ShieldCheck } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { uploadAthletePhoto, removeAthletePhoto } from "@/lib/actions/athlete-photo";
import { resizePhoto } from "@/lib/people/resize-image";
import { PHOTO_INPUT_ACCEPT, checkPhotoFile } from "@/lib/people/validation";

/**
 * Upload / replace / remove an athlete's identification photo. Used by admins
 * (player profile) and guardians (parent app, own child). The image is
 * resized in the browser before upload; the server re-checks type and size.
 */
export function PhotoManager({
  athleteId,
  name,
  photoUrl,
  compact = false,
}: {
  athleteId: string;
  name: string;
  photoUrl: string | null;
  compact?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [state, setState] = React.useState<"idle" | "processing" | "uploading" | "removing">("idle");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const busy = state !== "idle";

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    setMsg(null);
    setState("processing");
    const resized = await resizePhoto(picked);
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
    fd.append("athleteId", athleteId);
    fd.append("file", resized.file);
    const res = await uploadAthletePhoto(fd);
    setState("idle");
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("athletePhoto.saved") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  async function onRemove() {
    if (!window.confirm(t("athletePhoto.confirmRemove"))) return;
    setMsg(null);
    setState("removing");
    const res = await removeAthletePhoto(athleteId);
    setState("idle");
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? t("athletePhoto.removed") });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  const label =
    state === "processing" ? t("athletePhoto.processing")
    : state === "uploading" ? t("athletePhoto.uploading")
    : photoUrl ? t("athletePhoto.replace") : t("athletePhoto.upload");

  return (
    <div className={compact ? "flex items-center gap-4" : "flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left"}>
      <Avatar name={name} src={photoUrl} alt={t("athletePhoto.alt", { name })} size={compact ? "xl" : "2xl"} />
      <div className="min-w-0 space-y-2">
        <input
          ref={inputRef}
          type="file"
          accept={PHOTO_INPUT_ACCEPT}
          className="sr-only"
          id={`photo-${athleteId}`}
          onChange={onPick}
          disabled={busy}
        />
        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <Button type="button" size="sm" variant="secondary" loading={state === "processing" || state === "uploading"} onClick={() => inputRef.current?.click()} disabled={busy}>
            <Camera className="h-4 w-4" /> {label}
          </Button>
          {photoUrl && (
            <Button type="button" size="sm" variant="ghost" loading={state === "removing"} onClick={onRemove} disabled={busy}>
              <Trash2 className="h-4 w-4" /> {state === "removing" ? t("athletePhoto.removing") : t("athletePhoto.remove")}
            </Button>
          )}
        </div>
        <p className="text-xs text-ink-3">{t("athletePhoto.hint")}</p>
        <p className="flex items-start gap-1.5 text-xs text-ink-3">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("athletePhoto.privacy")}
        </p>
        {msg && (
          <p role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
