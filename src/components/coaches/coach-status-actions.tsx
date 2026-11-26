"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Power, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteCoach, setCoachActive } from "@/lib/actions/coaches";

/**
 * Deactivate / reactivate a coach, and delete one that nothing references
 * (the server re-checks the references atomically before deleting).
 */
export function CoachStatusActions({
  coachId,
  name,
  isActive,
  canDelete,
}: {
  coachId: string;
  name: string;
  isActive: boolean;
  canDelete: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState<"toggle" | "delete" | null>(null);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function toggle() {
    if (isActive && !window.confirm(t("coaches.actions.confirmDeactivate", { name }))) return;
    setBusy("toggle");
    setMsg(null);
    const res = await setCoachActive(coachId, !isActive);
    setBusy(null);
    if (res.ok) {
      setMsg({ ok: true, text: res.message ?? "" });
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  async function remove() {
    if (!window.confirm(t("coaches.actions.confirmDelete", { name }))) return;
    setBusy("delete");
    setMsg(null);
    const res = await deleteCoach(coachId);
    setBusy(null);
    if (res.ok) {
      router.push("/admin/coaches");
      router.refresh();
    } else setMsg({ ok: false, text: res.error });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" loading={busy === "toggle"} disabled={!!busy} onClick={toggle}>
          {isActive ? <Power className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          {isActive ? t("coaches.actions.deactivate") : t("coaches.actions.reactivate")}
        </Button>
        {canDelete && (
          <Button type="button" size="sm" variant="danger" loading={busy === "delete"} disabled={!!busy} onClick={remove}>
            <Trash2 className="h-4 w-4" /> {busy === "delete" ? t("coaches.actions.deleting") : t("coaches.actions.delete")}
          </Button>
        )}
      </div>
      <p className="text-xs text-ink-3">{canDelete ? t("coaches.actions.deleteHint") : t("coaches.actions.deleteBlocked")}</p>
      {msg && msg.text && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}
