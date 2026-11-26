"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { AccountingResult } from "@/lib/actions/accounting";

/** Run a server action, show its message, refresh the page on success. */
export function useAct() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const run = React.useCallback(async (fn: () => Promise<AccountingResult>, after?: (r: AccountingResult) => void) => {
    setBusy(true);
    setMsg(null);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error });
    if (res.ok) {
      after?.(res);
      router.refresh();
    }
    return res;
  }, [router]);
  const status = msg && (
    <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>
  );
  return { busy, run, status };
}

/** window.prompt for a mandatory reason; null when cancelled or empty. */
export function askReason(label: string): string | null {
  const v = window.prompt(label);
  return v && v.trim() ? v.trim() : null;
}
