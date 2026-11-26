"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";
import { createInvoice } from "@/lib/actions/invoice";
import { useFormat, useT } from "@/lib/i18n/client";
import { MANUAL_INVOICE_CATEGORIES, categoryLabelKey } from "@/lib/billing/activities";

type Item = { description: string; quantity: string; unit_price_chf: string };
const emptyItem = (): Item => ({ description: "", quantity: "1", unit_price_chf: "" });

export function InvoiceForm({ families, prefixes, year }: {
  families: { id: string; name: string }[];
  /** Invoice-number prefix per revenue category (club settings); missing = standard numbering. */
  prefixes: Partial<Record<string, string>>;
  /** Issue year in the club time zone, for the number preview. */
  year: number;
}) {
  const f = useFormat();
  const t = useT();
  const [familyId, setFamilyId] = React.useState("");
  const [category, setCategory] = React.useState("");
  // One idempotency key per form: a double submit or retry returns the same invoice.
  const [requestId] = React.useState(() => crypto.randomUUID());
  const [description, setDescription] = React.useState("");
  const [dueDate, setDueDate] = React.useState("");
  const [discount, setDiscount] = React.useState("");
  const [items, setItems] = React.useState<Item[]>([emptyItem()]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const setItem = (i: number, k: keyof Item) => (v: string) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price_chf) || 0), 0);
  const total = subtotal - (Number(discount) || 0);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await createInvoice({
      family_id: familyId,
      activity: category as (typeof MANUAL_INVOICE_CATEGORIES)[number],
      request_id: requestId,
      description,
      due_date: dueDate,
      discount_chf: Number(discount) || 0,
      items: items.map((it) => ({ description: it.description, quantity: Number(it.quantity) || 0, unit_price_chf: Number(it.unit_price_chf) || 0 })),
    });
    setPending(false);
    if (res && !res.ok) setError(res.error);
  }

  return (
    <Card className="max-w-3xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="family">{t("billing.invoiceForm.family")}</Label>
              <select id="family" required value={familyId} onChange={(e) => setFamilyId(e.target.value)} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
                <option value="">{t("billing.invoiceForm.chooseFamily")}</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="category">{t("billing.invoice.category")}</Label>
              <select id="category" required value={category} onChange={(e) => setCategory(e.target.value)} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
                <option value="">{t("billing.invoice.chooseCategory")}</option>
                {MANUAL_INVOICE_CATEGORIES.map((c) => <option key={c} value={c}>{t(categoryLabelKey(c))}</option>)}
              </select>
              {category && (
                <p className="mt-1 text-xs text-ink-3" aria-live="polite">
                  {prefixes[category]
                    ? t("billing.invoiceForm.numberPreview", { number: `${prefixes[category]}-${year}-####` })
                    : t("billing.invoiceForm.numberStandard")}
                </p>
              )}
            </div>
            <div><Label htmlFor="due">{t("billing.invoiceForm.dueDate")}</Label><Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <div><Label htmlFor="desc">{t("billing.invoiceForm.description")}</Label><Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("billing.invoiceForm.descriptionPlaceholder")} /></div>

          <div>
            <Label>{t("billing.invoiceForm.lineItems")}</Label>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="flex-1" placeholder={t("billing.invoiceForm.itemDescription")} aria-label={t("billing.invoiceForm.itemDescription")} value={it.description} onChange={(e) => setItem(i, "description")(e.target.value)} />
                  <Input className="w-16" placeholder={t("billing.invoiceForm.quantity")} aria-label={t("billing.invoiceForm.quantity")} value={it.quantity} onChange={(e) => setItem(i, "quantity")(e.target.value)} />
                  <Input className="w-28" placeholder={t("billing.invoiceForm.unitPrice")} aria-label={t("billing.invoiceForm.unitPrice")} value={it.unit_price_chf} onChange={(e) => setItem(i, "unit_price_chf")(e.target.value)} />
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))} className="px-2 text-ink-3 hover:text-danger" aria-label={t("billing.invoiceForm.removeLine")}><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setItems((a) => [...a, emptyItem()])}><Plus className="h-4 w-4" /> {t("billing.invoiceForm.addLine")}</Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="disc">{t("billing.invoiceForm.discount")}</Label><Input id="disc" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-surface-elevated px-4 py-3 text-sm">
            <span className="text-ink-2">{t("billing.invoiceForm.total")}</span>
            <span className="tnum text-base font-semibold text-ink">{f.money(total)}</span>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? t("billing.invoiceForm.creating") : t("billing.invoiceForm.create")}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
