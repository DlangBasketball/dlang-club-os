"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteProduct } from "@/lib/actions/shop";
import { useT } from "@/lib/i18n/client";

/** Shop list: delete a product (or hide it when it was already sold). Imported products then stay out of later website imports. */
export function ProductListActions({ id, name }: { id: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  async function remove() {
    if (!window.confirm(t("shop.admin.deleteConfirm"))) return;
    setBusy(true);
    setMsg(null);
    const res = await deleteProduct(id);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: res.data?.archived ? t("shop.admin.archived") : t("shop.admin.deleted") });
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {msg && <span role="status" className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</span>}
      <Button type="button" variant="ghost" size="sm" onClick={remove} loading={busy} aria-label={t("shop.admin.removeNamed", { name })}>
        <Trash2 className="h-4 w-4" aria-hidden /> {t("shop.admin.remove")}
      </Button>
    </div>
  );
}
