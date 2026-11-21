import { z } from "zod";
import { FORM_KINDS, type FormKind } from "./blocks";

/**
 * Public site forms (contact, join, coach / athlete application). Minimal
 * data only: name, email, optional phone, a message and the contact consent.
 * No date of birth, health or school data of minors: an athlete application
 * is sent by the athlete or, for a minor, by a parent / guardian, and the
 * club follows up in the app. Spam: a hidden honeypot field plus a time trap
 * (forms posted faster than MIN_FILL_MS after render are dropped) and rate
 * limits (in-process per IP, and in the database per hashed IP and per club;
 * public.site_form_limits()).
 */

export const HONEYPOT_FIELD = "website_url";
export const MIN_FILL_MS = 2_500;
export const SITE_FORM_LIMITS = { perIp10Min: 5, perIpDay: 20, perOrgHour: 200 } as const;

export const siteFormSchema = z.object({
  kind: z.enum(FORM_KINDS),
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  phone: z.string().trim().max(40).regex(/^[+0-9 ().\/-]*$/).optional().transform((v) => v || undefined),
  message: z.string().trim().min(1).max(3000),
  consent: z.literal(true),
  lang: z.string().max(20).optional(),
  pagePath: z.string().max(300).optional(),
  startedAt: z.coerce.number().int().optional(),
  [HONEYPOT_FIELD]: z.string().max(500).optional(),
});
export type SiteFormInput = z.input<typeof siteFormSchema>;

/** Honeypot filled or posted too fast: treat as spam (answer "sent", store nothing). */
export function looksLikeSpam(input: { [HONEYPOT_FIELD]?: string; startedAt?: number }, now = Date.now()): boolean {
  if (input[HONEYPOT_FIELD] && input[HONEYPOT_FIELD]!.trim()) return true;
  if (typeof input.startedAt === "number" && input.startedAt > 0 && now - input.startedAt < MIN_FILL_MS) return true;
  return false;
}

/** Interest of the lead created in the "New contacts" inbox. */
export function leadInterestFor(kind: FormKind): "camp" | "training" | "team" | "other" {
  switch (kind) {
    case "join":
    case "athlete_application":
      return "team";
    default:
      return "other";
  }
}
