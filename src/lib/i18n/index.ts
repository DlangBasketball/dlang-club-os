/**
 * i18n public surface (isomorphic parts only).
 *
 *   Server components / actions:  import { getI18n, getTranslations, getFormatter } from "@/lib/i18n/server";
 *   Client components:            import { useT, useFormat, useLocale } from "@/lib/i18n/client";
 *   Emails / PDFs / cron:         import { getStandaloneI18n } from "@/lib/i18n/messages";
 *   Formatting primitives:        import { formatMoney, formatDate, ... } from "@/lib/format";
 *
 * Adding a string:
 *   1. Add the key to src/messages/en.json (source of truth).
 *   2. Add the translation to de/fr/it/es.json — `tsc` fails until every locale has it.
 *   3. Use it: t("namespace.key", { var }) — keys are type-checked.
 *   4. Run `node scripts/i18n-check.mjs` (placeholders, plurals, Swiss "ss", unknown keys).
 */
export * from "./config";
export { matchAcceptLanguage, resolveLocale, type LocaleSources } from "./negotiate";
export {
  createTranslator,
  formatMessage,
  type MessageKey,
  type Messages,
  type Namespace,
  type NamespaceKey,
  type TranslateValues,
  type Translator,
} from "./translator";
