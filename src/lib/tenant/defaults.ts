import type { Tenant, TenantBranding, Terminology } from "./types";
import { PLATFORM_NAME } from "@/lib/brand";

/** Product name shown when no tenant can be resolved. Not a club name. */
export { PLATFORM_NAME };

/**
 * Platform default theme = the "V5 dark luxury" palette from the design
 * prototype. Tenants override any subset of it.
 */
export const DEFAULT_BRANDING: TenantBranding = {
  logoUrl: null,
  faviconUrl: null,
  colors: {
    primary: "#DA2627",
    primaryDark: "#961F1F",
    accent: "#C19A45",
    background: "#0A0A0A",
    surface: "#1A1A1A",
    text: "#F1F1F1",
  },
  fonts: { display: "Fraunces", ui: "Geist", mono: "Geist Mono" },
  darkMode: true,
};

/** Light starting point offered when a tenant switches dark mode off. */
export const DEFAULT_LIGHT_COLORS = {
  primary: "#DA2627",
  primaryDark: "#961F1F",
  accent: "#B7862C",
  background: "#F7F7F5",
  surface: "#FFFFFF",
  text: "#151515",
} as const;

export const DEFAULT_TERMINOLOGY: Terminology = {
  organization: { one: "Club", other: "Clubs" },
  athlete: { one: "Athlete", other: "Athletes" },
  coach: { one: "Coach", other: "Coaches" },
  program: { one: "Program", other: "Programs" },
  session: { one: "Session", other: "Sessions" },
  season: { one: "Season", other: "Seasons" },
  family: { one: "Family", other: "Families" },
  guardian: { one: "Parent", other: "Parents" },
};

/** Ready-made vocabularies for the settings page. */
export const TERMINOLOGY_PRESETS: { id: string; label: string; terms: Partial<Terminology> }[] = [
  { id: "club", label: "Sports club", terms: {} },
  {
    id: "team",
    label: "Team",
    terms: {
      organization: { one: "Team", other: "Teams" },
      athlete: { one: "Player", other: "Players" },
      program: { one: "Squad", other: "Squads" },
      session: { one: "Practice", other: "Practices" },
    },
  },
  {
    id: "school",
    label: "School",
    terms: {
      organization: { one: "School", other: "Schools" },
      athlete: { one: "Student", other: "Students" },
      coach: { one: "Teacher", other: "Teachers" },
      program: { one: "Class", other: "Classes" },
      session: { one: "Lesson", other: "Lessons" },
      season: { one: "Term", other: "Terms" },
      family: { one: "Household", other: "Households" },
      guardian: { one: "Parent/Guardian", other: "Parents/Guardians" },
    },
  },
  {
    id: "academy",
    label: "Academy / training",
    terms: {
      organization: { one: "Academy", other: "Academies" },
      athlete: { one: "Trainee", other: "Trainees" },
      coach: { one: "Trainer", other: "Trainers" },
      program: { one: "Course", other: "Courses" },
    },
  },
];

export const SUPPORTED_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "CAD", "AUD", "SEK", "NOK", "DKK", "PLN", "CZK"] as const;

export const SUPPORTED_LOCALES = [
  { code: "en", label: "English" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "fr", label: "Français" },
  { code: "fr-CH", label: "Français (Suisse)" },
  { code: "de", label: "Deutsch" },
  { code: "de-CH", label: "Deutsch (Schweiz)" },
  { code: "it", label: "Italiano" },
  { code: "it-CH", label: "Italiano (Svizzera)" },
  { code: "es", label: "Español" },
  { code: "nl", label: "Nederlands" },
  { code: "pt", label: "Português" },
] as const;

export const COMMON_TIMEZONES = [
  "Europe/Zurich",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "UTC",
] as const;

export const SPORTS = [
  "basketball",
  "soccer",
  "volleyball",
  "handball",
  "tennis",
  "swimming",
  "athletics",
  "hockey",
  "baseball",
  "rugby",
  "gymnastics",
  "martial-arts",
  "dance",
  "multi",
] as const;

/** Tenant used when nothing can be resolved (build time, DB down, local dev without seed). */
export function fallbackTenant(slug = "default", source: Tenant["source"] = "fallback"): Tenant {
  return {
    id: null,
    slug,
    name: PLATFORM_NAME,
    appName: PLATFORM_NAME,
    customDomain: null,
    branding: DEFAULT_BRANDING,
    terminology: DEFAULT_TERMINOLOGY,
    sport: null,
    country: "CH",
    defaultLocale: "en",
    supportedLocales: ["en"],
    currency: "CHF",
    timezone: "Europe/Zurich",
    status: "active",
    source,
  };
}
