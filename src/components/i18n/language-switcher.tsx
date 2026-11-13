"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { setLocale } from "@/lib/i18n/actions";
import { useLocaleContext, useT } from "@/lib/i18n/client";
import { LOCALE_NAMES, LOCALE_SHORT, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Language switcher. Shows only the languages the tenant enables.
 *  - variant "select"  (default): native <select>, accessible and mobile-friendly
 *  - variant "compact": globe + short code, for tight headers
 */
export function LanguageSwitcher({
  variant = "select",
  className,
}: {
  variant?: "select" | "compact";
  className?: string;
}) {
  const ctx = useLocaleContext();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const languages = ctx.languages.length ? ctx.languages : [ctx.locale];
  if (languages.length < 2) return null;

  function change(next: string) {
    if (next === ctx.locale) return;
    startTransition(async () => {
      const res = await setLocale(next);
      if (res.ok) {
        document.documentElement.lang = next;
        router.refresh();
      }
    });
  }

  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md text-ink-3 transition-colors hover:text-ink",
        variant === "compact" ? "px-1.5 py-1" : "border border-line bg-surface px-2 py-1.5",
        pending && "opacity-60",
        className,
      )}
      title={t("shell.languageSwitcher")}
    >
      <Globe className="h-4 w-4 shrink-0" aria-hidden />
      <span className="sr-only">{t("shell.languageSwitcher")}</span>
      <select
        value={ctx.locale}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        aria-label={t("shell.languageSwitcher")}
        className={cn(
          "cursor-pointer appearance-none bg-transparent text-xs font-medium text-inherit outline-none",
          variant === "compact" ? "pr-0 uppercase tracking-wide" : "pr-1",
        )}
      >
        {languages.map((l: Locale) => (
          <option key={l} value={l} lang={l} className="bg-bg-secondary text-ink">
            {variant === "compact" ? LOCALE_SHORT[l] : LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
