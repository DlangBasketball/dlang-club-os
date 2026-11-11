"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardBody, Button, Input, Label } from "@/components/ui";
import { createInvoice } from "@/lib/actions/invoice";
import { formatCHF } from "@/lib/utils";

type Item = { description: string; quantity: string; unit_price_chf: string };
const emptyItem = (): Item => ({ description: "", quantity: "1", unit_price_chf: "" });

export function InvoiceForm({ families }: { families: { id: string; name: string }[] }) {
  const [familyId, setFamilyId] = React.useState("");
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
              <Label htmlFor="family">Family</Label>
              <select id="family" required value={familyId} onChange={(e) => setFamilyId(e.target.value)} className="h-10 w-full rounded border border-line bg-surface-input px-3 text-sm text-ink">
                <option value="">Select a family…</option>
                {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div><Label htmlFor="due">Due date</Label><Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          </div>
          <div><Label htmlFor="desc">Description</Label><Input id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Spring term coaching" /></div>

          <div>
            <Label>Line items</Label>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="flex gap-2">
                  <Input className="flex-1" placeholder="Description" value={it.description} onChange={(e) => setItem(i, "description")(e.target.value)} />
                  <Input className="w-16" placeholder="Qty" value={it.quantity} onChange={(e) => setItem(i, "quantity")(e.target.value)} />
                  <Input className="w-28" placeholder="Unit CHF" value={it.unit_price_chf} onChange={(e) => setItem(i, "unit_price_chf")(e.target.value)} />
                  {items.length > 1 && (
                    <button type="button" onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))} className="px-2 text-ink-3 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              ))}
            </div>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setItems((a) => [...a, emptyItem()])}><Plus className="h-4 w-4" /> Add line</Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div><Label htmlFor="disc">Discount (CHF)</Label><Input id="disc" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" /></div>
          </div>

          <div className="flex items-center justify-between rounded-md bg-surface-elevated px-4 py-3 text-sm">
            <span className="text-ink-2">Total</span>
            <span className="tnum text-base font-semibold text-ink">{formatCHF(total)}</span>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create invoice (draft)"}</Button>
        </form>
      </CardBody>
    </Card>
  );
}
