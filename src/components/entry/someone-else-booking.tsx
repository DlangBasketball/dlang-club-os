"use client";

import { ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { SomeoneElseForm, type SomeoneElseSlotContext } from "@/components/participants/someone-else-form";

/**
 * "Someone else" slot of the ParticipantPicker (Workstream B): A's form
 * (participant + their parent / legal guardian + relation) with what happens
 * next — the place is held for 72 hours, the guardian is asked by e-mail, the
 * booker sees the status only.
 */
export function SomeoneElseBooking(ctx: SomeoneElseSlotContext) {
  const t = useT();
  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 rounded-md border border-border bg-surface p-3 text-xs text-text-muted">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" aria-hidden />
        {t("consentRequest.slot.explain")}
      </p>
      <SomeoneElseForm {...ctx} />
    </div>
  );
}

/** Render prop for <ParticipantPicker someoneElse={...} />. */
export const someoneElseSlot = (ctx: SomeoneElseSlotContext) => <SomeoneElseBooking {...ctx} />;
