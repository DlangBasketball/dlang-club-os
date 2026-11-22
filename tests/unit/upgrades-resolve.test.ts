import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_FEATURE_KEYS,
  CORE_FEATURE_KEYS,
  FEATURE_CATALOG,
  defaultPlanFeatures,
  featuresForPath,
  getFeature,
  routeFeatureMap,
} from "@/lib/upgrades/catalog";
import {
  canPurchase,
  canStartTrial,
  estimateProration,
  formatAddonPrice,
  lockedHrefs,
  planChangeDirection,
  previewPlanChange,
  resolveFeatures,
  type GrantRow,
  type PlanLite,
  type ResolveInput,
} from "@/lib/upgrades/resolve";
import { FEATURES } from "@/lib/platform/catalog";

const NOW = new Date("2026-11-21T10:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const PLANS: PlanLite[] = [
  { code: "starter", name: "Starter", sort_order: 10, is_public: true, is_active: true, features: defaultPlanFeatures("starter") },
  { code: "club", name: "Club", sort_order: 20, is_public: true, is_active: true, features: defaultPlanFeatures("club") },
  { code: "academy", name: "Academy", sort_order: 30, is_public: true, is_active: true, features: defaultPlanFeatures("academy") },
  { code: "federation", name: "Multi-site", sort_order: 40, is_public: true, is_active: true, is_custom: true, features: defaultPlanFeatures("federation") },
];

function input(over: Partial<ResolveInput> = {}): ResolveInput {
  return { planCode: "club", plans: PLANS, live: true, suspended: false, grants: [], currency: "CHF", now: NOW, ...over };
}
const grant = (g: Partial<GrantRow> & Pick<GrantRow, "feature_key" | "kind">): GrantRow => ({
  status: "active", starts_at: day(-30), ends_at: null, ...g,
});

describe("feature catalog", () => {
  it("covers every module with a unique key and valid dependencies", () => {
    expect(new Set(ALL_FEATURE_KEYS).size).toBe(ALL_FEATURE_KEYS.length);
    expect(ALL_FEATURE_KEYS.length).toBeGreaterThanOrEqual(60);
    for (const f of FEATURE_CATALOG) for (const r of f.requires ?? []) expect(getFeature(r), `${f.key} requires ${r}`).toBeDefined();
    for (const k of ["accounting", "ops_equipment", "website_connect", "site_builder", "ai_assistant", "sms", "extra_languages", "custom_domain", "bookings"]) {
      expect(getFeature(k), k).toBeDefined();
    }
  });

  it("prices the business-model add-ons as documented (§4.3)", () => {
    expect(getFeature("ai_assistant")?.addon).toEqual({ CHF: 69, EUR: 69, USD: 79 });
    expect(getFeature("custom_domain")?.addon?.CHF).toBe(29);
    expect(getFeature("ai_assistant")?.tier).toBeNull(); // never in a plan
    expect(FEATURES).not.toHaveProperty("ai_assistant");
  });

  it("follows §4.1 tier placement", () => {
    const club = defaultPlanFeatures("club");
    const starter = defaultPlanFeatures("starter");
    const academy = defaultPlanFeatures("academy");
    for (const k of ["multi_team", "coach_app", "reminders", "reports_advanced", "csv_import"]) {
      expect(starter[k], `starter ${k}`).toBe(false);
      expect(club[k], `club ${k}`).toBe(true);
    }
    for (const k of ["multi_location", "bookings", "player_development", "advanced_roles", "custom_domain"]) {
      expect(club[k], `club ${k}`).toBe(false);
      expect(academy[k], `academy ${k}`).toBe(true);
    }
    for (const k of CORE_FEATURE_KEYS) expect(starter[k]).toBe(true);
  });

  it("is mirrored exactly in the migration (keys, dependencies, prices)", () => {
    // The catalog seed (20250420102100) plus later migrations that add a feature key.
    const sql = ["20250420102100_feature_upgrades.sql", "20250420102600_selection_programs.sql", "20250420102800_alumni_placements.sql"]
      .map((f) => readFileSync(path.resolve(__dirname, "../../supabase/migrations", f), "utf8")).join("\n");
    const seeded = Array.from(sql.matchAll(/^\s+\('([a-z_]+)', '[a-z]+', (true|false), /gm)).map((m) => m[1]);
    expect(new Set(seeded)).toEqual(new Set(ALL_FEATURE_KEYS));
    for (const f of FEATURE_CATALOG) {
      for (const [cur, amount] of Object.entries(f.addon ?? {})) {
        if (amount === null) continue;
        expect(sql, `${f.key} ${cur}`).toContain(`('${f.key}', '${cur}', ${amount.toFixed(2)})`);
      }
    }
  });

  it("maps routes to features, longest prefix first", () => {
    expect(featuresForPath("admin", "/admin/accounting/exports")).toEqual(["accounting"]);
    expect(featuresForPath("admin", "/admin/operations/equipment/123")).toEqual(["ops_equipment"]);
    expect(featuresForPath("admin", "/admin/operations").sort()).toEqual(["ops_equipment", "ops_facilities", "ops_sponsors"]);
    expect(featuresForPath("admin", "/admin/invoices")).toEqual([]);
    expect(routeFeatureMap("admin").get("/admin/site")).toEqual(["site_builder"]);
  });
});

describe("entitlement resolution", () => {
  it("core is always on, even suspended or without a plan", () => {
    const a = resolveFeatures(input({ planCode: null, live: false, suspended: true }));
    for (const k of CORE_FEATURE_KEYS) expect(a[k]).toMatchObject({ enabled: true, state: "core" });
  });

  it("plan inclusion needs a live subscription", () => {
    expect(resolveFeatures(input()).shop).toMatchObject({ enabled: true, state: "included" });
    expect(resolveFeatures(input({ live: false })).shop.enabled).toBe(false);
  });

  it("offers features outside the plan as add-ons or in a higher plan", () => {
    const a = resolveFeatures(input());
    expect(a.bookings).toMatchObject({ enabled: false, state: "available", price: 79, upgradePlan: "academy" });
    expect(a.white_label).toMatchObject({ enabled: false, state: "upgrade", price: null, upgradePlan: "academy" });
    expect(a.sso).toMatchObject({ state: "upgrade", upgradePlan: "federation" });
    expect(canPurchase(a.bookings)).toBe(true);
    expect(canPurchase(a.white_label)).toBe(false);
  });

  it("uses runtime prices per currency, and does not sell where no price exists", () => {
    const prices = { bookings: { CHF: 75, EUR: 72 }, js_export: { CHF: 15 } };
    expect(resolveFeatures(input({ prices })).bookings.price).toBe(75);
    expect(resolveFeatures(input({ prices, currency: "EUR" })).bookings.price).toBe(72);
    expect(resolveFeatures(input({ prices, currency: "USD" })).bookings.state).toBe("upgrade");
    // Catalog fallback when no runtime prices are loaded: J+S is CHF only.
    expect(resolveFeatures(input({ planCode: "starter", currency: "USD" })).js_export.state).toBe("upgrade");
    expect(resolveFeatures(input({ planCode: "starter", currency: "CHF" })).js_export.price).toBe(15);
  });

  it("paid add-ons: active, canceling until period end, pending grants nothing", () => {
    expect(resolveFeatures(input({ grants: [grant({ feature_key: "bookings", kind: "addon" })] })).bookings)
      .toMatchObject({ enabled: true, state: "addon" });
    expect(resolveFeatures(input({ grants: [grant({ feature_key: "bookings", kind: "addon", status: "canceling", ends_at: day(5) })] })).bookings)
      .toMatchObject({ enabled: true, state: "addon_canceling", endsAt: day(5) });
    expect(resolveFeatures(input({ grants: [grant({ feature_key: "bookings", kind: "addon", status: "canceling", ends_at: day(-1) })] })).bookings.enabled)
      .toBe(false);
    expect(resolveFeatures(input({ grants: [grant({ feature_key: "bookings", kind: "addon", status: "pending" })] })).bookings)
      .toMatchObject({ enabled: false, state: "pending" });
    expect(resolveFeatures(input({ live: false, grants: [grant({ feature_key: "bookings", kind: "addon" })] })).bookings.enabled).toBe(false);
  });

  it("trials run until their end date, then expire; one trial per feature", () => {
    const running = resolveFeatures(input({ grants: [grant({ feature_key: "accounting", kind: "trial", ends_at: day(3) })] }));
    expect(running.accounting).toMatchObject({ enabled: true, state: "trial", endsAt: day(3) });
    const expired = resolveFeatures(input({ grants: [grant({ feature_key: "accounting", kind: "trial", starts_at: day(-20), ends_at: day(-6) })] }));
    expect(expired.accounting).toMatchObject({ enabled: false, state: "available", trialUsed: true });
    expect(canStartTrial(expired.accounting)).toBe(false);
    expect(canStartTrial(resolveFeatures(input()).accounting)).toBe(true);
  });

  it("complimentary grants work without a live subscription; complimentary_all covers every unmetered module", () => {
    const one = resolveFeatures(input({ live: false, grants: [grant({ feature_key: "bookings", kind: "complimentary" })] }));
    expect(one.bookings).toMatchObject({ enabled: true, state: "complimentary" });
    const all = resolveFeatures(input({ planCode: null, live: false, grants: [grant({ feature_key: "*", kind: "complimentary_all" })] }));
    // every module, except metered ones (AI, SMS) which are granted one by one
    for (const f of FEATURE_CATALOG) expect(all[f.key].enabled, f.key).toBe(!f.metered);
    expect(all.ai_assistant.state).toBe("available");
    expect(resolveFeatures(input({ grants: [grant({ feature_key: "bookings", kind: "founding" })] })).bookings.state).toBe("complimentary");
  });

  it("blocks win over the plan, add-ons and complimentary_all", () => {
    const a = resolveFeatures(input({
      grants: [grant({ feature_key: "*", kind: "complimentary_all" }), grant({ feature_key: "shop", kind: "block" }), grant({ feature_key: "bookings", kind: "block" }), grant({ feature_key: "bookings", kind: "addon" })],
    }));
    expect(a.shop).toMatchObject({ enabled: false, state: "blocked" });
    expect(a.bookings).toMatchObject({ enabled: false, state: "blocked" });
    expect(a.accounting.enabled).toBe(true);
    // legacy per-tenant override false is a block too
    expect(resolveFeatures(input({ overrides: { shop: false } })).shop.state).toBe("blocked");
    expect(resolveFeatures(input({ overrides: { bookings: true } })).bookings.state).toBe("included");
  });

  it("dependencies: a feature whose prerequisite is off is off (chains resolve)", () => {
    const a = resolveFeatures(input({ grants: [grant({ feature_key: "player_journey", kind: "addon" })] }));
    expect(a.player_journey).toMatchObject({ enabled: false, state: "requires", missing: ["player_development"] });
    const b = resolveFeatures(input({ grants: [grant({ feature_key: "player_journey", kind: "addon" }), grant({ feature_key: "player_development", kind: "trial", ends_at: day(2) })] }));
    expect(b.player_journey.enabled).toBe(true);
    // accounting requires finance: blocking finance switches accounting off
    const c = resolveFeatures(input({ planCode: "academy", grants: [grant({ feature_key: "finance", kind: "block" })] }));
    expect(c.accounting).toMatchObject({ enabled: false, state: "requires", missing: ["finance"] });
    // site builder requires the website connection
    const d = resolveFeatures(input({ planCode: "academy", grants: [grant({ feature_key: "website_connect", kind: "block" })] }));
    expect(d.site_builder.state).toBe("requires");
  });

  it("legacy AI add-on rows still entitle the assistant", () => {
    expect(resolveFeatures(input({ legacyAi: "complimentary", live: false })).ai_assistant.state).toBe("complimentary");
    expect(resolveFeatures(input({ legacyAi: "paid_addon" })).ai_assistant.state).toBe("addon");
    expect(resolveFeatures(input({ legacyAi: "paid_addon", live: false })).ai_assistant.enabled).toBe(false);
    expect(resolveFeatures(input()).ai_assistant).toMatchObject({ state: "available", price: 69 });
  });

  it("a suspended club gets nothing but core", () => {
    const a = resolveFeatures(input({ suspended: true, grants: [grant({ feature_key: "*", kind: "complimentary_all" })] }));
    expect(a.shop.enabled).toBe(false);
    expect(a.invoicing.enabled).toBe(true);
  });
});

describe("plan changes", () => {
  it("previews which features lock on a downgrade and which come with an upgrade", () => {
    const fromAcademy = input({ planCode: "academy", grants: [grant({ feature_key: "accounting", kind: "addon" })] });
    const down = previewPlanChange(fromAcademy, "club");
    expect(down.lose).toContain("bookings");
    expect(down.lose).toContain("player_journey");
    expect(down.lose).not.toContain("accounting"); // paid add-on stays
    expect(down.lose).not.toContain("shop");
    const up = previewPlanChange(input({ grants: [grant({ feature_key: "bookings", kind: "addon" })] }), "academy");
    expect(up.gain).toContain("player_development");
    expect(up.lose).toEqual([]);
    expect(up.redundantAddons).toEqual(["bookings"]);
    // complimentary grants survive any plan change
    expect(previewPlanChange(input({ planCode: "academy", grants: [grant({ feature_key: "*", kind: "complimentary_all" })] }), "starter").lose).toEqual([]);
  });

  it("knows the direction of a change", () => {
    expect(planChangeDirection(PLANS, "club", "academy")).toBe("upgrade");
    expect(planChangeDirection(PLANS, "academy", "starter")).toBe("downgrade");
    expect(planChangeDirection(PLANS, "club", "club")).toBe("same");
    expect(planChangeDirection(PLANS, null, "starter")).toBe("upgrade");
  });

  it("estimates proration for the rest of the period", () => {
    expect(estimateProration(30, day(15), NOW)).toBe(15);
    expect(estimateProration(29, day(45), NOW)).toBe(29); // capped at one month
    expect(estimateProration(29, day(-1), NOW)).toBe(0);
    expect(estimateProration(29, null, NOW)).toBe(0);
  });
});

describe("price formatting per currency", () => {
  it("formats in the club's currency and locale", () => {
    expect(formatAddonPrice(29, "CHF", "de-CH")).toBe("CHF 29");
    expect(formatAddonPrice(69, "EUR", "de-DE")).toBe("69 €");
    expect(formatAddonPrice(79, "USD", "en-US")).toBe("$79");
    expect(formatAddonPrice(19.5, "EUR", "fr-FR")).toBe("19,50 €");
    expect(formatAddonPrice(1690, "CHF", "fr-CH")).toMatch(/^1.690 CHF$/);
  });
});

describe("nav locking", () => {
  it("locks nav entries only when every feature behind them is off", () => {
    const club = resolveFeatures(input());
    const locked = lockedHrefs(routeFeatureMap("admin"), club);
    expect(locked).toContain("/admin/accounting");
    expect(locked).toContain("/admin/operations");
    expect(locked).not.toContain("/admin/shop");
    const withEquipment = resolveFeatures(input({ grants: [grant({ feature_key: "ops_equipment", kind: "addon" })] }));
    expect(lockedHrefs(routeFeatureMap("admin"), withEquipment)).not.toContain("/admin/operations");
  });
});
