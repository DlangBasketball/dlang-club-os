"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { adjustStock, deleteVariant, removeProductImage, saveVariant, uploadProductImage } from "@/lib/actions/shop";
import { isLowStock } from "@/lib/shop/cart";
import type { ShopVariant } from "@/lib/shop/data";

type Row = { id: string | null; sku: string; size: string; color: string; price: string; isActive: boolean; sortOrder: number; stock: number };

const toRow = (v: ShopVariant): Row => ({
  id: v.id, sku: v.sku ?? "", size: v.size ?? "", color: v.color ?? "", price: "", isActive: v.isActive, sortOrder: v.sortOrder, stock: v.stock,
});

/** Variants (size / colour, SKU, own price), stock per variant and movements (admin). */
export function VariantManager({ productId, variants, productPrice, currency, lowStockThreshold, canEdit }: {
  productId: string; variants: ShopVariant[]; productPrice: number; currency: string; lowStockThreshold: number; canEdit: boolean;
}) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [rows, setRows] = React.useState<Row[]>(() => variants.map((v) => ({ ...toRow(v), price: v.price !== productPrice ? String(v.price) : "" })));
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [stockFor, setStockFor] = React.useState<string | null>(null);
  const [delta, setDelta] = React.useState("1");
  const [kind, setKind] = React.useState<"restock" | "adjustment">("restock");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    setRows(variants.map((v) => ({ ...toRow(v), price: v.price !== productPrice ? String(v.price) : "" })));
  }, [variants, productPrice]);

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save(i: number) {
    const r = rows[i];
    setBusy(true); setMsg(null);
    const res = await saveVariant(productId, { id: r.id, sku: r.sku, size: r.size, color: r.color, price: r.price === "" ? null : Number(r.price), isActive: r.isActive, sortOrder: r.sortOrder });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: t("shop.admin.saved") });
    router.refresh();
  }
  async function remove(i: number) {
    const r = rows[i];
    if (!r.id) return setRows((rs) => rs.filter((_, j) => j !== i));
    if (!window.confirm(t("shop.admin.variantDeleteConfirm"))) return;
    const res = await deleteVariant(productId, r.id);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    router.refresh();
  }
  async function moveStock(e: React.FormEvent) {
    e.preventDefault();
    if (!stockFor) return;
    setBusy(true); setMsg(null);
    const res = await adjustStock({ variantId: stockFor, delta: Number(delta), kind, reason });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    setMsg({ ok: true, text: t("shop.admin.stockSaved", { stock: res.data?.stock ?? 0 }) });
    setStockFor(null); setReason(""); setDelta("1");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-text-muted">
            <tr><th className="p-2">{t("shop.admin.sku")}</th><th className="p-2">{t("shop.admin.size")}</th><th className="p-2">{t("shop.admin.color")}</th>
              <th className="p-2">{t("shop.admin.variantPrice")}</th><th className="p-2">{t("shop.admin.stock")}</th><th className="p-2">{t("shop.admin.active")}</th><th className="p-2" /></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className="border-t border-border">
                <td className="p-2"><Input aria-label={t("shop.admin.sku")} value={r.sku} maxLength={40} disabled={!canEdit} onChange={(e) => update(i, { sku: e.target.value })} className="min-w-[7rem] font-mono" /></td>
                <td className="p-2"><Input aria-label={t("shop.admin.size")} value={r.size} maxLength={30} disabled={!canEdit} onChange={(e) => update(i, { size: e.target.value })} className="min-w-[5rem]" /></td>
                <td className="p-2"><Input aria-label={t("shop.admin.color")} value={r.color} maxLength={30} disabled={!canEdit} onChange={(e) => update(i, { color: e.target.value })} className="min-w-[5rem]" /></td>
                <td className="p-2"><Input aria-label={t("shop.admin.variantPrice")} type="number" min={0} step="0.01" value={r.price} placeholder={f.money(productPrice, currency)} disabled={!canEdit} onChange={(e) => update(i, { price: e.target.value })} className="min-w-[6rem]" /></td>
                <td className="p-2 whitespace-nowrap">
                  {r.id ? (
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{r.stock}</span>
                      {isLowStock(r.stock, lowStockThreshold) && <Badge tone={r.stock === 0 ? "danger" : "warning"}>{r.stock === 0 ? t("shop.soldOut") : t("shop.admin.lowStockBadge")}</Badge>}
                      {canEdit && <Button type="button" size="sm" variant="ghost" onClick={() => { setStockFor(r.id); setKind("restock"); }}>{t("shop.admin.moveStock")}</Button>}
                    </span>
                  ) : "—"}
                </td>
                <td className="p-2"><input type="checkbox" aria-label={t("shop.admin.active")} checked={r.isActive} disabled={!canEdit} onChange={(e) => update(i, { isActive: e.target.checked })} className="h-4 w-4 accent-[var(--red-primary)]" /></td>
                <td className="p-2 whitespace-nowrap">
                  {canEdit && <>
                    <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => save(i)}>{t("common.save")}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => remove(i)} aria-label={t("common.delete")}><Trash2 className="h-4 w-4 text-danger" aria-hidden /></Button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <Button type="button" size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, { id: null, sku: "", size: "", color: "", price: "", isActive: true, sortOrder: rs.length, stock: 0 }])}>
          <Plus className="h-4 w-4" aria-hidden /> {t("shop.admin.addVariant")}
        </Button>
      )}
      {stockFor && (
        <form onSubmit={moveStock} className="grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-4">
          <div><Label htmlFor="mv-kind">{t("shop.admin.movementKind")}</Label>
            <Select id="mv-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="restock">{t("shop.movements.restock")}</option>
              <option value="adjustment">{t("shop.movements.adjustment")}</option>
            </Select></div>
          <div><Label htmlFor="mv-delta">{t("shop.admin.quantity")}</Label>
            <Input id="mv-delta" type="number" step={1} min={kind === "restock" ? 1 : undefined} value={delta} onChange={(e) => setDelta(e.target.value)} /></div>
          <div className="sm:col-span-2"><Label htmlFor="mv-reason">{t("shop.admin.reason")}</Label>
            <Input id="mv-reason" value={reason} maxLength={500} required={kind === "adjustment"} onChange={(e) => setReason(e.target.value)} /></div>
          <div className="flex gap-2 sm:col-span-4">
            <Button type="submit" size="sm" loading={busy}>{t("shop.admin.applyMovement")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setStockFor(null)}>{t("common.cancel")}</Button>
          </div>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</p>}
    </div>
  );
}

/** Product photos (public bucket: no personal data on product images). */
export function ProductImages({ productId, images, canEdit }: { productId: string; images: { path: string; url: string }[]; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("productId", productId);
    fd.set("file", file);
    const res = await uploadProductImage(fd);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    router.refresh();
  }
  async function remove(path: string) {
    const res = await removeProductImage(productId, path);
    if (!res.ok) return setErr(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-3">
        {images.map((img) => (
          <li key={img.path} className="relative h-24 w-24 overflow-hidden rounded-md border border-border bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" className="h-full w-full object-cover" />
            {canEdit && (
              <button type="button" onClick={() => remove(img.path)} aria-label={t("shop.admin.removeImage")}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"><X className="h-3 w-3" aria-hidden /></button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && images.length < 8 && (
        <>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} />
          <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => inputRef.current?.click()}>
            <ImagePlus className="h-4 w-4" aria-hidden /> {t("shop.admin.addImage")}
          </Button>
        </>
      )}
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
    </div>
  );
}
