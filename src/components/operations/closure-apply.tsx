"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import type { OpsActionResult } from "./ops-form";

export type ClosureItemView = { kind: "event" | "session" | "camp" | "booking" | "rental"; id: string; label: string; when: string };

/**
 * Venue closure, one step: pick what to act on, choose cancel / move by N
 * days / relocate / notify only, and send. The server re-computes the impact
 * and only touches items that really fall inside the closure.
 */
export function ClosureApply({
  closureId,
  items,
  venues,
  action,
}: {
  closureId: string;
  items: ClosureItemView[];
  venues: { value: string; label: string }[];
  action: (values: Record<string, unknown>) => Promise<OpsActionResult>;
}) {
  const t = useT();
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(items.map((i) => `${i.kind}:${i.id}`)));
  const [op, setOp] = React.useState("cancel");
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const chosen = items.filter((i) => selected.has(`${i.kind}:${i.id}`)).map((i) => ({ kind: i.kind, id: i.id }));
        setMsg(null);
        start(async () => {
          const res = await action({
            closureId, items: chosen, op, shiftDays: fd.get("shiftDays") ?? "", targetVenueId: fd.get("targetVenueId") ?? "",
            notify: fd.get("notify") === "on", message: fd.get("message") ?? "",
          });
          setMsg(res.ok ? { ok: true, text: res.message ?? t("common.saved") } : { ok: false, text: res.error });
          if (res.ok) router.refresh();
        });
      }}
    >
      {items.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">{t("operations.closures.select")}</legend>
          {items.map((i) => {
            const key = `${i.kind}:${i.id}`;
            return (
              <label key={key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-primary" checked={selected.has(key)} onChange={() => toggle(key)} />
                <span>
                  <span className="text-text-muted">{t.dynamic(`operations.conflicts.kinds.${i.kind}`, undefined, i.kind)}</span>
                  {i.label ? ` · ${i.label}` : ""} · {i.when}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="closure-op">{t("operations.closures.action")}</Label>
          <Select id="closure-op" value={op} onChange={(e) => setOp(e.target.value)}>
            {["cancel", "shift", "relocate", "notify_only"].map((o) => (
              <option key={o} value={o}>{t.dynamic(`operations.closures.ops.${o}`)}</option>
            ))}
          </Select>
        </div>
        {op === "shift" && (
          <div>
            <Label htmlFor="closure-days">{t("operations.closures.shiftDays")}</Label>
            <Input id="closure-days" name="shiftDays" type="number" min={-366} max={366} defaultValue={7} required />
          </div>
        )}
        {op === "relocate" && (
          <div>
            <Label htmlFor="closure-venue">{t("operations.closures.targetVenue")}</Label>
            <Select id="closure-venue" name="targetVenueId" required>
              {venues.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </Select>
          </div>
        )}
      </div>
      <p className="text-xs text-text-muted">{t("operations.closures.opsHelp")}</p>
      <div>
        <Label htmlFor="closure-message">{t("operations.closures.message")}</Label>
        <Textarea id="closure-message" name="message" rows={3} maxLength={1000} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-brand-primary" />
        {t("operations.closures.notify")}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? t("common.saving") : t("operations.closures.apply")}</Button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      </div>
    </form>
  );
}
