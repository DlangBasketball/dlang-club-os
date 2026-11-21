import { formatMoney, FORMAT_DEFAULTS } from "@/lib/format";
import { PLATFORM_NAME } from "@/lib/brand";
import { directionOf } from "@/lib/i18n/languages";
import { getTranslator } from "@/lib/i18n/messages";
import type { Translator } from "@/lib/i18n/translator";

const DEFAULT_BRAND = "#DA2627";
const DEFAULT_BG = "#0A0A0A";

/**
 * Issuing club (tenant): name, brand colour, logo, and the currency/locale its
 * amounts are shown in, plus the RECIPIENT's language. All optional so callers
 * without an org still render (English, CHF). Build it with
 * getOrgEmailContext(orgId, recipientLocale).brand.
 */
export type ClubBrand = {
  clubName?: string | null;
  /** Tenant primary colour (#RRGGBB). */
  primaryColor?: string | null;
  /** Dark page background; null/absent keeps the neutral dark shell. */
  background?: string | null;
  /** Absolute https URL of the club logo. */
  logoUrl?: string | null;
  /** ISO 4217 code of the amounts (the invoice / club currency). */
  currency?: string | null;
  /** Intl locale for number formatting, e.g. "de-CH", "en-US". */
  locale?: string | null;
  /** Recipient's catalog language, e.g. "de-CH", "fr", "en-GB" (default English). */
  language?: string | null;
};
const clubOf = (d: ClubBrand) => d.clubName?.trim() || PLATFORM_NAME;

const HEX = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;
const esc = (s: string | number | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colorOf = (v: string | null | undefined, fallback: string) => (v && HEX.test(v) ? v : fallback);

/** Translator in the recipient's language, numbers in the club's Intl locale. */
export function emailTranslator(d: ClubBrand): Translator {
  return getTranslator(d.language || "en", d.locale || undefined);
}

/** Brand colour / background / money formatter for one render. */
export function brandStyle(d: ClubBrand) {
  const currency = d.currency || FORMAT_DEFAULTS.currency;
  const locale = d.locale || FORMAT_DEFAULTS.locale;
  return {
    brand: colorOf(d.primaryColor, DEFAULT_BRAND),
    bg: colorOf(d.background, DEFAULT_BG),
    logo: d.logoUrl && /^https:\/\/[^\s"'<>]+$/.test(d.logoUrl) ? d.logoUrl : null,
    money: (n: number) => formatMoney(n, currency, locale),
  };
}

/** `lang` + `dir` attributes for the <html> of an email in the recipient's language. */
export function htmlLangAttrs(d: ClubBrand): string {
  const lang = d.language || "en";
  return `lang="${esc(lang)}" dir="${directionOf(lang)}"`;
}

function shell(title: string, inner: string, d: ClubBrand) {
  const t = emailTranslator(d);
  const club = esc(clubOf(d));
  const { brand, bg, logo } = brandStyle(d);
  const header = logo
    ? `<img src="${esc(logo)}" alt="${club}" height="40" style="display:block;height:40px;max-width:200px;border:0;" />`
    : `<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:${brand};font-weight:700;">${club}</div>`;
  return `<!doctype html><html ${htmlLangAttrs(d)}><body style="margin:0;background:${bg};font-family:Helvetica,Arial,sans-serif;color:#F1F1F1;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${header}
    <h1 style="font-size:24px;margin:12px 0 20px;color:#fff;">${title}</h1>
    ${inner}
    <hr style="border:none;border-top:1px solid #2A2A2A;margin:28px 0;" />
    <p style="font-size:12px;color:#8A8A8A;line-height:1.6;">${esc(t("email.footer", { club: clubOf(d) }))}</p>
  </div></body></html>`;
}

/** Greeting name, or the language's neutral form when unknown. */
const nameOr = (t: Translator, name: string | null | undefined) => (name?.trim() ? name.trim() : t("email.defaultName"));

export type ConfirmationData = {
  parentName: string;
  programName: string;
  children: string[];
  invoiceNumber: string;
  totalChf: number;
  dueDateLabel: string;
  manageUrl: string;
};

/** Sent to the parent after a successful registration. */
export function registrationConfirmation(d: ConfirmationData & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const { brand: BRAND, money } = brandStyle(d);
  const kids = d.children.map((c) => `<li style="margin:2px 0;">${esc(c)}</li>`).join("");
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.registrationConfirmation.intro", { name: nameOr(t, d.parentName), club: clubOf(d) }))}</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:12px;color:#8A8A8A;text-transform:uppercase;letter-spacing:.1em;">${esc(t("email.registrationConfirmation.program"))}</div>
      <div style="font-size:17px;color:#fff;margin:2px 0 14px;">${esc(d.programName)}</div>
      <div style="font-size:12px;color:#8A8A8A;text-transform:uppercase;letter-spacing:.1em;">${esc(t("email.registrationConfirmation.participants", { count: d.children.length }))}</div>
      <ul style="margin:6px 0 14px;padding-inline-start:18px;color:#D8D8D8;font-size:15px;">${kids}</ul>
      <div style="display:flex;justify-content:space-between;border-top:1px solid #2A2A2A;padding-top:14px;">
        <span style="color:#8A8A8A;">${esc(t("email.registrationConfirmation.invoice", { invoice: d.invoiceNumber }))}</span>
        <span style="color:#fff;font-weight:700;">${esc(money(d.totalChf))}</span>
      </div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:6px;">${esc(t("email.registrationConfirmation.dueBy", { date: d.dueDateLabel }))}</div>
    </div>
    <a href="${esc(d.manageUrl)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${esc(t("email.registrationConfirmation.cta"))}</a>
    <p style="font-size:13px;color:#8A8A8A;margin-top:18px;line-height:1.6;">${esc(t("email.registrationConfirmation.outro"))}</p>`;
  return {
    subject: t("email.registrationConfirmation.subject", { program: d.programName, invoice: d.invoiceNumber }),
    html: shell(esc(t("email.registrationConfirmation.title")), inner, d),
  };
}

/** Internal heads-up to the club inbox. */
export function adminRegistrationAlert(d: ({ programName: string; parentName: string; children: string[]; totalChf: number; invoiceNumber: string }) & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const { money } = brandStyle(d);
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.adminRegistrationAlert.intro"))}</p>
    <ul style="color:#D8D8D8;font-size:15px;line-height:1.9;">
      <li>${esc(t("email.adminRegistrationAlert.program"))}: <strong style="color:#fff;">${esc(d.programName)}</strong></li>
      <li>${esc(t("email.adminRegistrationAlert.parent"))}: <strong style="color:#fff;">${esc(d.parentName)}</strong></li>
      <li>${esc(t("email.adminRegistrationAlert.children"))}: ${esc(d.children.join(", "))}</li>
      <li>${esc(t("email.adminRegistrationAlert.invoice"))}: ${esc(d.invoiceNumber)} — ${esc(money(d.totalChf))}</li>
    </ul>`;
  return {
    subject: t("email.adminRegistrationAlert.subject", { program: d.programName }),
    html: shell(esc(t("email.adminRegistrationAlert.title")), inner, d),
  };
}

export type InvoiceEmailData = {
  parentName: string;
  invoiceNumber: string;
  description: string | null;
  totalChf: number;
  dueDateLabel: string;
  payUrl: string;
};

/** Sent when an invoice is issued to a parent. */
export function invoiceIssued(d: InvoiceEmailData & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const { brand: BRAND, money } = brandStyle(d);
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.invoiceIssued.intro", { name: nameOr(t, d.parentName) }))}</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="display:flex;justify-content:space-between;"><span style="color:#8A8A8A;">${esc(t("email.registrationConfirmation.invoice", { invoice: d.invoiceNumber }))}</span><span style="color:#fff;font-weight:700;">${esc(money(d.totalChf))}</span></div>
      ${d.description ? `<div style="font-size:13px;color:#B8B8B8;margin-top:8px;">${esc(d.description)}</div>` : ""}
      <div style="font-size:13px;color:#8A8A8A;margin-top:8px;">${esc(t("email.invoiceIssued.dueBy", { date: d.dueDateLabel }))}</div>
    </div>
    <a href="${esc(d.payUrl)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${esc(t("email.invoiceIssued.cta"))}</a>
    <p style="font-size:13px;color:#8A8A8A;margin-top:18px;">${esc(t("email.invoiceIssued.methods"))}</p>`;
  return {
    subject: t("email.invoiceIssued.subject", { invoice: d.invoiceNumber, amount: money(d.totalChf) }),
    html: shell(esc(t("email.invoiceIssued.title")), inner, d),
  };
}

/** Overdue reminder. */
export function overdueReminder(d: InvoiceEmailData & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const { brand: BRAND, money } = brandStyle(d);
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.overdueReminder.intro", { name: nameOr(t, d.parentName), invoice: d.invoiceNumber }))}</p>
    <div style="background:#1A1A1A;border:1px solid ${BRAND};border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="display:flex;justify-content:space-between;"><span style="color:#8A8A8A;">${esc(t("email.overdueReminder.amountDue"))}</span><span style="color:#fff;font-weight:700;">${esc(money(d.totalChf))}</span></div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:8px;">${esc(t("email.overdueReminder.wasDue", { date: d.dueDateLabel }))}</div>
    </div>
    <a href="${esc(d.payUrl)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${esc(t("email.overdueReminder.cta"))}</a>
    <p style="font-size:13px;color:#8A8A8A;margin-top:18px;">${esc(t("email.overdueReminder.disregard"))}</p>`;
  return {
    subject: t("email.overdueReminder.subject", { invoice: d.invoiceNumber }),
    html: shell(esc(t("email.overdueReminder.title")), inner, d),
  };
}

/** Receipt after a payment is recorded. */
export function paymentReceived(d: ({ parentName: string; invoiceNumber: string; amountChf: number; balanceChf: number }) & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const { money } = brandStyle(d);
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.paymentReceived.intro", { name: nameOr(t, d.parentName) }))}</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="display:flex;justify-content:space-between;"><span style="color:#8A8A8A;">${esc(t("email.registrationConfirmation.invoice", { invoice: d.invoiceNumber }))}</span><span style="color:#2F9E55;font-weight:700;">+ ${esc(money(d.amountChf))}</span></div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:8px;">${esc(t("email.paymentReceived.remaining", { amount: money(d.balanceChf) }))}</div>
    </div>`;
  return {
    subject: t("email.paymentReceived.subject", { invoice: d.invoiceNumber }),
    html: shell(esc(t("email.paymentReceived.title")), inner, d),
  };
}

export function bookingConfirmation(d: ({ parentName: string; athleteName: string; serviceName: string; coachName: string; when: string; payNote: string }) & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.bookingConfirmation.intro", { name: nameOr(t, d.parentName), athlete: d.athleteName }))}</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:16px;color:#F1F1F1;font-weight:700;">${esc(d.serviceName)}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:6px;">${esc(d.when)}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:4px;">${esc(t("email.bookingConfirmation.coach", { coach: d.coachName }))}</div>
      <div style="font-size:13px;color:#D8D8D8;margin-top:10px;">${esc(d.payNote)}</div>
    </div>`;
  return {
    subject: t("email.bookingConfirmation.subject", { service: d.serviceName }),
    html: shell(esc(t("email.bookingConfirmation.title")), inner, d),
  };
}

export function coachBookingAlert(d: ({ coachName: string; athleteName: string; serviceName: string; when: string }) & ClubBrand): { subject: string; html: string } {
  const t = emailTranslator(d);
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(t("email.coachBookingAlert.intro", { name: nameOr(t, d.coachName) }))}</p>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">
      <div style="font-size:16px;color:#F1F1F1;font-weight:700;">${esc(d.serviceName)}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:6px;">${esc(d.when)}</div>
      <div style="font-size:13px;color:#8A8A8A;margin-top:4px;">${esc(t("email.coachBookingAlert.athlete", { athlete: d.athleteName }))}</div>
    </div>`;
  return {
    subject: t("email.coachBookingAlert.subject", { athlete: d.athleteName }),
    html: shell(esc(t("email.coachBookingAlert.title")), inner, d),
  };
}

/**
 * Generic, already-translated message in the club's email shell (instalment
 * reminders, autopay notices …). Every string comes from the caller's
 * translator; values are HTML-escaped here.
 */
export function brandedMessage(d: {
  title: string;
  intro: string;
  rows?: { label: string; value: string }[];
  note?: string | null;
  cta?: { label: string; url: string } | null;
  footer?: string | null;
} & ClubBrand): { subject: string; html: string } {
  const { brand } = brandStyle(d);
  const rows = (d.rows ?? [])
    .map((r) => `<div style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;"><span style="color:#8A8A8A;">${esc(r.label)}</span><span style="color:#fff;font-weight:600;">${esc(r.value)}</span></div>`)
    .join("");
  const inner = `
    <p style="font-size:15px;line-height:1.7;color:#D8D8D8;">${esc(d.intro)}</p>
    ${rows ? `<div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:18px 20px;margin:18px 0;">${rows}</div>` : ""}
    ${d.note ? `<p style="font-size:13px;color:#D8D8D8;line-height:1.6;">${esc(d.note)}</p>` : ""}
    ${d.cta && /^https?:\/\//.test(d.cta.url) ? `<a href="${esc(d.cta.url)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${esc(d.cta.label)}</a>` : ""}
    ${d.footer ? `<p style="font-size:13px;color:#8A8A8A;margin-top:18px;">${esc(d.footer)}</p>` : ""}`;
  return { subject: d.title, html: shell(esc(d.title), inner, d) };
}
