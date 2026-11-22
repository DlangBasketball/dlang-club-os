"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Select } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { SELECTABLE_CATEGORIES, categoryLabelKey } from "@/lib/billing/activities";
import { saveBillingEntity, setBillingEntityRoute, setInvoiceNumberPrefix } from "@/lib/actions/billing";
import type { BillingEntitiesView, BillingEntity } from "@/lib/data/billing";

type Msg = { ok: boolean; text: string } | null;
type FormState = {
  id: string | null; name: string; legalName: string; street: string; buildingNumber: string; addressExtra: string; postalCode: string;
  city: string; country: string; vatNumber: string; iban: string; qrIban: string; email: string; phone: string; isDefault: boolean; isActive: boolean;
};
const TEXT_FIELDS = ["name", "legalName", "street", "buildingNumber", "addressExtra", "postalCode", "city", "country", "vatNumber", "iban", "qrIban", "email", "phone"] as const;

const toForm = (e?: BillingEntity): FormState => ({
  id: e?.id ?? null, name: e?.name ?? "", legalName: e?.legalName ?? "", street: e?.street ?? "", buildingNumber: e?.buildingNumber ?? "",
  addressExtra: e?.addressExtra ?? "", postalCode: e?.postalCode ?? "", city: e?.city ?? "", country: e?.country ?? "CH",
  vatNumber: e?.vatNumber ?? "", iban: e?.iban ?? "", qrIban: e?.qrIban ?? "", email: e?.email ?? "", phone: e?.phone ?? "",
  isDefault: e?.isDefault ?? false, isActive: e?.isActive ?? true,
});

function Status({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return <span role="status" className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{msg.text}</span>;
}

function EntityForm({ initial, onDone }: { initial: FormState; onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  const [f, setF] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<Msg>(null);
  const set = (k: (typeof TEXT_FIELDS)[number]) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await saveBillingEntity({ ...f, id: f.id });
    setBusy(false);
    if (!res.ok) return setMsg({ ok: false, text: res.error });
    router.refresh();
    onDone();
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TEXT_FIELDS.map((k) => (
          <div key={k}>
            <Label htmlFor={`be-${k}`}>{t(`billing.entities.fields.${k}`)}</Label>
            <Input id={`be-${k}`} value={f[k]} onChange={set(k)} required={k === "name"} maxLength={k === "country" ? 2 : 140}
              type={k === "email" ? "email" : "text"} autoComplete="off" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-6 text-sm text-ink">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.isDefault} onChange={(e) => setF({ ...f, isDefault: e.target.checked, isActive: e.target.checked ? true : f.isActive })} />
          {t("billing.entities.fields.isDefault")}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.isActive} disabled={f.isDefault} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
          {t("billing.entities.fields.isActive")}
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy}>{busy ? t("common.saving") : t("common.save")}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>{t("common.cancel")}</Button>
        <Status msg={msg} />
      </div>
    </form>
  );
}

function address(e: BillingEntity) {
  return [[e.street, e.buildingNumber].filter(Boolean).join(" "), [e.postalCode, e.city].filter(Boolean).join(" "), e.country]
    .filter(Boolean).join(", ");
}

export function BillingEntitiesEditor({ view }: { view: BillingEntitiesView }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = React.useState<string | "new" | null>(null);
  const [msg, setMsg] = React.useState<Msg>(null);
  const [prefixes, setPrefixes] = React.useState<Record<string, string>>(
    Object.fromEntries(SELECTABLE_CATEGORIES.map((c) => [c, view.numberSeries[c]?.prefix ?? ""])),
  );
  const year = new Date().getFullYear();
  const active = view.entities.filter((e) => e.isActive);
  const def = view.entities.find((e) => e.isDefault);

  async function route(category: string, entityId: string) {
    setMsg(null);
    const res = await setBillingEntityRoute({ activity: category, entityId: entityId || null });
    setMsg(res.ok ? { ok: true, text: res.message ?? t("billing.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }
  async function savePrefix(category: string) {
    setMsg(null);
    const res = await setInvoiceNumberPrefix({ category, prefix: prefixes[category]?.trim() || null });
    setMsg(res.ok ? { ok: true, text: res.message ?? t("billing.saved") } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-sm text-ink-3">{t("billing.entities.description")}</p>
      {view.migrationDefaultCount > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-ink">
          {t("billing.entities.reviewNotice", { count: view.migrationDefaultCount })}
        </div>
      )}
      {!view.canEdit && <p className="text-sm text-ink-3">{t("billing.entities.readOnly")}</p>}

      <Card>
        <CardHeader><CardTitle>{t("billing.entities.listTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          {view.entities.map((e) => (
            <div key={e.id} className="rounded-md border border-line p-4">
              {editing === e.id ? (
                <EntityForm initial={toForm(e)} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{e.name}</span>
                      {e.isDefault && <Badge tone="success">{t("billing.entities.default")}</Badge>}
                      {!e.isActive && <Badge tone="neutral">{t("billing.entities.inactive")}</Badge>}
                    </div>
                    {e.legalName && e.legalName !== e.name && <div className="text-ink-2">{e.legalName}</div>}
                    {address(e) && <div className="text-ink-3">{address(e)}</div>}
                    {(e.iban || e.qrIban) && (
                      <div className="font-mono text-xs text-ink-3">{[e.iban, e.qrIban].filter(Boolean).join(" · ")}</div>
                    )}
                    {e.vatNumber && <div className="text-ink-3">{t("billing.entities.fields.vatNumber")}: {e.vatNumber}</div>}
                  </div>
                  {view.canEdit && <Button variant="ghost" size="sm" onClick={() => setEditing(e.id)}>{t("billing.entities.edit")}</Button>}
                </div>
              )}
            </div>
          ))}
          {view.canEdit && (editing === "new"
            ? <div className="rounded-md border border-line p-4"><EntityForm initial={toForm()} onDone={() => setEditing(null)} /></div>
            : <Button variant="secondary" onClick={() => setEditing("new")}>{t("billing.entities.add")}</Button>)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("billing.entities.routingTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-3">{t("billing.entities.routingHint")}</p>
          <div className="space-y-2">
            {SELECTABLE_CATEGORIES.map((c) => (
              <div key={c} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[14rem_1fr]">
                <Label htmlFor={`route-${c}`}>{t(categoryLabelKey(c))}</Label>
                <Select id={`route-${c}`} disabled={!view.canEdit} value={view.routes[c] ?? ""} onChange={(e) => route(c, e.target.value)}>
                  <option value="">{t("billing.entities.useDefault", { name: def?.name ?? "—" })}</option>
                  {active.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </Select>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t("billing.entities.numberingTitle")}</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-3">{t("billing.entities.numberingHint")}</p>
          {SELECTABLE_CATEGORIES.map((c) => {
            const prefix = (prefixes[c] ?? "").trim();
            return (
              <div key={c} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[14rem_12rem_auto_1fr]">
                <Label htmlFor={`prefix-${c}`}>{t(categoryLabelKey(c))}</Label>
                <Input id={`prefix-${c}`} value={prefixes[c] ?? ""} maxLength={24} disabled={!view.canEdit}
                  placeholder={t("billing.entities.noPrefix")} onChange={(e) => setPrefixes({ ...prefixes, [c]: e.target.value })} />
                {view.canEdit
                  ? <Button variant="ghost" size="sm" onClick={() => savePrefix(c)}>{t("common.save")}</Button>
                  : <span />}
                <span className="text-xs text-ink-3">
                  {prefix ? t("billing.entities.example", { example: `${prefix}-${year}-0001` }) : t("billing.entities.noPrefix")}
                </span>
              </div>
            );
          })}
        </CardBody>
      </Card>
      <Status msg={msg} />
    </div>
  );
}
