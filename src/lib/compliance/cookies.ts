/**
 * Cookie / tracking consent model (isomorphic).
 *
 * Default state = strictly necessary ONLY. Nothing in the "analytics",
 * "functional" or "marketing" categories may load until the visitor opts in
 * (EU/UK ePrivacy, CH TCA Art. 45c) — and a Global Privacy Control signal is
 * treated as an opt-out of sale/share (CCPA regs §7025).
 *
 * The choice itself is stored in a first-party, strictly-necessary cookie.
 */

export const CONSENT_COOKIE = "cos_cookie_consent";
/** Bump to re-prompt everyone when categories or the cookie policy change. */
export const CONSENT_VERSION = 1;
/** 6 months — within EDPB/CNIL guidance (re-ask at most every 13 months). */
export const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;
/** Fired on window to reopen the preferences dialog (e.g. from footer link). */
export const OPEN_CONSENT_EVENT = "cos:open-cookie-settings";
/** Fired on window after the visitor saves a choice (detail = CookieConsent). */
export const CONSENT_CHANGED_EVENT = "cos:cookie-consent-changed";

export type ConsentCategory = "necessary" | "functional" | "analytics" | "marketing";

export type CookieConsent = {
  v: number;
  necessary: true;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  /** ISO timestamp of the decision (evidence). */
  ts: string;
  /** Global Privacy Control was present when the choice was saved. */
  gpc: boolean;
};

export const CATEGORY_INFO: Record<ConsentCategory, { label: string; description: string; required: boolean }> = {
  necessary: {
    label: "Strictly necessary",
    description: "Sign-in session, security (CSRF), load balancing and remembering this cookie choice. Always on — the service cannot work without them.",
    required: true,
  },
  functional: {
    label: "Functional",
    description: "Remember preferences such as language or dismissed tips. Off by default.",
    required: false,
  },
  analytics: {
    label: "Analytics",
    description: "Anonymous usage statistics to improve the product. Off by default; none are active today.",
    required: false,
  },
  marketing: {
    label: "Marketing",
    description: "Advertising or cross-site tracking. Off by default; the platform does not use any.",
    required: false,
  },
};

export const NECESSARY_ONLY = (gpc = false): CookieConsent => ({
  v: CONSENT_VERSION,
  necessary: true,
  functional: false,
  analytics: false,
  marketing: false,
  ts: new Date().toISOString(),
  gpc,
});

export function parseConsent(raw: string | null | undefined): CookieConsent | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raw)) as Partial<CookieConsent>;
    if (!o || o.v !== CONSENT_VERSION) return null; // outdated -> re-prompt
    return {
      v: CONSENT_VERSION,
      necessary: true,
      functional: o.functional === true,
      analytics: o.analytics === true,
      marketing: o.marketing === true && o.gpc !== true,
      ts: typeof o.ts === "string" ? o.ts : new Date(0).toISOString(),
      gpc: o.gpc === true,
    };
  } catch {
    return null;
  }
}

export function serializeConsent(c: CookieConsent): string {
  return encodeURIComponent(JSON.stringify(c));
}

/** True only if the visitor explicitly allowed this category. */
export function hasConsent(c: CookieConsent | null, category: ConsentCategory): boolean {
  if (category === "necessary") return true;
  if (!c) return false;
  return c[category] === true;
}
