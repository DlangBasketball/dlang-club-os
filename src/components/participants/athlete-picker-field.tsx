"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ParticipantOption, SelfState } from "@/lib/participants/validation";
import { ParticipantPicker } from "./participant-picker";

export type AthleteChoices = { participants: ParticipantOption[]; self: SelfState };

/**
 * One athlete for a form (club programme, membership, selection application,
 * training booking): the shared ParticipantPicker in single mode. Preselects
 * the active athlete of the switcher when it is a valid choice here; a child
 * or "Myself" created inline is selected at once and the page data refreshes
 * in the background (the rest of the form keeps its state).
 *
 * "Someone else" only where third-party booking is supported (allowOther);
 * "Myself" only for adults where the activity accepts adults (allowSelf; the
 * picker also hides it when the self profile is under 18 on activityDate).
 */
export function AthletePickerField({
  choices, value, onChange, activityDate, allowSelf = false, allowOther = false, idPrefix, legend,
  disabledReason, exclude, disabled,
}: {
  choices: AthleteChoices;
  value: string;
  onChange: (id: string, participant: ParticipantOption | null) => void;
  activityDate: string;
  allowSelf?: boolean;
  allowOther?: boolean;
  idPrefix: string;
  legend?: string;
  disabledReason?: (p: ParticipantOption) => string | null;
  /** Participants not offered here (e.g. already applied). */
  exclude?: readonly string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const participants = React.useMemo(
    () => choices.participants.filter((p) => (allowOther || (p.kind !== "other" && p.kind !== "linked")) && !(exclude ?? []).includes(p.id)),
    [choices.participants, allowOther, exclude],
  );
  return (
    <ParticipantPicker
      idPrefix={idPrefix} legend={legend} participants={participants} self={choices.self} activityDate={activityDate}
      allowSelf={allowSelf} allowOther={allowOther} disabledReason={disabledReason} disabled={disabled}
      value={value ? [value] : []}
      onChange={(ids, all) => onChange(ids[0] ?? "", all.find((p) => p.id === ids[0]) ?? null)}
      onCreated={() => router.refresh()}
    />
  );
}

/** Initial selection: the active athlete when offered, else the only choice, else none. */
export function initialAthlete(active: string | null | undefined, ids: readonly string[]): string {
  if (active && ids.includes(active)) return active;
  return ids.length === 1 ? ids[0] : "";
}
