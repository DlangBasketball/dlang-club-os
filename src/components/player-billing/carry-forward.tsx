"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Input, Label, Select } from "@/components/ui";
import { ActionDialog } from "@/components/money/action-dialog";
import { useFormat, useT } from "@/lib/i18n/client";
import { carryForwardMembership } from "@/lib/actions/billing";
import { parseAmount } from "@/lib/billing/player-billing";
import { newRequestId } from "@/lib/billing/request-id";

/**
 * Carry an open amount of this season's membership forward to the player's
 * membership in a later season (membership_carry_forward): a separate Club
 * Membership invoice, shown on its own line and never counted in the later
 * season's fee. One request id per dialog open (no duplicate on retry).
 */
export function CarryForwardButton({ fromMembershipId, targets, currency, balance }: {
  fromMembershipId: string; targets: { id: string; seasonName: string }[]; currency: string; balance: number;
}) {
  const t = useT();
  const f = useFormat();
  const id = React.useId();
  const [to, setTo] = React.useState(targets[0]?.id ?? "");
  const [amount, setAmount] = React.useState(balance > 0 ? String(balance) : "");
  const requestId = React.useRef(newRequestId());

  if (!targets.length) return <p className="text-xs text-text-muted">{t("playerBilling.carry.noTarget")}</p>;
  return (
    <ActionDialog
      trigger={<><ArrowRight className="h-4 w-4" aria-hidden /> {t("playerBilling.carry.button")}</>}
      title={t("playerBilling.carry.title")}
      description={t("playerBilling.carry.hint", { balance: f.money(balance, currency) })}
      confirmLabel={t("playerBilling.carry.confirm")}
      reasonLabel={t("playerBilling.carry.reason")}
      onConfirm={async (reason) => {
        const value = parseAmount(amount);
        const res = await carryForwardMembership({
          fromMembershipId, toMembershipId: to, amount: value != null && Number.isFinite(value) ? value : 0, reason, requestId: requestId.current,
        });
        if (res.ok) requestId.current = newRequestId();
        return res.ok ? { ok: true, message: t("playerBilling.carry.done", { number: res.data?.number ?? "" }) } : res;
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-to`}>{t("playerBilling.carry.to")}</Label>
          <Select id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value)}>
            {targets.map((x) => <option key={x.id} value={x.id}>{x.seasonName}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor={`${id}-amount`}>{t("playerBilling.carry.amount", { currency })}</Label>
          <Input id={`${id}-amount`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
    </ActionDialog>
  );
}
