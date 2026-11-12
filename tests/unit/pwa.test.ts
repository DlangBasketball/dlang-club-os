import { describe, expect, it, vi } from "vitest";
import {
  buildWebManifest,
  iconMonogram,
  iconVersion,
  isFetchableLogoUrl,
  isPwaIconVariant,
  manifestLang,
  monogramColors,
  shortNameFor,
  type ManifestTenant,
} from "@/lib/pwa/manifest";
import {
  DISMISS_TTL_MS,
  detectPlatform,
  dismissKey,
  installUiMode,
  isBeforeInstallPromptEvent,
  isInAppBrowser,
  isStandalone,
  readDismissed,
  writeDismissed,
} from "@/lib/pwa/install";
import { buildServiceWorkerScript, swRequestPolicy, swVersion, type SwRequestInfo } from "@/lib/pwa/service-worker";
import { escapeHtml, renderOfflinePage } from "@/lib/pwa/offline-page";
import { showsHubAtRoot } from "@/lib/pwa/hub";
import { isOpenCamp } from "@/lib/data/club-hub";
import { DEFAULT_BRANDING } from "@/lib/tenant/defaults";
import { CATALOGS } from "@/lib/i18n/messages";

// Synthetic tenants only.
function tenant(over: Partial<ManifestTenant> & { colors?: Partial<ManifestTenant["branding"]["colors"]>; logoUrl?: string | null } = {}): ManifestTenant {
  const { colors, logoUrl, ...rest } = over;
  return {
    name: "Riverside Hoops",
    appName: "Riverside OS",
    defaultLocale: "fr-CH",
    branding: {
      ...DEFAULT_BRANDING,
      logoUrl: logoUrl === undefined ? null : logoUrl,
      colors: { ...DEFAULT_BRANDING.colors, primary: "#1144AA", primaryDark: "#0A2255", background: "#F7F7F5", ...colors },
    },
    ...rest,
  };
}

describe("buildWebManifest", () => {
  it("uses the tenant app name, colours and locale", () => {
    const m = buildWebManifest(tenant(), { description: "Camps at Riverside Hoops." });
    expect(m.name).toBe("Riverside OS");
    expect(m.short_name).toBe("Riverside OS");
    expect(m.description).toBe("Camps at Riverside Hoops.");
    expect(m.lang).toBe("fr-CH");
    expect(m.background_color).toBe("#F7F7F5");
    expect(m.theme_color).toBe("#F7F7F5");
    expect(m).toMatchObject({ start_url: "/", scope: "/", display: "standalone", id: "/" });
  });

  it("declares 192, 512 and a maskable 512 PNG icon, versioned by branding", () => {
    const t = tenant();
    const m = buildWebManifest(t, { description: "x" });
    const v = iconVersion(t);
    expect(m.icons).toEqual([
      { src: `/pwa/icon/192?v=${v}`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/pwa/icon/512?v=${v}`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/pwa/icon/maskable-512?v=${v}`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("differs per tenant and changes when the branding changes", () => {
    const a = tenant();
    const b = tenant({ appName: "Lakeside App", colors: { primary: "#22AA44" } });
    expect(iconVersion(a)).not.toBe(iconVersion(b));
    expect(iconVersion(a)).toBe(iconVersion(tenant()));
    expect(iconVersion(tenant({ logoUrl: "https://cdn.example.com/logo.png" }))).not.toBe(iconVersion(a));
  });

  it("falls back to the club name, default colours and English", () => {
    const t = tenant({ appName: "  ", defaultLocale: "", colors: { background: "not-a-colour" } });
    const m = buildWebManifest(t, { description: "x" });
    expect(m.name).toBe("Riverside Hoops");
    expect(m.background_color).toBe(DEFAULT_BRANDING.colors.background);
    expect(m.lang).toBe("en");
  });

  it("shortens long names for the home screen", () => {
    expect(shortNameFor("DLang OS")).toBe("DLang OS");
    expect(shortNameFor("Riverside Basketball Academy")).toBe("Riverside");
    expect(shortNameFor("Supercalifragilistic Club")).toBe("Supercalifra");
  });

  it("normalises manifest languages", () => {
    expect(manifestLang("de_CH")).toBe("de-CH");
    expect(manifestLang("it")).toBe("it");
    expect(manifestLang("<script>")).toBe("en");
    expect(manifestLang(null)).toBe("en");
  });

  it("builds monogram colours and letters with fallbacks", () => {
    expect(monogramColors(tenant())).toEqual({ from: "#1144AA", to: "#0A2255" });
    expect(monogramColors(tenant({ colors: { primary: "bad" } })).from).toBe(DEFAULT_BRANDING.colors.primary);
    expect(iconMonogram("dlang OS")).toBe("D");
    expect(iconMonogram("  ")).toBe("C");
    expect(iconMonogram("Équipe Genève")).toBe("É");
  });

  it("knows its icon variants", () => {
    expect(isPwaIconVariant("192")).toBe(true);
    expect(isPwaIconVariant("apple-touch")).toBe(true);
    expect(isPwaIconVariant("1024")).toBe(false);
    expect(isPwaIconVariant("__proto__")).toBe(false);
  });

  it("only fetches logos from public https hosts (SSRF guard)", () => {
    expect(isFetchableLogoUrl("https://cdn.example.com/logo.png")).toBe(true);
    expect(isFetchableLogoUrl(null)).toBe(false);
    expect(isFetchableLogoUrl("/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("http://cdn.example.com/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("https://127.0.0.1/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("https://[::1]/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("https://localhost/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("https://db.internal/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("https://user:pw@cdn.example.com/logo.png")).toBe(false);
    expect(isFetchableLogoUrl("https://cdn.example.com:8443/logo.png")).toBe(false);
  });

  it("has a translated manifest description in every catalog", () => {
    for (const c of Object.values(CATALOGS)) expect(c.pwa.manifest.description).toContain("{club}");
  });
});

describe("install prompt helper", () => {
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
  const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

  it("detects platforms", () => {
    expect(detectPlatform(IPHONE)).toBe("ios");
    expect(detectPlatform(IPAD_DESKTOP, 5)).toBe("ios");
    expect(detectPlatform(IPAD_DESKTOP, 0)).toBe("desktop");
    expect(detectPlatform(ANDROID)).toBe("android");
    expect(detectPlatform(WINDOWS)).toBe("desktop");
    expect(detectPlatform("")).toBe("other");
    expect(detectPlatform(null)).toBe("other");
  });

  it("detects in-app browsers and standalone mode", () => {
    expect(isInAppBrowser(`${IPHONE} Instagram 300.0`)).toBe(true);
    expect(isInAppBrowser(IPHONE)).toBe(false);
    expect(isStandalone({ displayModeStandalone: true })).toBe(true);
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
    expect(isStandalone({})).toBe(false);
  });

  it("chooses the UI mode", () => {
    const base = { platform: "android" as const, standalone: false, hasPrompt: false, dismissed: false };
    expect(installUiMode({ ...base, hasPrompt: true })).toBe("prompt");
    expect(installUiMode({ ...base, platform: "desktop", hasPrompt: true })).toBe("prompt");
    expect(installUiMode(base)).toBe("hidden"); // no prompt yet (or not installable)
    expect(installUiMode({ ...base, platform: "ios" })).toBe("ios-instructions");
    expect(installUiMode({ ...base, platform: "ios", inAppBrowser: true })).toBe("hidden");
    expect(installUiMode({ ...base, hasPrompt: true, standalone: true })).toBe("hidden");
    expect(installUiMode({ ...base, platform: "ios", dismissed: true })).toBe("hidden");
  });

  it("remembers a dismissal per club, for a limited time", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const key = dismissKey("riverside");
    expect(key).not.toBe(dismissKey("lakeside"));
    expect(readDismissed(storage, key, 1_000)).toBe(false);
    writeDismissed(storage, key, 1_000);
    expect(readDismissed(storage, key, 2_000)).toBe(true);
    expect(readDismissed(storage, dismissKey("lakeside"), 2_000)).toBe(false);
    expect(readDismissed(storage, key, 1_000 + DISMISS_TTL_MS + 1)).toBe(false);
    store.set(key, "garbage");
    expect(readDismissed(storage, key, 2_000)).toBe(false);
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readDismissed(broken, "k")).toBe(false);
    expect(() => writeDismissed(broken, "k")).not.toThrow();
    expect(readDismissed(null, "k")).toBe(false);
    expect(() => writeDismissed(undefined, "k")).not.toThrow();
  });

  it("recognises the beforeinstallprompt event", () => {
    expect(isBeforeInstallPromptEvent({ prompt: () => Promise.resolve() })).toBe(true);
    expect(isBeforeInstallPromptEvent({})).toBe(false);
    expect(isBeforeInstallPromptEvent(null)).toBe(false);
  });
});

describe("service worker request policy", () => {
  const origin = "https://riverside.clubos.test";
  const req = (path: string, over: Partial<SwRequestInfo> = {}): SwRequestInfo => ({
    url: path.startsWith("http") ? path : `${origin}${path}`,
    origin,
    method: "GET",
    mode: "no-cors",
    ...over,
  });

  it("never caches API, auth or data responses", () => {
    for (const p of [
      "/api/health",
      "/api/stripe/webhook",
      "/api/invoices/123/pdf",
      "/api",
      "/auth/callback?code=x",
      "/_next/data/build/parent/home.json",
      "/_next/image?url=https%3A%2F%2Fx.supabase.co%2Fstorage%2Fv1%2Fobject%2Fsign%2Fphoto.jpg&w=256",
      "/sw.js",
      "/manifest.webmanifest",
      "/parent/invoices/abc/pdf",
      "/admin/invoices/abc/pdf",
    ]) {
      expect(swRequestPolicy(req(p)), p).toBe("bypass");
      expect(swRequestPolicy(req(p, { mode: "navigate" })), p).toBe("bypass");
    }
  });

  it("never stores authenticated pages: navigations are network-first only", () => {
    for (const p of ["/admin", "/admin/invoices", "/parent/home", "/parent/children/abc", "/coach/sessions", "/platform", "/onboarding"]) {
      expect(swRequestPolicy(req(p, { mode: "navigate" })), p).toBe("navigate");
      // Non-navigation fetches of the same paths (RSC/prefetch) are never cached.
      expect(swRequestPolicy(req(p)), p).toBe("bypass");
    }
    expect(swRequestPolicy(req("/parent/home?_rsc=abc"))).toBe("bypass");
    expect(swRequestPolicy(req("/parent/home", { isRsc: true }))).toBe("bypass");
    expect(swRequestPolicy(req("/parent/home", { mode: "navigate", isRsc: true }))).toBe("bypass");
  });

  it("caches only hashed static assets and app icons", () => {
    expect(swRequestPolicy(req("/_next/static/chunks/app-123.js"))).toBe("static");
    expect(swRequestPolicy(req("/_next/static/css/abc.css"))).toBe("static");
    expect(swRequestPolicy(req("/pwa/icon/192?v=abc"))).toBe("static");
    expect(swRequestPolicy(req("/register/summer-camp"))).toBe("bypass");
  });

  it("ignores cross-origin, non-GET and authorised requests", () => {
    expect(swRequestPolicy(req("https://other.example.com/_next/static/x.js"))).toBe("bypass");
    expect(swRequestPolicy(req("https://x.supabase.co/rest/v1/athletes"))).toBe("bypass");
    expect(swRequestPolicy(req("/_next/static/x.js", { method: "POST" }))).toBe("bypass");
    expect(swRequestPolicy(req("/parent/home", { method: "POST", mode: "navigate" }))).toBe("bypass");
    expect(swRequestPolicy(req("/_next/static/x.js", { hasAuthorization: true }))).toBe("bypass");
    expect(swRequestPolicy(req("::not a url::", { origin: "not an origin" }))).toBe("bypass");
  });

  it("does not over-match look-alike paths", () => {
    expect(swRequestPolicy(req("/apiary", { mode: "navigate" }))).toBe("navigate");
    expect(swRequestPolicy(req("/authors", { mode: "navigate" }))).toBe("navigate");
  });
});

describe("service worker script", () => {
  type Listener = (event: unknown) => void;

  /** Runs the generated /sw.js against minimal browser stubs. */
  function loadWorker() {
    const listeners: Record<string, Listener> = {};
    const puts: string[] = [];
    const cache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async (r: { url: string }) => {
        puts.push(r.url);
      }),
      add: vi.fn(async () => undefined),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    };
    const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => []), delete: vi.fn(async () => true) };
    const fetchStub = vi.fn(async () => ({
      ok: true,
      type: "basic",
      headers: new Headers({ "cache-control": "public, max-age=31536000, immutable" }),
      clone() {
        return this;
      },
    }));
    const self = {
      location: { origin: "https://riverside.clubos.test" },
      addEventListener: (type: string, fn: Listener) => {
        listeners[type] = fn;
      },
      skipWaiting: vi.fn(),
      clients: { claim: vi.fn() },
    };
    class FakeRequest {
      constructor(public url: string, public init?: unknown) {}
    }
    const script = buildServiceWorkerScript("test-1");
    new Function("self", "caches", "fetch", "Request", script)(self, caches, fetchStub, FakeRequest);
    return { listeners, puts, fetchStub };
  }

  function fetchEvent(path: string, mode = "no-cors", method = "GET", headers: Record<string, string> = {}) {
    let responded: Promise<unknown> | null = null;
    return {
      event: {
        request: { url: `https://riverside.clubos.test${path}`, method, mode, headers: new Headers(headers) },
        respondWith: (p: Promise<unknown>) => {
          responded = p;
        },
      },
      responded: () => responded,
    };
  }

  it("is valid JavaScript with a versioned cache", () => {
    const src = buildServiceWorkerScript("abc");
    expect(src).toContain('const VERSION = "abc"');
    expect(() => new Function(src)).not.toThrow();
    expect(buildServiceWorkerScript('x";alert(1)//')).toContain('const VERSION = "xalert1"');
  });

  it("leaves API and authenticated data requests to the browser", () => {
    const w = loadWorker();
    for (const [path, mode, headers] of [
      ["/api/health", "cors", {}],
      ["/api/invoices/1/pdf", "navigate", {}],
      ["/auth/callback", "navigate", {}],
      ["/parent/home", "cors", { rsc: "1" }],
      ["/parent/home?_rsc=1", "cors", {}],
    ] as const) {
      const e = fetchEvent(path, mode, "GET", headers);
      w.listeners.fetch!(e.event);
      expect(e.responded(), path).toBeNull();
    }
  });

  it("serves navigations from the network and never writes them to the cache", async () => {
    const w = loadWorker();
    const e = fetchEvent("/parent/children/abc", "navigate");
    w.listeners.fetch!(e.event);
    expect(e.responded()).not.toBeNull();
    await e.responded();
    expect(w.fetchStub).toHaveBeenCalledTimes(1);
    expect(w.puts).toEqual([]);
  });

  it("caches hashed static assets", async () => {
    const w = loadWorker();
    const e = fetchEvent("/_next/static/chunks/main.js");
    w.listeners.fetch!(e.event);
    await e.responded();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.puts).toEqual(["https://riverside.clubos.test/_next/static/chunks/main.js"]);
  });

  it("derives the version from deployment env", () => {
    expect(swVersion({ VERCEL_DEPLOYMENT_ID: "dpl_123" })).toBe("dpl_123");
    expect(swVersion({})).toBe("v1");
  });
});

describe("offline page", () => {
  it("escapes text and keeps only safe CSS variables", () => {
    const html = renderOfflinePage({
      lang: "de",
      appName: "<b>Club</b>",
      cssVars: { "--bg": "#0A0A0A", "--evil": "red;}</style><script>", "bad key": "#fff" },
      title: "Sie sind offline",
      body: "Body & more",
      retry: "Erneut versuchen",
    });
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("--bg:#0A0A0A;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Club</b>");
    expect(html).toContain("&lt;b&gt;Club&lt;/b&gt;");
    expect(html).toContain("Body &amp; more");
    expect(escapeHtml(`"'`)).toBe("&quot;&#39;");
  });
});

describe("club hub", () => {
  it("shows the hub at / only on a club's own host", () => {
    expect(showsHubAtRoot({ id: "org-1", source: "subdomain" })).toBe(true);
    expect(showsHubAtRoot({ id: "org-1", source: "custom_domain" })).toBe(true);
    expect(showsHubAtRoot({ id: "org-1", source: "default" })).toBe(false);
    expect(showsHubAtRoot({ id: null, source: "fallback" })).toBe(false);
  });

  it("lists only camps open for registration and not yet over", () => {
    const now = Date.parse("2026-11-12T10:00:00Z");
    const today = "2026-11-12";
    const row = { slug: "winter-camp", name: "Winter camp", description: null, price_chf: 300, location: null, starts_on: "2026-12-28", ends_on: "2026-12-31" };
    expect(isOpenCamp(row, now, today)).toBe(true);
    expect(isOpenCamp({ ...row, slug: null }, now, today)).toBe(false);
    expect(isOpenCamp({ ...row, registration_opens_at: "2026-12-01T00:00:00Z" }, now, today)).toBe(false);
    expect(isOpenCamp({ ...row, registration_closes_at: "2026-11-01T00:00:00Z" }, now, today)).toBe(false);
    expect(isOpenCamp({ ...row, starts_on: "2026-10-01", ends_on: "2026-10-05" }, now, today)).toBe(false);
    expect(isOpenCamp({ ...row, starts_on: null, ends_on: null }, now, today)).toBe(true);
  });
});
