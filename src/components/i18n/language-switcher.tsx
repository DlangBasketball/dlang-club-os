"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe } from "lucide-react";
import { setLocale } from "@/lib/i18n/actions";
import { useLocaleContext, useT } from "@/lib/i18n/client";
import { baseLanguage, directionOf, nativeName } from "@/lib/i18n/languages";
import { cn } from "@/lib/utils";

/**
 * Endonyms for the switcher: "Deutsch", "Français" … The region is only
 * shown when two variants of one language are offered side by side
 * ("English" + "English (UK)").
 */
export function switcherLabels(languages: readonly string[]): Record<string, { name: string; short: string }> {
  const count = new Map<string, number>();
  for (const l of languages) count.set(baseLanguage(l), (count.get(baseLanguage(l)) ?? 0) + 1);
  return Object.fromEntries(
    languages.map((l) => {
      const shared = (count.get(baseLanguage(l)) ?? 0) > 1;
      return [l, { name: nativeName(l, { withRegion: shared }), short: (shared ? l : baseLanguage(l)).toUpperCase() }];
    }),
  );
}

/**
 * Language switcher. Shows only the languages the tenant enables, each in its
 * own language. Persists the choice (cookie + profile), so emails and PDFs
 * follow it too.
 *  - variant "select"  (default): native <select>, accessible and mobile-friendly
 *  - variant "compact": globe + short code, for tight headers
 * `showSingle`: render the current language even when only one is offered
 * (account pages), instead of nothing.
 */
export function LanguageSwitcher({
  variant = "select",
  className,
  showSingle = false,
}: {
  variant?: "select" | "compact";
  className?: string;
  showSingle?: boolean;
}) {
  const ctx = useLocaleContext();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const languages = ctx.languages.length ? ctx.languages : [ctx.locale];
  const options = languages.includes(ctx.locale) ? languages : [ctx.locale, ...languages];
  const labels = switcherLabels(options);
  if (options.length < 2 && !showSingle) return null;

  function change(next: string) {
    if (next === ctx.locale) return;
    startTransition(async () => {
      const res = await setLocale(next);
      if (res.ok) {
        document.documentElement.lang = next;
        document.documentElement.dir = directionOf(next);
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
        disabled={pending || options.length < 2}
        onChange={(e) => change(e.target.value)}
        aria-label={t("shell.languageSwitcher")}
        className={cn(
          "cursor-pointer appearance-none bg-transparent text-xs font-medium text-inherit outline-none",
          variant === "compact" ? "pe-0 uppercase tracking-wide" : "pe-1",
        )}
      >
        {options.map((l) => (
          <option key={l} value={l} lang={l} dir={directionOf(l)} className="bg-bg-secondary text-ink">
            {variant === "compact" ? labels[l].short : labels[l].name}
          </option>
        ))}
      </select>
    </label>
  );
}
