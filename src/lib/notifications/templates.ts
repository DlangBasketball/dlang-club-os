import { formatDate, formatMoney, FORMAT_DEFAULTS } from "@/lib/format";
import { brandStyle, type ClubBrand } from "@/lib/email/templates";
import { tenantLink } from "@/lib/tenant/url";
import { PLATFORM_NAME } from "@/lib/brand";

/**
 * Template keys. Nine product event types plus a freeform "announcement"
 * used by admin broadcasts. Every key except `announcement` maps 1:1 to a
 * `notification_type` enum label; `announcement` is stored as `system`.
 */
export type NotifType =
  | "registration_confirmation"
  | "invoice_sent"
  | "payment_received"
  | "payment_overdue"
  | "booking_confirmation"
  | "booking_cancellation"
  | "attendance_submitted"
  | "document_uploaded"
  | "consent_required"
  | "announcement";

export const ENUM_FOR: Record<NotifType, string> = {
  registration_confirmation: "registration_confirmation",
  invoice_sent: "invoice_sent",
  payment_received: "payment_received",
  payment_overdue: "payment_overdue",
  booking_confirmation: "booking_confirmation",
  booking_cancellation: "booking_cancellation",
  attendance_submitted: "attendance_submitted",
  document_uploaded: "document_uploaded",
  consent_required: "consent_required",
  announcement: "system",
};

/** Variables a template may reference (snake_case, as in the product spec). */
export type NotifVars = {
  parent_name?: string;
  athlete_name?: string;
  invoice_number?: string;
  amount_due?: number;
  due_date?: string;
  payment_link?: string;
  service_name?: string;
  coach_name?: string;
  when?: string;
  document_name?: string;
  consent_name?: string;
  program_name?: string;
  title?: string;
  message?: string;
  /** Issuing club (tenant) name; filled in by dispatchNotification(). */
  club_name?: string;
};

export type Rendered = { title: string; body: string; link?: string; subject: string; html: string };

const PLATFORM = () => PLATFORM_NAME;

/**
 * Per-render tenant context: brand colour/logo, money and date formatting in
 * the club's currency / locale / time zone, and the club's own base URL for
 * call-to-action links. Built by dispatchNotification() from the org.
 */
export type RenderContext = ClubBrand & { timeZone?: string | null; baseUrl?: string | null };

// Set per render() call so every template's shell shows the issuing club.
let current: RenderContext = {};
const clubName = (v?: NotifVars) => v?.club_name?.trim() || current.clubName?.trim() || PLATFORM();

function shell(heading: string, lines: string[], cta?: { label: string; href: string }): string {
  const club = clubName();
  const { brand: BRAND, bg: BG, logo } = brandStyle(current);
  const href = cta && current.baseUrl ? tenantLink(current.baseUrl, cta.href) : cta?.href;
  const body = lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#D8D8D8;">${l}</p>`).join("");
  const button = cta
    ? `<a href="${href}" style="display:inline-block;margin-top:8px;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${cta.label}</a>`
    : "";
  const header = logo
    ? `<img src="${logo.replace(/"/g, "&quot;")}" alt="${club.replace(/"/g, "&quot;")}" height="40" style="display:block;height:40px;max-width:200px;border:0;" />`
    : `<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:${BRAND};font-weight:700;">${club}</div>`;
  return `<!doctype html><html><body style="margin:0;background:${BG};font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${header}
    <h1 style="margin:16px 0 18px;font-size:22px;color:#F1F1F1;">${heading}</h1>
    ${body}${button}
    <hr style="border:none;border-top:1px solid #222;margin:28px 0 14px;" />
    <p style="margin:0;font-size:12px;color:#777;">${club}</p>
  </div></body></html>`;
}

const money = (n?: number) =>
  typeof n === "number" ? formatMoney(n, current.currency || FORMAT_DEFAULTS.currency, current.locale || FORMAT_DEFAULTS.locale) : "—";
const day = (d?: string) =>
  d ? formatDate(d, { locale: current.locale || FORMAT_DEFAULTS.locale, timeZone: current.timeZone || FORMAT_DEFAULTS.timeZone }) : "—";
const name = (v?: string) => v ?? "there";

/** Replace {{variable}} placeholders in freeform text (admin broadcasts). */
export function applyVars(text: string, vars: NotifVars): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key: string) => {
    const raw = (vars as Record<string, unknown>)[key];
    if (raw == null) return "";
    if (key === "amount_due") return money(raw as number);
    if (key === "due_date") return day(raw as string);
    return String(raw);
  });
}

type Builder = (v: NotifVars) => Rendered;

export const TEMPLATES: Record<NotifType, Builder> = {
  registration_confirmation: (v) => ({
    title: "Registration confirmed",
    body: `${v.athlete_name ?? "Your child"} is registered for ${v.program_name ?? "the program"}.`,
    link: "/parent/children",
    subject: `Registration confirmed — ${v.program_name ?? clubName(v)}`,
    html: shell("You're all set!", [
      `Hi ${name(v.parent_name)},`,
      `${v.athlete_name ?? "Your child"} is now registered for <strong>${v.program_name ?? "the program"}</strong>.`,
      v.invoice_number ? `Invoice <strong>${v.invoice_number}</strong> (${money(v.amount_due)}) has been issued.` : "We're excited to have you on the team.",
    ], v.payment_link ? { label: "View invoice", href: v.payment_link } : undefined),
  }),
  invoice_sent: (v) => ({
    title: `Invoice ${v.invoice_number ?? ""} issued`.trim(),
    body: `${money(v.amount_due)} due ${day(v.due_date)}.`,
    link: "/parent/invoices",
    subject: `Invoice ${v.invoice_number ?? ""} — ${money(v.amount_due)} due`,
    html: shell("New invoice", [
      `Hi ${name(v.parent_name)},`,
      `Invoice <strong>${v.invoice_number ?? ""}</strong> for <strong>${money(v.amount_due)}</strong> is now available.`,
      `It is due on <strong>${day(v.due_date)}</strong>.`,
    ], v.payment_link ? { label: "Pay now", href: v.payment_link } : undefined),
  }),
  payment_received: (v) => ({
    title: "Payment received",
    body: `Thank you — we received your payment for ${v.invoice_number ?? "your invoice"}.`,
    link: "/parent/invoices",
    subject: `Payment received — ${v.invoice_number ?? "thank you"}`,
    html: shell("Payment received", [
      `Hi ${name(v.parent_name)},`,
      `We've received <strong>${money(v.amount_due)}</strong> toward invoice <strong>${v.invoice_number ?? ""}</strong>. Thank you!`,
    ]),
  }),
  payment_overdue: (v) => ({
    title: `Payment overdue — ${v.invoice_number ?? ""}`.trim(),
    body: `${money(v.amount_due)} was due ${day(v.due_date)}.`,
    link: "/parent/invoices",
    subject: `Reminder: invoice ${v.invoice_number ?? ""} is overdue`,
    html: shell("Payment reminder", [
      `Hi ${name(v.parent_name)},`,
      `Our records show invoice <strong>${v.invoice_number ?? ""}</strong> for <strong>${money(v.amount_due)}</strong> was due on <strong>${day(v.due_date)}</strong> and is still open.`,
      `If you've already paid, please disregard this note.`,
    ], v.payment_link ? { label: "Pay now", href: v.payment_link } : undefined),
  }),
  booking_confirmation: (v) => ({
    title: "Training session booked",
    body: `${v.service_name ?? "Session"} with ${v.coach_name ?? "your coach"} · ${v.when ?? ""}`.trim(),
    link: "/parent/bookings",
    subject: `Booking confirmed — ${v.service_name ?? "training"}`,
    html: shell("Session booked", [
      `Hi ${name(v.parent_name)},`,
      `${v.athlete_name ?? "Your child"} is booked for <strong>${v.service_name ?? "a session"}</strong> with ${v.coach_name ?? "a coach"}.`,
      `When: <strong>${v.when ?? "—"}</strong>.`,
    ], { label: "View booking", href: "/parent/bookings" }),
  }),
  booking_cancellation: (v) => ({
    title: "Booking cancelled",
    body: `${v.service_name ?? "Session"} · ${v.when ?? ""} was cancelled.`.trim(),
    link: "/parent/bookings",
    subject: `Booking cancelled — ${v.service_name ?? "training"}`,
    html: shell("Booking cancelled", [
      `Hi ${name(v.parent_name)},`,
      `The booking for <strong>${v.service_name ?? "a session"}</strong> (${v.when ?? "—"}) has been cancelled.`,
    ], { label: "Book again", href: "/parent/bookings/new" }),
  }),
  attendance_submitted: (v) => ({
    title: "Attendance updated",
    body: `Attendance for ${v.athlete_name ?? "your child"} was recorded${v.program_name ? ` for ${v.program_name}` : ""}.`,
    link: "/parent/attendance",
    subject: `Attendance recorded${v.program_name ? ` — ${v.program_name}` : ""}`,
    html: shell("Attendance recorded", [
      `Hi ${name(v.parent_name)},`,
      `Today's attendance for <strong>${v.athlete_name ?? "your child"}</strong>${v.program_name ? ` in ${v.program_name}` : ""} has been recorded.`,
    ], { label: "View attendance", href: "/parent/attendance" }),
  }),
  document_uploaded: (v) => ({
    title: "New document available",
    body: `${v.document_name ?? "A document"} was added to your family file.`,
    link: "/parent/documents",
    subject: `New document — ${v.document_name ?? clubName(v)}`,
    html: shell("New document", [
      `Hi ${name(v.parent_name)},`,
      `<strong>${v.document_name ?? "A new document"}</strong> has been added to your family's records.`,
    ], { label: "View documents", href: "/parent/documents" }),
  }),
  consent_required: (v) => ({
    title: "Action needed: consent required",
    body: `Please review and sign: ${v.consent_name ?? "a consent form"}.`,
    link: "/parent/documents",
    subject: `Action needed — ${v.consent_name ?? "consent required"}`,
    html: shell("Consent required", [
      `Hi ${name(v.parent_name)},`,
      `We need your consent for <strong>${v.consent_name ?? "a required form"}</strong>${v.athlete_name ? ` for ${v.athlete_name}` : ""}.`,
      `Please review and sign at your earliest convenience.`,
    ], { label: "Review now", href: "/parent/documents" }),
  }),
  announcement: (v) => ({
    title: v.title ?? `A message from ${clubName(v)}`,
    body: applyVars(v.message ?? "", v),
    link: "/parent/notifications",
    subject: v.title ?? `A message from ${clubName(v)}`,
    html: shell(v.title ?? "A message from your club", [
      `Hi ${name(v.parent_name)},`,
      applyVars(v.message ?? "", v).replace(/\n/g, "<br/>"),
    ]),
  }),
};

export function render(type: NotifType, vars: NotifVars, ctx: RenderContext = {}): Rendered {
  current = { ...ctx, clubName: vars.club_name?.trim() || ctx.clubName || null };
  try {
    return TEMPLATES[type](vars);
  } finally {
    current = {};
  }
}
