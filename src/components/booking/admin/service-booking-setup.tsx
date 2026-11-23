"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button, FieldHint, Input, Label } from "@/components/ui";
import { Select } from "@/components/teams/fields";
import { saveServiceBookingSetup } from "@/lib/actions/admin-booking";
import { SELECTABLE_CATEGORIES, categoryLabelKey, type RevenueCategory } from "@/lib/billing/activities";
import type { CoachOption, SpaceOption } from "@/lib/booking/admin-data";
import { SERVICE_KINDS, type ServiceKind, type SetupMissingCode } from "@/lib/booking/types";
import { useT } from "@/lib/i18n/client";

/**
 * Booking setup of a service (admin): kind, revenue category (never
 * "other"), eligible coaches (training_service_coaches — authoritative once
 * set), default venue space and capacity; shows why invoicing is blocked.
 */
export function ServiceBookingSetup({ serviceId, initial, coaches, spaces, setupMissing, numberPrefix, canEdit }: {
  serviceId: string; canEdit: boolean;
  initial: { kind: ServiceKind; billingCategory: string; defaultVenueSpaceId: string | null; maxParticipants: number; coachIds: string[]; bookableByFamilies?: boolean };
  coaches: CoachOption[]; spaces: SpaceOption[]; setupMissing: SetupMissingCode[]; numberPrefix: string | null;
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState({
    kind: initial.kind,
    billingCategory: ((SELECTABLE_CATEGORIES as readonly string[]).includes(initial.billingCategory) ? initial.billingCategory : "training") as RevenueCategory,
    defaultVenueSpaceId: initial.defaultVenueSpaceId ?? "", maxParticipants: String(initial.maxParticipants), coachIds: initial.coachIds,
    bookableByFamilies: initial.bookableByFamilies ?? initial.kind !== "package",
  });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => { setMsg(null); setV((s) => ({ ...s, [k]: val })); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await saveServiceBookingSetup({
      serviceId, kind: v.kind, billingCategory: v.billingCategory, defaultVenueSpaceId: v.defaultVenueSpaceId || null,
      maxParticipants: Number(v.maxParticipants) || 1, coachIds: v.coachIds, bookableByFamilies: v.bookableByFamilies,
    });
    setBusy(false);
    setMsg({ ok: res.ok, text: res.ok ? res.message ?? t("common.saved") : res.error });
    if (res.ok) router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-4">
      {setupMissing.length > 0 && (
        <div role="alert" className="space-y-1 rounded border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> {t("adminBooking.services.setupMissing")}</p>
          <ul className="list-disc pl-5">{setupMissing.map((c) => <li key={c}>{t.dynamic(`bookingWorkflow.setup.${c}`, undefined, c)}</li>)}</ul>
          <Link href="/admin/settings/billing-entities" className="text-xs underline">{t("adminBooking.quote.fixEntities")}</Link>
        </div>
      )}
      {v.coachIds.length === 0 && <p className="text-sm text-warning">{t("adminBooking.services.noCoach")}</p>}
      <fieldset disabled={!canEdit || busy} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="sb-kind">{t("adminBooking.services.kind")}</Label>
            <Select id="sb-kind" value={v.kind} onChange={(e) => { const k = e.target.value as ServiceKind; setV((s) => ({ ...s, kind: k, maxParticipants: k === "group" ? (Number(s.maxParticipants) > 1 ? s.maxParticipants : "6") : "1" })); setMsg(null); }}>
              {SERVICE_KINDS.map((k) => <option key={k} value={k}>{t.dynamic(`adminBooking.kind.${k}`, undefined, k)}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="sb-cat">{t("adminBooking.services.category")}</Label>
            <Select id="sb-cat" value={v.billingCategory} onChange={(e) => set("billingCategory", e.target.value as RevenueCategory)}>
              {SELECTABLE_CATEGORIES.map((c) => <option key={c} value={c}>{t(categoryLabelKey(c))}</option>)}
            </Select>
            {numberPrefix && <FieldHint>{t("adminBooking.services.prefix", { prefix: numberPrefix })}</FieldHint>}
          </div>
          <div>
            <Label htmlFor="sb-cap">{t("adminBooking.services.capacity")}</Label>
            <Input id="sb-cap" type="number" min={v.kind === "group" ? 2 : 1} max={100} disabled={v.kind !== "group"} value={v.maxParticipants} onChange={(e) => set("maxParticipants", e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="sb-space">{t("adminBooking.services.defaultSpace")}</Label>
          <Select id="sb-space" value={v.defaultVenueSpaceId} onChange={(e) => set("defaultVenueSpaceId", e.target.value)}>
            <option value="">{t("adminBooking.form.noSpace")}</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.venueName ? `${s.venueName} · ${s.name}` : s.name}</option>)}
          </Select>
        </div>
        <fieldset>
          <legend className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("adminBooking.services.coaches")}</legend>
          <div className="flex flex-wrap gap-2">
            {coaches.map((c) => (
              <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${v.coachIds.includes(c.id) ? "border-maroon bg-maroon/10 text-ink" : "border-line text-ink-3"}`}>
                <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--red-primary)]" checked={v.coachIds.includes(c.id)}
                  onChange={(e) => set("coachIds", e.target.checked ? [...v.coachIds, c.id] : v.coachIds.filter((x) => x !== c.id))} />
                {c.name}
              </label>
            ))}
          </div>
          <FieldHint>{t("adminBooking.services.coachesHint")}</FieldHint>
        </fieldset>
        <label className="flex items-start gap-2 text-sm text-ink-2">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--red-primary)]" checked={v.bookableByFamilies}
            onChange={(e) => set("bookableByFamilies", e.target.checked)} />
          <span>{t("bookingRequests.services.bookableByFamilies")}<span className="block text-xs text-text-muted">{t("bookingRequests.services.bookableHint")}</span></span>
        </label>
      </fieldset>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      {canEdit && <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("adminBooking.services.save")}</Button>}
    </form>
  );
}
