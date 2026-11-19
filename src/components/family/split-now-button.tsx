"use client";

import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { splitFamilyInvoicesNow } from "@/lib/actions/guardians";
import { StatusLine, useFamilyAction } from "./use-family-action";

/** Finance: split a family's open invoices by its billing split now. */
export function SplitNowButton({ familyId }: { familyId: string }) {
  const t = useT();
  const { busy, msg, run } = useFamilyAction();
  return (
    <span className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" loading={busy} disabled={busy} onClick={() => run(() => splitFamilyInvoicesNow(familyId))}>
        {t("family.pages.billing.splitNow")}
      </Button>
      <StatusLine msg={msg} />
    </span>
  );
}
