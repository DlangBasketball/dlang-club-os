/**
 * Minimal XLIFF 1.2 writer/reader for flat message catalogs (zero deps).
 * Supports what CAT tools exchange for UI strings: one <file>, trans-units
 * with id, <source>, <target state="…">, <note>.
 */

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unescapeXml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/**
 * units: [{ id, source, target, state, note }]
 * state: new | translated | needs-review-translation | final
 */
export function toXliff({ sourceLanguage, targetLanguage, original = "messages", units }) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">',
    `  <file source-language="${escapeXml(sourceLanguage)}" target-language="${escapeXml(targetLanguage)}" datatype="plaintext" original="${escapeXml(original)}">`,
    "    <body>",
  ];
  for (const u of units) {
    out.push(`      <trans-unit id="${escapeXml(u.id)}" resname="${escapeXml(u.id)}" xml:space="preserve">`);
    out.push(`        <source>${escapeXml(u.source)}</source>`);
    out.push(`        <target state="${escapeXml(u.state ?? (u.target ? "translated" : "new"))}">${escapeXml(u.target ?? "")}</target>`);
    if (u.note) out.push(`        <note>${escapeXml(u.note)}</note>`);
    out.push("      </trans-unit>");
  }
  out.push("    </body>", "  </file>", "</xliff>", "");
  return out.join("\n");
}

const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
};

export function parseXliff(xml) {
  const file = /<file\b[^>]*>/.exec(xml);
  if (!/<xliff\b[^>]*version="1\.2"/.test(xml) || !file) throw new Error("not an XLIFF 1.2 document");
  const units = [];
  const re = /<trans-unit\b([^>]*)>([\s\S]*?)<\/trans-unit>/g;
  let m;
  while ((m = re.exec(xml))) {
    const id = attr(m[1], "id");
    const body = m[2];
    const source = /<source\b[^>]*>([\s\S]*?)<\/source>/.exec(body);
    const targetTag = /<target\b([^>]*)>([\s\S]*?)<\/target>|<target\b([^>]*)\/>/.exec(body);
    units.push({
      id,
      source: source ? unescapeXml(source[1]) : "",
      target: targetTag ? unescapeXml(targetTag[2] ?? "") : "",
      state: targetTag ? attr(targetTag[1] ?? targetTag[3] ?? "", "state") : null,
    });
  }
  return { sourceLanguage: attr(file[0], "source-language"), targetLanguage: attr(file[0], "target-language"), units };
}
