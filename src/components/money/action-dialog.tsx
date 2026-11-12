"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Confirm dialog for money mutations: a trigger button opens a modal
 * (<dialog>) that states the consequence, optionally asks for a reason
 * (required for every void / cancel / write-off / adjustment), and runs the
 * server action. Extra form fields can be passed as children; `onConfirm`
 * receives the reason. On success the page data is refreshed.
 */
export function ActionDialog({
  trigger,
  triggerVariant = "secondary",
  triggerSize = "sm",
  title,
  description,
  confirmLabel,
  danger = false,
  askReason = true,
  reasonLabel,
  disabled,
  children,
  onConfirm,
  onDone,
}: {
  trigger: React.ReactNode;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  triggerSize?: "sm" | "md";
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  askReason?: boolean;
  reasonLabel?: string;
  disabled?: boolean;
  children?: React.ReactNode;
  onConfirm: (reason: string) => Promise<Result>;
  onDone?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const ref = React.useRef<HTMLDialogElement>(null);
  const id = React.useId();
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  function open() {
    setError(null);
    setReason("");
    ref.current?.showModal();
  }
  function close() {
    ref.current?.close();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (askReason && !reason.trim()) {
      setError(t("editMoney.errors.REASON_REQUIRED"));
      return;
    }
    setPending(true);
    setError(null);
    const res = await onConfirm(reason.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    close();
    onDone?.();
    router.refresh();
  }

  return (
    <>
      <Button type="button" size={triggerSize} variant={triggerVariant} disabled={disabled} onClick={open}>
        {trigger}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={`${id}-title`}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/60"
      >
        <form onSubmit={submit} className="space-y-4 p-5">
          <h2 id={`${id}-title`} className="font-display text-lg text-ink">{title}</h2>
          {description && <div className="text-sm text-ink-2">{description}</div>}
          {children}
          {askReason && (
            <div>
              <Label htmlFor={`${id}-reason`}>{reasonLabel ?? t("editMoney.common.reason")}</Label>
              <Textarea
                id={`${id}-reason`}
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("editMoney.common.reasonPlaceholder")}
              />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={pending}>
              {t("editMoney.common.back")}
            </Button>
            <Button type="submit" size="sm" variant={danger ? "danger" : "primary"} disabled={pending}>
              {pending ? t("editMoney.common.working") : confirmLabel ?? t("editMoney.common.confirm")}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
