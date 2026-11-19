import { z } from "zod";
import { MAX_ORIGINS, isValidOrigin } from "./origins";

/**
 * Website connection settings (public.website_settings) — shape, defaults
 * and validation shared by the admin form, the server action, the public
 * API and the embeds. Pure.
 */

export const PUBLIC_SECTIONS = ["programs", "camps", "events", "results", "teams", "coaches", "training", "shop", "campaigns", "news", "contact"] as const;
export type PublicSection = (typeof PUBLIC_SECTIONS)[number];

export const EMBED_THEMES = ["club", "light", "dark"] as const;
export type EmbedTheme = (typeof EMBED_THEMES)[number];

export const SOCIAL_KEYS = ["facebook", "instagram", "youtube", "tiktok", "x", "linkedin"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export const DEFAULT_SECTIONS: Record<PublicSection, boolean> = {
  programs: true, camps: true, events: true, results: true, teams: true, coaches: false,
  training: true, shop: true, campaigns: true, news: true, contact: true,
};

export type NavLink = { label: string; url: string };

export type WebsiteSettings = {
  orgId: string;
  enabled: boolean;
  websiteUrl: string | null;
  allowedOrigins: string[];
  sections: Record<PublicSection, boolean>;
  rosterPublic: boolean;
  embedTheme: EmbedTheme;
  webhookUrl: string | null;
  secretHint: string | null;
  secretSetAt: string | null;
  tagline: string | null;
  navLinks: NavLink[];
  socialLinks: Partial<Record<SocialKey, string>>;
  lastDelivery: { at: string | null; status: string | null; code: number | null; error: string | null };
};

export function defaultWebsiteSettings(orgId: string): WebsiteSettings {
  return {
    orgId, enabled: false, websiteUrl: null, allowedOrigins: [], sections: { ...DEFAULT_SECTIONS }, rosterPublic: false,
    embedTheme: "club", webhookUrl: null, secretHint: null, secretSetAt: null, tagline: null, navLinks: [], socialLinks: {},
    lastDelivery: { at: null, status: null, code: null, error: null },
  };
}

const httpsUrl = z.string().trim().max(500).refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}, "https_only");

/** A nav link points to an https page or to an app path ("/shop"). */
export function isSafeNavUrl(v: string): boolean {
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?#=&%]*$/.test(v) && v.length <= 300) return true;
  return httpsUrl.safeParse(v).success;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function rowToWebsiteSettings(orgId: string, row: Row | null | undefined): WebsiteSettings {
  const d = defaultWebsiteSettings(orgId);
  if (!row) return d;
  const sections = { ...DEFAULT_SECTIONS };
  if (row.public_sections && typeof row.public_sections === "object") {
    for (const k of PUBLIC_SECTIONS) {
      const v = (row.public_sections as Row)[k];
      if (typeof v === "boolean") sections[k] = v;
    }
  }
  const nav = Array.isArray(row.nav_links)
    ? (row.nav_links as unknown[])
        .map((l) => (l && typeof l === "object" ? { label: s((l as Row).label) ?? "", url: s((l as Row).url) ?? "" } : null))
        .filter((l): l is NavLink => !!l && !!l.label && isSafeNavUrl(l.url))
        .slice(0, 12)
    : [];
  const social: Partial<Record<SocialKey, string>> = {};
  if (row.social_links && typeof row.social_links === "object") {
    for (const k of SOCIAL_KEYS) {
      const v = s((row.social_links as Row)[k]);
      if (v && httpsUrl.safeParse(v).success) social[k] = v;
    }
  }
  const theme = s(row.embed_theme);
  return {
    orgId,
    enabled: row.enabled === true,
    websiteUrl: s(row.website_url),
    allowedOrigins: Array.isArray(row.allowed_origins) ? (row.allowed_origins as unknown[]).filter((o): o is string => typeof o === "string" && isValidOrigin(o)) : [],
    sections,
    rosterPublic: row.roster_public === true,
    embedTheme: (EMBED_THEMES as readonly string[]).includes(theme ?? "") ? (theme as EmbedTheme) : "club",
    webhookUrl: s(row.webhook_url),
    secretHint: s(row.secret_hint),
    secretSetAt: s(row.secret_set_at),
    tagline: s(row.tagline),
    navLinks: nav,
    socialLinks: social,
    lastDelivery: {
      at: s(row.last_delivery_at),
      status: s(row.last_delivery_status),
      code: typeof row.last_delivery_code === "number" ? row.last_delivery_code : null,
      error: s(row.last_delivery_error),
    },
  };
}

/** Admin form input (server action). Origins arrive already split. */
export const websiteSettingsInput = z.object({
  enabled: z.boolean(),
  websiteUrl: z.union([httpsUrl, z.literal("")]).optional().default(""),
  allowedOrigins: z.array(z.string().refine(isValidOrigin, "origin")).max(MAX_ORIGINS),
  sections: z.record(z.enum(PUBLIC_SECTIONS), z.boolean()),
  rosterPublic: z.boolean(),
  embedTheme: z.enum(EMBED_THEMES),
  webhookUrl: z.union([httpsUrl, z.literal("")]).optional().default(""),
  tagline: z.string().trim().max(200).optional().default(""),
  navLinks: z.array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().trim().max(300).refine(isSafeNavUrl, "url") })).max(12),
  socialLinks: z.record(z.enum(SOCIAL_KEYS), z.union([httpsUrl, z.literal("")])).optional().default({}),
});
export type WebsiteSettingsInput = z.input<typeof websiteSettingsInput>;
