import { CreditCard, Smartphone, Landmark, Banknote, QrCode } from "lucide-react";

const ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  card: CreditCard, twint: Smartphone, bank_transfer: Landmark, manual: Banknote, qr_bill: QrCode,
};

export function PaymentMethods({ methods }: { methods: { key: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {methods.map((m) => {
        const Icon = ICON[m.key] ?? Banknote;
        return (
          <span key={m.key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-elevated px-3 py-1 text-xs text-ink-2">
            <Icon className="h-3.5 w-3.5" /> {m.label}
          </span>
        );
      })}
    </div>
  );
}
