"use client";

import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { hasLicence, type Licence } from "@/lib/people/licence";

function Item({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md bg-surface-elevated px-3 py-2">
      <div className="text-xs text-text-muted">{label}</div>
      <div className="text-sm text-text">{value?.trim() ? value : "—"}</div>
    </div>
  );
}

/**
 * Federation licence on a player profile (admin, finance, parent). The fee is
 * shown only when `showFee` (admin / finance); editing lives on the admin
 * edit page (`editHref`).
 */
export function LicenceCard({ licence, showFee = false, editHref }: { licence: Licence; showFee?: boolean; editHref?: string }) {
  const t = useT();
  const f = useFormat();
  const present = hasLicence(licence) || !!licence.category || !!licence.federation || !!licence.issuedOn;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BadgeCheck className="h-4 w-4" aria-hidden /> {t("editPeople.licence.title")}</CardTitle>
        {editHref && <Link href={editHref} className="text-xs text-brand-primary hover:underline">{t("editPeople.edit")}</Link>}
      </CardHeader>
      <CardBody>
        {present ? (
          <div className="grid grid-cols-2 gap-2">
            <Item label={t("editPeople.licence.number")} value={licence.number} />
            <Item label={t("editPeople.licence.category")} value={licence.category} />
            <Item label={t("editPeople.licence.federation")} value={licence.federation} />
            <Item label={t("editPeople.licence.issuedOn")} value={licence.issuedOn ? f.date(licence.issuedOn) : null} />
            {showFee && <Item label={t("editPeople.licence.fee")} value={licence.fee !== null ? f.money(licence.fee) : null} />}
          </div>
        ) : (
          <p className="text-sm text-text-muted">{t("editPeople.licence.none")}</p>
        )}
      </CardBody>
    </Card>
  );
}
