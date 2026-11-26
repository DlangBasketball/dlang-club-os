"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import { switchMode } from "@/lib/actions/role-mode";

export function SwitchModeButton({ mode, next, label }: { mode: string; next: string; label: string }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button loading={busy} disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        const res = await switchMode(mode, next);
        if (!res.ok) { setBusy(false); setError(res.error); return; }
        window.location.assign(res.href);
      }}>{label}</Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
