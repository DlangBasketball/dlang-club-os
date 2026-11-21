import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { RESERVED_SEGMENTS, isReservedPath, splitLangPath } from "@/lib/site/paths";

/**
 * Routing guard: the club site is served by the root catch-all
 * src/app/[...sitePath]. It must NEVER shadow an app route. These tests walk
 * src/app and prove that every top-level URL segment the app serves is a
 * reserved segment (so the catch-all 404s for it and middleware keeps its
 * auth gate), and that the SQL guard lists the same segments.
 */

const APP = path.resolve(__dirname, "../../src/app");
const ROOT = path.resolve(__dirname, "../..");

/** Top-level URL segments served by the app router (route groups flattened). */
function topLevelSegments(dir: string): string[] {
  const out = new Set<string>();
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const isDir = statSync(p).isDirectory();
    if (isDir && /^\(.+\)$/.test(name)) {
      for (const s of topLevelSegments(p)) out.add(s);
      continue;
    }
    if (isDir && (name.startsWith("_") || name.startsWith("["))) continue; // private folders / the site catch-all
    if (isDir) {
      out.add(name);
      continue;
    }
    // Files: only metadata conventions become URLs (icon.png, robots.ts,
    // sitemap.ts, manifest.ts, favicon.ico, opengraph-image.*); page.tsx /
    // layout.tsx are "/" and other modules (components) are not routes.
    const meta = /^(favicon\.ico|icon|apple-icon|opengraph-image|twitter-image|robots|sitemap|manifest)(\.\w+)?$/.exec(name);
    if (meta) {
      const base = meta[1]!;
      out.add(base === "robots" ? "robots.txt" : base === "sitemap" ? "sitemap.xml" : base === "manifest" ? "manifest.webmanifest" : base);
    }
  }
  return Array.from(out);
}

describe("site routing never shadows app routes", () => {
  const segments = topLevelSegments(APP);

  it("finds the app's top-level routes", () => {
    for (const s of ["admin", "coach", "parent", "login", "register", "book", "shop", "club", "embed", "api"]) expect(segments).toContain(s);
  });

  it.each(segments)("/%s is a reserved path", (seg) => {
    expect(isReservedPath(`/${seg}`), `/${seg} must be in RESERVED_SEGMENTS (src/lib/site/paths.ts and site_path_reserved())`).toBe(true);
  });

  it("deeper app paths stay reserved", () => {
    for (const p of ["/admin/site", "/admin/site/pages/x", "/register/camps", "/book/club/x", "/club/news/1", "/embed/camps", "/api/stripe/webhook", "/_next/static/chunks/x.js", "/auth/callback"]) {
      expect(isReservedPath(p), p).toBe(true);
    }
  });

  it("a language prefix never unlocks a reserved path", () => {
    const s = splitLangPath("/fr/admin", ["en", "fr"], "en");
    expect(s?.path).toBe("/admin");
    expect(isReservedPath(s!.path)).toBe(true);
  });

  it("the SQL guard lists the same reserved segments", () => {
    const sql = readFileSync(path.join(ROOT, "supabase/migrations/20250420101900_site_builder.sql"), "utf8");
    const m = /function public\.site_path_reserved[\s\S]*?in \(([\s\S]*?)\);/.exec(sql);
    expect(m).not.toBeNull();
    const listed = Array.from(m![1]!.matchAll(/'([^']+)'/g)).map((x) => x[1]);
    expect(new Set(listed)).toEqual(new Set(RESERVED_SEGMENTS));
  });

  it("the site catch-all and its guard exist", () => {
    expect(existsSync(path.join(APP, "[...sitePath]", "page.tsx"))).toBe(true);
    const src = readFileSync(path.join(APP, "[...sitePath]", "page.tsx"), "utf8");
    expect(src).toContain("isReservedPath");
    expect(src).toContain("notFound");
  });

  it("middleware only opens non-reserved paths to signed-out visitors", () => {
    const mw = readFileSync(path.join(ROOT, "src/middleware.ts"), "utf8");
    expect(mw).toContain("isReservedPath");
  });
});
