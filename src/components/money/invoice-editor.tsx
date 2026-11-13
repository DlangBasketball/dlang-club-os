"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, CardBody, Input, Label, Select, Textarea } from "@/components/ui";
import { useFormat, useT } from "@/lib/i18n/client";
import { updateDraftInvoice, updateInvoiceDetails } from "@/lib/actions/invoice-edit";
import { draftTotals } from "@/lib/payments/adjustments";

const LOCALES = ["en", "de", "fr", "it", "es"] as const;

type Line = { description: string; quantity: string; unitPrice: string };

export type DraftEditorProps = {
  id: string;
  number: string;
  currency: string;
  reference: string | null;
  families: { id: string; name: string }[];
  initial: {
    familyId: string;
    description: string;
    dueDate: string;
    notes: string;
    locale: string;
    taxRate: number;
    taxInclusive: boolean;
    items: { description: string; quantity: number; unitPrice: number }[];
  };
};

function LocaleSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const t = useT();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("editMoney.invoice.languageDefault")}</option>
      {LOCALES.map((l) => <option key={l} value={l}>{t.dynamic(`editMoney.languages.${l}`, undefined, l)}</option>)}
    </Select>
  );
}

/** Free editor for a draft (never issued) invoice. */
export function DraftInvoiceEditor(p: DraftEditorProps) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [familyId, setFamilyId] = React.useState(p.initial.familyId);
  const [description, setDescription] = React.useState(p.initial.description);
  const [dueDate, setDueDate] = React.useState(p.initial.dueDate);
  const [notes, setNotes] = React.useState(p.initial.notes);
  const [locale, setLocale] = React.useState(p.initial.locale);
  const [taxRate, setTaxRate] = React.useState(String(p.initial.taxRate));
  const [taxInclusive, setTaxInclusive] = React.useState(p.initial.taxInclusive);
  const [discount, setDiscount] = React.useState("");
  const [discountLabel, setDiscountLabel] = React.useState("");
  const [lines, setLines] = React.useState<Line[]>(
    p.initial.items.length
      ? p.initial.items.map((it) => ({ description: it.description, quantity: String(it.quantity), unitPrice: String(it.unitPrice) }))
      : [{ description: "", quantity: "1", unitPrice: "" }],
  );
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const totals = draftTotals(
    lines.map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0 })),
    Number(discount) || 0,
    p.currency,
  );
  const setLine = (i: number, k: keyof Line) => (v: string) => setLines((arr) => arr.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!totals.valid) {
      setError(t("editMoney.errors.INVALID_TOTAL"));
      return;
    }
    if (!window.confirm(t("editMoney.invoice.saveDraftConfirm", { amount: f.money(totals.total, p.currency) }))) return;
    setPending(true);
    setError(null);
    const res = await updateDraftInvoice(p.id, {
      family_id: familyId,
      description,
      due_date: dueDate,
      notes,
      locale: locale as "" | (typeof LOCALES)[number],
      tax_rate: Number(taxRate) || 0,
      tax_inclusive: taxInclusive,
      discount: Number(discount) || 0,
      discount_label: discountLabel || t("editMoney.invoice.discountLabelDefault"),
      items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 0, unit_price: Number(l.unitPrice) || 0 })),
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push(`/admin/invoices/${p.id}`);
    router.refresh();
  }

  return (
    <Card className="max-w-3xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-5">
          <p className="text-sm text-ink-3">{t("editMoney.invoice.draftHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-family">{t("editMoney.invoice.family")}</Label>
              <Select id="ed-family" required value={familyId} onChange={(e) => setFamilyId(e.target.value)}>
                {p.families.map((fam) => <option key={fam.id} value={fam.id}>{fam.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="ed-due">{t("editMoney.invoice.dueDate")}</Label>
              <Input id="ed-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="ed-desc">{t("editMoney.invoice.description")}</Label>
            <Input id="ed-desc" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-text-muted">{t("editMoney.invoice.lines")}</legend>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap gap-2 sm:flex-nowrap">
                  <Input aria-label={t("editMoney.invoice.lineDescription")} placeholder={t("editMoney.invoice.lineDescription")} className="min-w-0 flex-1" required value={l.description} onChange={(e) => setLine(i, "description")(e.target.value)} />
                  <Input aria-label={t("editMoney.invoice.quantity")} placeholder={t("editMoney.invoice.quantity")} className="w-20" inputMode="decimal" required value={l.quantity} onChange={(e) => setLine(i, "quantity")(e.target.value)} />
                  <Input aria-label={t("editMoney.invoice.unitPrice", { currency: p.currency })} placeholder={t("editMoney.invoice.unitPrice", { currency: p.currency })} className="w-32" inputMode="decimal" required value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice")(e.target.value)} />
                  {lines.length > 1 && (
                    <button type="button" aria-label={t("editMoney.invoice.removeLine")} onClick={() => setLines((arr) => arr.filter((_, idx) => idx !== i))} className="px-2 text-ink-3 hover:text-danger">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink-3">{t("editMoney.invoice.negativeLineHint")}</p>
            <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setLines((a) => [...a, { description: "", quantity: "1", unitPrice: "" }])}>
              <Plus className="h-4 w-4" /> {t("editMoney.invoice.addLine")}
            </Button>
          </fieldset>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="ed-disc">{t("editMoney.invoice.discount", { currency: p.currency })}</Label>
              <Input id="ed-disc" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="ed-disc-label">{t("editMoney.invoice.discountLabel")}</Label>
              <Input id="ed-disc-label" maxLength={200} value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} placeholder={t("editMoney.invoice.discountLabelDefault")} />
            </div>
            <div>
              <Label htmlFor="ed-tax">{t("editMoney.invoice.taxRate")}</Label>
              <Input id="ed-tax" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
              <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} />
              {t("editMoney.invoice.taxInclusive")}
            </label>
            <div>
              <Label htmlFor="ed-locale">{t("editMoney.invoice.language")}</Label>
              <LocaleSelect id="ed-locale" value={locale} onChange={setLocale} />
            </div>
          </div>
          <div>
            <Label htmlFor="ed-notes">{t("editMoney.invoice.notes")}</Label>
            <Textarea id="ed-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="mt-1 text-xs text-ink-3">{t("editMoney.invoice.notesHint")}</p>
          </div>

          <div className="flex items-center justify-between rounded-md bg-surface-elevated px-4 py-3 text-sm">
            <span className="text-ink-2">{t("editMoney.invoice.total")}</span>
            <span className="tnum text-base font-semibold text-ink">{f.money(totals.total, p.currency)}</span>
          </div>
          {p.reference && <p className="text-xs text-ink-3">{t("editMoney.invoice.referenceStable", { reference: p.reference })}</p>}

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? t("editMoney.common.working") : t("editMoney.invoice.saveDraft")}</Button>
            <Button type="button" variant="ghost" onClick={() => router.push(`/admin/invoices/${p.id}`)}>{t("editMoney.common.back")}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Safe edits on an issued invoice: due date, notes, language, reminder pause. */
export function InvoiceDetailsForm({
  id,
  initial,
}: {
  id: string;
  initial: { dueDate: string; notes: string; locale: string; remindersPaused: boolean };
}) {
  const t = useT();
  const router = useRouter();
  const [dueDate, setDueDate] = React.useState(initial.dueDate);
  const [notes, setNotes] = React.useState(initial.notes);
  const [locale, setLocale] = React.useState(initial.locale);
  const [paused, setPaused] = React.useState(initial.remindersPaused);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = React.useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMsg(null);
    const res = await updateInvoiceDetails(id, {
      due_date: dueDate,
      notes,
      locale: locale as "" | (typeof LOCALES)[number],
      reminders_paused: paused,
    });
    setPending(false);
    setMsg(res.ok ? { ok: true, text: res.message ?? t("editMoney.invoice.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <Card className="max-w-3xl">
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-ink-3">{t("editMoney.invoice.issuedHint")}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="det-due">{t("editMoney.invoice.dueDate")}</Label>
              <Input id="det-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="det-locale">{t("editMoney.invoice.language")}</Label>
              <LocaleSelect id="det-locale" value={locale} onChange={setLocale} />
            </div>
          </div>
          <div>
            <Label htmlFor="det-notes">{t("editMoney.invoice.notes")}</Label>
            <Textarea id="det-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <p className="mt-1 text-xs text-ink-3">{t("editMoney.invoice.notesHint")}</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            {t("editMoney.invoice.remindersPaused")}
          </label>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>{pending ? t("editMoney.common.working") : t("editMoney.common.save")}</Button>
            <Button type="button" variant="ghost" onClick={() => router.push(`/admin/invoices/${id}`)}>{t("editMoney.common.back")}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
