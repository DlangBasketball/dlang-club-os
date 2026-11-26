"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Select, Textarea, FieldHint } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { deleteProduct, saveProduct } from "@/lib/actions/shop";

export type ProductFormValue = {
  name: string; description: string; category: string; price: string; visibility: "public" | "members"; isActive: boolean;
  pickupAvailable: boolean; pickupVenueId: string; shippingAvailable: boolean; shippingFee: string; lowStockThreshold: string; sortOrder: string;
};

export const EMPTY_PRODUCT: ProductFormValue = {
  name: "", description: "", category: "", price: "0", visibility: "public", isActive: true, pickupAvailable: true, pickupVenueId: "",
  shippingAvailable: false, shippingFee: "0", lowStockThreshold: "3", sortOrder: "0",
};

/** Create / edit a shop product (admin). Prices in the club currency. */
export function ProductForm({ id, initial, venues, currency, canEdit }: {
  id: string | null; initial: ProductFormValue; venues: { id: string; name: string }[]; currency: string; canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const set = <K extends keyof ProductFormValue>(k: K, val: ProductFormValue[K]) => setV((s) => ({ ...s, [k]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await saveProduct(id, {
      name: v.name, description: v.description, category: v.category, price: Number(v.price), visibility: v.visibility, isActive: v.isActive,
      pickupAvailable: v.pickupAvailable, pickupVenueId: v.pickupVenueId || null, shippingAvailable: v.shippingAvailable,
      shippingFee: Number(v.shippingFee || 0), lowStockThreshold: Number(v.lowStockThreshold || 0), sortOrder: Number(v.sortOrder || 0),
    });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: t("shop.admin.saved") });
    if (!id && res.data?.id) router.push(`/admin/shop/${res.data.id}`);
    else router.refresh();
  }

  async function remove() {
    if (!id || !window.confirm(t("shop.admin.deleteConfirm"))) return;
    setBusy(true);
    const res = await deleteProduct(id);
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    if (res.data?.archived) { setMsg({ ok: true, text: t("shop.admin.archived") }); router.refresh(); }
    else router.push("/admin/shop");
  }

  const check = (k: "isActive" | "pickupAvailable" | "shippingAvailable", label: string) => (
    <label className="flex items-center gap-2 text-sm text-text-secondary">
      <input type="checkbox" checked={v[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.checked)} className="h-4 w-4 accent-[var(--red-primary)]" />
      {label}
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Label htmlFor="sp-name">{t("shop.admin.name")}</Label>
          <Input id="sp-name" value={v.name} maxLength={120} required disabled={!canEdit} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="sm:col-span-2"><Label htmlFor="sp-desc">{t("shop.admin.descriptionField")}</Label>
          <Textarea id="sp-desc" value={v.description} maxLength={4000} rows={4} disabled={!canEdit} onChange={(e) => set("description", e.target.value)} /></div>
        <div><Label htmlFor="sp-cat">{t("shop.admin.category")}</Label>
          <Input id="sp-cat" value={v.category} maxLength={60} disabled={!canEdit} onChange={(e) => set("category", e.target.value)} /></div>
        <div><Label htmlFor="sp-price">{t("shop.admin.price", { currency })}</Label>
          <Input id="sp-price" type="number" min={0} step="0.01" value={v.price} disabled={!canEdit} onChange={(e) => set("price", e.target.value)} /></div>
        <div><Label htmlFor="sp-vis">{t("shop.admin.visibility")}</Label>
          <Select id="sp-vis" value={v.visibility} disabled={!canEdit} onChange={(e) => set("visibility", e.target.value as ProductFormValue["visibility"])}>
            <option value="public">{t("shop.admin.visibilityPublic")}</option>
            <option value="members">{t("shop.admin.visibilityMembers")}</option>
          </Select></div>
        <div><Label htmlFor="sp-low">{t("shop.admin.lowStock")}</Label>
          <Input id="sp-low" type="number" min={0} value={v.lowStockThreshold} disabled={!canEdit} onChange={(e) => set("lowStockThreshold", e.target.value)} /></div>
      </div>
      <fieldset className="space-y-3 rounded-md border border-border p-4">
        <legend className="px-1 text-xs uppercase tracking-[0.12em] text-text-muted">{t("shop.admin.fulfillment")}</legend>
        {check("pickupAvailable", t("shop.admin.pickup"))}
        {v.pickupAvailable && (
          <div className="max-w-sm"><Label htmlFor="sp-venue">{t("shop.admin.pickupVenue")}</Label>
            <Select id="sp-venue" value={v.pickupVenueId} disabled={!canEdit} onChange={(e) => set("pickupVenueId", e.target.value)}>
              <option value="">{t("shop.admin.anyVenue")}</option>
              {venues.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select></div>
        )}
        {check("shippingAvailable", t("shop.admin.shipping"))}
        {v.shippingAvailable && (
          <div className="max-w-xs"><Label htmlFor="sp-ship">{t("shop.admin.shippingFee", { currency })}</Label>
            <Input id="sp-ship" type="number" min={0} step="0.01" value={v.shippingFee} disabled={!canEdit} onChange={(e) => set("shippingFee", e.target.value)} />
            <FieldHint>{t("shop.admin.shippingHint")}</FieldHint></div>
        )}
      </fieldset>
      {check("isActive", t("shop.admin.active"))}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>{id ? t("common.save") : t("shop.admin.create")}</Button>
          {id && <Button type="button" variant="ghost" onClick={remove} disabled={busy} className="text-danger">{t("common.delete")}</Button>}
        </div>
      )}
    </form>
  );
}
