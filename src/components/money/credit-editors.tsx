"use client";

import * as React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Input, Label, Select } from "@/components/ui";
import { ActionDialog } from "./action-dialog";
import { useFormat, useT } from "@/lib/i18n/client";
import { adjustTrainingCredits } from "@/lib/actions/credits";
import { adjustFamilyCredit } from "@/lib/actions/payments";
import { trainingCreditChange } from "@/lib/payments/adjustments";

type Cat = "personal" | "nutrition" | "mental";
const CATS: Cat[] = ["personal", "nutrition", "mental"];

/** Grant / adjust / revoke one athlete's training credits, with a reason. */
export function TrainingCreditAdjust({
  athleteId,
  name,
  totals,
}: {
  athleteId: string;
  name: string;
  totals: Record<Cat, { total: number; used: number }>;
}) {
  const t = useT();
  const [cat, setCat] = React.useState<Cat>("personal");
  const [mode, setMode] = React.useState<"delta" | "total">("delta");
  const [value, setValue] = React.useState("1");
  const cur = totals[cat];
  const n = Number(value);
  const change = trainingCreditChange(cur, mode === "delta" ? { delta: n } : { newTotal: n });

  return (
    <ActionDialog
      trigger={<><SlidersHorizontal className="h-4 w-4" /> {t("editMoney.training.adjust")}</>}
      triggerVariant="ghost"
      title={t("editMoney.training.adjustTitle", { athlete: name })}
      confirmLabel={t("editMoney.common.save")}
      onConfirm={(reason) => {
        if (!Number.isInteger(n)) return Promise.resolve({ ok: false as const, error: t("editMoney.errors.INVALID_CREDITS") });
        if (!change.ok) return Promise.resolve({ ok: false as const, error: t.dynamic(`editMoney.errors.${change.code}`) });
        return adjustTrainingCredits(mode === "delta" ? { athleteId, category: cat, delta: n, reason } : { athleteId, category: cat, newTotal: n, reason });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor={`cr-cat-${athleteId}`}>{t("editMoney.training.category")}</Label>
          <Select id={`cr-cat-${athleteId}`} value={cat} onChange={(e) => setCat(e.target.value as Cat)}>
            {CATS.map((c) => <option key={c} value={c}>{t.dynamic(`editMoney.training.categories.${c}`, undefined, c)}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`cr-mode-${athleteId}`}>{t("editMoney.training.mode")}</Label>
          <Select id={`cr-mode-${athleteId}`} value={mode} onChange={(e) => setMode(e.target.value as "delta" | "total")}>
            <option value="delta">{t("editMoney.training.modeDelta")}</option>
            <option value="total">{t("editMoney.training.modeTotal")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`cr-val-${athleteId}`}>{mode === "delta" ? t("editMoney.training.delta") : t("editMoney.training.newTotal")}</Label>
          <Input id={`cr-val-${athleteId}`} type="number" step={1} required value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      </div>
      <p className="text-sm text-ink-3">
        {t("editMoney.training.current", { total: cur.total, used: cur.used, balance: cur.total - cur.used })}
        {change.ok && <> — {t("editMoney.training.after", { total: change.total, balance: change.balance })}</>}
      </p>
      {!change.ok && value !== "" && <p className="text-sm text-warning">{t.dynamic(`editMoney.errors.${change.code}`)}</p>}
    </ActionDialog>
  );
}

/** Grant credits to any athlete (ledgered, with a reason). */
export function GrantCreditsWithReason({ athletes }: { athletes: { athleteId: string; name: string }[] }) {
  const t = useT();
  const [athleteId, setAthleteId] = React.useState(athletes[0]?.athleteId ?? "");
  const [cat, setCat] = React.useState<Cat>("personal");
  const [credits, setCredits] = React.useState("1");
  const n = Number(credits);
  const name = athletes.find((a) => a.athleteId === athleteId)?.name ?? "";
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="grant-athlete">{t("editMoney.training.athlete")}</Label>
        <Select id="grant-athlete" className="w-48" value={athleteId} onChange={(e) => setAthleteId(e.target.value)}>
          {athletes.map((a) => <option key={a.athleteId} value={a.athleteId}>{a.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="grant-cat">{t("editMoney.training.category")}</Label>
        <Select id="grant-cat" className="w-36" value={cat} onChange={(e) => setCat(e.target.value as Cat)}>
          {CATS.map((c) => <option key={c} value={c}>{t.dynamic(`editMoney.training.categories.${c}`, undefined, c)}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="grant-n">{t("editMoney.training.credits")}</Label>
        <Input id="grant-n" type="number" min={1} step={1} className="w-24" value={credits} onChange={(e) => setCredits(e.target.value)} />
      </div>
      <ActionDialog
        trigger={t("editMoney.training.grant")}
        triggerVariant="primary"
        disabled={!athleteId || !(n > 0)}
        title={t("editMoney.training.grantTitle", { credits: n, athlete: name })}
        confirmLabel={t("editMoney.training.grant")}
        onConfirm={(reason) => adjustTrainingCredits({ athleteId, category: cat, delta: n, reason })}
      />
    </div>
  );
}

/** Manual family-credit correction (goodwill credit or credit paid out). */
export function FamilyCreditAdjust({ familyId, familyName, currency, balance }: { familyId: string; familyName: string; currency: string; balance: number }) {
  const t = useT();
  const f = useFormat();
  const [amount, setAmount] = React.useState("");
  return (
    <ActionDialog
      trigger={<><SlidersHorizontal className="h-4 w-4" /> {t("editMoney.credit.adjust")}</>}
      triggerVariant="ghost"
      title={t("editMoney.credit.adjustTitle", { family: familyName })}
      description={t("editMoney.credit.adjustHint", { balance: f.money(balance, currency) })}
      confirmLabel={t("editMoney.common.save")}
      onConfirm={(reason) => adjustFamilyCredit(familyId, currency, Number(amount), reason)}
    >
      <div>
        <Label htmlFor={`fc-amt-${familyId}-${currency}`}>{t("editMoney.common.amountIn", { currency })}</Label>
        <Input id={`fc-amt-${familyId}-${currency}`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
    </ActionDialog>
  );
}
