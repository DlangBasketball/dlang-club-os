import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  LANGUAGES,
  LOCALES,
  BCP47_PATTERN,
  canonicalizeTag,
  catalogChain,
  catalogLocaleFor,
  directionOf,
  fallbackChain,
  intlTagFor,
  isLocale,
  matchLocale,
  nativeName,
} from "@/lib/i18n/languages";
import { BASE_LOCALES, LOCALE_NAMES, normalizeLocale, regionFor } from "@/lib/i18n/config";
import { matchAcceptLanguage, parseAcceptLanguage, pickLocale, resolveLocale } from "@/lib/i18n/negotiate";
import { buildOverlay, britishEnglish, mapMessageText, swissGerman, type MessageTree } from "@/lib/i18n/overlay-transforms";
import { CATALOGS, getMessages, getStandaloneI18n } from "@/lib/i18n/messages";
import { mergeCatalogs, type PartialMessages } from "@/lib/i18n/translator";
import { tenantLocaleSettingsFromRows } from "@/lib/i18n/tenant-settings";
import { CATALOG_SOURCES } from "@/messages";
import { registrationConfirmation, htmlLangAttrs } from "@/lib/email/templates";
import { render } from "@/lib/notifications/templates";
import { paymentFooterText } from "@/lib/invoice-pdf";
import { switcherLabels } from "@/components/i18n/language-switcher";

const MESSAGES = path.resolve(__dirname, "../../src/messages");
const readCatalog = (tag: string): MessageTree => JSON.parse(readFileSync(path.join(MESSAGES, `${tag}.json`), "utf8"));
const flat = (o: unknown, p = "", out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const key = p ? `${p}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flat(v, key, out);
  }
  return out;
};
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/[’']/g, "'");

describe("language registry", () => {
  it("is one source of truth: LOCALES and the catalog index derive from it", () => {
    const withCatalog = LANGUAGES.filter((l) => l.status !== "none").map((l) => l.tag);
    expect([...LOCALES]).toEqual(withCatalog);
    expect(Object.keys(CATALOG_SOURCES).sort()).toEqual([...withCatalog].sort());
    for (const tag of withCatalog) expect(existsSync(path.join(MESSAGES, `${tag}.json`))).toBe(true);
    for (const l of LANGUAGES.filter((x) => x.status === "none")) {
      expect(existsSync(path.join(MESSAGES, `${l.tag}.json`))).toBe(false);
      expect(isLocale(l.tag)).toBe(false);
    }
  });

  it("has valid tags, endonyms, directions and fallback chains ending in English", () => {
    for (const l of LANGUAGES) {
      expect(l.tag).toMatch(BCP47_PATTERN);
      expect(l.nativeName.length).toBeGreaterThan(1);
      expect(["ltr", "rtl"]).toContain(l.dir);
      expect(fallbackChain(l.tag).at(-1)).toBe("en");
      if ("overlay" in l) expect(LANGUAGES.some((b) => b.tag === l.overlay.base)).toBe(true);
    }
  });

  it("ships the Swiss launch languages complete and enabled for Swiss regions", () => {
    for (const tag of ["de", "de-CH", "fr", "fr-CH", "it", "it-CH", "en", "en-GB"]) {
      expect(LANGUAGES.find((l) => l.tag === tag)?.status).toBe("complete");
    }
    expect(BASE_LOCALES).toEqual(expect.arrayContaining(["de", "fr", "it", "en"]));
    expect(LOCALE_NAMES.de).toBe("Deutsch");
    expect(LOCALE_NAMES.fr).toBe("Français");
    expect(LOCALE_NAMES["de-CH"]).toBe("Deutsch (Schweiz)");
  });

  it("resolves fallback chains, by registry or by truncation", () => {
    expect(fallbackChain("de-CH")).toEqual(["de-CH", "de", "en"]);
    expect(fallbackChain("fr-CH")).toEqual(["fr-CH", "fr", "en"]);
    expect(fallbackChain("en-GB")).toEqual(["en-GB", "en"]);
    expect(fallbackChain("pt-BR")).toEqual(["pt-BR", "pt", "en"]);
    expect(fallbackChain("de-AT")).toEqual(["de-AT", "de", "en"]);
    expect(fallbackChain("zh-Hant-TW")).toEqual(["zh-Hant-TW", "zh-Hant", "zh", "en"]);
    expect(fallbackChain("en")).toEqual(["en"]);
    expect(fallbackChain("nonsense!")).toEqual(["en"]);
    // Only languages with a catalog take part in loading.
    expect(catalogChain("de-CH")).toEqual(["de-CH", "de", "en"]);
    expect(catalogChain("pt-BR")).toEqual(["en"]);
    expect(catalogChain("de-AT")).toEqual(["de", "en"]);
  });

  it("canonicalises tags like the database does", () => {
    expect(canonicalizeTag("DE_ch")).toBe("de-CH");
    expect(canonicalizeTag(" zh-hant-tw ")).toBe("zh-Hant-TW");
    expect(canonicalizeTag("es-419")).toBe("es-419");
    expect(canonicalizeTag("en-US-x-private")).toBe("en-US");
    expect(canonicalizeTag("de-C")).toBeNull();
    expect(canonicalizeTag("german")).toBeNull();
    expect(canonicalizeTag("")).toBeNull();
  });

  it("matches arbitrary tags to a renderable language", () => {
    expect(matchLocale("de-AT")).toBe("de");
    expect(matchLocale("fr-CH")).toBe("fr-CH");
    expect(matchLocale("en-US")).toBe("en");
    expect(matchLocale("pt-BR")).toBeNull();
    expect(normalizeLocale("it_ch")).toBe("it-CH");
  });

  it("picks the regional catalog from the tenant region", () => {
    expect(catalogLocaleFor("de", "CH")).toBe("de-CH");
    expect(catalogLocaleFor("de", "LI")).toBe("de-CH");
    expect(catalogLocaleFor("de", "DE")).toBe("de");
    expect(catalogLocaleFor("fr", "CH")).toBe("fr-CH");
    expect(catalogLocaleFor("fr", "FR")).toBe("fr");
    expect(catalogLocaleFor("it", "CH")).toBe("it-CH");
    expect(catalogLocaleFor("en", "CH")).toBe("en-GB");
    expect(catalogLocaleFor("en", "US")).toBe("en");
    expect(catalogLocaleFor("de-CH", "DE")).toBe("de-CH");
  });

  it("builds Intl tags from language + region", () => {
    expect(intlTagFor("de", "CH")).toBe("de-CH");
    expect(intlTagFor("en", "CH")).toBe("en-CH");
    expect(intlTagFor("en-GB", "CH")).toBe("en-CH");
    expect(intlTagFor("fr")).toBe("fr-FR");
    expect(regionFor("en", { en: "US" }, "CH")).toBe("US");
    expect(regionFor("en-GB", {}, "CH")).toBe("GB");
    expect(regionFor("de", null, "AT")).toBe("AT");
  });
});

describe("text direction (RTL readiness)", () => {
  it("resolves dir from the registry, then by language/script", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("he-IL")).toBe("rtl");
    expect(directionOf("fa")).toBe("rtl");
    expect(directionOf("ur-PK")).toBe("rtl");
    expect(directionOf("az-Arab")).toBe("rtl");
    expect(directionOf("az-Latn")).toBe("ltr");
    expect(directionOf("de-CH")).toBe("ltr");
    expect(directionOf(null)).toBe("ltr");
    expect(LANGUAGES.find((l) => l.tag === "ar")?.dir).toBe("rtl");
  });

  it("smoke: an RTL recipient gets dir=rtl on the email document", () => {
    expect(htmlLangAttrs({ language: "ar" })).toBe('lang="ar" dir="rtl"');
    expect(htmlLangAttrs({ language: "de-CH" })).toBe('lang="de-CH" dir="ltr"');
    const r = render("invoice_sent", { invoice_number: "INV-1" }, { language: "he" });
    expect(r.html).toContain('dir="rtl"');
  });
});

describe("overlays", () => {
  it("swissGerman replaces ß with ss (and capital ẞ)", () => {
    expect(swissGerman("Straße, Größe, GROẞ")).toBe("Strasse, Grösse, GROSS");
  });

  it("generates a thin de-CH overlay: only changed keys, ICU syntax untouched, terms win", () => {
    const base: MessageTree = {
      a: { close: "Schließen", open: "Öffnen" },
      b: "{count, plural, one {# Größe} other {# Größen}} für {name}",
      c: "Gesamt",
    };
    const overlay = buildOverlay(base, "swiss-german", { c: "Total" });
    expect(overlay).toEqual({ a: { close: "Schliessen" }, b: "{count, plural, one {# Grösse} other {# Grössen}} für {name}", c: "Total" });
  });

  it("British spelling leaves placeholders and select selectors alone", () => {
    expect(britishEnglish("Program colors, canceled enrollment")).toBe("Programme colours, cancelled enrolment");
    expect(mapMessageText("{program} · {kind, select, program {Program} other {Camp}}", britishEnglish)).toBe(
      "{program} · {kind, select, program {Programme} other {Camp}}",
    );
  });

  it("checked-in generated overlays match their base + terms (run npm run i18n:sync)", () => {
    for (const l of LANGUAGES) {
      if (!("overlay" in l) || l.status === "none" || l.overlay.transform === "none") continue;
      const termsFile = path.join(MESSAGES, "overlays", `${l.tag}.terms.json`);
      const terms = existsSync(termsFile) ? JSON.parse(readFileSync(termsFile, "utf8")) : {};
      expect(readCatalog(l.tag)).toEqual(buildOverlay(readCatalog(l.overlay.base), l.overlay.transform, terms));
    }
  });

  it("merges en <- base <- overlay so missing keys always resolve", () => {
    const de = getMessages("de");
    const deCH = getMessages("de-CH");
    expect(de.common.close).toBe("Schließen");
    expect(deCH.common.close).toBe("Schliessen");
    expect(deCH.common.save).toBe(de.common.save);
    expect(Object.values(flat(deCH)).some((v) => /[ßẞ]/.test(v))).toBe(false);
    expect(Object.keys(flat(deCH)).length).toBe(Object.keys(flat(getMessages("en"))).length);
    // Swiss terms
    expect(deCH.common.total).toBe("Total");
    expect(de.common.total).toBe("Gesamt");
    expect(getMessages("fr-CH").sports.locations.postalCode).toBe("NPA");
    expect(getMessages("fr").sports.locations.postalCode).toBe("Code postal");
    expect(getMessages("it-CH").sports.locations.postalCode).toBe("NPA");
    expect(getMessages("en-GB").nav.programs).toBe("Programmes");
    expect(getMessages("en").nav.programs).toBe("Programs");
    // Unknown / uncatalogued tags fall back to English.
    expect(getMessages("pt-BR")).toEqual(getMessages("en"));
    expect(CATALOGS["it-CH"].common.save).toBe(getMessages("it").common.save);
  });

  it("mergeCatalogs: later layers win, empty strings never override", () => {
    const en = { common: { save: "Save", cancel: "Cancel" } } as unknown as PartialMessages;
    const partial = { common: { save: "Speichern", cancel: "" } } as unknown as PartialMessages;
    const merged = mergeCatalogs(en, partial) as unknown as { common: Record<string, string> };
    expect(merged.common).toEqual({ save: "Speichern", cancel: "Cancel" });
    expect((en as unknown as { common: Record<string, string> }).common.save).toBe("Save");
  });
});

describe("negotiation", () => {
  const SWISS = ["de", "fr", "it", "en"];

  it("parses Accept-Language by quality", () => {
    expect(parseAcceptLanguage("de-CH,de;q=0.9,en;q=0.8")).toEqual(["de-CH", "de", "en"]);
    expect(parseAcceptLanguage("en;q=0.2, fr-CH, *;q=0.1, it;q=0")).toEqual(["fr-CH", "en"]);
  });

  it("matches de-CH,de;q=0.9,en;q=0.8 through the fallback chains", () => {
    const h = "de-CH,de;q=0.9,en;q=0.8";
    expect(matchAcceptLanguage(h)).toBe("de-CH");
    expect(matchAcceptLanguage(h, ["de", "fr", "it", "en"])).toBe("de");
    expect(matchAcceptLanguage(h, ["fr", "en"])).toBe("en");
    expect(matchAcceptLanguage("pt-BR,pt;q=0.9")).toBeNull();
    expect(matchAcceptLanguage("pt-BR,pt;q=0.9,fr;q=0.5", ["de", "fr"])).toBe("fr");
    expect(pickLocale("de", ["de-CH", "fr-CH"])).toBe("de-CH");
    expect(pickLocale("pt-BR", ["de", "en"])).toBeNull();
  });

  it("order: user preference -> cookie -> Accept-Language -> tenant default", () => {
    const accept = "de-CH,de;q=0.9,en;q=0.8";
    expect(resolveLocale({ userPreference: "it", cookie: "fr", acceptLanguage: accept, tenantDefault: "en", tenantLanguages: SWISS })).toBe("it");
    expect(resolveLocale({ cookie: "fr", acceptLanguage: accept, tenantDefault: "en", tenantLanguages: SWISS })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: accept, tenantDefault: "fr", tenantLanguages: SWISS })).toBe("de");
    expect(resolveLocale({ acceptLanguage: "pt-BR,pt;q=0.9", tenantDefault: "fr", tenantLanguages: SWISS })).toBe("fr");
    // A preference outside the club's languages is ignored.
    expect(resolveLocale({ userPreference: "es", acceptLanguage: "es", tenantDefault: "de", tenantLanguages: SWISS })).toBe("de");
    // A regional preference maps to the enabled base language.
    expect(resolveLocale({ userPreference: "fr-CH", tenantLanguages: SWISS })).toBe("fr");
    expect(resolveLocale({})).toBe("en");
  });

  it("reads tenant settings from the stored rows", () => {
    const s = tenantLocaleSettingsFromRows(
      "org-1",
      { country: "CH", default_locale: "de-CH", supported_locales: ["de-CH", "fr-CH"] },
      { default_locale: "de", enabled_locales: ["de", "fr", "it", "en", "nl"], settings: { localization: { regions: { en: "gb", de: "CH", bad: "Switzerland" } } } },
    );
    expect(s.languages).toEqual(["de", "fr", "it", "en"]);
    expect(s.defaultLocale).toBe("de");
    expect(s.regions).toEqual({ en: "GB", de: "CH" });
  });
});

describe("out-of-request rendering in the recipient's language", () => {
  it("Swiss club: German with Swiss spelling and Swiss formats; German club: ß", () => {
    const ch = getStandaloneI18n({ locale: "de", country: "CH", currency: "CHF" });
    expect(ch.catalogLocale).toBe("de-CH");
    expect(ch.t("common.close")).toBe("Schliessen");
    expect(norm(ch.f.money(1234.5))).toBe("CHF 1'234.50");
    const de = getStandaloneI18n({ locale: "de", country: "DE", currency: "EUR" });
    expect(de.catalogLocale).toBe("de");
    expect(de.t("common.close")).toBe("Schließen");
    expect(norm(de.f.money(1234.5))).toBe("1.234,50 €");
    expect(getStandaloneI18n({ locale: "en", country: "CH" }).catalogLocale).toBe("en-GB");
    expect(getStandaloneI18n({ locale: "en", country: "US" }).catalogLocale).toBe("en");
  });

  it("emails render in de / fr / it / en", () => {
    const base = { parentName: "Carla", programName: "Camp", children: ["Mia"], invoiceNumber: "INV-1", totalChf: 10, dueDateLabel: "1.7.2026", manageUrl: "https://x.test" };
    expect(registrationConfirmation({ ...base, language: "de-CH" }).subject).toBe("Anmeldung erhalten – Camp (INV-1)");
    expect(registrationConfirmation({ ...base, language: "de-CH" }).html).toContain('lang="de-CH"');
    expect(registrationConfirmation({ ...base, language: "fr-CH" }).html).toContain("Bonjour Carla");
    expect(registrationConfirmation({ ...base, language: "it-CH" }).html).toContain("Ciao Carla");
    expect(registrationConfirmation(base).subject).toBe("Registration received — Camp (INV-1)");
  });

  it("notifications render in the recipient's language", () => {
    const vars = { parent_name: "Carla", invoice_number: "INV-9", amount_due: 50, due_date: "2026-06-30" };
    expect(render("payment_overdue", vars, { language: "de-CH", locale: "de-CH" }).subject).toBe("Zahlungserinnerung: Rechnung INV-9 ist überfällig");
    expect(render("payment_overdue", vars, { language: "fr-CH" }).html).toContain("Bonjour Carla,");
    expect(render("invoice_sent", vars, { language: "it" }).title).toBe("Fattura INV-9 emessa");
    // Values are escaped, never interpreted as HTML.
    expect(render("invoice_sent", { ...vars, invoice_number: "<b>x</b>" }, {}).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("invoice PDF footer is translated", () => {
    const { t } = getStandaloneI18n({ locale: "de", country: "CH" });
    expect(paymentFooterText([{ key: "card", label: "Karte", via: "stripe" }, { key: "qr_bill", label: "QR", via: "offline" }], t)).toBe(
      "Bezahle online (Karte) in deinem Elternkonto oder per Banküberweisung auf das Clubkonto.",
    );
  });
});

describe("language switcher labels", () => {
  it("uses endonyms and shows the region only for two variants of one language", () => {
    expect(switcherLabels(["de", "fr", "it", "en"])).toEqual({
      de: { name: "Deutsch", short: "DE" },
      fr: { name: "Français", short: "FR" },
      it: { name: "Italiano", short: "IT" },
      en: { name: "English", short: "EN" },
    });
    const both = switcherLabels(["en", "en-GB"]);
    expect(both["en-GB"]).toEqual({ name: "English (UK)", short: "EN-GB" });
    expect(nativeName("de-CH", { withRegion: false })).toBe("Deutsch");
  });
});
