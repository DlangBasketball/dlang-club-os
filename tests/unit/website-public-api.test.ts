import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BRANDING, DEFAULT_TERMINOLOGY } from "@/lib/tenant/defaults";
import type { Tenant } from "@/lib/tenant/types";

/**
 * Cross-tenant isolation of the public website API, end to end through the
 * route handler: the service-role client is replaced by an in-memory database
 * holding TWO clubs (synthetic data). Every query the handler and the camp
 * loaders make must be filtered to the club resolved server-side, so a
 * request for club A never sees a row of club B (and vice versa).
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ORG_C = "cccccccc-0000-4000-8000-00000000000c";
const ORIGIN_A = "https://www.club-a.example";
const ORIGIN_B = "https://www.club-b.example";

type Row = Record<string, unknown>;
const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

function seed(): Record<string, Row[]> {
  const settings = (org: string, enabled: boolean, origin: string) => ({
    org_id: org, enabled, allowed_origins: [origin], public_sections: {}, embed_theme: "club", roster_public: false,
  });
  const camp = (org: string, id: string, name: string, slug: string) => ({
    id, org_id: org, slug, name, description: null, currency: "CHF", is_public: true, season: "summer", season_year: 2099,
    cover_path: null, cover_focal_x: null, cover_focal_y: null, kind: "camp", status: "published", min_age: 8, max_age: 14,
  });
  const edition = (org: string, id: string, programId: string, name: string) => ({
    id, org_id: org, program_id: programId, name, starts_on: future(30), ends_on: future(34), venue_id: null, location_name: `${name} hall`,
    address: null, city: "Synthetic City", capacity: 20, registration_opens_at: null, registration_closes_at: null, status: "published",
    notes: null, archived_at: null, created_at: null, updated_at: null, cover_path: null, cover_focal_x: null, cover_focal_y: null,
  });
  const option = (org: string, id: string, programId: string, price: number) => ({
    id, org_id: org, program_id: programId, edition_id: null, label: "Full week", days_count: 5, includes_lunch: true, price,
    member_price: null, currency: "CHF", sort: 0, is_active: true,
  });
  return {
    website_settings: [settings(ORG_A, true, ORIGIN_A), settings(ORG_B, true, ORIGIN_B), settings(ORG_C, false, "https://www.club-c.example")],
    programs: [
      camp(ORG_A, "a0000000-0000-4000-8000-000000000001", "Club A Summer Camp", "club-a-summer"),
      camp(ORG_B, "b0000000-0000-4000-8000-000000000001", "Club B Summer Camp", "club-b-summer"),
      // Not public / not published in club A: never listed.
      { ...camp(ORG_A, "a0000000-0000-4000-8000-000000000002", "Club A Hidden Camp", "club-a-hidden"), is_public: false },
      { ...camp(ORG_A, "a0000000-0000-4000-8000-000000000003", "Club A Draft Camp", "club-a-draft"), status: "draft" },
    ],
    camp_editions: [
      edition(ORG_A, "a1000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000001", "Club A Week 1"),
      edition(ORG_A, "a1000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000002", "Club A Hidden Week"),
      edition(ORG_A, "a1000000-0000-4000-8000-000000000003", "a0000000-0000-4000-8000-000000000003", "Club A Draft Week"),
      edition(ORG_B, "b1000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000001", "Club B Week 1"),
      // A row of club B that (wrongly) points at club A's programme: must still not leak into club A.
      edition(ORG_B, "b1000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000001", "Club B Smuggled Week"),
    ],
    camp_price_options: [
      option(ORG_A, "a2000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000001", 350),
      option(ORG_B, "b2000000-0000-4000-8000-000000000001", "b0000000-0000-4000-8000-000000000001", 999),
      option(ORG_B, "b2000000-0000-4000-8000-000000000002", "a0000000-0000-4000-8000-000000000001", 1),
    ],
    registrations: [],
    venues: [],
  };
}

const state = { db: seed(), host: null as Tenant | null, queries: [] as { table: string; org: unknown }[] };

/** Minimal PostgREST-like query builder over the in-memory rows. */
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = [];
  let org: unknown;
  let limit = Infinity;
  const run = () => {
    state.queries.push({ table, org });
    return (state.db[table] ?? []).filter((r) => preds.every((p) => p(r))).slice(0, limit);
  };
  const b = {
    select: () => b,
    eq: (col: string, v: unknown) => {
      if (col === "org_id") org = v;
      preds.push((r) => r[col] === v);
      return b;
    },
    neq: (col: string, v: unknown) => (preds.push((r) => r[col] !== v), b),
    in: (col: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[col])), b),
    gte: (col: string, v: unknown) => (preds.push((r) => String(r[col]) >= String(v)), b),
    lte: (col: string, v: unknown) => (preds.push((r) => String(r[col]) <= String(v)), b),
    is: (col: string, v: unknown) => (preds.push((r) => (r[col] ?? null) === v), b),
    or: () => b,
    order: () => b,
    limit: (n: number) => ((limit = n), b),
    maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    single: async () => ({ data: run()[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: run(), error: null }).then(resolve),
  };
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => query(table),
    rpc: async (fn: string) => ({ data: fn === "org_currency" ? "CHF" : null, error: null }),
  }),
}));

function tenant(id: string, slug: string, source: Tenant["source"]): Tenant {
  return {
    id, slug, name: slug === "club-a" ? "Synthetic Club A" : "Synthetic Club B", appName: "Club OS", customDomain: null,
    branding: DEFAULT_BRANDING, terminology: DEFAULT_TERMINOLOGY, sport: null, country: "CH", defaultLocale: "en",
    supportedLocales: ["en"], currency: "CHF", timezone: "Europe/Zurich", status: "active", source,
  } as Tenant;
}
const BY_SLUG: Record<string, string> = { "club-a": ORG_A, "club-b": ORG_B, "club-c": ORG_C };

vi.mock("@/lib/tenant/server", () => ({
  getTenant: async () => state.host,
  resolveTenant: async ({ slug }: { slug: string }) =>
    BY_SLUG[slug] ? tenant(BY_SLUG[slug]!, slug, "default") : { ...tenant("", slug, "unknown"), id: null },
}));

// Both clubs hold the website-connection module (module off: tests/unit/upgrades-gating.test.ts).
vi.mock("@/lib/upgrades/server", () => ({ hasFeature: async () => true }));

const { handlePublicApi, resetPublicApiRateLimit } = await import("@/lib/website/public-api");

async function get(path: string, origin?: string) {
  const req = new Request(`https://app.example${path}`, { headers: { ...(origin ? { origin } : {}), "x-forwarded-for": "198.51.100.7" } });
  const resource = new URL(req.url).pathname.split("/").pop()!;
  const res = await handlePublicApi(req, resource);
  return { res, body: res.status === 200 ? ((await res.json()) as { club: { slug: string }; data: unknown[] }) : null };
}

beforeEach(() => {
  state.db = seed();
  state.queries = [];
  state.host = tenant(ORG_A, "club-a", "default"); // platform host (not naming a club)
  resetPublicApiRateLimit();
});

describe("public API /api/public/v1/camps cross-tenant isolation", () => {
  it("club A only ever gets club A's public, published camps", async () => {
    const { res, body } = await get("/api/public/v1/camps?club=club-a", ORIGIN_A);
    expect(res.status).toBe(200);
    const text = JSON.stringify(body);
    expect(body!.club.slug).toBe("club-a");
    expect(text).toContain("Club A Summer Camp");
    expect(text).toContain("Club A Week 1");
    expect(text).not.toMatch(/Club B|b0000000|b1000000|b2000000|999/);
    expect(text).not.toMatch(/Hidden|Draft/);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
    // Every org-scoped query of this request was pinned to club A.
    const scoped = state.queries.filter((q) => q.org !== undefined);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((q) => q.org === ORG_A)).toBe(true);
  });

  it("club B gets only club B's data, and club A's website origin is not echoed", async () => {
    const { res, body } = await get("/api/public/v1/camps?club=club-b", ORIGIN_A);
    expect(res.status).toBe(200);
    const text = JSON.stringify(body);
    expect(text).toContain("Club B Summer Camp");
    expect(text).not.toMatch(/Club A|a0000000|a1000000|a2000000/);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("a host that names club B never serves club A, even with ?club=club-a", async () => {
    state.host = tenant(ORG_B, "club-b", "subdomain");
    const { res } = await get("/api/public/v1/camps?club=club-a", ORIGIN_A);
    expect(res.status).toBe(404);
  });

  it("clubs without an enabled website connection, unknown clubs and bad params are refused", async () => {
    expect((await get("/api/public/v1/camps?club=club-c")).res.status).toBe(404);
    expect((await get("/api/public/v1/camps?club=no-such-club")).res.status).toBe(404);
    expect((await get("/api/public/v1/camps?club=club-a&season=monsoon")).res.status).toBe(400);
    expect((await get("/api/public/v1/camps?club=..%2Fclub-b")).res.status).toBe(400);
  });

  it("sends cache headers and honours If-None-Match", async () => {
    const first = await get("/api/public/v1/camps?club=club-a");
    expect(first.res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");
    const etag = first.res.headers.get("etag")!;
    expect(etag).toBeTruthy();
    const req = new Request("https://app.example/api/public/v1/camps?club=club-a", { headers: { "if-none-match": etag } });
    const res = await handlePublicApi(req, "camps");
    // generated_at is outside the ETag: the same data -> 304.
    expect(res.status).toBe(304);
  });
});
