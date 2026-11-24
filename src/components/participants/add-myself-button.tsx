"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserRound } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { SelfState } from "@/lib/participants/validation";
import { SelfProfileForm } from "./participant-picker";
import { PortalDialog } from "./portal-dialog";

/**
 * "Add myself": the adult's own participant profile (18+ on today's date),
 * created once through participant_self_ensure. Prefilled with the account
 * name; the database refuses a minor (SELF_MUST_BE_ADULT).
 */
export function AddMyselfButton({ self, today }: { self: SelfState; today: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UserRound className="h-4 w-4" aria-hidden /> {t("myAthletes.addMyself")}
      </Button>
      <PortalDialog open={open} onClose={() => setOpen(false)} title={t("myAthletes.addMyself")}>
        <SelfProfileForm initial={self} activityDate={today} idPrefix="ma-self"
          onCreated={() => { setOpen(false); router.refresh(); }} />
      </PortalDialog>
    </>
  );
}
