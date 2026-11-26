import Link from "next/link";
import { cn } from "@/lib/utils";
import { getTranslations } from "@/lib/i18n/server";

/** Tabs shared by the admin forms / contracts pages. */
export async function FormsNav({ active }: { active: "forms" | "completion" | "contracts" | "templates" }) {
  const t = await getTranslations();
  const tabs = [
    { key: "forms", href: "/admin/forms", label: t("forms.nav.forms") },
    { key: "completion", href: "/admin/forms/completion", label: t("forms.nav.completion") },
    { key: "contracts", href: "/admin/contracts", label: t("forms.nav.contracts") },
    { key: "templates", href: "/admin/contracts/templates", label: t("forms.nav.templates") },
  ] as const;
  return (
    <nav className="flex flex-wrap gap-1 border-b border-line" aria-label={t("forms.nav.label")}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={active === tab.key ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active === tab.key ? "border-maroon text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
