import { brandStyle, type ClubBrand } from "@/lib/email/templates";
import { PLATFORM_NAME } from "@/lib/brand";

/**
 * Minimal branded email for messaging / alert / lead notifications. All
 * wording comes from the message catalogs (the caller passes translated
 * strings); values are HTML-escaped here. Message text is only included when
 * the caller allows it (never for sensitive threads).
 */
export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function messagingEmailHtml(opts: {
  brand: ClubBrand;
  heading: string;
  lines: string[];
  /** Quoted text block (already plain text; escaped here). */
  quote?: string | null;
  cta?: { label: string; href: string } | null;
  footer: string;
}): string {
  const { brand, bg, logo } = brandStyle(opts.brand);
  const club = escapeHtml(opts.brand.clubName?.trim() || PLATFORM_NAME);
  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${club}" height="40" style="display:block;height:40px;max-width:200px;border:0;" />`
    : `<div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:${brand};font-weight:700;">${club}</div>`;
  const lines = opts.lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#D8D8D8;">${escapeHtml(l)}</p>`).join("");
  const quote = opts.quote
    ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid ${brand};color:#D8D8D8;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(opts.quote)}</blockquote>`
    : "";
  const cta = opts.cta && /^https?:\/\//.test(opts.cta.href)
    ? `<a href="${escapeHtml(opts.cta.href)}" style="display:inline-block;margin-top:8px;background:${brand};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:8px;">${escapeHtml(opts.cta.label)}</a>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:${bg};font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    ${header}
    <h1 style="margin:16px 0 18px;font-size:22px;color:#F1F1F1;">${escapeHtml(opts.heading)}</h1>
    ${lines}${quote}${cta}
    <hr style="border:none;border-top:1px solid #222;margin:28px 0 14px;" />
    <p style="margin:0;font-size:12px;color:#777;">${club} · ${escapeHtml(opts.footer)}</p>
  </div></body></html>`;
}
