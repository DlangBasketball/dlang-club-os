"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { updateRegistrationStatus, type RegistrationStatus } from "@/lib/actions/registration";

const OPTIONS: { value: RegistrationStatus; label: string }[] = [
  { value: "confirmed", label: "Confirm" },
  { value: "waitlist", label: "Waitlist" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Complete" },
];

export function RegistrationStatusControl({ id, current }: { id: string; current: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  async function set(status: RegistrationStatus) {
    setPending(status);
    const res = await updateRegistrationStatus(id, status);
    setPending(null);
    if (!res.ok) window.alert(res.error ?? "Couldn't update status");
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.map((o) => (
        <Button
          key={o.value}
          size="sm"
          variant={o.value === current ? "primary" : "secondary"}
          disabled={pending !== null || o.value === current}
          onClick={() => set(o.value)}
        >
          {pending === o.value ? "…" : o.label}
        </Button>
      ))}
    </div>
  );
}
