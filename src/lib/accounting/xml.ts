/**
 * Minimal, hardened XML parser for bank files (ISO 20022 camt.05x).
 *
 * Bank files are untrusted input, so this parser deliberately supports less
 * than XML 1.0:
 *   - no DTD at all: any `<!DOCTYPE` / `<!ENTITY` / other `<!` markup
 *     (except comments and CDATA) is rejected -> no XXE, no entity expansion
 *     ("billion laughs"), no external fetches;
 *   - only the five predefined entities and numeric character references are
 *     decoded; any other `&name;` is an error;
 *   - hard limits on input size, nesting depth and node count;
 *   - namespace prefixes are dropped (camt files use a default namespace whose
 *     version differs per bank: camt.054.001.04 / .08 ...).
 * Zero dependencies; pure (no I/O).
 */

export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

export type XmlErrorCode =
  | "TOO_LARGE"
  | "DTD_NOT_ALLOWED"
  | "ENTITY_NOT_ALLOWED"
  | "MALFORMED"
  | "TOO_DEEP"
  | "TOO_MANY_NODES"
  | "EMPTY";

export class XmlError extends Error {
  readonly code: XmlErrorCode;
  constructor(code: XmlErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.name = "XmlError";
  }
}

export const XML_LIMITS = { maxBytes: 5 * 1024 * 1024, maxDepth: 64, maxNodes: 200_000 } as const;

const NAME_RE = /^[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?$/;

function localName(qname: string): string {
  const i = qname.indexOf(":");
  return i >= 0 ? qname.slice(i + 1) : qname;
}

function decodeOne(ent: string): string {
  switch (ent) {
    case "lt": return "<";
    case "gt": return ">";
    case "amp": return "&";
    case "quot": return '"';
    case "apos": return "'";
  }
  let cp: number | null = null;
  if (/^#[0-9]{1,7}$/.test(ent)) cp = Number.parseInt(ent.slice(1), 10);
  else if (/^#x[0-9a-fA-F]{1,6}$/.test(ent)) cp = Number.parseInt(ent.slice(2), 16);
  if (cp === null || cp > 0x10ffff || cp === 0 || (cp >= 0xd800 && cp <= 0xdfff)) {
    throw new XmlError("ENTITY_NOT_ALLOWED", `&${ent.slice(0, 12)};`);
  }
  return String.fromCodePoint(cp);
}

/** Decode the predefined entities and numeric references; anything else is an error. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf("&", i);
    if (amp < 0) { out += s.slice(i); break; }
    out += s.slice(i, amp);
    const semi = s.indexOf(";", amp + 1);
    if (semi < 0 || semi - amp > 13) throw new XmlError("MALFORMED", "bare &");
    out += decodeOne(s.slice(amp + 1, semi));
    i = semi + 1;
  }
  return out;
}

function byteLength(s: string): number {
  // UTF-8 length without Buffer (works in any runtime).
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Parse an XML document into a tree. Throws XmlError on anything unsafe or malformed. */
export function parseXml(input: string, limits: { maxBytes?: number; maxDepth?: number; maxNodes?: number } = {}): XmlNode {
  const maxBytes = limits.maxBytes ?? XML_LIMITS.maxBytes;
  const maxDepth = limits.maxDepth ?? XML_LIMITS.maxDepth;
  const maxNodes = limits.maxNodes ?? XML_LIMITS.maxNodes;
  if (input.length > maxBytes || byteLength(input) > maxBytes) throw new XmlError("TOO_LARGE");
  let src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  // Fail fast on any DTD, even inside what a lenient parser might skip.
  if (/<!DOCTYPE/i.test(src) || /<!ENTITY/i.test(src) || /<!ATTLIST/i.test(src) || /<!ELEMENT/i.test(src)) {
    throw new XmlError("DTD_NOT_ALLOWED");
  }
  src = src.replace(/\r\n?/g, "\n");
  if (!src.trim()) throw new XmlError("EMPTY");

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let nodes = 0;
  let i = 0;
  const n = src.length;

  const appendText = (t: string) => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (t.trim()) throw new XmlError("MALFORMED", "text outside the root element");
      return;
    }
    top.text += t;
  };

  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { appendText(decodeEntities(src.slice(i))); break; }
    if (lt > i) appendText(decodeEntities(src.slice(i, lt)));
    i = lt;

    if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end < 0) throw new XmlError("MALFORMED", "unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) throw new XmlError("MALFORMED", "unterminated comment");
      i = end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      if (end < 0) throw new XmlError("MALFORMED", "unterminated CDATA");
      if (!stack.length) throw new XmlError("MALFORMED", "CDATA outside the root element");
      stack[stack.length - 1].text += src.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith("<!", i)) throw new XmlError("DTD_NOT_ALLOWED");

    const gt = findTagEnd(src, i + 1);
    if (gt < 0) throw new XmlError("MALFORMED", "unterminated tag");
    const raw = src.slice(i + 1, gt);
    i = gt + 1;

    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      const top = stack.pop();
      if (!top || top.name !== localName(name)) throw new XmlError("MALFORMED", `unexpected </${name}>`);
      continue;
    }

    const selfClosing = raw.endsWith("/");
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m || !NAME_RE.test(m[1])) throw new XmlError("MALFORMED", "bad element name");
    const node: XmlNode = { name: localName(m[1]), attrs: parseAttrs(body.slice(m[1].length)), children: [], text: "" };
    nodes += 1;
    if (nodes > maxNodes) throw new XmlError("TOO_MANY_NODES");

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else if (root) throw new XmlError("MALFORMED", "more than one root element");
    else root = node;

    if (!selfClosing) {
      stack.push(node);
      if (stack.length > maxDepth) throw new XmlError("TOO_DEEP");
    }
  }
  if (stack.length) throw new XmlError("MALFORMED", `unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw new XmlError("EMPTY");
  return root;
}

/** Index of the `>` closing a tag, skipping `>` inside quoted attribute values. */
function findTagEnd(s: string, from: number): number {
  let q: string | null = null;
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === ">") return j;
    else if (c === "<") return -1;
  }
  return -1;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\s*([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== consumed) break;
    consumed = re.lastIndex;
    if (!NAME_RE.test(m[1])) throw new XmlError("MALFORMED", "bad attribute name");
    out[localName(m[1])] = decodeEntities(m[3] ?? m[4] ?? "");
  }
  if (s.slice(consumed).trim()) throw new XmlError("MALFORMED", "bad attributes");
  return out;
}

// ---------------------------------------------------------------------------
// Navigation helpers (local names)
// ---------------------------------------------------------------------------
export function child(node: XmlNode | null | undefined, name: string): XmlNode | null {
  if (!node) return null;
  for (const c of node.children) if (c.name === name) return c;
  return null;
}

export function childrenNamed(node: XmlNode | null | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Follow a path of child names: path(n, "Refs", "AcctSvcrRef"). */
export function path(node: XmlNode | null | undefined, ...names: string[]): XmlNode | null {
  let cur: XmlNode | null = node ?? null;
  for (const nm of names) {
    cur = child(cur, nm);
    if (!cur) return null;
  }
  return cur;
}

export function textAt(node: XmlNode | null | undefined, ...names: string[]): string | null {
  const n = path(node, ...names);
  if (!n) return null;
  const t = n.text.trim();
  return t ? t : null;
}
