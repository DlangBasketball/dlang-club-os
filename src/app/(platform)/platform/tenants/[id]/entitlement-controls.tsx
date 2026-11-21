"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import { setTenantGrant, updateTenantGrant, type PlatformGrantKind } from "@/lib/upgrades/platform-actions";

/** Per-feature operator controls: grant, trial N days, block, end a grant, activate a request. */
export function EntitlementControls({
  orgId,
  feature,
  grants,
}: {
  orgId: string;
  feature: string;
  grants: { id: string; kind: string; status: string; label: string }[];
}) {
  const [pending, start] = React.useTransition();
  const [days, setDays] = React.useState("14");
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => ReturnType<typeof setTenantGrant>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
    });
  const grant = (kind: PlatformGrantKind) => run(() => setTenantGrant({ orgId, feature, kind, days: Number(days) }));
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {grants.map((g) => (
          <span key={g.id} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-2">
            {g.label}
            {g.status === "pending" && (
              <button type="button" disabled={pending} className="text-success hover:underline" onClick={() => run(() => updateTenantGrant(orgId, g.id, "active"))}>
                activate
              </button>
            )}
            <button type="button" disabled={pending} className="text-danger hover:underline" onClick={() => run(() => updateTenantGrant(orgId, g.id, "canceled"))}>
              end
            </button>
          </span>
        ))}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => grant("complimentary")}>Grant</Button>
        <span className="inline-flex items-center gap-1">
          <input
            aria-label="Trial days"
            className="h-8 w-12 rounded border border-line bg-surface px-1 text-xs"
            value={days}
            inputMode="numeric"
            onChange={(e) => setDays(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
          />
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => grant("trial")}>Trial</Button>
        </span>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => grant("block")}>Block</Button>
      </div>
      {msg && <span className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </div>
  );
}

/** Customer-zero style switch: every module complimentary (feature '*'). */
export function ComplimentaryAllControl({ orgId, grantId }: { orgId: string; grantId: string | null }) {
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={grantId ? "danger" : "secondary"}
        disabled={pending}
        onClick={() => {
          if (!window.confirm(grantId ? "End complimentary access to every module?" : "Give this tenant every module free of charge?")) return;
          start(async () => {
            const r = grantId
              ? await updateTenantGrant(orgId, grantId, "canceled")
              : await setTenantGrant({ orgId, feature: "*", kind: "complimentary_all", note: "Granted in the platform console" });
            setMsg(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Working…" : grantId ? "End complimentary_all" : "Grant complimentary_all"}
      </Button>
      {msg && <span className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </div>
  );
}
