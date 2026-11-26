/**
 * i18n public surface (isomorphic parts only).
 *
 *   Server components / actions:  import { getI18n, getTranslations, getFormatter } from "@/lib/i18n/server";
 *   Client components:            import { useT, useFormat, useLocale } from "@/lib/i18n/client";
 *   Emails / PDFs / cron:         import { getStandaloneI18n } from "@/lib/i18n/messages";
 *   Formatting primitives:        import { formatMoney, formatDate, ... } from "@/lib/format";
 *   Language registry:            import { LANGUAGES, nativeName, fallbackChain } from "@/lib/i18n/languages";
 *
 * Adding a string:
 *   1. Add the key to src/messages/en.json (source of truth, US English).
 *   2. Add the translation to every complete catalog (de/fr/it) — `tsc` fails until each has it;
 *      partial catalogs (beta) may lag and fall back.
 *   3. Use it: t("namespace.key", { var }) — keys are type-checked.
 *   4. Run `npm run i18n:sync` (regional overlays) and `npm run i18n:check`.
 *
 * Adding a language: docs/i18n/ADDING_A_LANGUAGE.md.
 */
export * from "./config";
export { matchAcceptLanguage, parseAcceptLanguage, pickLocale, resolveLocale, allowedLocales, type LocaleSources } from "./negotiate";
export {
  createTranslator,
  formatMessage,
  mergeCatalogs,
  type MessageKey,
  type Messages,
  type Namespace,
  type NamespaceKey,
  type PartialMessages,
  type TranslateValues,
  type Translator,
} from "./translator";
