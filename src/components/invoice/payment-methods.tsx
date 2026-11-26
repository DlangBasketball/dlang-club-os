import { CreditCard, Smartphone, Landmark, Banknote, QrCode, Wallet, Building2, Clock } from "lucide-react";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  card: CreditCard,
  apple_pay: Wallet,
  google_pay: Wallet,
  twint: Smartphone,
  bank_transfer: Landmark,
  qr_bill: QrCode,
  manual: Banknote,
  sepa_debit: Building2,
  ach: Building2,
  ideal: Smartphone,
  bancontact: Smartphone,
};

export type PaymentMethodChip = {
  key: string;
  label: string;
  /** "stripe" = pay online now; "offline" = instructions, reconciled by the club. */
  via?: "stripe" | "offline";
  /** Bank debits (SEPA / ACH) confirm after a few business days. */
  delayedSettlement?: boolean;
};

export function PaymentMethods({ methods }: { methods: PaymentMethodChip[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {methods.map((m) => {
        const Icon = ICON[m.key] ?? Banknote;
        return (
          <span
            key={m.key}
            title={m.delayedSettlement ? "Confirms in 3–5 business days" : undefined}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-elevated px-3 py-1 text-xs text-ink-2"
          >
            <Icon className="h-3.5 w-3.5" /> {m.label}
            {m.delayedSettlement && <Clock className="h-3 w-3 text-ink-3" aria-label="delayed settlement" />}
          </span>
        );
      })}
    </div>
  );
}
