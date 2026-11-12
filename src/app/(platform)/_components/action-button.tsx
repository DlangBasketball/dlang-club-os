"use client";

import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui";
import type { ActionResult } from "@/lib/platform/actions";

/** Runs a bound server action and shows its result inline. */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  size = "sm",
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  confirm?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setMsg(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Working…" : children}
      </Button>
      {msg && <span className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
    </div>
  );
}
