"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ParticipantOption, SelfState } from "@/lib/participants/validation";
import { ParticipantPicker } from "./participant-picker";

/**
 * Picker for a page that loads per participant (?athlete=<id>): choosing or
 * creating a participant navigates to it. Used when the adult has no
 * participant yet (e.g. the training request page).
 */
export function ParticipantNavPicker({ participants, self, hrefBase, activityDate, legend }: {
  participants: ParticipantOption[]; self: SelfState; hrefBase: string; activityDate: string; legend?: string;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState<string[]>([]);
  return (
    <ParticipantPicker idPrefix="nav-pp" legend={legend} participants={participants} self={self} activityDate={activityDate}
      value={value} onChange={(ids) => { setValue(ids); if (ids[0]) router.push(`${hrefBase}${hrefBase.includes("?") ? "&" : "?"}athlete=${ids[0]}`, { scroll: false }); }} />
  );
}
