/**
 * WhatsApp, phase 1: no API integration. Staff get an "Open in WhatsApp"
 * share link with the text prefilled and NO recipient number (wa.me/?text=),
 * so they pick their own team group in WhatsApp; parent numbers are never
 * exposed to coaches. See docs/product/messaging.md for the planned
 * WhatsApp Business (Cloud API) integration.
 */
export const WHATSAPP_MAX_TEXT = 1500;

export function whatsappShareUrl(text: string): string {
  const clean = text.replace(/\r\n/g, "\n").trim().slice(0, WHATSAPP_MAX_TEXT);
  return `https://wa.me/?text=${encodeURIComponent(clean)}`;
}

/** Share text for a staff broadcast: title, body and a link back to the app. */
export function broadcastShareText(parts: { title?: string | null; body: string; link?: string | null }): string {
  return [parts.title?.trim(), parts.body.trim(), parts.link?.trim()].filter(Boolean).join("\n\n");
}
