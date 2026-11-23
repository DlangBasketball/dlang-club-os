"use client";

import * as React from "react";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Native <dialog> (focus trap, Escape, inert background) controlled by
 * `open`. Full width on phones, centred card on larger screens.
 */
export function ModalDialog({
  open, onClose, title, children, size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "md" | "lg";
}) {
  const t = useT();
  const ref = React.useRef<HTMLDialogElement>(null);
  const id = React.useId();

  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      className={cn(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-lg border border-border bg-surface p-0 text-text shadow-xl",
        "backdrop:bg-black/60 sm:m-auto sm:rounded-lg",
        size === "lg" ? "sm:w-[min(40rem,calc(100vw-2rem))]" : "sm:w-[min(32rem,calc(100vw-2rem))]",
      )}
    >
      {open && (
        <div className="p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={`${id}-title`} className="font-display text-lg text-text">{title}</h2>
            <button type="button" onClick={onClose} aria-label={t("coachTrainings.common.close")}
                    className="touch-target -m-2 flex items-center justify-center rounded p-2 text-text-muted hover:text-text focus-visible:outline-none focus-visible:shadow-focus">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
