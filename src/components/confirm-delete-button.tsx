"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

export function ConfirmDeleteButton({
  action,
  confirmText,
  label = "Delete",
}: {
  action: () => Promise<{ ok: boolean; error?: string } | void>;
  confirmText: string;
  label?: string;
}) {
  const [pending, setPending] = React.useState(false);
  async function onClick() {
    if (!window.confirm(confirmText)) return;
    setPending(true);
    const res = await action(); // success redirects (throws), so code below runs only on failure
    setPending(false);
    if (res && "ok" in res && !res.ok) window.alert(res.error ?? "Something went wrong.");
  }
  return (
    <Button variant="danger" size="sm" onClick={onClick} disabled={pending}>
      <Trash2 className="h-4 w-4" /> {pending ? "Deleting…" : label}
    </Button>
  );
}
