import { describe, expect, it } from "vitest";
import {
  activeGroupKey, activeNavKey, buildAdminNav, buildDashboardShortcuts, currentSelectionProgram, divisionHref,
  tournamentsHref, type AdminNavModel, type SelectionNavProgram,
} from "@/components/layout/admin-nav";
import { ADMIN_NAV_FLAT, ADMIN_NAV_ICONS, ADMIN_ONLY_COMMS } from "@/components/layout/nav-config";

/** Every destination of the former flat admin menu: each must stay reachable. */
const LEGACY_ADMIN_HREFS = [
  "/admin/dashboard", "/admin/notifications", "/admin/messages", "/admin/alerts", "/admin/leads", "/admin/documents", "/admin/consents",
  "/admin/forms", "/admin/contracts", "/admin/families", "/admin/athletes", "/admin/programs", "/admin/registrations", "/admin/selection",
  "/admin/waitlists", "/admin/memberships", "/admin/discounts", "/admin/sponsorships", "/admin/shop", "/admin/teams", "/admin/coaches",
  "/admin/staff-compliance", "/admin/schedule", "/admin/locations", "/admin/operations", "/board", "/admin/sports", "/admin/media",
  "/admin/site", "/admin/calendar", "/admin/timesheets", "/admin/lesson-plans", "/admin/invoices", "/admin/payments", "/admin/payment-plans",
  "/admin/recurring-fees", "/admin/family-billing", "/admin/finance", "/admin/accounting", "/admin/attendance", "/admin/js", "/admin/incidents",
  "/admin/bookings", "/admin/services", "/admin/training", "/admin/development", "/admin/journey", "/admin/alumni", "/admin/carpool",
  "/admin/invitations", "/admin/import", "/admin/deleted", "/admin/reports", "/admin/assistant", "/admin/settings", "/admin/upgrades",
];

// Synthetic programmes (no real club data).
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const D3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const one: SelectionNavProgram[] = [{ id: P1, name: "Elite League 2026-27", divisions: [{ id: D1, name: "U14" }, { id: D2, name: "U16" }] }];
const two: SelectionNavProgram[] = [...one, { id: P2, name: "Elite League 2025-26", divisions: [{ id: D3, name: "U14" }] }];

const hrefs = (m: AdminNavModel) => [...m.pinned, ...m.groups.flatMap((g) => g.items)].map((i) => i.href.split(/[?#]/)[0]);
const keys = (m: AdminNavModel) => [...m.pinned, ...m.groups.flatMap((g) => g.items)].map((i) => i.key);
const group = (m: AdminNavModel, key: string) => m.groups.find((g) => g.key === key);
const params = (q: string) => new URLSearchParams(q);

describe("admin nav: legacy destinations", () => {
  it("keeps every former menu destination for admins", () => {
    const m = buildAdminNav({ roles: ["admin"], selection: one });
    const all = new Set(hrefs(m));
    for (const h of LEGACY_ADMIN_HREFS) expect(all, h).toContain(h);
  });

  it("keeps every former destination in the flat list (command palette search)", () => {
    const flat = new Set(ADMIN_NAV_FLAT.map((d) => d.href));
    for (const h of LEGACY_ADMIN_HREFS) expect(flat, h).toContain(h);
    expect(ADMIN_NAV_FLAT.length).toBe(new Set(ADMIN_NAV_FLAT.map((d) => d.href)).size);
  });

  it("has the requested groups in order, Dashboard pinned on top", () => {
    const m = buildAdminNav({ roles: ["admin"], selection: one });
    expect(m.pinned.map((i) => i.key)).toEqual(["dashboard"]);
    expect(m.groups.map((g) => g.key)).toEqual(["players", "operations", "selection", "calendar", "finance", "settings", "more"]);
    expect(group(m, "players")!.items.slice(0, 2).map((i) => i.href)).toEqual(["/admin/athletes", "/admin/families"]);
    expect(group(m, "operations")!.items.slice(0, 2).map((i) => i.href)).toEqual(["/admin/teams", "/admin/memberships"]);
    expect(group(m, "calendar")!.items.slice(0, 3).map((i) => i.href)).toEqual(["/admin/calendar", "/admin/bookings", "/admin/services"]);
    expect(group(m, "finance")!.items.slice(0, 6).map((i) => i.href)).toEqual([
      "/admin/invoices", "/admin/payments", "/admin/finance/club-membership-payments", "/admin/finance/selection-payments",
      "/admin/credits", "/admin/accounting/exports",
    ]);
    expect(group(m, "settings")!.items.slice(0, 4).map((i) => i.href)).toEqual([
      "/admin/settings/seasons", "/admin/payment-plans/settings", "/admin/settings/billing-entities", "/admin/settings/staff",
    ]);
  });

  it("has an icon for every entry and group, and unique keys", () => {
    const m = buildAdminNav({ roles: ["admin"], selection: two });
    for (const e of [...m.pinned, ...m.groups.flatMap((g) => g.items)]) expect(ADMIN_NAV_ICONS[e.icon], e.key).toBeDefined();
    for (const g of m.groups) expect(ADMIN_NAV_ICONS[g.icon], g.key).toBeDefined();
    expect(new Set(keys(m)).size).toBe(keys(m).length);
  });
});

describe("admin nav: roles", () => {
  it("finance sees finance, players & families, club memberships and selection payments, not admin pages", () => {
    const m = buildAdminNav({ roles: ["finance"], hidden: ADMIN_ONLY_COMMS, selection: null });
    const h = new Set(hrefs(m));
    for (const x of ["/admin/dashboard", "/admin/athletes", "/admin/families", "/admin/memberships", "/admin/invoices", "/admin/payments",
      "/admin/finance/club-membership-payments", "/admin/finance/selection-payments", "/admin/credits", "/admin/accounting/exports"]) {
      expect(h, x).toContain(x);
    }
    for (const x of ["/admin/teams", "/admin/selection", "/admin/calendar", "/admin/settings/staff", "/admin/settings/seasons",
      "/admin/documents", "/admin/consents", "/admin/incidents", "/admin/alerts", "/admin/import", "/admin/deleted"]) {
      expect(h, x).not.toContain(x);
    }
    expect(m.groups.map((g) => g.key)).not.toContain("selection");
    expect(m.groups.map((g) => g.key)).not.toContain("calendar");
    expect(group(m, "operations")!.items.map((i) => i.key)).toEqual(["memberships", "board"]);
  });

  it("finance never gets division entries even when programmes are passed", () => {
    const m = buildAdminNav({ roles: ["finance"], selection: one });
    expect(keys(m).some((k) => k.startsWith("division:"))).toBe(false);
  });

  it("admin + finance on one account sees the admin menu", () => {
    expect(keys(buildAdminNav({ roles: ["finance", "admin"], selection: one }))).toEqual(keys(buildAdminNav({ roles: ["admin"], selection: one })));
  });

  it("coach and parent get no admin entries at all", () => {
    for (const roles of [["coach"], ["parent"], ["coach", "parent"], []]) {
      const m = buildAdminNav({ roles, selection: one });
      expect(m.pinned).toEqual([]);
      expect(m.groups).toEqual([]);
    }
  });
});

describe("admin nav: plan gating", () => {
  it("drops hidden destinations (prefix match) and empty groups", () => {
    const m = buildAdminNav({ roles: ["admin"], hidden: ["/admin/selection", "/admin/assistant", "/admin/finance"], selection: one });
    const h = hrefs(m);
    expect(h).not.toContain("/admin/selection");
    expect(h).not.toContain("/admin/assistant");
    expect(h).not.toContain("/admin/finance/club-membership-payments");
    expect(h).not.toContain("/admin/finance/selection-payments");
    expect(m.groups.map((g) => g.key)).not.toContain("selection");
    expect(h).toContain("/admin/invoices");
  });

  it("flags locked modules (and their sub-pages) with the upgrade badge instead of hiding them", () => {
    const m = buildAdminNav({ roles: ["admin"], locked: ["/admin/payment-plans", "/admin/finance"], selection: one });
    const all = m.groups.flatMap((g) => g.items);
    expect(all.find((i) => i.key === "paymentPlans")!.locked).toBe(true);
    expect(all.find((i) => i.key === "feesPaymentPlans")!.locked).toBe(true);
    expect(all.find((i) => i.key === "clubMembershipPayments")!.locked).toBe(true);
    expect(all.find((i) => i.key === "invoices")!.locked).toBeUndefined();
  });

  it("a locked selection module shows the static entries (badge) but no division entries", () => {
    const m = buildAdminNav({ roles: ["admin"], locked: ["/admin/selection"], selection: one });
    const sel = group(m, "selection")!;
    expect(sel.items.map((i) => i.key)).toEqual(["selectionRosters", "selectionTournaments"]);
    expect(sel.items.every((i) => i.locked)).toBe(true);
  });
});

describe("admin nav: selection programmes from data", () => {
  it("one entry per division of the current programme, labelled programme short name + division", () => {
    const sel = group(buildAdminNav({ roles: ["admin"], selection: one }), "selection")!;
    expect(sel.items.map((i) => i.text ?? i.key)).toEqual(["Elite League U14", "Elite League U16", "selectionRosters", "selectionTournaments"]);
    expect(sel.items[0].href).toBe(`/admin/selection/${P1}?tab=players&division=${D1}`);
    expect(sel.items.find((i) => i.key === "selectionTournaments")!.href).toBe(`/admin/selection/${P1}?tab=setup#tournaments`);
    expect(sel.items.find((i) => i.key === "selectionRosters")!.href).toBe("/admin/selection");
  });

  it("several programmes: tournaments go to the programme list, same-named divisions are told apart", () => {
    const sel = group(buildAdminNav({ roles: ["admin"], selection: two }), "selection")!;
    const div = sel.items.filter((i) => i.key.startsWith("division:"));
    expect(div).toHaveLength(3);
    expect(new Set(div.map((i) => i.text)).size).toBe(3);
    expect(div.find((i) => i.key === `division:${D2}`)!.text).toBe("Elite League U16");
    expect(sel.items.find((i) => i.key === "selectionTournaments")!.href).toBe("/admin/selection");
  });

  it("no programmes: only the static entries", () => {
    const sel = group(buildAdminNav({ roles: ["admin"], selection: [] }), "selection")!;
    expect(sel.items.map((i) => i.key)).toEqual(["selectionRosters", "selectionTournaments"]);
    expect(tournamentsHref([])).toBe("/admin/selection");
    expect(currentSelectionProgram(null)).toBeNull();
  });

  it("selection payments are named after the one current programme, generic otherwise", () => {
    const pay = (sel: SelectionNavProgram[] | null) =>
      buildAdminNav({ roles: ["admin"], selection: sel }).groups.flatMap((g) => g.items).find((i) => i.key === "selectionPayments")!;
    expect(pay(one)).toMatchObject({ labelKey: "selectionPaymentsFor", labelParams: { name: "Elite League" } });
    expect(pay(two)).toMatchObject({ labelKey: "selectionPayments" });
    expect(pay(two).labelParams).toBeUndefined();
  });
});

describe("admin nav: active entry and group", () => {
  const m = buildAdminNav({ roles: ["admin"], selection: one });

  it("matches the longest path, including sub-pages", () => {
    expect(activeNavKey(m, "/admin/athletes/123")).toBe("athletes");
    expect(activeGroupKey(m, "/admin/athletes/123")).toBe("players");
    expect(activeNavKey(m, "/admin/accounting/exports")).toBe("accountingExports");
    expect(activeNavKey(m, "/admin/accounting/bank")).toBe("accounting");
    expect(activeNavKey(m, "/admin/payment-plans/settings")).toBe("feesPaymentPlans");
    expect(activeNavKey(m, "/admin/payment-plans/abc")).toBe("paymentPlans");
    expect(activeNavKey(m, "/admin/settings/branding")).toBe("clubSettings");
    expect(activeGroupKey(m, "/admin/settings/staff")).toBe("settings");
    expect(activeNavKey(m, "/admin/finance/reports")).toBe("financeOverview");
    expect(activeGroupKey(m, "/admin/finance/club-membership-payments")).toBe("finance");
  });

  it("dashboard is pinned: active, but no group", () => {
    expect(activeNavKey(m, "/admin/dashboard")).toBe("dashboard");
    expect(activeGroupKey(m, "/admin/dashboard")).toBeNull();
  });

  it("division entries only match their own query; the bare programme page falls back to the rosters entry", () => {
    expect(activeNavKey(m, `/admin/selection/${P1}`, params(`tab=players&division=${D2}`))).toBe(`division:${D2}`);
    expect(activeNavKey(m, `/admin/selection/${P1}`, params("tab=players"))).toBe("selectionRosters");
    expect(activeNavKey(m, `/admin/selection/${P1}`, params("tab=setup"))).toBe("selectionTournaments");
    expect(activeGroupKey(m, `/admin/selection/${P1}/players/new`)).toBe("selection");
  });

  it("unknown pages have no active entry or group", () => {
    expect(activeNavKey(m, "/admin/nowhere")).toBeNull();
    expect(activeGroupKey(m, "/admin")).toBeNull();
    expect(activeNavKey(m, "/admin/athletesX")).toBeNull();
  });
});

describe("dashboard shortcuts", () => {
  const base = { month: "2026-11", currentSeasonId: "33333333-3333-4333-8333-333333333333" };

  it("admin gets all five, pointing at the current programme and season", () => {
    const s = buildDashboardShortcuts({ ...base, roles: ["admin"], selection: one });
    expect(s.map((x) => x.key)).toEqual(["findPlayer", "addMembership", "addToRoster", "recordPayment", "monthlyReport"]);
    expect(s.find((x) => x.key === "findPlayer")!.href).toBe("/admin/athletes?focus=search");
    expect(s.find((x) => x.key === "addMembership")!.href).toBe("/admin/memberships/new");
    expect(s.find((x) => x.key === "addToRoster")).toMatchObject({ href: `/admin/selection/${P1}/players/new`, labelParams: { name: "Elite League" } });
    expect(s.find((x) => x.key === "recordPayment")!.href).toBe("/admin/payments/record");
    expect(s.find((x) => x.key === "monthlyReport")!.href)
      .toBe(`/admin/finance/club-membership-payments?season=${base.currentSeasonId}&month=2026-11`);
  });

  it("several or no programmes: the roster shortcut opens the programme list", () => {
    expect(buildDashboardShortcuts({ ...base, roles: ["admin"], selection: two }).find((x) => x.key === "addToRoster"))
      .toEqual({ key: "addToRoster", href: "/admin/selection" });
    expect(buildDashboardShortcuts({ ...base, roles: ["admin"], selection: [] }).find((x) => x.key === "addToRoster")!.href).toBe("/admin/selection");
  });

  it("no current season: the report link carries the month only", () => {
    expect(buildDashboardShortcuts({ month: "2026-11", currentSeasonId: null, roles: ["admin"] }).find((x) => x.key === "monthlyReport")!.href)
      .toBe("/admin/finance/club-membership-payments?month=2026-11");
  });

  it("finance: no roster shortcut; coach/parent: nothing", () => {
    expect(buildDashboardShortcuts({ ...base, roles: ["finance"], selection: one }).map((x) => x.key))
      .toEqual(["findPlayer", "addMembership", "recordPayment", "monthlyReport"]);
    expect(buildDashboardShortcuts({ ...base, roles: ["coach"] })).toEqual([]);
    expect(buildDashboardShortcuts({ ...base, roles: ["parent"] })).toEqual([]);
  });

  it("leaves out shortcuts into hidden or locked modules", () => {
    const s = buildDashboardShortcuts({ ...base, roles: ["admin"], selection: one, locked: ["/admin/memberships"], hidden: ["/admin/finance"] });
    expect(s.map((x) => x.key)).toEqual(["findPlayer", "addToRoster", "recordPayment"]);
  });
});

describe("divisionHref", () => {
  it("encodes the roster filters", () => {
    expect(divisionHref(P1, D1)).toBe(`/admin/selection/${P1}?tab=players&division=${D1}`);
  });
});
