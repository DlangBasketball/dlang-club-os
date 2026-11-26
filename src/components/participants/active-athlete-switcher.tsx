"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { useTenant } from "@/lib/tenant/context";
import { myAthletesLabel } from "@/lib/tenant/terms";
import { cn } from "@/lib/utils";
import { setActiveAthlete } from "@/lib/actions/my-athletes";
import { ALL_ATHLETES } from "@/lib/participants/active-athlete";

export type SwitcherAthlete = { id: string; firstName: string; lastName?: string | null; kind: "self" | "child" | "linked" };

/**
 * Parent app: the active athlete (shown for 2+ athletes). The choice is saved
 * server-side in an httpOnly cookie after the database confirmed the caller
 * manages that athlete; every page re-validates it when reading.
 * Per-athlete pages then default to this athlete; "All" keeps lists complete.
 */
export function ActiveAthleteSwitcher({ athletes, active }: { athletes: SwitcherAthlete[]; active: string | null }) {
  const t = useT();
  const { terminology } = useTenant();
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [current, setCurrent] = React.useState<string>(active ?? ALL_ATHLETES);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { setCurrent(active ?? ALL_ATHLETES); }, [active]);
  if (athletes.length < 2) return null;

  function choose(id: string) {
    if (id === current) return;
    const prev = current;
    setCurrent(id); setErr(null);
    start(async () => {
      const res = await setActiveAthlete(id);
      if (!res.ok) { setCurrent(prev); setErr(res.error); return; }
      router.refresh();
    });
  }

  const allLabel = myAthletesLabel(terminology, t("myAthletes.switcher.all"), (term) => t("myAthletes.switcher.allTerm", { term }));
  const chip = (id: string, label: string) => (
    <button key={id} type="button" onClick={() => choose(id)} aria-pressed={current === id} disabled={pending}
      className={cn("touch-target shrink-0 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:shadow-focus",
        current === id ? "border-brand-primary bg-brand-primary-soft font-medium text-text" : "border-border text-text-muted hover:text-text")}>
      {label}
    </button>
  );
  return (
    <div className="sticky top-14 z-20 border-b border-border bg-bg-secondary/95 px-4 py-2 backdrop-blur">
      <div role="group" aria-label={t("myAthletes.switcher.label")} aria-busy={pending} className="flex items-center gap-2 overflow-x-auto">
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-text-muted">{t("myAthletes.switcher.label")}</span>
        {chip(ALL_ATHLETES, allLabel)}
        {athletes.map((a) => chip(a.id, a.kind === "self" ? t("myAthletes.switcher.me", { name: a.firstName }) : chipName(a, athletes)))}
      </div>
      {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}

/** First name, plus the last-name initial when two athletes share a first name. */
function chipName(a: { id: string; firstName: string; lastName?: string | null }, all: { id: string; firstName: string; lastName?: string | null }[]): string {
  const same = (x: string | null | undefined, y: string | null | undefined) => (x ?? "").trim().toLowerCase() === (y ?? "").trim().toLowerCase();
  const others = all.filter((o) => o.id !== a.id && same(o.firstName, a.firstName));
  const last = a.lastName?.trim();
  if (!others.length || !last) return a.firstName;
  // Initial when it tells them apart, else the full last name.
  const initialClash = others.some((o) => same((o as { lastName?: string | null }).lastName?.trim().charAt(0), last.charAt(0)));
  return initialClash ? `${a.firstName} ${last}` : `${a.firstName} ${last.charAt(0)}.`;
}
