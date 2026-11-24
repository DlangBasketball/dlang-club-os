import { describe, expect, it } from "vitest";
import {
  ALL_ATHLETES, acceptsAdults, encodeActiveAthleteCookie, filterByAthlete, parseActiveAthleteCookie, preselectAthlete,
  resolveActiveAthlete, resolveAthleteFilter,
} from "@/lib/participants/active-athlete";
import { athleteNextSteps } from "@/lib/participants/next-steps";
import { myAthletesLabel } from "@/lib/tenant/terms";
import { normalizeTerminology } from "@/lib/tenant/terms";
import { approvalErrorKey } from "@/lib/approvals/errors";
import { canSeeFlag, decidedInPanel, flagGroup, flagHref } from "@/lib/attendance/review-flags";
import { parseProfileTab } from "@/lib/billing/player-billing";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const K1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const K2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const FOREIGN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

describe("active athlete cookie", () => {
  it("round-trips user, club and athlete", () => {
    const raw = encodeActiveAthleteCookie({ userId: USER, orgId: ORG, athleteId: K1 });
    expect(parseActiveAthleteCookie(raw)).toEqual({ userId: USER, orgId: ORG, athleteId: K1 });
    expect(parseActiveAthleteCookie(encodeActiveAthleteCookie({ userId: USER, orgId: ORG, athleteId: ALL_ATHLETES }))?.athleteId).toBe(ALL_ATHLETES);
  });

  it("rejects malformed values", () => {
    for (const raw of [undefined, null, "", "x", `${USER}.${ORG}`, `${USER}.${ORG}.not-a-uuid`, `${USER}.${ORG}.${K1}.extra`, "a".repeat(300)]) {
      expect(parseActiveAthleteCookie(raw)).toBeNull();
    }
  });

  it("accepts only an authorised athlete of the same user and club", () => {
    const cookie = encodeActiveAthleteCookie({ userId: USER, orgId: ORG, athleteId: K2 });
    expect(resolveActiveAthlete({ cookie, userId: USER, orgId: ORG, authorisedIds: [K1, K2] })).toBe(K2);
    // another family's / stale athlete id
    expect(resolveActiveAthlete({ cookie: encodeActiveAthleteCookie({ userId: USER, orgId: ORG, athleteId: FOREIGN }), userId: USER, orgId: ORG, authorisedIds: [K1, K2] })).toBeNull();
    // cookie of another club or another login on the same browser
    expect(resolveActiveAthlete({ cookie, userId: USER, orgId: OTHER_ORG, authorisedIds: [K1, K2] })).toBeNull();
    expect(resolveActiveAthlete({ cookie, userId: "44444444-4444-4444-8444-444444444444", orgId: ORG, authorisedIds: [K1, K2] })).toBeNull();
    // the athlete is no longer managed by the adult
    expect(resolveActiveAthlete({ cookie, userId: USER, orgId: ORG, authorisedIds: [K1] })).toBeNull();
    expect(resolveActiveAthlete({ cookie: encodeActiveAthleteCookie({ userId: USER, orgId: ORG, athleteId: ALL_ATHLETES }), userId: USER, orgId: ORG, authorisedIds: [K1] })).toBe(ALL_ATHLETES);
  });
});

describe("athlete filter of a page", () => {
  const ids = [K1, K2];
  it("explicit param wins, then the active athlete, then all / first", () => {
    expect(resolveAthleteFilter({ param: K2, active: K1, authorisedIds: ids, allowAll: true })).toEqual({ mode: "one", athleteId: K2 });
    expect(resolveAthleteFilter({ param: null, active: K1, authorisedIds: ids, allowAll: true })).toEqual({ mode: "one", athleteId: K1 });
    expect(resolveAthleteFilter({ param: "all", active: K1, authorisedIds: ids, allowAll: true })).toEqual({ mode: "all" });
    expect(resolveAthleteFilter({ param: null, active: null, authorisedIds: ids, allowAll: true })).toEqual({ mode: "all" });
    expect(resolveAthleteFilter({ param: null, active: null, authorisedIds: ids, allowAll: false })).toEqual({ mode: "one", athleteId: K1 });
    expect(resolveAthleteFilter({ param: null, active: ALL_ATHLETES, authorisedIds: ids, allowAll: false })).toEqual({ mode: "one", athleteId: K1 });
  });

  it("ignores foreign ids in the URL", () => {
    expect(resolveAthleteFilter({ param: FOREIGN, active: K2, authorisedIds: ids, allowAll: true })).toEqual({ mode: "one", athleteId: K2 });
    expect(resolveAthleteFilter({ param: [FOREIGN], active: null, authorisedIds: ids, allowAll: true })).toEqual({ mode: "all" });
  });

  it("filters rows and preselects only valid choices", () => {
    const rows = [{ a: K1 }, { a: K2 }, { a: null }];
    expect(filterByAthlete(rows, { mode: "one", athleteId: K2 }, (r) => r.a)).toEqual([{ a: K2 }]);
    expect(filterByAthlete(rows, { mode: "all" }, (r) => r.a)).toHaveLength(3);
    expect(preselectAthlete(K2, ids)).toBe(K2);
    expect(preselectAthlete(FOREIGN, ids)).toBeNull();
    expect(preselectAthlete(ALL_ATHLETES, ids)).toBeNull();
  });

  it("offers Myself only when the activity accepts adults", () => {
    expect(acceptsAdults(null)).toBe(true);
    expect(acceptsAdults(25)).toBe(true);
    expect(acceptsAdults(18)).toBe(true);
    expect(acceptsAdults(14)).toBe(false);
  });
});

describe("My Athletes next steps", () => {
  it("lists open steps, most urgent first, never confirmed ones", () => {
    const steps = athleteNextSteps({
      requests: [{ name: "U14", status: "info_requested" }],
      programmes: [{ name: "Clinic", status: "pending", balance: 120 }, { name: "Team", status: "confirmed", balance: 0 }],
      memberships: [{ name: "Player", status: "pending_payment", balance: 200 }],
    });
    expect(steps.map((s) => s.step)).toEqual(["information_requested", "awaiting_payment", "awaiting_payment"]);
    expect(steps.map((s) => s.label)).toEqual(["U14", "Clinic", "Player"]);
  });
});

describe("terminology", () => {
  it("uses the translated label unless the club renamed athletes", () => {
    const tpl = (term: string) => `My ${term}`;
    expect(myAthletesLabel(normalizeTerminology({}), "Mes athlètes", tpl)).toBe("Mes athlètes");
    expect(myAthletesLabel(normalizeTerminology({ athlete: { one: "Player", other: "Players" } }), "My athletes", tpl)).toBe("My Players");
  });
});

describe("club request profile errors + data review", () => {
  it("maps proposal validation codes to the participant catalog", () => {
    expect(approvalErrorKey("FIELD_NOT_ALLOWED")).toBe("participants.errors.FIELD_NOT_ALLOWED");
    expect(approvalErrorKey("INVALID_HEIGHT")).toBe("participants.errors.INVALID_HEIGHT");
    expect(approvalErrorKey("MESSAGE_TOO_LONG")).toBe("approvals.errors.MESSAGE_TOO_LONG");
  });

  it("POSSIBLE_SELF_LINK is an admin-only people flag decided in its panel", () => {
    expect(flagGroup("POSSIBLE_SELF_LINK")).toBe("people");
    expect(canSeeFlag("POSSIBLE_SELF_LINK", { admin: false, finance: true })).toBe(false);
    expect(decidedInPanel("POSSIBLE_SELF_LINK")).toBe(true);
    expect(flagHref({ entityTable: "athletes", entityId: K1, reasonCode: "POSSIBLE_SELF_LINK", details: {} })).toBe(`/admin/athletes/${K1}`);
  });

  it("the profile history tab is addressable", () => {
    expect(parseProfileTab("history")).toBe("history");
  });
});
