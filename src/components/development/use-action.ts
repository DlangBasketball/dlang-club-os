"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

/** Runs a server action, keeps busy / error state and refreshes the page on success. */
export function useAction() {
  const router = useRouter();
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  async function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>, after?: (res: T) => void): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setErr(res.error ?? null);
        return false;
      }
      after?.(res);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  return { err, busy, run, setErr };
}
