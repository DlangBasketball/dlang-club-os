"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

export type Msg = { ok: boolean; text: string } | null;

export function useRunner() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  async function run<T extends { ok: true; message?: string } | { ok: false; error: string }>(fn: () => Promise<T>, onOk?: (r: T) => void) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fn();
      if (res.ok) {
        setMsg(res.message ? { ok: true, text: res.message } : null);
        onOk?.(res);
        router.refresh();
      } else {
        setMsg({ ok: false, text: (res as { error: string }).error });
      }
    } finally {
      setBusy(false);
    }
  }
  return { busy, msg, run, setMsg };
}

export function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <span role="status" className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>
      {msg.text}
    </span>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const t = useT();
  const [done, setDone] = React.useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {done ? t("website.admin.copied") : (label ?? t("website.admin.copy"))}
    </Button>
  );
}

export function CodeBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{label}</span>
        <CopyButton value={value} />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded border border-border bg-surface-input p-3 font-mono text-xs text-text">{value}</pre>
    </div>
  );
}
