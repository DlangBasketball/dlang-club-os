/**
 * Feature catalog for packaging and upsell (pure data; safe on client and server).
 *
 * Every module of the app has a key here. The catalog holds the PROPOSED
 * packaging (docs/company/15_FEATURE_PACKAGING_PROPOSAL.md, [Proposal][Confirm]):
 *   - `tier`: the lowest plan that includes the feature by default. It only
 *     seeds plans.features (migration 20250420102100); at runtime the plan
 *     matrix in the database (editable in /platform/plans/features) decides.
 *   - `addon`: proposed monthly add-on price per currency [Est.], or null when
 *     the feature is not sold on its own. Runtime prices live in
 *     public.feature_addon_prices (editable by platform admins).
 *   - `requires`: features that must be on for this one to work.
 *   - `routes`: route prefixes per app that the feature gates (page layouts and
 *     nav entries). A nav entry listed under several features locks only when
 *     all of them are off.
 *
 * Names, descriptions and value pitches are translated under
 * `upgrades.features.<key>.{name,description,pitch}` in every catalog.
 * Core features are always on and cannot be removed.
 */

export const PLAN_TIERS = ["starter", "club", "academy", "federation"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const FEATURE_CATEGORIES = [
  "core",
  "programs",
  "communication",
  "finance",
  "training",
  "people",
  "safety",
  "operations",
  "family",
  "website",
  "ai",
  "enterprise",
] as const;
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

export type AddonPrice = { CHF: number | null; EUR: number | null; USD: number | null };

export type FeatureRoutes = { admin?: string[]; coach?: string[]; parent?: string[]; public?: string[] };

export type FeatureDef = {
  key: string;
  category: FeatureCategory;
  /** Always on, in every plan; never locked, blocked or sold. */
  core?: boolean;
  /** Lowest plan that includes it by default; null = sold only as an add-on. */
  tier: PlanTier | null;
  /**
   * Running cost per use (AI inference, SMS). Not covered by a
   * complimentary_all grant: granted one by one, on purpose.
   */
  metered?: true;
  addon: AddonPrice | null;
  requires?: string[];
  routes?: FeatureRoutes;
  /** English fallback label (platform console, logs). UI uses the catalogs. */
  label: string;
};

const p = (chf: number, eur: number = chf, usd: number | null = Math.round(chf * 1.1)): AddonPrice => ({
  CHF: chf,
  EUR: eur,
  USD: usd,
});

export const FEATURE_CATALOG: readonly FeatureDef[] = [
  // ---- Core: Starter §4.1 "Includes" (always on) -------------------------------
  { key: "programs", category: "core", core: true, tier: "starter", addon: null, label: "Programs & schedule" },
  { key: "registration", category: "core", core: true, tier: "starter", addon: null, label: "Online registration" },
  { key: "invoicing", category: "core", core: true, tier: "starter", addon: null, label: "Invoicing" },
  { key: "qr_bill", category: "core", core: true, tier: "starter", addon: null, label: "Swiss QR-bill" },
  { key: "online_payments", category: "core", core: true, tier: "starter", addon: null, label: "Card & TWINT payments" },
  { key: "roster", category: "core", core: true, tier: "starter", addon: null, label: "Roster: families, athletes, coaches" },
  { key: "attendance", category: "core", core: true, tier: "starter", addon: null, label: "Attendance" },
  { key: "messaging", category: "core", core: true, tier: "starter", addon: null, label: "Messaging & notifications" },
  { key: "documents_consent", category: "core", core: true, tier: "starter", addon: null, label: "Documents & consents" },
  { key: "parent_app", category: "core", core: true, tier: "starter", addon: null, label: "Parent web app" },
  { key: "custom_branding", category: "core", core: true, tier: "starter", addon: null, label: "Club branding" },
  { key: "web_push", category: "core", core: true, tier: "starter", addon: null, label: "Web push notifications" },
  { key: "multi_club", category: "core", core: true, tier: "starter", addon: null, label: "One login for several clubs" },

  // ---- Programs & scheduling -----------------------------------------------------
  { key: "camps", category: "programs", tier: "starter", addon: null, label: "Camps", routes: { admin: ["/admin/camps"], parent: ["/parent/camps"] } },
  { key: "camp_basket", category: "programs", tier: "club", addon: p(29, 29, 32), requires: ["camps"], label: "Camp seasons & multi-week basket" },
  { key: "multi_team", category: "programs", tier: "club", addon: p(29, 29, 32), label: "Multiple teams", routes: { admin: ["/admin/teams"], coach: ["/coach/team"] } },
  { key: "multi_location", category: "programs", tier: "academy", addon: p(49, 49, 54), requires: ["multi_team"], label: "Multiple locations", routes: { admin: ["/admin/locations"] } },
  {
    key: "calendar_ics", category: "programs", tier: "club", addon: p(9, 9, 10), label: "Club calendar & ICS feeds",
    routes: { admin: ["/admin/calendar"], coach: ["/coach/calendar"], parent: ["/parent/calendar"], public: ["/api/calendar/feed"] },
  },
  { key: "waitlists", category: "programs", tier: "club", addon: p(19, 19, 21), label: "Waiting lists with auto-promotion", routes: { admin: ["/admin/waitlists"], parent: ["/parent/waitlist"], public: ["/waitlist"] } },
  {
    key: "selection_programs", category: "programs", tier: "academy", addon: p(49, 49, 54), label: "Selection programmes: applications, packages & approvals",
    routes: { admin: ["/admin/selection"], coach: ["/coach/selection"], parent: ["/parent/programmes"] },
  },
  { key: "shop", category: "programs", tier: "club", addon: p(39, 39, 43), label: "Club shop", routes: { admin: ["/admin/shop"], parent: ["/shop"], public: ["/shop"] } },

  // ---- Communication ---------------------------------------------------------------
  { key: "alerts_leads", category: "communication", tier: "club", addon: p(19, 19, 21), label: "Scheduled alerts & new contacts", routes: { admin: ["/admin/alerts", "/admin/leads"], coach: ["/coach/alerts"] } },
  { key: "media_library", category: "communication", tier: "club", addon: p(15, 15, 17), label: "Media library", routes: { admin: ["/admin/media"] } },
  { key: "sms", category: "communication", tier: null, metered: true, addon: p(25, 25, 29), label: "SMS packs" },

  // ---- Finance ---------------------------------------------------------------------
  { key: "reminders", category: "finance", tier: "club", addon: p(19, 19, 21), label: "Automatic payment reminders" },
  { key: "discounts", category: "finance", tier: "club", addon: p(15, 15, 17), label: "Discounts & promo codes", routes: { admin: ["/admin/discounts"] } },
  { key: "payment_plans", category: "finance", tier: "club", addon: p(39, 39, 43), label: "Payment plans, instalments & autopay", routes: { admin: ["/admin/payment-plans"], parent: ["/parent/payment-plans"] } },
  { key: "recurring_fees", category: "finance", tier: "club", addon: p(25, 25, 28), label: "Recurring fees", routes: { admin: ["/admin/recurring-fees"] } },
  { key: "finance", category: "finance", tier: "club", addon: p(29, 29, 32), label: "Finance: expenses, payouts, budgets", routes: { admin: ["/admin/finance"] } },
  { key: "reports_advanced", category: "finance", tier: "club", addon: p(29, 29, 32), label: "Reports", routes: { admin: ["/admin/reports"] } },
  {
    key: "accounting", category: "finance", tier: "academy", addon: p(49, 49, 54), requires: ["finance"], label: "Accounting: bank import, exports, period locks, dunning, refunds",
    routes: { admin: ["/admin/accounting"], parent: ["/parent/refunds"] },
  },

  // ---- Training & player development ---------------------------------------------
  {
    key: "bookings", category: "training", tier: "academy", addon: p(79, 79, 87), label: "Training bookings & packages",
    routes: {
      admin: ["/admin/bookings", "/admin/services", "/admin/training", "/admin/availability", "/admin/credits"],
      coach: ["/coach/availability", "/coach/training"],
      parent: ["/parent/bookings"],
      public: ["/book"],
    },
  },
  {
    key: "player_development", category: "training", tier: "academy", addon: p(69, 69, 76), label: "Player development: assessments, plans, nutrition, rankings, wellness",
    routes: { admin: ["/admin/development"], coach: ["/coach/development"], parent: ["/parent/development"] },
  },
  {
    key: "player_journey", category: "training", tier: "academy", addon: p(39, 39, 43), requires: ["player_development"], label: "Player journey & scout profile",
    routes: { admin: ["/admin/journey"], coach: ["/coach/journey"], parent: ["/parent/journey"], public: ["/scout"] },
  },
  { key: "lesson_plans", category: "training", tier: "club", addon: p(15, 15, 17), requires: ["coach_app"], label: "Lesson plans", routes: { admin: ["/admin/lesson-plans"], coach: ["/coach/lesson-plans"] } },

  // ---- People & staff --------------------------------------------------------------
  { key: "coach_app", category: "people", tier: "club", addon: p(39, 39, 43), label: "Coach app", routes: { coach: ["/coach"] } },
  { key: "csv_import", category: "people", tier: "club", addon: p(19, 19, 21), label: "CSV / Excel import", routes: { admin: ["/admin/import"] } },
  { key: "memberships", category: "people", tier: "club", addon: p(25, 25, 28), label: "Memberships", routes: { admin: ["/admin/memberships"], parent: ["/parent/membership"] } },
  { key: "member_cards", category: "people", tier: "academy", addon: p(19, 19, 21), requires: ["memberships"], label: "NFC / QR member cards" },
  { key: "forms", category: "people", tier: "club", addon: p(19, 19, 21), label: "Custom forms", routes: { admin: ["/admin/forms"], parent: ["/parent/forms"] } },
  { key: "contracts", category: "people", tier: "academy", addon: p(29, 29, 32), label: "Contracts & e-signature", routes: { admin: ["/admin/contracts"], parent: ["/parent/contracts"] } },
  { key: "staff_time", category: "people", tier: "academy", addon: p(39, 39, 43), requires: ["coach_app"], label: "Staff clock-in, schedules & timesheets", routes: { admin: ["/admin/timesheets", "/admin/staff-schedules"], coach: ["/coach/clock"] } },
  { key: "advanced_roles", category: "people", tier: "academy", addon: p(29, 29, 32), label: "Advanced roles (finance role, delegated access)" },

  // ---- Safety & compliance -----------------------------------------------------------
  { key: "staff_compliance", category: "safety", tier: "club", addon: p(19, 19, 21), label: "Staff compliance & certificates", routes: { admin: ["/admin/staff-compliance"], coach: ["/coach/compliance"] } },
  { key: "injury_log", category: "safety", tier: "club", addon: p(15, 15, 17), label: "Injury & incident log", routes: { admin: ["/admin/incidents"], coach: ["/coach/incidents"], parent: ["/parent/incidents"] } },
  { key: "js_export", category: "safety", tier: "club", addon: { CHF: 15, EUR: null, USD: null }, label: "J+S export (Switzerland)", routes: { admin: ["/admin/js"] } },

  // ---- Operations --------------------------------------------------------------------
  {
    key: "ops_equipment", category: "operations", tier: "academy", addon: p(19, 19, 21), label: "Equipment & kit",
    routes: { admin: ["/admin/operations", "/admin/operations/equipment", "/admin/operations/kit"], coach: ["/coach/equipment"], parent: ["/parent/kit"] },
  },
  { key: "ops_facilities", category: "operations", tier: "academy", addon: p(19, 19, 21), label: "Facilities & closures", routes: { admin: ["/admin/operations", "/admin/operations/facilities"] } },
  { key: "ops_board", category: "operations", tier: "academy", addon: p(15, 15, 17), label: "Board & committees", routes: { admin: ["/board"], coach: ["/board"], parent: ["/board"] } },
  {
    key: "ops_sponsors", category: "operations", tier: "academy", addon: p(25, 25, 28), label: "Sponsors & donations",
    routes: { admin: ["/admin/operations", "/admin/operations/sponsors", "/admin/operations/donations", "/admin/operations/invoices"] },
  },

  // ---- Family ------------------------------------------------------------------------
  { key: "split_billing", category: "family", tier: "club", addon: p(19, 19, 21), label: "Second guardian split billing", routes: { admin: ["/admin/family-billing"] } },
  { key: "carpooling", category: "family", tier: "club", addon: p(9, 9, 10), label: "Carpooling", routes: { admin: ["/admin/carpool"], coach: ["/coach/carpool"], parent: ["/parent/carpool"] } },

  // ---- Website, brand & languages ---------------------------------------------------
  { key: "website_connect", category: "website", tier: "club", addon: p(29, 29, 32), label: "Website connection: public API, embeds, WordPress plugin", routes: { admin: ["/admin/settings/website"], public: ["/api/public", "/embed"] } },
  { key: "site_builder", category: "website", tier: "academy", addon: p(39, 39, 43), requires: ["website_connect"], label: "Built-in club website", routes: { admin: ["/admin/site"] } },
  { key: "custom_domain", category: "website", tier: "academy", addon: p(29, 29, 32), label: "Custom domain & branded email sender" },
  { key: "extra_languages", category: "website", tier: "academy", addon: p(19, 19, 21), label: "More than two languages" },
  { key: "white_label", category: "website", tier: "academy", addon: null, label: "Full white-label" },

  // ---- AI ----------------------------------------------------------------------------
  { key: "ai_assistant", category: "ai", tier: null, metered: true, addon: { CHF: 69, EUR: 69, USD: 79 }, label: "AI assistant" },

  // ---- Enterprise --------------------------------------------------------------------
  { key: "api_access", category: "enterprise", tier: "academy", addon: null, label: "Admin API access" },
  { key: "priority_support", category: "enterprise", tier: "academy", addon: p(49, 49, 54), label: "Priority support" },
  { key: "sso", category: "enterprise", tier: "federation", addon: null, label: "Single sign-on" },
  { key: "federation_rollup", category: "enterprise", tier: "federation", addon: null, label: "Group / federation roll-up" },
];

export const FEATURE_BY_KEY: ReadonlyMap<string, FeatureDef> = new Map(FEATURE_CATALOG.map((f) => [f.key, f]));
export const ALL_FEATURE_KEYS: readonly string[] = FEATURE_CATALOG.map((f) => f.key);
export const CORE_FEATURE_KEYS: readonly string[] = FEATURE_CATALOG.filter((f) => f.core).map((f) => f.key);

export function getFeature(key: string): FeatureDef | undefined {
  return FEATURE_BY_KEY.get(key);
}

export function isKnownFeature(key: string): boolean {
  return FEATURE_BY_KEY.has(key);
}

export function isCoreFeature(key: string): boolean {
  return FEATURE_BY_KEY.get(key)?.core === true;
}

/** Default inclusion per tier (seed for plans.features). Add-on-only modules are never plan keys. */
export function defaultPlanFeatures(tier: PlanTier): Record<string, boolean> {
  const rank = PLAN_TIERS.indexOf(tier);
  const out: Record<string, boolean> = {};
  for (const f of FEATURE_CATALOG) if (f.tier !== null) out[f.key] = PLAN_TIERS.indexOf(f.tier) <= rank;
  return out;
}

export type AppArea = "admin" | "coach" | "parent" | "public";

/** Route prefix -> features that gate it, per app area. */
export function routeFeatureMap(area: AppArea): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const f of FEATURE_CATALOG) {
    for (const href of f.routes?.[area] ?? []) m.set(href, [...(m.get(href) ?? []), f.key]);
  }
  return m;
}

/**
 * Features gating a pathname: the longest matching route prefix wins
 * (/admin/operations/equipment -> ops_equipment, not the whole hub).
 * Returns [] when the path is not gated.
 */
export function featuresForPath(area: AppArea, pathname: string): string[] {
  let best = "";
  let keys: string[] = [];
  for (const [href, ks] of routeFeatureMap(area)) {
    if ((pathname === href || pathname.startsWith(`${href}/`)) && href.length > best.length) {
      best = href;
      keys = ks;
    }
  }
  return keys;
}
