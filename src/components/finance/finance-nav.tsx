import Link from "next/link";
import { Download } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

export const HUB_TABS = ["balances", "transactions", "payments", "invoices", "expenses"] as const;
export type HubTab = (typeof HUB_TABS)[number];
export type FinanceSection = HubTab | "payouts" | "reports" | "lists";

/** Tab strip shared by the finance hub and its sub-pages. */
export function FinanceNav({ t, active }: { t: Translator; active: FinanceSection }) {
  const items: { key: FinanceSection; href: string }[] = [
    ...HUB_TABS.map((k) => ({ key: k as FinanceSection, href: `/admin/finance?tab=${k}` })),
    { key: "payouts", href: "/admin/finance/payouts" },
    { key: "reports", href: "/admin/finance/reports" },
  ];
  return (
    <nav aria-label={t("finance.nav.label")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {items.map((i) => (
          <li key={i.key}>
            <Link
              href={i.href}
              aria-current={active === i.key ? "page" : undefined}
              className={cn(
                "inline-block border-b-2 px-3 py-2 text-sm transition-colors",
                active === i.key ? "border-brand-primary text-ink" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {t.dynamic(`finance.nav.${i.key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** GET form: date range + currency (+ hidden extra params). */
export function RangeForm({ t, action, from, to, currency, currencies, hidden = {}, children, showRange = true }: {
  t: Translator; action: string; from: string; to: string; currency?: string; currencies?: string[];
  hidden?: Record<string, string>; children?: React.ReactNode; showRange?: boolean;
}) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {showRange && (
        <>
          <div><Label htmlFor="fin-from">{t("finance.filters.from")}</Label><Input id="fin-from" name="from" type="date" defaultValue={from} className="w-44" /></div>
          <div><Label htmlFor="fin-to">{t("finance.filters.to")}</Label><Input id="fin-to" name="to" type="date" defaultValue={to} className="w-44" /></div>
        </>
      )}
      {currencies && currencies.length > 1 && (
        <div>
          <Label htmlFor="fin-cur">{t("finance.filters.currency")}</Label>
          <Select id="fin-cur" name="currency" defaultValue={currency} className="w-28">
            {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
      )}
      {children}
      <Button type="submit" size="sm" variant="secondary" className="h-10">{t("finance.filters.apply")}</Button>
    </form>
  );
}

export function ExportLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} prefetch={false} className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink">
      <Download className="h-3.5 w-3.5" aria-hidden /> {label}
    </Link>
  );
}
