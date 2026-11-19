"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Res = { ok: true; message?: string } | { ok: false; error: string };

/** Runs a club-admin server action, shows its translated message, refreshes the page. */
export function useCaAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function run<R extends Res>(fn: () => Promise<R>, after?: (r: R) => void): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error });
        return false;
      }
      if (r.message) setMsg({ ok: true, text: r.message });
      after?.(r);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  const note = msg ? (
    <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>
  ) : null;
  return { busy, run, note };
}
