import Link from "next/link";
import type { Translator } from "@/lib/i18n/translator";
import { cn } from "@/lib/utils";

export const ACCOUNTING_SECTIONS = ["overview", "bank", "exports", "periods", "refunds", "dunning", "support", "chart"] as const;
export type AccountingSection = (typeof ACCOUNTING_SECTIONS)[number];

const HREF: Record<AccountingSection, string> = {
  overview: "/admin/accounting",
  bank: "/admin/accounting/bank",
  exports: "/admin/accounting/exports",
  periods: "/admin/accounting/periods",
  refunds: "/admin/accounting/refunds",
  dunning: "/admin/accounting/dunning",
  support: "/admin/accounting/support",
  chart: "/admin/accounting/chart",
};

/** Tab strip shared by the accounting pages. */
export function AccountingNav({ t, active }: { t: Translator; active: AccountingSection }) {
  return (
    <nav aria-label={t("accounting.nav.label")} className="-mx-1 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border px-1">
        {ACCOUNTING_SECTIONS.map((k) => (
          <li key={k}>
            <Link
              href={HREF[k]}
              aria-current={active === k ? "page" : undefined}
              className={cn(
                "inline-block border-b-2 px-3 py-2 text-sm transition-colors",
                active === k ? "border-brand-primary text-ink" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {t.dynamic(`accounting.nav.${k}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function sectionHref(k: AccountingSection): string {
  return HREF[k];
}
