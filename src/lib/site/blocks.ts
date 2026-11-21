import { z } from "zod";
import { isLanguageTag } from "./languages";
import { safeSiteHref, sanitizeRichText } from "./sanitize";

/**
 * Block model of a site page (pure; browser + server).
 *
 *   PageContent = { [languageTag]: PageLang }      e.g. { en: {...}, fr: {...}, "de-CH": {...} }
 *   PageLang    = { title, metaTitle?, metaDescription?, ogImage?, blocks[], state? }
 *
 * Every block has a stable id and a type. Images are club media-library
 * paths (<org>/<covers|banners|gallery>/<file>); the renderer shows them on
 * the public site only when the admin cleared the image for public use.
 * Rich text is sanitised on parse (sanitizeRichText), links are restricted to
 * https / mailto / tel / site paths.
 */

export const BLOCK_TYPES = [
  "hero", "richText", "image", "gallery", "video", "twoColumn", "stats", "cards", "testimonials",
  "logos", "faq", "cta", "form", "map", "spacer", "live",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const LIVE_SOURCES = [
  "camps", "programs", "schedule", "results", "teams", "team", "coaches", "training", "shop", "campaigns", "news", "calendar",
] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

export const FORM_KINDS = ["contact", "join", "coach_application", "athlete_application"] as const;
export type FormKind = (typeof FORM_KINDS)[number];

/** Per-language translation state shown in the editor. */
export const LANG_STATES = ["ok", "needs_translation", "machine_draft"] as const;
export type LangState = (typeof LANG_STATES)[number];

export const MAX_BLOCKS = 80;

const LIB_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(covers|banners|gallery)\/[A-Za-z0-9._-]{1,120}$/i;

export function isLibraryImagePath(v: unknown): v is string {
  return typeof v === "string" && LIB_PATH_RE.test(v) && !v.includes("..");
}

const text = (max: number) => z.string().max(max).transform((s) => s.trim());
const optText = (max: number) => z.string().max(max).optional().transform((s) => (s ? s.trim() : undefined));
const focal = z.coerce.number().min(0).max(100).transform((n) => Math.round(n)).default(50);

export const mediaRefSchema = z.object({
  path: z.string().refine(isLibraryImagePath, "invalid image"),
  alt: optText(300),
  focalX: focal,
  focalY: focal,
});
export type MediaRef = z.infer<typeof mediaRefSchema>;

const hrefSchema = z
  .string()
  .max(1000)
  .transform((v, ctx) => {
    const ok = safeSiteHref(v);
    if (!ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid link" });
      return z.NEVER;
    }
    return ok.href;
  });

export const ctaSchema = z.object({
  label: text(80).pipe(z.string().min(1)),
  href: hrefSchema,
  style: z.enum(["primary", "secondary"]).default("primary"),
});
export type Cta = z.infer<typeof ctaSchema>;

const richHtml = (max = 50_000) => z.string().max(max * 2).transform((v) => sanitizeRichText(v, max));

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const base = { id };

export const heroBlock = z.object({
  ...base,
  type: z.literal("hero"),
  eyebrow: optText(80),
  headline: text(200),
  subheadline: optText(400),
  image: mediaRefSchema.nullable().optional(),
  videoUrl: z.string().max(500).optional().refine((v) => !v || isSafeVideoUrl(v), "invalid video").transform((v) => v || undefined),
  overlay: z.coerce.number().min(0).max(90).default(45),
  height: z.enum(["full", "large", "medium"]).default("large"),
  align: z.enum(["start", "center"]).default("start"),
  ctas: z.array(ctaSchema).max(3).default([]),
});

export const richTextBlock = z.object({ ...base, type: z.literal("richText"), html: richHtml(), width: z.enum(["narrow", "wide"]).default("narrow") });

export const imageBlock = z.object({
  ...base,
  type: z.literal("image"),
  image: mediaRefSchema.nullable(),
  caption: optText(300),
  width: z.enum(["content", "wide", "full"]).default("wide"),
});

export const galleryBlock = z.object({
  ...base,
  type: z.literal("gallery"),
  heading: optText(160),
  images: z.array(mediaRefSchema).max(80).default([]),
  columns: z.coerce.number().int().min(2).max(5).default(3),
});

export const videoBlock = z.object({
  ...base,
  type: z.literal("video"),
  url: z.string().max(500).refine((v) => isSafeVideoUrl(v), "invalid video"),
  title: optText(160),
  caption: optText(300),
  poster: mediaRefSchema.nullable().optional(),
});

export const twoColumnBlock = z.object({
  ...base,
  type: z.literal("twoColumn"),
  eyebrow: optText(80),
  heading: optText(200),
  html: richHtml(20_000),
  image: mediaRefSchema.nullable().optional(),
  imageSide: z.enum(["start", "end"]).default("end"),
  ctas: z.array(ctaSchema).max(2).default([]),
});

export const statsBlock = z.object({
  ...base,
  type: z.literal("stats"),
  heading: optText(160),
  items: z.array(z.object({ value: text(24), label: text(80) })).max(8).default([]),
});

export const cardsBlock = z.object({
  ...base,
  type: z.literal("cards"),
  eyebrow: optText(80),
  heading: optText(160),
  intro: optText(600),
  columns: z.coerce.number().int().min(2).max(4).default(3),
  items: z
    .array(z.object({ title: text(120), text: optText(600), eyebrow: optText(60), image: mediaRefSchema.nullable().optional(), href: hrefSchema.optional().or(z.literal("").transform(() => undefined)) }))
    .max(24)
    .default([]),
});

export const testimonialsBlock = z.object({
  ...base,
  type: z.literal("testimonials"),
  heading: optText(160),
  items: z.array(z.object({ quote: text(800), name: text(80), role: optText(80) })).max(12).default([]),
});

export const logosBlock = z.object({
  ...base,
  type: z.literal("logos"),
  heading: optText(160),
  /** sponsors: active sponsors with a "website" deliverable (operations module) + manual items. */
  source: z.enum(["manual", "sponsors"]).default("manual"),
  items: z.array(z.object({ name: text(120), image: mediaRefSchema.nullable().optional(), href: hrefSchema.optional().or(z.literal("").transform(() => undefined)) })).max(40).default([]),
});

export const faqBlock = z.object({
  ...base,
  type: z.literal("faq"),
  heading: optText(160),
  items: z.array(z.object({ q: text(300), a: richHtml(5_000) })).max(40).default([]),
});

export const ctaBlock = z.object({
  ...base,
  type: z.literal("cta"),
  heading: text(200),
  text: optText(600),
  tone: z.enum(["brand", "dark", "light"]).default("brand"),
  image: mediaRefSchema.nullable().optional(),
  ctas: z.array(ctaSchema).max(2).default([]),
});

export const formBlock = z.object({
  ...base,
  type: z.literal("form"),
  kind: z.enum(FORM_KINDS).default("contact"),
  heading: optText(160),
  intro: optText(600),
});

export const mapBlock = z.object({
  ...base,
  type: z.literal("map"),
  heading: optText(160),
  venueName: optText(160),
  address: optText(300),
  hours: optText(300),
  phone: optText(40),
  email: z.string().max(254).optional().refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "invalid email").transform((v) => v || undefined),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

export const spacerBlock = z.object({
  ...base,
  type: z.literal("spacer"),
  size: z.enum(["sm", "md", "lg"]).default("md"),
  divider: z.boolean().default(false),
});

export const liveBlock = z.object({
  ...base,
  type: z.literal("live"),
  source: z.enum(LIVE_SOURCES),
  eyebrow: optText(80),
  heading: optText(160),
  intro: optText(600),
  limit: z.coerce.number().int().min(1).max(48).default(6),
  /** camps: season key (spring/summer/autumn/winter/...); programs: kind; team: team slug. */
  filter: optText(80),
});

export const blockSchema = z.discriminatedUnion("type", [
  heroBlock, richTextBlock, imageBlock, galleryBlock, videoBlock, twoColumnBlock, statsBlock, cardsBlock,
  testimonialsBlock, logosBlock, faqBlock, ctaBlock, formBlock, mapBlock, spacerBlock, liveBlock,
]);
export type Block = z.infer<typeof blockSchema>;
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

export const pageLangSchema = z.object({
  title: text(200),
  metaTitle: optText(120),
  metaDescription: optText(320),
  ogImage: mediaRefSchema.nullable().optional(),
  state: z.enum(LANG_STATES).default("ok"),
  blocks: z.array(blockSchema).max(MAX_BLOCKS).default([]),
});
export type PageLang = z.infer<typeof pageLangSchema>;

export const pageContentSchema = z
  .record(z.string(), pageLangSchema)
  .superRefine((rec, ctx) => {
    const keys = Object.keys(rec);
    if (keys.length > 20) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "too many languages" });
    for (const k of keys) if (!isLanguageTag(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid language ${k}`, path: [k] });
  });
export type PageContent = z.infer<typeof pageContentSchema>;

/** Post translations: title, excerpt, body (rich text), SEO. */
export const postLangSchema = z.object({
  title: text(200),
  excerpt: optText(600),
  bodyHtml: richHtml(60_000).default(""),
  metaTitle: optText(120),
  metaDescription: optText(320),
  state: z.enum(LANG_STATES).default("ok"),
});
export type PostLang = z.infer<typeof postLangSchema>;
export const postContentSchema = z.record(z.string(), postLangSchema).superRefine((rec, ctx) => {
  for (const k of Object.keys(rec)) if (!isLanguageTag(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `invalid language ${k}`, path: [k] });
});
export type PostContent = z.infer<typeof postContentSchema>;

/** Parse stored JSON leniently: invalid blocks are dropped instead of breaking the page. */
export function parsePageContent(raw: unknown): PageContent {
  const out: PageContent = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [lang, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLanguageTag(lang) || !v || typeof v !== "object") continue;
    const obj = v as Record<string, unknown>;
    const blocks = Array.isArray(obj.blocks)
      ? (obj.blocks as unknown[]).map((b) => blockSchema.safeParse(b)).filter((r) => r.success).map((r) => r.data!)
      : [];
    const head = pageLangSchema.omit({ blocks: true }).safeParse(obj);
    out[lang] = { ...(head.success ? head.data : { title: "", state: "ok" as const }), blocks };
  }
  return out;
}

export function parsePostContent(raw: unknown): PostContent {
  const out: PostContent = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [lang, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isLanguageTag(lang)) continue;
    const r = postLangSchema.safeParse(v);
    if (r.success) out[lang] = r.data;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Video URLs
// ---------------------------------------------------------------------------

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = /^\/(embed|shorts|live)\/([\w-]{11})/.exec(u.pathname);
      return m ? m[2]! : null;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

export function vimeoId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host !== "vimeo.com" && host !== "player.vimeo.com") return null;
    const m = /\/(?:video\/)?(\d{5,12})(?:$|\/|\?)/.exec(u.pathname + "/");
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

export function isVideoFileUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && /\.(mp4|webm)$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function isSafeVideoUrl(url: string): boolean {
  return Boolean(youtubeId(url) || vimeoId(url) || isVideoFileUrl(url));
}

export type VideoEmbed =
  | { kind: "youtube"; id: string; embedUrl: string; thumbUrl: string }
  | { kind: "vimeo"; id: string; embedUrl: string; thumbUrl: null }
  | { kind: "file"; url: string };

/** Privacy-friendly embed (YouTube no-cookie, Vimeo do-not-track), or the file URL. */
export function videoEmbed(url: string): VideoEmbed | null {
  const y = youtubeId(url);
  if (y) return { kind: "youtube", id: y, embedUrl: `https://www.youtube-nocookie.com/embed/${y}?autoplay=1&rel=0`, thumbUrl: `https://i.ytimg.com/vi/${y}/hqdefault.jpg` };
  const v = vimeoId(url);
  if (v) return { kind: "vimeo", id: v, embedUrl: `https://player.vimeo.com/video/${v}?autoplay=1&dnt=1`, thumbUrl: null };
  if (isVideoFileUrl(url)) return { kind: "file", url };
  return null;
}

// ---------------------------------------------------------------------------
// Editor helpers
// ---------------------------------------------------------------------------

export function newBlockId(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `b${r.replace(/-/g, "").slice(0, 12)}`;
}

/** A new, valid-shaped block of a type (empty texts are filled in the editor). */
export function newBlock(type: BlockType): Block {
  const id = newBlockId();
  switch (type) {
    case "hero": return { id, type, headline: "", overlay: 45, height: "large", align: "start", ctas: [], image: null };
    case "richText": return { id, type, html: "", width: "narrow" };
    case "image": return { id, type, image: null, width: "wide" };
    case "gallery": return { id, type, images: [], columns: 3 };
    case "video": return { id, type, url: "" };
    case "twoColumn": return { id, type, html: "", imageSide: "end", ctas: [], image: null };
    case "stats": return { id, type, items: [] };
    case "cards": return { id, type, columns: 3, items: [] };
    case "testimonials": return { id, type, items: [] };
    case "logos": return { id, type, source: "manual", items: [] };
    case "faq": return { id, type, items: [] };
    case "cta": return { id, type, heading: "", tone: "brand", ctas: [] };
    case "form": return { id, type, kind: "contact" };
    case "map": return { id, type };
    case "spacer": return { id, type, size: "md", divider: false };
    case "live": return { id, type, source: "camps", limit: 6 };
  }
}

/** Deep copy with fresh block ids (duplicate block / page, copy a language). */
export function cloneBlocks(blocks: readonly Block[]): Block[] {
  return blocks.map((b) => ({ ...(JSON.parse(JSON.stringify(b)) as Block), id: newBlockId() }));
}

/** Move an item within a list (drag and drop / keyboard). Out-of-range moves are no-ops. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it!);
  return out;
}

/** Every library image path a page uses (public-use check, media usage). */
export function imagePathsOf(content: PageContent): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.path === "string" && isLibraryImagePath(o.path)) out.add(o.path);
    Object.values(o).forEach(walk);
  };
  walk(content);
  return Array.from(out);
}

/** True if every image path belongs to this org's library. */
export function imagesBelongTo(content: unknown, orgId: string): boolean {
  const paths = imagePathsOf(content as PageContent);
  return paths.every((p) => p.startsWith(`${orgId}/`));
}

// ---------------------------------------------------------------------------
// Generic editor field descriptors (labels: site.fields.<key>)
// ---------------------------------------------------------------------------

export type FieldKind = "text" | "textarea" | "richtext" | "media" | "mediaList" | "select" | "number" | "boolean" | "ctas" | "items" | "href";
export type Field = {
  key: string;
  kind: FieldKind;
  options?: readonly string[];
  min?: number;
  max?: number;
  item?: readonly Field[];
};

export const BLOCK_FIELDS: Record<BlockType, readonly Field[]> = {
  hero: [
    { key: "eyebrow", kind: "text" }, { key: "headline", kind: "text" }, { key: "subheadline", kind: "textarea" },
    { key: "image", kind: "media" }, { key: "videoUrl", kind: "text" }, { key: "overlay", kind: "number", min: 0, max: 90 },
    { key: "height", kind: "select", options: ["full", "large", "medium"] }, { key: "align", kind: "select", options: ["start", "center"] },
    { key: "ctas", kind: "ctas" },
  ],
  richText: [{ key: "html", kind: "richtext" }, { key: "width", kind: "select", options: ["narrow", "wide"] }],
  image: [{ key: "image", kind: "media" }, { key: "caption", kind: "text" }, { key: "width", kind: "select", options: ["content", "wide", "full"] }],
  gallery: [{ key: "heading", kind: "text" }, { key: "images", kind: "mediaList" }, { key: "columns", kind: "number", min: 2, max: 5 }],
  video: [{ key: "url", kind: "text" }, { key: "title", kind: "text" }, { key: "caption", kind: "text" }, { key: "poster", kind: "media" }],
  twoColumn: [
    { key: "eyebrow", kind: "text" }, { key: "heading", kind: "text" }, { key: "html", kind: "richtext" },
    { key: "image", kind: "media" }, { key: "imageSide", kind: "select", options: ["start", "end"] }, { key: "ctas", kind: "ctas" },
  ],
  stats: [{ key: "heading", kind: "text" }, { key: "items", kind: "items", item: [{ key: "value", kind: "text" }, { key: "label", kind: "text" }] }],
  cards: [
    { key: "eyebrow", kind: "text" }, { key: "heading", kind: "text" }, { key: "intro", kind: "textarea" }, { key: "columns", kind: "number", min: 2, max: 4 },
    { key: "items", kind: "items", item: [{ key: "eyebrow", kind: "text" }, { key: "title", kind: "text" }, { key: "text", kind: "textarea" }, { key: "image", kind: "media" }, { key: "href", kind: "href" }] },
  ],
  testimonials: [{ key: "heading", kind: "text" }, { key: "items", kind: "items", item: [{ key: "quote", kind: "textarea" }, { key: "name", kind: "text" }, { key: "role", kind: "text" }] }],
  logos: [
    { key: "heading", kind: "text" }, { key: "source", kind: "select", options: ["manual", "sponsors"] },
    { key: "items", kind: "items", item: [{ key: "name", kind: "text" }, { key: "image", kind: "media" }, { key: "href", kind: "href" }] },
  ],
  faq: [{ key: "heading", kind: "text" }, { key: "items", kind: "items", item: [{ key: "q", kind: "text" }, { key: "a", kind: "richtext" }] }],
  cta: [
    { key: "heading", kind: "text" }, { key: "text", kind: "textarea" }, { key: "tone", kind: "select", options: ["brand", "dark", "light"] },
    { key: "image", kind: "media" }, { key: "ctas", kind: "ctas" },
  ],
  form: [{ key: "kind", kind: "select", options: FORM_KINDS }, { key: "heading", kind: "text" }, { key: "intro", kind: "textarea" }],
  map: [
    { key: "heading", kind: "text" }, { key: "venueName", kind: "text" }, { key: "address", kind: "textarea" }, { key: "hours", kind: "text" },
    { key: "phone", kind: "text" }, { key: "email", kind: "text" }, { key: "lat", kind: "number", min: -90, max: 90 }, { key: "lng", kind: "number", min: -180, max: 180 },
  ],
  spacer: [{ key: "size", kind: "select", options: ["sm", "md", "lg"] }, { key: "divider", kind: "boolean" }],
  live: [
    { key: "source", kind: "select", options: LIVE_SOURCES }, { key: "eyebrow", kind: "text" }, { key: "heading", kind: "text" },
    { key: "intro", kind: "textarea" }, { key: "limit", kind: "number", min: 1, max: 48 }, { key: "filter", kind: "text" },
  ],
};

/** Plain texts of a page language (translation drafts). Keys are JSON paths into the blocks. */
export function translatableTexts(lang: PageLang): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const TEXT_KEYS = new Set(["title", "metaTitle", "metaDescription", "eyebrow", "headline", "subheadline", "heading", "intro", "text", "caption", "quote", "role", "label", "q", "a", "html", "value", "hours"]);
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}.${i}`));
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === "string" && TEXT_KEYS.has(k) && x.trim()) out.push({ key: `${path}.${k}`.replace(/^\./, ""), text: x });
      else if (x && typeof x === "object") walk(x, `${path}.${k}`);
    }
  };
  walk(lang, "");
  return out;
}

/** Write translated texts back (same keys as translatableTexts). Unknown keys are ignored. */
export function applyTexts<T>(value: T, texts: Record<string, string>): T {
  const copy = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  for (const [key, t] of Object.entries(texts)) {
    const parts = key.split(".");
    let cur: unknown = copy;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur || typeof cur !== "object") break;
      cur = (cur as Record<string, unknown>)[parts[i]!];
    }
    const last = parts[parts.length - 1]!;
    if (cur && typeof cur === "object" && typeof (cur as Record<string, unknown>)[last] === "string") (cur as Record<string, unknown>)[last] = t;
  }
  return copy as T;
}
