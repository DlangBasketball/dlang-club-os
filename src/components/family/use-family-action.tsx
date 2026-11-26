"use client";
import * as React from "react";
import { useRouter } from "next/navigation";

type Res = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

/** Runs a family server action: busy flag, translated status/error message, refresh on success. */
export function useFamilyAction() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function run<T extends Res>(fn: () => Promise<T>, after?: (res: Extract<T, { ok: true }>) => void): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        return false;
      }
      setMsg(res.message ? { ok: true, text: res.message } : null);
      after?.(res as Extract<T, { ok: true }>);
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run, setMsg };
}

export function StatusLine({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>
      {msg.text}
    </p>
  );
}
