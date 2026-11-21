"use client";

import { HandHeart } from "lucide-react";
import { Badge } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import type { SponsorshipKind } from "@/lib/people/sponsorship";

/**
 * Family-facing line: "Fees sponsored by …" (or "50 % of fees sponsored by …").
 * With `name`, prefixed by the child's name (invoices covering several children).
 */
export function SponsorshipNote({ kind, percent, sponsorName, name, className }: {
  kind: SponsorshipKind; percent: number | null; sponsorName: string | null; name?: string; className?: string;
}) {
  const t = useT();
  const f = useFormat();
  if (kind === "none") return null;
  const sponsor = sponsorName?.trim() || t("sponsorship.sponsorClub");
  const partial = kind === "partial" && percent !== null && percent < 100;
  const text = name
    ? partial ? t("sponsorship.invoiceNotePartial", { name, percent: f.number(percent), sponsor }) : t("sponsorship.invoiceNote", { name, sponsor })
    : partial ? t("sponsorship.parentNotePartial", { percent: f.number(percent), sponsor }) : t("sponsorship.parentNote", { sponsor });
  return (
    <p className={className ?? "flex items-center gap-2 rounded-md border border-brand-accent/30 bg-brand-accent-soft px-3 py-2 text-sm text-text"}>
      <HandHeart className="h-4 w-4 shrink-0 text-brand-accent" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

/** "Sponsored" (full) or "Sponsored 50 %" (partial); nothing when not sponsored. Staff views only. */
export function SponsorshipBadge({ kind, percent }: { kind: SponsorshipKind; percent: number | null }) {
  const t = useT();
  const f = useFormat();
  if (kind === "none") return null;
  return (
    <Badge tone="accent">
      <HandHeart className="h-3 w-3" aria-hidden />
      {kind === "partial" && percent !== null ? t("sponsorship.badgePercent", { percent: f.number(percent) }) : t("sponsorship.badge")}
    </Badge>
  );
}
