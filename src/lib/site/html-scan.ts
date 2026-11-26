import { decodeEntities } from "@/lib/website/sanitize";

/**
 * Tiny, dependency-free helpers to walk rendered (WordPress / page-builder)
 * HTML: attribute reads and balanced element bounds. Pure; never executes or
 * outputs the HTML (anything shown on the site goes through the sanitiser).
 */

/** Decoded value of an attribute in an opening tag, or null. */
export function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

/** The opening tag starting at `start` ("<div class=...>"). */
export function openTagAt(html: string, start: number): string {
  const end = html.indexOf(">", start);
  return end === -1 ? html.slice(start) : html.slice(start, end + 1);
}

const VOID = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "col", "embed", "wbr", "track", "param"]);

/** Index just after the element that opens at `start` (balanced on its tag name). */
export function elementEnd(html: string, start: number): number {
  const nm = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start, start + 40));
  if (!nm) return start + 1;
  const name = nm[1]!.toLowerCase();
  const open = openTagAt(html, start);
  if (VOID.has(name) || open.endsWith("/>")) return start + open.length;
  const re = new RegExp(`<(\\/?)${name}\\b[^>]*>`, "gi");
  re.lastIndex = start + open.length;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1]) depth--;
    else if (!m[0].endsWith("/>")) depth++;
    if (depth === 0) return m.index + m[0].length;
  }
  return html.length;
}

/** Inner HTML bounds of the element at `start`: [innerStart, innerEnd). */
export function innerBounds(html: string, start: number): [number, number] {
  const open = openTagAt(html, start);
  const end = elementEnd(html, start);
  const close = html.lastIndexOf("</", end - 1);
  return [start + open.length, close > start ? close : end];
}

/** Start indexes of opening tags matching `tag` (regex source, e.g. "div|section") whose opening tag satisfies `test`. */
export function findTags(html: string, tag: string, test: (openTag: string) => boolean, from = 0, to = html.length): number[] {
  const out: number[] = [];
  const re = new RegExp(`<(?:${tag})\\b[^>]*>`, "gi");
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && m.index < to) if (test(m[0])) out.push(m.index);
  return out;
}

/** Direct child elements named `tag` inside [from, to) (each skipped whole). */
export function childElements(html: string, from: number, to: number, tag: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = new RegExp(`<${tag}\\b`, "gi");
  let pos = from;
  while (pos < to) {
    re.lastIndex = pos;
    const m = re.exec(html);
    if (!m || m.index >= to) break;
    const end = Math.min(elementEnd(html, m.index), to);
    out.push({ start: m.index, end });
    pos = end;
  }
  return out;
}

/** class + id of an opening tag, lower-cased (for pattern tests). */
export function classIdOf(openTag: string): string {
  return `${attrOf(openTag, "class") ?? ""} ${attrOf(openTag, "id") ?? ""}`.toLowerCase();
}
