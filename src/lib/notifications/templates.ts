import { formatDate, formatDateTime, formatMoney, FORMAT_DEFAULTS } from "@/lib/format";
import { attendancePortalPath } from "@/lib/attendance/types";
import { brandStyle, emailTranslator, htmlLangAttrs, type ClubBrand } from "@/lib/email/templates";
import { tenantLink } from "@/lib/tenant/url";
import { PLATFORM_NAME } from "@/lib/brand";
import type { MessageKey, TranslateValues, Translator } from "@/lib/i18n/translator";

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
  | "booking_rescheduled"
  | "attendance_submitted"
  | "document_uploaded"
  | "consent_required"
  | "attendance_no_show"
  | "attendance_no_show_correction"
  | "announcement";

export const ENUM_FOR: Record<NotifType, string> = {
  registration_confirmation: "registration_confirmation",
  invoice_sent: "invoice_sent",
  payment_received: "payment_received",
  payment_overdue: "payment_overdue",
  booking_confirmation: "booking_confirmation",
  booking_cancellation: "booking_cancellation",
  booking_rescheduled: "booking_rescheduled",
  attendance_submitted: "attendance_submitted",
  document_uploaded: "document_uploaded",
  consent_required: "consent_required",
  attendance_no_show: "attendance_no_show",
  attendance_no_show_correction: "attendance_no_show_correction",
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
  // Team attendance no-show alerts (src/lib/attendance/alerts.ts)
  team_name?: string;
  /** ISO instant of the session start (formatted in the club time zone). */
  starts_at?: string;
  event_id?: string;
  athlete_id?: string;
  /** Status the correction notice announces: present | late | excused | unexcused. */
  attendance_status?: string;
  /** training | game | tournament (no-show alerts). */
  event_type?: string;
  /**
   * false: the recipient has no login (family contact e-mail): the message
   * asks them to contact the club instead of linking the parent portal.
   */
  has_account?: boolean;
  // Booking workflow (src/lib/booking/notify.ts)
  /** ISO instant of the previous start (reschedule notice). */
  previous_starts_at?: string;
  /** In-app link / call to action of a booking notice (coach, player or parent app); none without an account. */
  portal_path?: string;
};

export type Rendered = { title: string; body: string; link?: string; subject: string; html: string };

/**
 * Per-render tenant context: brand colour/logo, money and date formatting in
 * the club's currency / locale / time zone, the RECIPIENT's language
 * (`language`, default English) and the club's own base URL for
 * call-to-action links. Built by dispatchNotification() from the org.
 */
export type RenderContext = ClubBrand & { timeZone?: string | null; baseUrl?: string | null };

// Set per render() call so every template's shell shows the issuing club.
let current: RenderContext = {};
let tr: Translator = emailTranslator({});
const clubName = (v?: NotifVars) => v?.club_name?.trim() || current.clubName?.trim() || PLATFORM_NAME;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tidy = (s: string) => s.replace(/\s{2,}/g, " ").replace(/\s+([.,:;!?)])/g, "$1").trim();

/** Plain-text translation (titles, bodies, subjects). */
const txt = (key: MessageKey, values?: TranslateValues) => tidy(tr(key, values));

/**
 * HTML translation: the catalog text is escaped, values are escaped and set
 * in <strong> (no string concatenation of translated fragments).
 */
function html(key: MessageKey, values: Record<string, string> = {}, plain: string[] = []): string {
  const tokens: string[] = [];
  const marked: TranslateValues = {};
  for (const [k, v] of Object.entries(values)) {
    marked[k] = `${tokens.length}`;
    tokens.push(plain.includes(k) ? esc(v) : `<strong>${esc(v)}</strong>`);
  }
  return esc(tidy(tr(key, marked))).replace(/(\d+)/g, (_m, i: string) => tokens[Number(i)] ?? "");
}

function shell(heading: string, lines: string[], cta?: { label: string; href: string }): string {
  const club = esc(clubName());
  const { brand: BRAND, bg: BG, logo } = brandStyle(current);
  const href = cta && current.baseUrl ? tenantLink(current.baseUrl, cta.href) : cta?.href;
  const body = lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#D8D8D8;">${l}</p>`).join("");
  const button = cta
    ? `<a href="${esc(href ?? "")}" style="display:inline-block;margin-top:8px;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${esc(cta.label)}</a>`
    : "";
  const header = logo
    ? `<img src="${esc(logo)}" alt="${club}" height="40" style="display:block;height:40px;max-width:200px;border:0;" />`
    : `<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:${BRAND};font-weight:700;">${club}</div>`;
  return `<!doctype html><html ${htmlLangAttrs(current)}><body style="margin:0;background:${BG};font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${header}
    <h1 style="margin:16px 0 18px;font-size:22px;color:#F1F1F1;">${esc(heading)}</h1>
    ${body}${button}
    <hr style="border:none;border-top:1px solid #222;margin:28px 0 14px;" />
    <p style="margin:0;font-size:12px;color:#777;">${club}</p>
  </div></body></html>`;
}

const money = (n?: number) =>
  typeof n === "number" ? formatMoney(n, current.currency || FORMAT_DEFAULTS.currency, current.locale || FORMAT_DEFAULTS.locale) : "—";
const day = (d?: string) =>
  d ? formatDate(d, { locale: current.locale || FORMAT_DEFAULTS.locale, timeZone: current.timeZone || FORMAT_DEFAULTS.timeZone }) : "—";
const at = (d?: string) =>
  d ? formatDateTime(d, { locale: current.locale || FORMAT_DEFAULTS.locale, timeZone: current.timeZone || FORMAT_DEFAULTS.timeZone, style: "full" }) : "—";
const greeting = (v: NotifVars) => html("email.greeting", { name: v.parent_name?.trim() || tr("email.defaultName") }, ["name"]);

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

const N = "notifyEmail" as const;

export const TEMPLATES: Record<NotifType, Builder> = {
  registration_confirmation: (v) => {
    const athlete = v.athlete_name ?? tr(`${N}.fallback.child`);
    const program = v.program_name ?? tr(`${N}.fallback.program`);
    return {
      title: txt(`${N}.registration_confirmation.title`),
      body: txt(`${N}.registration_confirmation.body`, { athlete, program }),
      link: "/parent/children",
      subject: txt(`${N}.registration_confirmation.subject`, { program: v.program_name ?? clubName(v) }),
      html: shell(txt(`${N}.registration_confirmation.heading`), [
        greeting(v),
        html(`${N}.registration_confirmation.line`, { athlete, program }, ["athlete"]),
        v.invoice_number
          ? html(`${N}.registration_confirmation.invoiceLine`, { invoice: v.invoice_number, amount: money(v.amount_due) }, ["amount"])
          : html(`${N}.registration_confirmation.welcome`),
      ], v.payment_link ? { label: txt(`${N}.registration_confirmation.cta`), href: v.payment_link } : undefined),
    };
  },
  invoice_sent: (v) => ({
    title: txt(`${N}.invoice_sent.title`, { invoice: v.invoice_number ?? "" }),
    body: txt(`${N}.invoice_sent.body`, { amount: money(v.amount_due), date: day(v.due_date) }),
    link: "/parent/invoices",
    subject: txt(`${N}.invoice_sent.subject`, { invoice: v.invoice_number ?? "", amount: money(v.amount_due) }),
    html: shell(txt(`${N}.invoice_sent.heading`), [
      greeting(v),
      html(`${N}.invoice_sent.line`, { invoice: v.invoice_number ?? "", amount: money(v.amount_due) }),
      html(`${N}.invoice_sent.due`, { date: day(v.due_date) }),
    ], v.payment_link ? { label: txt(`${N}.invoice_sent.cta`), href: v.payment_link } : undefined),
  }),
  payment_received: (v) => ({
    title: txt(`${N}.payment_received.title`),
    body: txt(`${N}.payment_received.body`, { invoice: v.invoice_number ?? tr(`${N}.fallback.invoice`) }),
    link: "/parent/invoices",
    subject: v.invoice_number
      ? txt(`${N}.payment_received.subject`, { invoice: v.invoice_number })
      : txt(`${N}.payment_received.subjectThanks`),
    html: shell(txt(`${N}.payment_received.heading`), [
      greeting(v),
      html(`${N}.payment_received.line`, { amount: money(v.amount_due), invoice: v.invoice_number ?? "" }),
    ]),
  }),
  payment_overdue: (v) => ({
    title: txt(`${N}.payment_overdue.title`, { invoice: v.invoice_number ?? "" }),
    body: txt(`${N}.payment_overdue.body`, { amount: money(v.amount_due), date: day(v.due_date) }),
    link: "/parent/invoices",
    subject: txt(`${N}.payment_overdue.subject`, { invoice: v.invoice_number ?? "" }),
    html: shell(txt(`${N}.payment_overdue.heading`), [
      greeting(v),
      html(`${N}.payment_overdue.line`, { invoice: v.invoice_number ?? "", amount: money(v.amount_due), date: day(v.due_date) }),
      html(`${N}.payment_overdue.disregard`),
    ], v.payment_link ? { label: txt(`${N}.payment_overdue.cta`), href: v.payment_link } : undefined),
  }),
  booking_confirmation: (v) => {
    const service = v.service_name ?? tr(`${N}.fallback.session`);
    const when = v.when ?? (v.starts_at ? at(v.starts_at) : "");
    const link = v.portal_path ?? "/parent/bookings";
    const cta = v.has_account === false ? undefined : { label: txt(`${N}.booking_confirmation.cta`), href: link };
    return {
      title: txt(`${N}.booking_confirmation.title`),
      body: txt(`${N}.booking_confirmation.body`, { service, coach: v.coach_name ?? tr(`${N}.fallback.yourCoach`), when }),
      link,
      subject: txt(`${N}.booking_confirmation.subject`, { service: v.service_name ?? tr(`${N}.fallback.training`) }),
      html: shell(txt(`${N}.booking_confirmation.heading`), [
        greeting(v),
        html(`${N}.booking_confirmation.line`, {
          athlete: v.athlete_name ?? tr(`${N}.fallback.child`),
          service: v.service_name ?? tr(`${N}.fallback.aSession`),
          coach: v.coach_name ?? tr(`${N}.fallback.aCoach`),
        }, ["athlete", "coach"]),
        html(`${N}.booking_confirmation.when`, { when: when || "—" }),
      ], cta),
    };
  },
  booking_rescheduled: (v) => {
    const service = v.service_name ?? tr(`${N}.fallback.session`);
    const when = v.when ?? (v.starts_at ? at(v.starts_at) : "—");
    const before = v.previous_starts_at ? at(v.previous_starts_at) : "—";
    const link = v.portal_path ?? "/parent/bookings";
    return {
      title: txt(`${N}.booking_rescheduled.title`),
      body: txt(`${N}.booking_rescheduled.body`, { service, when }),
      link,
      subject: txt(`${N}.booking_rescheduled.subject`, { service: v.service_name ?? tr(`${N}.fallback.training`) }),
      html: shell(txt(`${N}.booking_rescheduled.heading`), [
        greeting(v),
        html(`${N}.booking_rescheduled.line`, {
          athlete: v.athlete_name ?? tr(`${N}.fallback.child`),
          service: v.service_name ?? tr(`${N}.fallback.aSession`),
        }, ["athlete"]),
        html(`${N}.booking_rescheduled.when`, { when, before }),
      ], v.has_account === false ? undefined : { label: txt(`${N}.booking_rescheduled.cta`), href: link }),
    };
  },
  booking_cancellation: (v) => {
    const when = v.when ?? (v.starts_at ? at(v.starts_at) : "");
    const link = v.portal_path ?? "/parent/bookings";
    return {
      title: txt(`${N}.booking_cancellation.title`),
      body: txt(`${N}.booking_cancellation.body`, { service: v.service_name ?? tr(`${N}.fallback.session`), when }),
      link,
      subject: txt(`${N}.booking_cancellation.subject`, { service: v.service_name ?? tr(`${N}.fallback.training`) }),
      html: shell(txt(`${N}.booking_cancellation.heading`), [
        greeting(v),
        html(`${N}.booking_cancellation.line`, { service: v.service_name ?? tr(`${N}.fallback.aSession`), when: when || "—" }, ["when"]),
      ], v.has_account === false ? undefined
        : { label: txt(`${N}.booking_cancellation.cta`), href: v.portal_path ?? "/parent/bookings/new" }),
    };
  },
  attendance_submitted: (v) => {
    const athlete = v.athlete_name ?? tr(`${N}.fallback.childLower`);
    const p = v.program_name;
    return {
      title: txt(`${N}.attendance_submitted.title`),
      body: p ? txt(`${N}.attendance_submitted.bodyProgram`, { athlete, program: p }) : txt(`${N}.attendance_submitted.body`, { athlete }),
      link: "/parent/attendance",
      subject: p ? txt(`${N}.attendance_submitted.subjectProgram`, { program: p }) : txt(`${N}.attendance_submitted.subject`),
      html: shell(txt(`${N}.attendance_submitted.heading`), [
        greeting(v),
        p
          ? html(`${N}.attendance_submitted.lineProgram`, { athlete, program: p }, ["program"])
          : html(`${N}.attendance_submitted.line`, { athlete }),
      ], { label: txt(`${N}.attendance_submitted.cta`), href: "/parent/attendance" }),
    };
  },
  document_uploaded: (v) => ({
    title: txt(`${N}.document_uploaded.title`),
    body: txt(`${N}.document_uploaded.body`, { document: v.document_name ?? tr(`${N}.fallback.document`) }),
    link: "/parent/documents",
    subject: txt(`${N}.document_uploaded.subject`, { document: v.document_name ?? clubName(v) }),
    html: shell(txt(`${N}.document_uploaded.heading`), [
      greeting(v),
      html(`${N}.document_uploaded.line`, { document: v.document_name ?? tr(`${N}.fallback.newDocument`) }),
    ], { label: txt(`${N}.document_uploaded.cta`), href: "/parent/documents" }),
  }),
  consent_required: (v) => ({
    title: txt(`${N}.consent_required.title`),
    body: txt(`${N}.consent_required.body`, { consent: v.consent_name ?? tr(`${N}.fallback.consent`) }),
    link: "/parent/documents",
    subject: txt(`${N}.consent_required.subject`, { consent: v.consent_name ?? tr(`${N}.fallback.consentRequired`) }),
    html: shell(txt(`${N}.consent_required.heading`), [
      greeting(v),
      v.athlete_name
        ? html(`${N}.consent_required.lineAthlete`, { consent: v.consent_name ?? tr(`${N}.fallback.requiredForm`), athlete: v.athlete_name }, ["athlete"])
        : html(`${N}.consent_required.line`, { consent: v.consent_name ?? tr(`${N}.fallback.requiredForm`) }),
      html(`${N}.consent_required.sign`),
    ], { label: txt(`${N}.consent_required.cta`), href: "/parent/documents" }),
  }),
  attendance_no_show: (v) => {
    const athlete = v.athlete_name ?? tr(`${N}.fallback.child`);
    const team = v.team_name ?? tr(`${N}.attendance_no_show.fallbackTeam`);
    const link = v.event_id && v.athlete_id ? attendancePortalPath(v.event_id, v.athlete_id) : "/parent/attendance";
    const account = v.has_account !== false;
    const when = at(v.starts_at);
    return {
      title: txt(`${N}.attendance_no_show.title`, { athlete }),
      body: txt(`${N}.attendance_no_show.body`, { athlete, team, when }),
      link,
      subject: txt(`${N}.attendance_no_show.subject`, { athlete, team }),
      html: shell(txt(`${N}.attendance_no_show.heading`), [
        greeting(v),
        html(`${N}.attendance_no_show.line`, { athlete, team, when }, ["athlete"]),
        account
          ? html(`${N}.attendance_no_show.correction`)
          : html(`${N}.attendance_no_show.correctionNoAccount`, { club: clubName(v) }),
        html(`${N}.attendance_no_show.why`),
      ], account ? { label: txt(`${N}.attendance_no_show.cta`), href: link } : undefined),
    };
  },
  attendance_no_show_correction: (v) => {
    const athlete = v.athlete_name ?? tr(`${N}.fallback.child`);
    const team = v.team_name ?? tr(`${N}.attendance_no_show.fallbackTeam`);
    const st = (["present", "late", "excused", "unexcused"].includes(v.attendance_status ?? "") ? v.attendance_status! : "excused") as
      "present" | "late" | "excused" | "unexcused";
    const status = tr(`${N}.attendance_no_show_correction.status.${st}`);
    const link = v.event_id && v.athlete_id ? attendancePortalPath(v.event_id, v.athlete_id) : "/parent/attendance";
    const account = v.has_account !== false;
    const when = at(v.starts_at);
    const why = st === "unexcused" ? `${N}.attendance_no_show_correction.whyUnexcused` as const : `${N}.attendance_no_show_correction.whyCleared` as const;
    return {
      title: txt(`${N}.attendance_no_show_correction.title`, { athlete, status }),
      body: txt(`${N}.attendance_no_show_correction.body`, { athlete, team, when, status }),
      link,
      subject: txt(`${N}.attendance_no_show_correction.subject`, { athlete, team, status }),
      html: shell(txt(`${N}.attendance_no_show_correction.heading`), [
        greeting(v),
        html(`${N}.attendance_no_show_correction.earlier`),
        html(`${N}.attendance_no_show_correction.line`, { athlete, team, when, status }, ["athlete"]),
        html(why),
      ], account ? { label: txt(`${N}.attendance_no_show.cta`), href: link } : undefined),
    };
  },
  announcement: (v) => ({
    title: v.title ?? txt(`${N}.announcement.title`, { club: clubName(v) }),
    body: applyVars(v.message ?? "", v),
    link: "/parent/notifications",
    subject: v.title ?? txt(`${N}.announcement.title`, { club: clubName(v) }),
    html: shell(v.title ?? txt(`${N}.announcement.heading`), [
      greeting(v),
      esc(applyVars(v.message ?? "", v)).replace(/\n/g, "<br/>"),
    ]),
  }),
};

/**
 * Render one notification in the recipient's language (`ctx.language`,
 * default English) with the club's formats.
 */
export function render(type: NotifType, vars: NotifVars, ctx: RenderContext = {}): Rendered {
  current = { ...ctx, clubName: vars.club_name?.trim() || ctx.clubName || null };
  tr = emailTranslator(current);
  try {
    return TEMPLATES[type](vars);
  } finally {
    current = {};
    tr = emailTranslator({});
  }
}
