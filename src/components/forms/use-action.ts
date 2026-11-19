"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

/** Runs a server action, keeps busy / error / message state and refreshes the page on success. */
export function useFormsAction() {
  const router = useRouter();
  const [err, setErr] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function run<T extends { ok: boolean; error?: string; message?: string }>(fn: () => Promise<T>, after?: (res: T) => void): Promise<boolean> {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setErr(res.error ?? null);
        return false;
      }
      if (res.message) setMsg(res.message);
      after?.(res);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  return { err, msg, busy, run, setErr };
}
