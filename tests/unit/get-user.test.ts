import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal in-memory stand-in for the Supabase query builder: supports the
// select / eq / in / is / maybeSingle chain getSessionUser uses, and applies
// the filters to fixture rows (RLS is not modelled: the point is that the app
// itself scopes roles to the profile's org).
type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

function query(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let head = false;
  const run = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const builder = {
    select(_cols?: string, opts?: { head?: boolean; count?: string }) {
      head = Boolean(opts?.head);
      return builder;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return builder;
    },
    maybeSingle() {
      return Promise.resolve({ data: run()[0] ?? null, error: null });
    },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      const rows = run();
      return Promise.resolve(
        head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null },
      ).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "u1@example.test" } } }) },
    from: (t: string) => query(t),
  }),
}));

const ORG_A = "org-a";
const ORG_B = "org-b";

describe("getSessionUser role scoping", () => {
  beforeEach(() => {
    tables = {
      profiles: [{ id: "u1", org_id: ORG_A, full_name: "U One", email: "u1@example.test", onboarding_completed_at: null }],
      staff_roles: [],
      family_members: [],
      families: [
        { id: "fam-a", org_id: ORG_A },
        { id: "fam-b", org_id: ORG_B },
      ],
    };
  });

  it("ignores a staff role held in another org", async () => {
    tables.staff_roles = [{ profile_id: "u1", org_id: ORG_B, role: "admin" }];
    const { getSessionUser } = await import("@/lib/auth/get-user");
    const me = await getSessionUser();
    expect(me?.orgId).toBe(ORG_A);
    expect(me?.roles).toEqual([]);
  });

  it("keeps roles held in the profile's own org", async () => {
    tables.staff_roles = [
      { profile_id: "u1", org_id: ORG_A, role: "finance" },
      { profile_id: "u1", org_id: ORG_B, role: "admin" },
    ];
    const { getSessionUser } = await import("@/lib/auth/get-user");
    const me = await getSessionUser();
    expect(me?.roles).toEqual(["finance"]);
  });

  it("derives parent only from families in the profile's org", async () => {
    tables.family_members = [{ profile_id: "u1", family_id: "fam-b" }];
    const { getSessionUser } = await import("@/lib/auth/get-user");
    expect((await getSessionUser())?.roles).toEqual([]);

    tables.family_members.push({ profile_id: "u1", family_id: "fam-a" });
    expect((await getSessionUser())?.roles).toEqual(["parent"]);
  });

  it("gives a user without a club no roles", async () => {
    tables.profiles[0].org_id = null;
    tables.staff_roles = [{ profile_id: "u1", org_id: ORG_B, role: "admin" }];
    const { getSessionUser } = await import("@/lib/auth/get-user");
    const me = await getSessionUser();
    expect(me?.orgId).toBeNull();
    expect(me?.roles).toEqual([]);
  });
});
