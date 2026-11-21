"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatCounts, monthlyFrom, normaliseCounts, type ApplicationStatus } from "@/lib/selection/rules";

const TONE: Record<ApplicationStatus, "neutral" | "info" | "success" | "warning" | "danger" | "brand"> = {
  applied: "info", under_review: "warning", accepted: "brand", waitlisted: "warning", declined: "danger", enrolled: "success", withdrawn: "neutral",
};

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useT();
  return <Badge tone={TONE[status] ?? "neutral"} dot>{t(`selection.statuses.${status}`)}</Badge>;
}

export type PackageOption = { id: string; name: string; description?: string | null; price: number; allowedCounts: number[]; showMonthly: boolean };

/** "1 500 / pay in full or from 300 / month x 5" — shared by the public page, the parent app and admin. */
export function PackageSummary({ pkg, currency }: { pkg: PackageOption; currency: string }) {
  const t = useT();
  const f = useFormat();
  const counts = normaliseCounts(pkg.allowedCounts);
  const monthly = monthlyFrom(pkg.price, counts, currency);
  return (
    <span className="block text-xs text-text-muted">
      {counts.length > 1 && pkg.showMonthly
        ? t("selection.packages.monthlyFrom", { amount: f.money(monthly.amount, currency), count: monthly.count })
        : t("selection.packages.payInFullOnly")}
      {counts.length > 1 && <> · {t("selection.packages.instalmentsAllowed", { counts: formatCounts(counts) })}</>}
    </span>
  );
}

/** Selectable package cards (radio group). */
export function PackagePicker({ packages, value, onChange, currency, name }: {
  packages: PackageOption[]; value: string; onChange: (id: string) => void; currency: string; name: string;
}) {
  const f = useFormat();
  return (
    <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
      {packages.map((p) => {
        const on = value === p.id;
        return (
          <label key={p.id} className={cn(
            "relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors",
            on ? "border-brand-primary bg-brand-primary-soft" : "border-border bg-surface hover:border-border-strong",
          )}>
            <input type="radio" name={name} value={p.id} checked={on} onChange={() => onChange(p.id)} className="sr-only" />
            <span className="flex items-center justify-between gap-2 text-sm font-medium text-text">
              {p.name}
              {on && <Check className="h-4 w-4 text-brand-primary" aria-hidden />}
            </span>
            <span className="font-display text-lg text-text tnum">{f.money(p.price, currency)}</span>
            {p.description && <span className="text-xs text-text-muted">{p.description}</span>}
            <PackageSummary pkg={p} currency={currency} />
          </label>
        );
      })}
    </div>
  );
}

export type DivisionOption = { id: string; name: string };

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{label}</label>
      {children}
      {error ? <p className="mt-1 text-xs text-danger" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

export function Notice({ msg }: { msg: { tone: "ok" | "err"; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>;
}
