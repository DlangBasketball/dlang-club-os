"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, BellOff, BellRing, FilePlus2, FileMinus2, PencilLine, RotateCcw, Scale } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import { ActionDialog } from "./action-dialog";
import { useFormat, useT } from "@/lib/i18n/client";
import { cancelInvoice } from "@/lib/actions/invoice";
import { issueInvoiceAdjustment, reopenInvoice, setInvoiceRemindersPaused, writeOffInvoice } from "@/lib/actions/invoice-edit";
import { checkAdjustment, invoiceMoney } from "@/lib/payments/adjustments";

export type InvoiceMoneyActionsProps = {
  id: string;
  number: string;
  status: string;
  currency: string;
  total: number;
  adjustmentsTotal: number;
  paid: number;
  remindersPaused: boolean;
};

/** Edit / adjust / cancel / reopen / write-off / reminder pause for one invoice (admin + finance). */
export function InvoiceMoneyActions(p: InvoiceMoneyActionsProps) {
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const money = invoiceMoney({ total: p.total, adjustmentsTotal: p.adjustmentsTotal, paid: p.paid, currency: p.currency });
  const fmt = (n: number) => f.money(n, p.currency);

  const isDraft = p.status === "draft";
  const isCancelled = p.status === "cancelled" || p.status === "void";
  const isWrittenOff = p.status === "written_off";
  const issuedOpen = !isDraft && !isCancelled && !isWrittenOff;
  const canCancel = !isCancelled && !isWrittenOff && p.status !== "paid" && money.paid === 0;
  const canWriteOff = issuedOpen && money.outstanding > 0;
  const canRemind = !isDraft && !isCancelled && !isWrittenOff;

  return (
    <div className="flex flex-wrap gap-2">
      {!isCancelled && (
        <Link href={`/admin/invoices/${p.id}/edit`}>
          <Button size="sm" variant="secondary"><PencilLine className="h-4 w-4" /> {t("editMoney.actions.edit")}</Button>
        </Link>
      )}

      {issuedOpen && <AdjustDialog {...p} />}

      {canWriteOff && (
        <ActionDialog
          trigger={<><Scale className="h-4 w-4" /> {t("editMoney.actions.writeOff")}</>}
          triggerVariant="ghost"
          title={t("editMoney.actions.writeOffTitle", { number: p.number })}
          description={t("editMoney.actions.writeOffConfirm", { amount: fmt(money.outstanding) })}
          confirmLabel={t("editMoney.actions.writeOff")}
          danger
          onConfirm={(reason) => writeOffInvoice(p.id, reason)}
        />
      )}

      {canRemind && (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const res = await setInvoiceRemindersPaused(p.id, !p.remindersPaused);
            setBusy(false);
            if (!res.ok) window.alert(res.error);
            else router.refresh();
          }}
        >
          {p.remindersPaused ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}{" "}
          {p.remindersPaused ? t("editMoney.actions.resumeReminders") : t("editMoney.actions.pauseReminders")}
        </Button>
      )}

      {canCancel && (
        <ActionDialog
          trigger={<><Ban className="h-4 w-4" /> {t("editMoney.actions.cancel")}</>}
          triggerVariant="ghost"
          title={t("editMoney.actions.cancelTitle", { number: p.number })}
          description={isDraft ? t("editMoney.actions.cancelDraftConfirm") : t("editMoney.actions.cancelIssuedConfirm", { amount: fmt(money.amountDue) })}
          confirmLabel={t("editMoney.actions.cancel")}
          danger
          onConfirm={(reason) => cancelInvoice(p.id, reason)}
        />
      )}

      {isCancelled && (
        <ActionDialog
          trigger={<><RotateCcw className="h-4 w-4" /> {t("editMoney.actions.reopen")}</>}
          title={t("editMoney.actions.reopenTitle", { number: p.number })}
          description={t("editMoney.actions.reopenConfirm")}
          confirmLabel={t("editMoney.actions.reopen")}
          onConfirm={(reason) => reopenInvoice(p.id, reason)}
        />
      )}
    </div>
  );
}

/** Credit note (reduce) or debit note (add) on an issued invoice. */
function AdjustDialog(p: InvoiceMoneyActionsProps) {
  const t = useT();
  const f = useFormat();
  const [kind, setKind] = React.useState<"credit_note" | "debit_note">("credit_note");
  const [amount, setAmount] = React.useState("");
  const [description, setDescription] = React.useState("");
  const money = invoiceMoney({ total: p.total, adjustmentsTotal: p.adjustmentsTotal, paid: p.paid, currency: p.currency });
  const check = checkAdjustment(kind, Number(amount), money, p.currency);
  const after = check.ok ? money.amountDue + (kind === "debit_note" ? check.amount : -check.amount) : null;

  return (
    <ActionDialog
      trigger={<>{kind === "credit_note" ? <FileMinus2 className="h-4 w-4" /> : <FilePlus2 className="h-4 w-4" />} {t("editMoney.adjust.add")}</>}
      title={t("editMoney.adjust.title", { number: p.number })}
      description={t("editMoney.adjust.hint")}
      confirmLabel={t("editMoney.adjust.issue")}
      onDone={() => { setAmount(""); setDescription(""); }}
      onConfirm={async (reason) => {
        if (!check.ok) return { ok: false, error: t.dynamic(`editMoney.errors.${check.code}`) };
        return issueInvoiceAdjustment(p.id, { kind, amount: check.amount, reason, description });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`adj-kind-${p.id}`}>{t("editMoney.adjust.kind")}</Label>
          <Select id={`adj-kind-${p.id}`} value={kind} onChange={(e) => setKind(e.target.value as "credit_note" | "debit_note")}>
            <option value="credit_note">{t("editMoney.adjust.kinds.credit_note")}</option>
            <option value="debit_note">{t("editMoney.adjust.kinds.debit_note")}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`adj-amt-${p.id}`}>{t("editMoney.common.amountIn", { currency: p.currency })}</Label>
          <Input id={`adj-amt-${p.id}`} inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor={`adj-desc-${p.id}`}>{t("editMoney.adjust.description")}</Label>
        <Input id={`adj-desc-${p.id}`} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <p className="text-sm text-ink-3">
        {t("editMoney.adjust.preview", { from: f.money(money.amountDue, p.currency), to: after == null ? "—" : f.money(after, p.currency) })}
      </p>
    </ActionDialog>
  );
}
