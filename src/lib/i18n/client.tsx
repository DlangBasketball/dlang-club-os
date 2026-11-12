"use client";

import * as React from "react";
import { createTranslator, type Messages, type Translator } from "./translator";
import { createFormatter, type Formatter } from "@/lib/format";
import { DEFAULT_LOCALE, LOCALES, type Locale, type LocaleContext } from "./config";

type I18nValue = {
  ctx: LocaleContext;
  t: Translator;
  f: Formatter;
};

const I18nContext = React.createContext<I18nValue | null>(null);

/**
 * Provides the active locale, its catalog and the tenant formatting context to
 * client components. Rendered by the root layout (and re-rendered nested on
 * tenant-specific public pages such as /register/[slug]).
 */
export function I18nProvider({
  ctx,
  messages,
  children,
}: {
  ctx: LocaleContext;
  messages: Messages;
  children: React.ReactNode;
}) {
  const value = React.useMemo<I18nValue>(
    () => ({
      ctx,
      t: createTranslator(ctx.locale, messages, undefined, ctx.intlLocale),
      f: createFormatter({ locale: ctx.intlLocale, currency: ctx.currency, timeZone: ctx.timeZone }),
    }),
    [ctx, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const FALLBACK_CTX: LocaleContext = {
  locale: DEFAULT_LOCALE,
  intlLocale: "en-CH",
  currency: "CHF",
  timeZone: "Europe/Zurich",
  country: "CH",
  languages: [...LOCALES],
  orgId: null,
};

function useI18n(): I18nValue {
  const v = React.useContext(I18nContext);
  if (!v) {
    throw new Error("useT/useFormat/useLocale must be used inside <I18nProvider> (rendered by the root layout).");
  }
  return v;
}

/** Translator for client components: `const t = useT(); t("nav.home")`. */
export function useT(): Translator {
  return useI18n().t;
}

/** Tenant-aware formatter: `const f = useFormat(); f.money(12)`. */
export function useFormat(): Formatter {
  return useI18n().f;
}

/** Active UI locale + tenant context. */
export function useLocale(): Locale {
  return useI18n().ctx.locale;
}

export function useLocaleContext(): LocaleContext {
  return React.useContext(I18nContext)?.ctx ?? FALLBACK_CTX;
}
