import type { Translator } from "@/lib/i18n/translator";
import type { Formatter } from "@/lib/format";
import type { ResolvedSite } from "@/lib/site/server";

/** A resolved library image (only cleared images reach the public site). */
export type SiteImg = { url: string; alt: string | null; width: number | null; height: number | null; cleared: boolean };

/** Everything a block needs to render. */
export type RenderCtx = {
  site: ResolvedSite;
  lang: string;
  defaultLang: string;
  path: string;
  t: Translator;
  f: Formatter;
  images: Map<string, SiteImg>;
  /** Admin preview: drafts, uncleared images shown with a warning. */
  preview: boolean;
};
