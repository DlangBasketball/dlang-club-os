import { describe, expect, it } from "vitest";
import { APP_NAME_MAX, appNameError, appNameFromBranding, resolveAppName, sanitizeAppName } from "@/lib/tenant/app-name";
import { DEFAULT_PLATFORM_NAME, PLATFORM_NAME, platformNameFrom } from "@/lib/brand";
import { rowToTenant } from "@/lib/tenant/normalize";
import { fallbackTenant } from "@/lib/tenant/defaults";
import { fromHeader } from "@/lib/email/resend";
import type { PublicTenantRow } from "@/lib/tenant/types";

const row = (branding: unknown, name = "DLang Basketball"): PublicTenantRow => ({
  id: "00000000-0000-0000-0000-000000000001",
  slug: "dlang",
  name,
  custom_domain: null,
  branding,
  terminology: {},
  sport: "basketball",
  country: "CH",
  default_locale: "fr-CH",
  supported_locales: ["fr-CH", "en"],
  currency: "CHF",
  timezone: "Europe/Zurich",
  status: "active",
});

describe("platform brand", () => {
  it("comes from the env with a neutral default", () => {
    expect(platformNameFrom("Global Sport OS")).toBe("Global Sport OS");
    expect(platformNameFrom("  ")).toBe(DEFAULT_PLATFORM_NAME);
    expect(platformNameFrom(undefined)).toBe(DEFAULT_PLATFORM_NAME);
    expect(platformNameFrom('Evil "<b>"\nName')).toBe("Evil bName");
    expect(PLATFORM_NAME.length).toBeGreaterThan(0);
  });
});

describe("sanitizeAppName", () => {
  it("accepts plain names and collapses whitespace", () => {
    expect(sanitizeAppName("DLang OS")).toBe("DLang OS");
    expect(sanitizeAppName("  DLang   OS ")).toBe("DLang OS");
    expect(sanitizeAppName("Équipe Genève · App")).toBe("Équipe Genève · App");
  });
  it("treats empty / non-strings as unset", () => {
    expect(sanitizeAppName("")).toBeNull();
    expect(sanitizeAppName("   ")).toBeNull();
    expect(sanitizeAppName(null)).toBeNull();
    expect(sanitizeAppName(42)).toBeNull();
  });
  it("rejects markup, template characters, control characters and long names (same rules as the DB)", () => {
    expect(sanitizeAppName("<script>x</script>")).toBeNull();
    expect(sanitizeAppName("{{name}}")).toBeNull();
    expect(sanitizeAppName('A "quoted" name')).toBeNull();
    expect(sanitizeAppName("back\\slash")).toBeNull();
    expect(sanitizeAppName("two\nlines")).toBeNull();
    expect(sanitizeAppName("x".repeat(APP_NAME_MAX))).toBe("x".repeat(APP_NAME_MAX));
    expect(sanitizeAppName("x".repeat(APP_NAME_MAX + 1))).toBeNull();
  });
  it("explains why an admin's input is refused", () => {
    expect(appNameError("")).toBeNull();
    expect(appNameError("DLang OS")).toBeNull();
    expect(appNameError("x".repeat(APP_NAME_MAX + 1))).toBe("tooLong");
    expect(appNameError("<b>")).toBe("invalidChars");
    expect(appNameError("a\tb")).toBe("invalidChars");
  });
});

describe("resolveAppName", () => {
  it("uses the club's app name when set", () => {
    expect(resolveAppName("DLang Basketball", { app_name: "DLang OS" })).toBe("DLang OS");
    expect(appNameFromBranding({ app_name: "DLang OS" })).toBe("DLang OS");
  });
  it("falls back to the organization name, then the platform name", () => {
    expect(resolveAppName("DLang Basketball", {})).toBe("DLang Basketball");
    expect(resolveAppName("DLang Basketball", { app_name: "" })).toBe("DLang Basketball");
    expect(resolveAppName("DLang Basketball", { app_name: "<x>" })).toBe("DLang Basketball");
    expect(resolveAppName("DLang Basketball", null)).toBe("DLang Basketball");
    expect(resolveAppName("", null)).toBe(PLATFORM_NAME);
  });
});

describe("tenant.appName", () => {
  it("is read from public branding by rowToTenant", () => {
    const t = rowToTenant(row({ app_name: "DLang OS" }), "subdomain");
    expect(t.appName).toBe("DLang OS");
    expect(t.name).toBe("DLang Basketball");
  });
  it("defaults to the club name, and to the platform name without a tenant", () => {
    expect(rowToTenant(row({}), "subdomain").appName).toBe("DLang Basketball");
    expect(fallbackTenant().appName).toBe(PLATFORM_NAME);
  });
  it("keeps other clubs' names separate (no cross-tenant bleed)", () => {
    const a = rowToTenant(row({ app_name: "DLang OS" }), "subdomain");
    const b = rowToTenant({ ...row({}, "Riverside High Soccer"), id: "10000000-0000-0000-0000-000000000002", slug: "riverside" }, "subdomain");
    expect(a.appName).toBe("DLang OS");
    expect(b.appName).toBe("Riverside High Soccer");
  });
});

describe("email sender display name", () => {
  it("uses the given (app) name with the configured address", () => {
    const prev = process.env.RESEND_FROM;
    process.env.RESEND_FROM = "Platform <noreply@example.test>";
    try {
      expect(fromHeader("DLang OS")).toBe("DLang OS <noreply@example.test>");
      expect(fromHeader('Bad "Name" <x>')).toBe("Bad Name x <noreply@example.test>");
      expect(fromHeader(null)).toBe("Platform <noreply@example.test>");
    } finally {
      if (prev === undefined) delete process.env.RESEND_FROM;
      else process.env.RESEND_FROM = prev;
    }
  });
});
