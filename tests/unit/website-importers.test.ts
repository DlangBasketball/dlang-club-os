import { describe, expect, it } from "vitest";
import events from "./fixtures/website/sportspress-events.json";
import teams from "./fixtures/website/sportspress-teams.json";
import products from "./fixtures/website/woo-products.json";
import posts from "./fixtures/website/wp-posts.json";
import {
  httpsLink, mapSportsPressEvent, mapSportsPressTeam, mapWooProduct, mapWpPost, wpDateToIso, type MappedTeam,
} from "@/lib/website/importers/mappers";
import { mapSources } from "@/lib/website/importers/run";
import { htmlToText, sanitizeHtml } from "@/lib/website/sanitize";
import { assertPublicUrl, assertSafeUrlShape, isPrivateIp, safeFetch, UnsafeUrlError, type LookupFn } from "@/lib/website/ssrf";

// All fixtures are synthetic (no real club, person or child).

describe("SportsPress mappers", () => {
  const mapped = teams.map(mapSportsPressTeam).filter((t): t is MappedTeam => !!t);
  const names = new Map(mapped.map((t) => [t.sourceId, t.name]));
  const ours = new Set(["101", "102"]);

  it("maps teams, decodes entities, upgrades http links and drops invalid rows", () => {
    expect(mapped.map((t) => t.sourceId)).toEqual(["101", "102", "201"]);
    expect(mapped[1]).toMatchObject({ name: "Synthetic U16 – Elite", slug: "synthetic-u16", sourceUrl: "https://www.club.example/team/synthetic-u16/" });
  });

  it("maps our games with score, home/away and opponent; skips drafts, other clubs and undated events", () => {
    const r = events.map((e) => mapSportsPressEvent(e, ours, names));
    const ok = r.flatMap((x) => (x.ok ? [x.event] : []));
    expect(ok.map((e) => e.sourceId)).toEqual(["5001", "5002"]);
    expect(r.flatMap((x) => (x.ok ? [] : [x.reason]))).toEqual(["not_our_team", "draft", "no_date"]);
    const [past, future] = ok;
    expect(past).toMatchObject({ startsAt: "2025-10-04T14:00:00.000Z", endsAt: "2025-10-04T15:30:00.000Z", homeAway: "home", opponent: "Rival Synthetic Club", scoreFor: 78, scoreAgainst: 65, status: "completed" });
    expect(future).toMatchObject({ homeAway: "away", opponent: "Rival Synthetic Club", scoreFor: null, status: "scheduled", title: "Rival Synthetic Club – Synthetic U16" });
  });

  it("never carries player names or performance data (minors)", () => {
    const r = mapSportsPressEvent(events[0], ours, names);
    expect(JSON.stringify(r)).not.toMatch(/Synthetic Child|Fullname|players|performance|9001/);
  });

  it("parses WordPress GMT dates as UTC and rejects junk", () => {
    expect(wpDateToIso("2025-01-02T03:04:05")).toBe("2025-01-02T03:04:05.000Z");
    expect(wpDateToIso(null, "2025-01-02T03:04")).toBe("2025-01-02T03:04:00.000Z");
    expect(wpDateToIso("yesterday")).toBeNull();
    expect(httpsLink("javascript:alert(1)")).toBeNull();
    expect(httpsLink("https://user:pw@club.example/")).toBeNull();
  });
});

describe("WooCommerce Store API mapper", () => {
  const mapped = products.map(mapWooProduct);

  it("maps price from minor units, currency, category, variants and stock", () => {
    expect(mapped[0]).toMatchObject({ sourceId: "301", price: 55, currency: "CHF", category: "Apparel & Merch", inStock: true });
    expect(mapped[0]!.variants.map((v) => v.size)).toEqual(["S", "M"]);
    expect(mapped[1]).toMatchObject({ price: 12, inStock: false, stock: 0 });
    expect(mapped[2]).toMatchObject({ currency: "EUR", price: 29.9, stock: 3 });
    expect(mapped[2]!.variants.map((v) => v.size)).toEqual(["5", "6"]);
    expect(mapped[3]).toBeNull();
  });

  it("keeps only https images (http upgraded) and strips scripts from descriptions", () => {
    expect(mapped[0]!.imageUrls).toEqual([
      "https://www.club.example/wp-content/uploads/hoodie.jpg",
      "https://www.club.example/wp-content/uploads/hoodie-back.jpg",
    ]);
    expect(mapped[0]!.description).toBe("Warm hoodie with club logo.");
  });
});

describe("WordPress posts -> news", () => {
  const mapped = posts.map(mapWpPost);

  it("imports published posts with sanitized HTML, no images, no scripts, no iframes", () => {
    expect(mapped[0]).toMatchObject({ sourceId: "401", title: "Season start – welcome back!", publishedAt: "2025-11-01T08:00:00.000Z" });
    const html = mapped[0]!.bodyHtml!;
    expect(html).toContain("<strong>starts</strong>");
    expect(html).toContain('<a href="https://www.club.example/teams" rel="noopener noreferrer nofollow">teams</a>');
    expect(html).not.toMatch(/script|iframe|<img|onclick|javascript:|document\.cookie|evil/i);
    expect(mapped[1]).toBeNull(); // draft
    expect(mapped[2]).toBeNull(); // no title
  });

  it("sanitizer and text extraction neutralise markup", () => {
    expect(sanitizeHtml('<p onclick="x()">a<style>b</style></p><a href="http://x.example">c</a>')).toBe("<p>a</p><a>c</a>");
    expect(htmlToText("<p>One</p><p>Two &amp; three</p>")).toBe("One\nTwo & three");
  });
});

describe("import mapping (preview counts)", () => {
  it("counts skipped rows per source and maps only our teams' events", () => {
    const m = mapSources({ teams, events, products, posts, errors: {} }, new Set(["101", "102"]));
    expect(m.events).toHaveLength(2);
    expect(m.products).toHaveLength(3);
    expect(m.posts).toHaveLength(1);
    expect(m.skipped).toEqual({ events: 3, products: 1, posts: 2 });
  });
});

describe("SSRF guard", () => {
  it("flags private, loopback, link-local, CGNAT, mapped and ULA addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "not-an-ip"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });

  it("accepts only https on the default port without credentials or internal hosts", () => {
    expect(assertSafeUrlShape("https://www.club.example/wp-json").hostname).toBe("www.club.example");
    for (const [url, reason] of [
      ["http://www.club.example/", "https_only"],
      ["ftp://www.club.example/", "https_only"],
      ["https://user:pw@www.club.example/", "credentials"],
      ["https://www.club.example:8443/", "port"],
      ["https://localhost/", "host"],
      ["https://intranet/", "host"],
      ["https://printer.local/", "host"],
      ["https://127.0.0.1/", "private_ip"],
      ["https://[::1]/", "private_ip"],
      ["https://169.254.169.254/latest/meta-data", "private_ip"],
      ["not a url", "invalid"],
    ] as const) {
      expect(() => assertSafeUrlShape(url), url).toThrow(new UnsafeUrlError(reason).message);
    }
  });

  it("rejects hosts that resolve to any private address (DNS)", async () => {
    const lookup = (map: Record<string, string[]>): LookupFn => async (h) => (map[h] ?? []).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    const l = lookup({ "ok.example": ["93.184.216.34"], "rebind.example": ["93.184.216.34", "10.0.0.5"], "v6.example": ["fd12::1"] });
    await expect(assertPublicUrl("https://ok.example/", l)).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("https://rebind.example/", l)).rejects.toThrow("private_ip");
    await expect(assertPublicUrl("https://v6.example/", l)).rejects.toThrow("private_ip");
    await expect(assertPublicUrl("https://nxdomain.example/", l)).rejects.toThrow("dns");
  });

  it("re-checks every redirect hop and enforces the size limit", async () => {
    const lookup: LookupFn = async (h) => [{ address: h === "inside.example" ? "192.168.0.10" : "93.184.216.34", family: 4 }];
    const redirecting = (async () => new Response(null, { status: 302, headers: { location: "https://inside.example/admin" } })) as unknown as typeof fetch;
    await expect(safeFetch("https://ok.example/", { lookup, fetchImpl: redirecting })).rejects.toThrow("private_ip");
    const big = (async () => new Response("x".repeat(2000))) as unknown as typeof fetch;
    await expect(safeFetch("https://ok.example/", { lookup, fetchImpl: big, maxBytes: 1000 })).rejects.toThrow("response_too_large");
    const fine = (async () => new Response('[{"id":1}]', { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const res = await safeFetch("https://ok.example/", { lookup, fetchImpl: fine });
    expect(JSON.parse(res.text())).toEqual([{ id: 1 }]);
  });
});
