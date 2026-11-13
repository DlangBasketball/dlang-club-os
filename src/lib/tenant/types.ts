/**
 * White-label tenant model. Everything here is PUBLIC-SAFE: it is serialised
 * into the page for the client TenantProvider, so never add secrets, billing
 * data or settings that RLS would hide.
 */

export type TenantColors = {
  /** Brand color for primary buttons, active states, highlights. */
  primary: string;
  /** Hover / pressed variant of primary. */
  primaryDark: string;
  /** Secondary accent (e.g. gold in the founding club palette). */
  accent: string;
  /** Page background. */
  background: string;
  /** Card / panel surface. */
  surface: string;
  /** Main body text. */
  text: string;
};

export type TenantFonts = {
  display: string;
  ui: string;
  mono: string;
};

export type TenantBranding = {
  logoUrl: string | null;
  faviconUrl: string | null;
  colors: TenantColors;
  fonts: TenantFonts;
  darkMode: boolean;
};

/** Configurable vocabulary keys. Add new keys here + in DEFAULT_TERMINOLOGY. */
export const TERM_KEYS = [
  "organization",
  "athlete",
  "coach",
  "program",
  "session",
  "season",
  "family",
  "guardian",
] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export type TermForms = { one: string; other: string };
export type Terminology = Record<TermKey, TermForms>;

export type TenantStatus = "trial" | "active" | "suspended";

/**
 * How the tenant was resolved:
 *  - custom_domain: Host matched organizations.custom_domain
 *  - subdomain:     <slug>.<PLATFORM_ROOT_DOMAIN> (or <slug>.localhost)
 *  - default:       no tenant in the host; DEFAULT_ORG_SLUG used (local dev / apex)
 *  - fallback:      database unreachable or DEFAULT_ORG_SLUG unset; built-in defaults
 *  - unknown:       host named a tenant that does not exist
 */
export type TenantSource = "custom_domain" | "subdomain" | "default" | "fallback" | "unknown";

export type Tenant = {
  id: string | null;
  slug: string;
  /** Organization (club) name, e.g. "DLang Basketball". */
  name: string;
  /**
   * Product name the club sees in the app shell, page titles, login and email
   * sender ("DLang OS"). branding.app_name, else the organization name.
   */
  appName: string;
  customDomain: string | null;
  branding: TenantBranding;
  terminology: Terminology;
  sport: string | null;
  country: string;
  defaultLocale: string;
  supportedLocales: string[];
  currency: string;
  timezone: string;
  status: TenantStatus;
  source: TenantSource;
};

/** Shape returned by public.get_public_tenant(). */
export type PublicTenantRow = {
  id: string;
  slug: string;
  name: string;
  custom_domain: string | null;
  branding: unknown;
  terminology: unknown;
  sport: string | null;
  country: string | null;
  default_locale: string | null;
  supported_locales: string[] | null;
  currency: string | null;
  timezone: string | null;
  status: string | null;
};
