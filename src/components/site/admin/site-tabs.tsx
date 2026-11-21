import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Translator } from "@/lib/i18n/translator";

const TABS = [
  ["pages", "/admin/site"],
  ["posts", "/admin/site/posts"],
  ["forms", "/admin/site/forms"],
  ["redirects", "/admin/site/redirects"],
  ["import", "/admin/site/import"],
  ["settings", "/admin/site/settings"],
] as const;

/** Sub-navigation of Admin -> Site. */
export function SiteTabs({ t, current }: { t: Translator; current: (typeof TABS)[number][0] }) {
  return (
    <nav aria-label={t("site.admin.title")} className="-mt-2 mb-6 overflow-x-auto">
      <ul className="flex gap-1 border-b border-border">
        {TABS.map(([key, href]) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={key === current ? "page" : undefined}
              className={cn(
                "inline-flex min-h-tap items-center border-b-2 px-3 text-sm font-medium",
                key === current ? "border-brand-primary text-text" : "border-transparent text-text-muted hover:text-text",
              )}
            >
              {t.dynamic(`site.admin.tabs.${key}`)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
