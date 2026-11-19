"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteProgram, setProgramStatus } from "@/lib/actions/programs";
import type { ProgramStatus } from "@/lib/club-ops/validation";
import { useT } from "@/lib/i18n/client";

/** Publish / unpublish (draft) / archive / delete for one programme. */
export function ProgramActions({ programId, status, registrations }: { programId: string; status: ProgramStatus; registrations: number }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function change(next: ProgramStatus) {
    if (next === "archived" && !window.confirm(t("editOps.programs.confirmArchive"))) return;
    setBusy(true); setMsg(null);
    const res = await setProgramStatus(programId, next);
    setBusy(false);
    if (!res.ok) setMsg({ tone: "err", text: res.error });
    else router.refresh();
  }
  async function remove() {
    const text = registrations > 0 ? t("editOps.programs.confirmDeleteArchives", { count: registrations }) : t("editOps.programs.confirmDelete");
    if (!window.confirm(text)) return;
    setBusy(true); setMsg(null);
    const res = await deleteProgram(programId);
    setBusy(false);
    if (!res.ok) return setMsg({ tone: "err", text: res.error });
    if (res.archived) { setMsg({ tone: "ok", text: t("editOps.programs.archivedInstead") }); router.refresh(); return; }
    router.push("/admin/programs");
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {status !== "published" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => change("published")}><Eye className="h-4 w-4" /> {t("editOps.programs.publish")}</Button>}
        {status === "published" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => change("draft")}><EyeOff className="h-4 w-4" /> {t("editOps.programs.unpublish")}</Button>}
        {status !== "archived" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => change("archived")}><Archive className="h-4 w-4" /> {t("editOps.programs.archive")}</Button>}
        <Button size="sm" variant="danger" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" /> {registrations > 0 ? t("editOps.programs.deleteOrArchive") : t("common.delete")}</Button>
      </div>
      {msg && <p role={msg.tone === "err" ? "alert" : "status"} className={msg.tone === "err" ? "text-sm text-danger" : "text-sm text-success"}>{msg.text}</p>}
    </div>
  );
}
