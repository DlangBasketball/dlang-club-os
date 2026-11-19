/**
 * Embed code generator (admin "Website" page) and the embed widget list.
 * Pure. Three equivalent forms for the club's website:
 *   - WordPress shortcode (DLang OS Connect plugin): [dlang_os widget="camps" season="summer"]
 *   - script helper:  <div data-dlang-widget="camps" data-club="dlang" ...></div><script src="<app>/embed.js" async></script>
 *   - plain iframe:   <iframe src="<app>/embed/camps?club=dlang&..."></iframe>
 */

export const EMBED_WIDGETS = ["camps", "programs", "schedule", "results", "teams", "book", "shop", "donate", "register", "login"] as const;
export type EmbedWidget = (typeof EMBED_WIDGETS)[number];

/** Optional parameters each widget understands (all strings, validated by the embed page). */
export const WIDGET_PARAMS: Record<EmbedWidget, readonly string[]> = {
  camps: ["season", "year"],
  programs: ["kind"],
  schedule: ["team", "type"],
  results: ["team"],
  teams: [],
  book: [],
  shop: ["category"],
  donate: ["campaign"],
  register: ["program"],
  login: [],
};

export function isEmbedWidget(v: unknown): v is EmbedWidget {
  return typeof v === "string" && (EMBED_WIDGETS as readonly string[]).includes(v);
}

export type EmbedSpec = {
  widget: EmbedWidget;
  club: string;
  lang?: string | null;
  theme?: "club" | "light" | "dark";
  params?: Record<string, string | null | undefined>;
};

const PARAM_VALUE_RE = /^[A-Za-z0-9_.-]{1,80}$/;

function cleanParams(spec: EmbedSpec): [string, string][] {
  const allowed = WIDGET_PARAMS[spec.widget];
  return Object.entries(spec.params ?? {})
    .filter(([k, v]) => allowed.includes(k) && typeof v === "string" && PARAM_VALUE_RE.test(v))
    .map(([k, v]) => [k, v as string]);
}

/** Path + query of the embed page (register needs a programme slug in the path). */
export function embedPath(spec: EmbedSpec, origin?: string | null): string {
  const params = cleanParams(spec);
  const program = params.find(([k]) => k === "program")?.[1];
  const path = spec.widget === "register" && program ? `/embed/register/${encodeURIComponent(program)}` : `/embed/${spec.widget}`;
  const q = new URLSearchParams({ club: spec.club });
  if (spec.lang) q.set("lang", spec.lang);
  if (spec.theme && spec.theme !== "club") q.set("theme", spec.theme);
  for (const [k, v] of params) if (k !== "program") q.set(k, v);
  if (origin) q.set("origin", origin);
  return `${path}?${q.toString()}`;
}

const attr = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function shortcodeFor(spec: EmbedSpec): string {
  const parts = [`widget="${attr(spec.widget)}"`];
  for (const [k, v] of cleanParams(spec)) parts.push(`${k}="${attr(v)}"`);
  if (spec.theme && spec.theme !== "club") parts.push(`theme="${spec.theme}"`);
  if (spec.lang) parts.push(`lang="${attr(spec.lang)}"`);
  return `[dlang_os ${parts.join(" ")}]`;
}

export function scriptSnippetFor(spec: EmbedSpec, appUrl: string): string {
  const base = appUrl.replace(/\/+$/, "");
  const data = [`data-dlang-widget="${attr(spec.widget)}"`, `data-club="${attr(spec.club)}"`];
  for (const [k, v] of cleanParams(spec)) data.push(`data-${k}="${attr(v)}"`);
  if (spec.theme && spec.theme !== "club") data.push(`data-theme="${spec.theme}"`);
  if (spec.lang) data.push(`data-lang="${attr(spec.lang)}"`);
  return `<div ${data.join(" ")}></div>\n<script src="${attr(base)}/embed.js" async></script>`;
}

export function iframeSnippetFor(spec: EmbedSpec, appUrl: string, origin?: string | null): string {
  const base = appUrl.replace(/\/+$/, "");
  return `<iframe src="${attr(base + embedPath(spec, origin))}" style="width:100%;border:0;min-height:480px" loading="lazy" title="${attr(spec.widget)}"></iframe>`;
}
