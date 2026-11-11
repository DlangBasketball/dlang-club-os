"use client";

import * as React from "react";
import { Button, Input, Label } from "@/components/ui";
import {
  addTenantDomain,
  changeTenantPlan,
  removeTenantDomain,
  setTenantSuspended,
  type ActionResult,
} from "@/lib/platform/actions";

function useAction() {
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: r.message ?? "Saved" } : { ok: false, text: r.error });
      if (r.ok) onOk?.();
    });
  const Note = () =>
    msg ? <p className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</p> : null;
  return { pending, run, Note };
}

const select = "h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink";

export function SuspendControl({ orgId, suspended }: { orgId: string; suspended: boolean }) {
  const [reason, setReason] = React.useState("");
  const { pending, run, Note } = useAction();
  if (suspended) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink-2">
          Reactivating restores the club&apos;s access to all its data immediately.
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={pending}
          onClick={() => run(() => setTenantSuspended(orgId, false, ""))}
        >
          {pending ? "Reactivating…" : "Reactivate tenant"}
        </Button>
        <Note />
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!window.confirm("Suspend this tenant? Its users will lose access to all club data.")) return;
        run(() => setTenantSuspended(orgId, true, reason), () => setReason(""));
      }}
    >
      <Label htmlFor="reason">Reason (visible in the audit log)</Label>
      <Input
        id="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Unpaid for 60 days, abuse report #123"
        minLength={3}
        maxLength={500}
        required
      />
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? "Suspending…" : "Suspend tenant"}
      </Button>
      <Note />
    </form>
  );
}

export function ChangePlanControl({
  orgId,
  plans,
  current,
}: {
  orgId: string;
  plans: { code: string; name: string; is_active: boolean }[];
  current: { plan: string | null; status: string | null; trialEndsAt: string | null; customAmount: number | null };
}) {
  const [plan, setPlan] = React.useState(current.plan ?? plans[0]?.code ?? "");
  const [status, setStatus] = React.useState("");
  const [trial, setTrial] = React.useState(current.trialEndsAt ? current.trialEndsAt.slice(0, 10) : "");
  const [amount, setAmount] = React.useState(current.customAmount != null ? String(current.customAmount) : "");
  const { pending, run, Note } = useAction();

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => changeTenantPlan({ orgId, plan, status, trialEndsAt: trial, customAmount: amount }));
      }}
    >
      <div>
        <Label htmlFor="plan">Plan</Label>
        <select id="plan" className={select} value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plans
            .filter((p) => p.is_active)
            .map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
      <div>
        <Label htmlFor="status">Status</Label>
        <select id="status" className={select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Keep ({current.status ?? "none"})</option>
          {["trialing", "active", "past_due", "canceled", "paused"].map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="trial">Trial ends (extend a trial)</Label>
        <Input id="trial" type="date" value={trial} onChange={(e) => setTrial(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="amount">Custom amount per period (Enterprise)</Label>
        <Input
          id="amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Leave blank to use list price"
        />
      </div>
      <div className="sm:col-span-2 space-y-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save plan"}
        </Button>
        <Note />
      </div>
    </form>
  );
}

export function DomainControls({
  orgId,
  domains,
}: {
  orgId: string;
  domains: {
    id: string;
    domain: string;
    status: string;
    token: string;
    lastError: string | null;
    checkedAt: string | null;
  }[];
}) {
  const [domain, setDomain] = React.useState("");
  const { pending, run, Note } = useAction();
  const [verifying, setVerifying] = React.useState<string | null>(null);
  const [verifyMsg, setVerifyMsg] = React.useState<Record<string, string>>({});

  async function verify(id: string) {
    setVerifying(id);
    try {
      const res = await fetch("/api/platform/domains/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string | null };
      setVerifyMsg((m) => ({ ...m, [id]: j.ok ? "Verified ✓ — reload to refresh status" : (j.error ?? "Not verified") }));
    } finally {
      setVerifying(null);
    }
  }

  return (
    <div className="space-y-4">
      {domains.length === 0 && <p className="text-sm text-ink-3">No custom domains.</p>}
      {domains.map((d) => (
        <div key={d.id} className="rounded border border-line-soft p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-ink">{d.domain}</span>
            <span
              className={
                d.status === "verified" ? "text-xs text-success" : d.status === "failed" ? "text-xs text-danger" : "text-xs text-warning"
              }
            >
              {d.status}
            </span>
          </div>
          <div className="mt-2 break-all font-mono text-[11px] text-ink-3">
            TXT _clubos-verify.{d.domain} = clubos-verify={d.token}
          </div>
          {d.lastError && <div className="mt-1 text-xs text-danger">{d.lastError}</div>}
          {verifyMsg[d.id] && <div className="mt-1 text-xs text-ink-2">{verifyMsg[d.id]}</div>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="secondary" disabled={verifying === d.id} onClick={() => verify(d.id)}>
              {verifying === d.id ? "Checking DNS…" : "Verify now"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`Remove ${d.domain}?`)) run(() => removeTenantDomain(orgId, d.id));
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addTenantDomain(orgId, domain), () => setDomain(""));
        }}
      >
        <Input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="club.example.com"
          className="max-w-xs"
          required
        />
        <Button type="submit" size="md" variant="secondary" disabled={pending}>
          Add domain
        </Button>
      </form>
      <Note />
    </div>
  );
}
