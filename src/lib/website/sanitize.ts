/**
 * Minimal, dependency-free HTML sanitizer for content imported from a club
 * website (WordPress posts, WooCommerce descriptions) and for "html-safe"
 * API fields. Allow-list based:
 *   - script / style / iframe / object / embed / svg / form ... are removed
 *     WITH their content; comments are removed
 *   - only simple formatting tags survive, without any attribute except an
 *     https / mailto href on <a> (which gets rel="noopener noreferrer nofollow")
 *   - images are dropped (a website photo may show a child; covers are set in
 *     the app, with consent)
 *   - text is entity-decoded and re-escaped, so no raw "<" ever survives
 */

const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "form", "textarea", "select", "button", "head", "title", "video", "audio", "canvas"];
const ALLOWED = new Set(["p", "br", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "h2", "h3", "h4", "blockquote"]);
const VOID = new Set(["br"]);

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", euro: "€", copy: "©", reg: "®",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç", ouml: "ö", auml: "ä", uuml: "ü",
  Ouml: "Ö", Auml: "Ä", Uuml: "Ü", szlig: "ss", iuml: "ï", ocirc: "ô", ucirc: "û", times: "×", middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return "";
      return String.fromCodePoint(n);
    }
    return NAMED[code] ?? m;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripDangerous(html: string): string {
  let out = html.replace(/<!--[\s\S]*?(-->|$)/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(<\\/${tag}\\s*>|$)`, "gi"), "");
    out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }
  return out;
}

function safeHref(raw: string | undefined): string | null {
  if (!raw) return null;
  const v = decodeEntities(raw).trim();
  if (/^mailto:[^\s"<>]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Sanitize HTML to the allow-list above. Output is safe to inject with dangerouslySetInnerHTML. */
export function sanitizeHtml(input: string | null | undefined, maxLength = 20_000): string {
  if (!input) return "";
  const src = stripDangerous(String(input));
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
    const tag = m[2]!.toLowerCase();
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const idx = open.lastIndexOf(tag);
      if (idx >= 0) {
        while (open.length > idx) out.push(`</${open.pop()}>`);
      }
      continue;
    }
    if (VOID.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }
    if (tag === "a") {
      const hrefMatch = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] ?? "");
      const href = safeHref(hrefMatch?.[2] ?? hrefMatch?.[3] ?? hrefMatch?.[4]);
      out.push(href ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">` : "<a>");
    } else {
      out.push(`<${tag}>`);
    }
    open.push(tag);
  }
  text(src.slice(last));
  while (open.length) out.push(`</${open.pop()}>`);
  const html = out.join("").replace(/\s{2,}/g, " ").trim();
  return html.length > maxLength ? sanitizeHtml(htmlToText(html).slice(0, maxLength - 100), maxLength) : html;
}

/** Plain text from HTML (dangerous blocks removed, entities decoded, whitespace collapsed). */
export function htmlToText(input: string | null | undefined, maxLength = 5_000): string {
  if (!input) return "";
  const s = stripDangerous(String(input))
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|li|h[1-6]|blockquote|div)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  const text = decodeEntities(s)
    .replace(/[<>]/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
