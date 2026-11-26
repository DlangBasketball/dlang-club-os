import { decodeEntities, escapeHtml, htmlToText } from "@/lib/website/sanitize";

/**
 * Rich-text sanitizer for site blocks (editor input and imported pages).
 * Allow-list based, dependency-free, same model as src/lib/website/sanitize.ts:
 *   - script / style / iframe / object / svg / form ... removed WITH content
 *   - comments removed; event handlers, style and class attributes dropped
 *   - only simple formatting tags survive; <a> keeps a safe href only:
 *     https:, mailto:, tel:, a site-relative path ("/camps") or "#anchor"
 *     (never //host, javascript:, data:, vbscript:)
 *   - external links get rel="noopener noreferrer nofollow" + target=_blank
 *   - text is entity-decoded and re-escaped: no raw "<" ever survives
 * Images are separate blocks (library images with a public-use check).
 */

const DROP_WITH_CONTENT = [
  "script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "form", "textarea",
  "select", "button", "head", "title", "video", "audio", "canvas", "frame", "frameset", "applet", "base", "link", "meta",
];
const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "u", "s", "ul", "ol", "li", "a", "h2", "h3", "h4", "blockquote", "small", "sup", "sub"]);
const VOID = new Set(["br"]);

function stripDangerous(html: string): string {
  let out = html.replace(/<!--[\s\S]*?(-->|$)/g, "").replace(/<!\[CDATA\[[\s\S]*?(\]\]>|$)/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(<\\/${tag}\\s*>|$)`, "gi"), "");
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }
  return out;
}

/** A link target allowed in site content, or null. */
export function safeSiteHref(raw: string | null | undefined): { href: string; external: boolean } | null {
  if (!raw) return null;
  // Decode entities, drop control / whitespace characters browsers ignore
  // ("java\tscript:"), then test the scheme.
  const v = decodeEntities(String(raw)).replace(/[\u0000- \u007f-\u009f]/g, "").trim();
  if (!v || v.length > 1000) return null;
  if (v.startsWith("#")) return /^#[A-Za-z][\w-]{0,80}$/.test(v) ? { href: v, external: false } : null;
  if (v.startsWith("/")) {
    if (v.startsWith("//") || v.startsWith("/\\")) return null;
    return { href: v, external: false };
  }
  if (/^mailto:[^\s"<>]+$/i.test(v)) return { href: v, external: false };
  if (/^tel:\+?[0-9().-]{3,30}$/i.test(v)) return { href: v, external: false };
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return { href: u.toString(), external: true };
  } catch {
    return null;
  }
}

/** Sanitize to the allow-list above. Output is safe for dangerouslySetInnerHTML. */
export function sanitizeRichText(input: string | null | undefined, maxLength = 50_000): string {
  if (!input) return "";
  const src = stripDangerous(String(input).slice(0, maxLength * 4));
  const out: string[] = [];
  const open: string[] = [];
  const re = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => out.push(escapeHtml(decodeEntities(t.replace(/</g, " ").replace(/>/g, " "))));
  while ((m = re.exec(src))) {
    text(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = Boolean(m[1]);
    let tag = m[2]!.toLowerCase();
    if (tag === "h1") tag = "h2";
    if (tag === "h5" || tag === "h6") tag = "h4";
    if (tag === "div" || tag === "section") {
      // Block wrappers become paragraph breaks.
      if (closing && open.includes("p")) {
        while (open.length && open[open.length - 1] !== "p") out.push(`</${open.pop()}>`);
        if (open.length) out.push(`</${open.pop()}>`);
      }
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx >= 0) while (open.length > idx) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }
    if (tag === "a") {
      const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] ?? "");
      const link = safeSiteHref(hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4]);
      out.push(
        link
          ? link.external
            ? `<a href="${escapeHtml(link.href)}" rel="noopener noreferrer nofollow" target="_blank">`
            : `<a href="${escapeHtml(link.href)}">`
          : "<a>",
      );
    } else {
      out.push(`<${tag}>`);
    }
    open.push(tag);
  }
  text(src.slice(last));
  while (open.length) out.push(`</${open.pop()}>`);
  const html = out
    .join("")
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/[ \t\r\n]{2,}/g, " ")
    .trim();
  if (html.length <= maxLength) return html;
  return `<p>${escapeHtml(htmlToText(html, maxLength - 20))}</p>`;
}

/** Plain text of rich text (search, meta descriptions, translation drafts). */
export function richTextToPlain(input: string | null | undefined, max = 5_000): string {
  return htmlToText(input ?? "", max);
}

/** Escape plain text into safe paragraphs. */
export function plainToRichText(text: string): string {
  return String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
