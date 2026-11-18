"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { switchOrg } from "@/lib/actions/org-switch";
import { cn } from "@/lib/utils";

export type SwitcherOrg = { id: string; name: string; current: boolean };

/**
 * Club switcher for people who belong to several clubs. Shown in every app
 * shell when there is more than one membership. The switch happens server
 * side (switch_current_org) and only to a club with a membership.
 */
export function OrgSwitcher({ orgs, className }: { orgs: SwitcherOrg[]; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  if (orgs.length < 2) return null;
  const current = orgs.find((o) => o.current)?.id ?? "";

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const orgId = e.target.value;
    if (!orgId || orgId === current) return;
    setBusy(true);
    setErr(null);
    const res = await switchOrg({ orgId });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    const href = res.data?.href ?? "/";
    if (/^https?:\/\//.test(href)) window.location.assign(href);
    else {
      router.push(href as never);
      router.refresh();
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Building2 aria-hidden className="h-4 w-4 shrink-0 text-text-muted" />
      <label htmlFor="org-switcher" className="sr-only">{t("family.orgSwitcher.label")}</label>
      <select
        id="org-switcher"
        value={current}
        onChange={onChange}
        disabled={busy}
        title={err ?? t("family.orgSwitcher.label")}
        aria-invalid={err ? true : undefined}
        className="h-9 max-w-[11rem] truncate rounded-md border border-border bg-surface px-2 text-[12.5px] text-text focus-visible:outline-none focus-visible:shadow-focus"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      {err && <span role="alert" className="sr-only">{err}</span>}
    </div>
  );
}
