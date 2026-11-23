import { describe, expect, it } from "vitest";
import {
  duplicateDateKeys, expandRecurrence, isPriceOverride, isoWeekday, normalizeDateRows, offeredOptions, optionLabel, orderPayloadSchema,
  orderPricingPreview, packageUsage, toOrderRpcPayload,
} from "@/lib/booking/orders";
import { formatMoney } from "@/lib/format";
import { addPlayer, completeRows, emptyOrderForm, orderFormToPayload, playerDateKeys, togglePlayerDate, withOrderService } from "@/lib/booking/order-form";
import { invoiceByBooking } from "@/lib/booking/portal";

/* Booking orders: pricing preview, option labels, recurrence expansion (mirror of the SQL rules). */

describe("order form", () => {
  const A = "00000000-0000-4000-8000-0000000000a1";
  const B = "00000000-0000-4000-8000-0000000000b2";
  const base = () => {
    let s = emptyOrderForm({ receivedOn: "2027-01-02" });
    s = withOrderService(s, "00000000-0000-4000-8000-000000000001", { kind: "group", coachIds: ["00000000-0000-4000-8000-000000000002"], venueSpaceId: null });
    s = addPlayer(s, { athleteId: A, label: "Synthetic A", familyId: "f1" }, true);
    s = addPlayer(s, { athleteId: B, label: "Synthetic B", familyId: "f2" }, true);
    s = addPlayer(s, { athleteId: A, label: "Synthetic A", familyId: "f1" }, true);
    return { ...s, rows: [{ key: "r2", date: "2027-01-18", time: "10:00" }, { key: "r1", date: "2027-01-11", time: "10:00" }, { key: "r3", date: "2027-01-11", time: "10:00" }] };
  };

  it("keeps players unique, group option and the only eligible coach", () => {
    const s = base();
    expect(s.players.map((p) => p.athleteId)).toEqual([A, B]);
    expect(s.option).toBe("group");
    expect(s.coachId).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("sorted complete rows without duplicate slots; per-player date subsets", () => {
    let s = base();
    const rows = completeRows(s.rows);
    expect(rows.map((r) => r.key)).toEqual(["r1", "r2"]);
    s = togglePlayerDate(s, B, "r2", rows.map((r) => r.key));
    expect(playerDateKeys(s.players[1], rows)).toEqual(["r1"]);
    s = togglePlayerDate(s, B, "r2", rows.map((r) => r.key));
    expect(s.players[1].dates).toBe("all");
  });

  it("payload: club wall time -> UTC, subset dates per player, payer ids", () => {
    let s = base();
    s = togglePlayerDate(s, B, "r2", ["r1", "r2"]);
    const p = orderFormToPayload(s, "Europe/Zurich", new Map([[B, "00000000-0000-4000-8000-0000000000c3"]]))!;
    expect(p.dates).toEqual(["2027-01-11T09:00:00.000Z", "2027-01-18T09:00:00.000Z"]);
    expect(p.participants[0]).toMatchObject({ athleteId: A, payerId: null, dates: null });
    expect(p.participants[1]).toMatchObject({ athleteId: B, payerId: "00000000-0000-4000-8000-0000000000c3", dates: ["2027-01-11T09:00:00.000Z"] });
    expect(p.receivedOn).toBe("2027-01-02");
    expect(orderFormToPayload({ ...s, option: "" }, "Europe/Zurich", new Map())).toBeNull();
  });

  it("a private service keeps one athlete", () => {
    let s = withOrderService(base(), "00000000-0000-4000-8000-000000000009", { kind: "private", coachIds: [], venueSpaceId: null });
    expect(s.players).toHaveLength(1);
    s = addPlayer(s, { athleteId: B, label: "Synthetic B", familyId: "f2" }, false);
    expect(s.players.map((p) => p.athleteId)).toEqual([B]);
  });

  it("portal: every booking of a shared order invoice shows the invoice; a package invoice has no booking", () => {
    const athlete = { id: "a", first_name: "Synthetic", last_name: "A" };
    const inv = { invoice_id: "i1", number: "DL PT-2027-0001", status: "sent", due_date: null, currency: "CHF", total: 60, balance: 60, service_name: "Group" };
    const m = invoiceByBooking([{ athlete, upcoming: [], changes: [], attendance: [],
      invoices: [{ ...inv, booking_id: "b1" }, { ...inv, booking_id: "b2" }, { ...inv, invoice_id: "i2", booking_id: null }] }]);
    expect(m.get("b1")?.invoice_id).toBe("i1");
    expect(m.get("b2")?.invoice_id).toBe("i1");
    expect(m.size).toBe(2);
  });
});

describe("orderPricingPreview (group, per player per session)", () => {
  it("rate 30, 4 players on date 1 = 120, 3 of them also on date 2 -> 210", () => {
    const d1 = "2027-01-11T10:00:00.000Z";
    const d2 = "2027-01-18T10:00:00.000Z";
    const r = orderPricingPreview({
      option: "group", rate: 30,
      players: [
        { athleteId: "a", payerKey: "family:1", dates: [d1, d2] },
        { athleteId: "b", payerKey: "family:2", dates: [d1, d2] },
        { athleteId: "c", payerKey: "family:2", dates: [d1, d2] },
        { athleteId: "d", payerKey: "payer:sponsor", dates: [d1] },
      ],
    });
    expect(r.total).toBe(210);
    expect(r.players.map((p) => p.charge)).toEqual([60, 60, 60, 30]);
    expect(r.sessions).toBe(7);
    expect(r.payers).toEqual([
      { payerKey: "family:1", payerName: null, charge: 60, athletes: 1 },
      { payerKey: "family:2", payerName: null, charge: 120, athletes: 2 },
      { payerKey: "payer:sponsor", payerName: null, charge: 30, athletes: 1 },
    ]);
  });

  it("4 players on one date only = 120; recomputed when a date is removed", () => {
    const d1 = "2027-01-11T10:00:00.000Z";
    const players = ["a", "b", "c", "d"].map((id) => ({ athleteId: id, payerKey: `family:${id}`, dates: [d1] }));
    expect(orderPricingPreview({ option: "group", rate: 30, players }).total).toBe(120);
    expect(orderPricingPreview({ option: "group", rate: 30, players: players.slice(0, 3) }).total).toBe(90);
  });

  it("counts a date once per player and rounds to the currency", () => {
    const d = "2027-01-11T10:00:00.000Z";
    const r = orderPricingPreview({ option: "group", rate: 12.345, players: [{ athleteId: "a", payerKey: "f", dates: [d, d] }] });
    expect(r.players[0]).toEqual({ athleteId: "a", sessions: 1, charge: 12.35 });
  });

  it("single / package: the agreed total once whatever the dates; an existing package charges nothing", () => {
    const players = [{ athleteId: "a", payerKey: "f", dates: ["2027-01-11T10:00:00Z", "2027-01-12T10:00:00Z"] }];
    expect(orderPricingPreview({ option: "package", agreedTotal: 850, players }).total).toBe(850);
    expect(orderPricingPreview({ option: "single", agreedTotal: 95, players: [{ ...players[0], dates: [players[0].dates[0]] }] }).total).toBe(95);
    expect(orderPricingPreview({ option: "existing_package", players }).total).toBe(0);
    expect(orderPricingPreview({ option: "package", agreedTotal: 850, players: [{ ...players[0], dates: [] }] }).total).toBe(850);
  });
});

describe("pricing options", () => {
  const sessions = (n: number) => (n === 1 ? "1 Session" : `${n} Sessions`);
  const chf = (n: number) => formatMoney(n, "CHF", "de-CH");

  it("Personal Training reads 1 Session — CHF 95.00 … 20 Sessions — CHF 1'500.00", () => {
    const options = [{ sessions: 1, total: 95 }, { sessions: 5, total: 450 }, { sessions: 10, total: 850 }, { sessions: 16, total: 1280 }, { sessions: 20, total: 1500 }];
    // The money formatter separates the currency with a no-break space.
    expect(options.map((o) => optionLabel(o, sessions, chf).replace(/\u00a0/g, " "))).toEqual([
      "1 Session — CHF 95.00", "5 Sessions — CHF 450.00", "10 Sessions — CHF 850.00", "16 Sessions — CHF 1'280.00", "20 Sessions — CHF 1'500.00",
    ]);
  });

  it("offers group pricing for groups, packages only for package services", () => {
    expect(offeredOptions("group")).toEqual(["group"]);
    expect(offeredOptions("package")).toEqual(["package", "existing_package"]);
    expect(offeredOptions("private")).toEqual(["single", "package", "existing_package"]);
  });

  it("flags an agreed price that differs from the catalogue", () => {
    expect(isPriceOverride(850, 850)).toBe(false);
    expect(isPriceOverride(800, 850)).toBe(true);
    expect(isPriceOverride(null, 850)).toBe(false);
    expect(isPriceOverride(30, null)).toBe(true);
  });

  it("package usage: booked / completed / available", () => {
    expect(packageUsage({ sessions: 10, sessions_used: 3, booked: 2, completed: 1 })).toEqual({ total: 10, booked: 2, completed: 1, available: 7 });
  });
});

describe("expandRecurrence", () => {
  it("weekly on Monday and Wednesday until a date (inclusive)", () => {
    // 2027-01-04 is a Monday.
    expect(isoWeekday("2027-01-04")).toBe(1);
    const rows = expandRecurrence({ from: "2027-01-04", weekdays: [1, 3], until: "2027-01-18", time: "17:00" });
    expect(rows.map((r) => r.date)).toEqual(["2027-01-04", "2027-01-06", "2027-01-11", "2027-01-13", "2027-01-18"]);
    expect(rows.every((r) => r.time === "17:00" && r.key === `${r.date}T17:00`)).toBe(true);
  });

  it("a count of dates, starting mid-week", () => {
    const rows = expandRecurrence({ from: "2027-01-06", weekdays: [1], count: 3, time: "09:30" });
    expect(rows.map((r) => r.date)).toEqual(["2027-01-11", "2027-01-18", "2027-01-25"]);
  });

  it("Sunday is 7; crosses month and year ends", () => {
    const rows = expandRecurrence({ from: "2026-12-27", weekdays: [7], count: 2, time: "10:00" });
    expect(rows.map((r) => r.date)).toEqual(["2026-12-27", "2027-01-03"]);
  });

  it("caps at the max and refuses invalid rules", () => {
    expect(expandRecurrence({ from: "2027-01-04", weekdays: [1, 2, 3, 4, 5, 6, 7], count: 500, time: "10:00" })).toHaveLength(60);
    expect(expandRecurrence({ from: "2027-01-04", weekdays: [], count: 3, time: "10:00" })).toEqual([]);
    expect(expandRecurrence({ from: "2027-01-04", weekdays: [1], time: "10:00" })).toEqual([]);
    expect(expandRecurrence({ from: "2027-01-04", weekdays: [1], until: "2027-01-01", time: "10:00" })).toEqual([]);
    expect(expandRecurrence({ from: "bad", weekdays: [1], count: 2, time: "10:00" })).toEqual([]);
  });
});

describe("date rows", () => {
  it("normalizes (sorted, unique, complete) and finds duplicates", () => {
    const rows = [
      { key: "x", date: "2027-01-11", time: "10:00" }, { key: "y", date: "2027-01-04", time: "10:00" },
      { key: "z", date: "2027-01-11", time: "10:00" }, { key: "w", date: "", time: "10:00" },
    ];
    expect(normalizeDateRows(rows).map((r) => r.key)).toEqual(["2027-01-04T10:00", "2027-01-11T10:00"]);
    expect([...duplicateDateKeys(rows)]).toEqual(["2027-01-11T10:00"]);
  });
});

describe("order payload", () => {
  it("maps to the RPC JSON (ISO dates, per-player subsets, no empty fields)", () => {
    const p = orderPayloadSchema.parse({
      serviceId: "00000000-0000-4000-8000-000000000001", option: "group", agreedRate: "30",
      coachId: "00000000-0000-4000-8000-000000000002", dates: ["2027-01-11T10:00:00Z"],
      participants: [{ athleteId: "00000000-0000-4000-8000-000000000003" },
                     { athleteId: "00000000-0000-4000-8000-000000000004", dates: ["2027-01-11T10:00:00Z"] }],
      description: "  ", receivedOn: "2027-01-02",
    });
    const j = toOrderRpcPayload(p);
    expect(j).toMatchObject({ option: "group", agreed_rate: 30, received_on: "2027-01-02", dates: ["2027-01-11T10:00:00.000Z"], notify: true });
    expect(j).not.toHaveProperty("description");
    expect((j.participants as Record<string, unknown>[])[0]).toEqual({ athlete_id: "00000000-0000-4000-8000-000000000003" });
    expect((j.participants as Record<string, unknown>[])[1]).toHaveProperty("dates", ["2027-01-11T10:00:00.000Z"]);
  });

  it("refuses an order without players", () => {
    expect(orderPayloadSchema.safeParse({ serviceId: "00000000-0000-4000-8000-000000000001", option: "single", dates: [], participants: [] }).success).toBe(false);
  });
});
