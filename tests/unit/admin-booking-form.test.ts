import { describe, expect, it } from "vitest";
import {
  DRAFT_KEY, DRAFT_MAX_AGE_MS, RequestIds, buildPayerOptions, clearDraft, emptyBookingForm, formToPayload, isDirty, loadDraft, payerKey,
  quoteKey, resolvePayer, saveDraft, slotInstant, withAthlete, withService, type PayerCandidates,
} from "@/lib/booking/admin-form";
import { bookingPayloadSchema } from "@/lib/booking/types";

/* Synthetic ids only (no personal data). */
const ATH = "00000000-0000-4000-8000-0000000000a1";
const SIB = "00000000-0000-4000-8000-0000000000a2";
const FAM = "00000000-0000-4000-8000-0000000000f1";
const SVC = "00000000-0000-4000-8000-0000000000b1";
const COACH = "00000000-0000-4000-8000-0000000000c1";
const SESS = "00000000-0000-4000-8000-0000000000d1";
const P1 = "00000000-0000-4000-8000-0000000000e1";
const P2 = "00000000-0000-4000-8000-0000000000e2";
const G1 = "00000000-0000-4000-8000-000000000091";
const G2 = "00000000-0000-4000-8000-000000000092";
const ORG_A = "org-a";
const ORG_B = "org-b";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

const filled = () => emptyBookingForm({
  athleteId: ATH, athleteLabel: "Test Athlete", athleteFamilyId: FAM, serviceId: SVC, coachId: COACH, date: "2026-12-07", time: "10:00",
  notes: "Bring a ball", payer: { type: "new", kind: "sponsor" },
  newPayer: { name: "Sponsor AG", email: "billing@example.test", phone: "", street: "Rue 1", postalCode: "1000", city: "Lausanne", country: "CH" },
  quickOpen: true, quick: { ...emptyBookingForm().quick, firstName: "New", lastName: "Kid", dob: "2015-03-01" },
});

describe("booking form draft (save / restore)", () => {
  it("restores every field, including the open add-athlete panel", () => {
    const st = memoryStorage();
    const s = filled();
    saveDraft(st, ORG_A, s, 1_000);
    const back = loadDraft(st, ORG_A, 2_000);
    expect(back).toEqual(s);
    expect(back?.quickOpen).toBe(true);
    expect(back?.quick.firstName).toBe("New");
  });

  it("never opens another club's draft", () => {
    const st = memoryStorage();
    saveDraft(st, ORG_A, filled(), 1_000);
    expect(loadDraft(st, ORG_B, 2_000)).toBeNull();
  });

  it("drops stale or malformed drafts and fills new fields with defaults", () => {
    const st = memoryStorage();
    saveDraft(st, ORG_A, filled(), 0);
    expect(loadDraft(st, ORG_A, DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(st.raw.has(DRAFT_KEY)).toBe(false);

    st.setItem(DRAFT_KEY, "{not json");
    expect(loadDraft(st, ORG_A)).toBeNull();

    // An older draft without some fields: merged onto an empty form; a bad payer choice falls back to the family.
    st.setItem(DRAFT_KEY, JSON.stringify({ v: 1, savedAt: 10, scope: ORG_A, state: { athleteId: ATH, payer: { type: "payer" }, quick: { firstName: "X" } } }));
    const merged = loadDraft(st, ORG_A, 20)!;
    expect(merged.athleteId).toBe(ATH);
    expect(merged.payer).toEqual({ type: "family" });
    expect(merged.quick.firstName).toBe("X");
    expect(merged.quick.guardianMode).toBe("existing");
    expect(merged.notify).toBe(true);
  });

  it("clears after confirm and tolerates missing / failing storage", () => {
    const st = memoryStorage();
    saveDraft(st, ORG_A, filled());
    clearDraft(st);
    expect(loadDraft(st, ORG_A)).toBeNull();
    expect(() => saveDraft(null, ORG_A, filled())).not.toThrow();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("x"); } };
    expect(() => saveDraft(broken, ORG_A, filled())).not.toThrow();
    expect(loadDraft(broken, ORG_A)).toBeNull();
    expect(() => clearDraft(broken)).not.toThrow();
  });

  it("isDirty ignores an untouched form", () => {
    expect(isDirty(emptyBookingForm({ date: "2026-12-07" }))).toBe(false);
    expect(isDirty(filled())).toBe(true);
  });

  it("selecting the athlete created in the panel keeps every other field", () => {
    const s = { ...filled(), athleteId: "", athleteLabel: "", payer: { type: "family" as const } };
    const next = withAthlete(s, SIB, "New Kid", FAM);
    expect(next.athleteId).toBe(SIB);
    expect(next.athleteFamilyId).toBe(FAM);
    expect(next.quickOpen).toBe(false);
    expect(next.quick.firstName).toBe("");
    for (const k of ["serviceId", "coachId", "date", "time", "notes", "newPayer"] as const) expect(next[k]).toEqual(s[k]);
  });

  it("a different athlete resets the payer (payers belong to the family); the same athlete keeps it", () => {
    const s = { ...filled(), payer: { type: "payer" as const, payerId: P1 } };
    expect(withAthlete(s, SIB, "Other").payer).toEqual({ type: "family" });
    expect(withAthlete(s, ATH, "Test Athlete").payer).toEqual({ type: "payer", payerId: P1 });
  });

  it("a different service keeps an eligible coach and resets the joined session", () => {
    const s = { ...filled(), slotMode: "join" as const, sessionId: SESS };
    const same = withService(s, "00000000-0000-4000-8000-0000000000b2", { coachIds: [COACH], venueSpaceId: null });
    expect(same.coachId).toBe(COACH);
    expect(same.sessionId).toBe("");
    expect(same.slotMode).toBe("new");
    expect(withService(s, "00000000-0000-4000-8000-0000000000b2", { coachIds: [], venueSpaceId: null }).coachId).toBe("");
  });
});

describe("quote -> confirm request id", () => {
  it("keeps one id per intent until it succeeds (double click / retry / refusal replay the same id)", () => {
    let n = 0;
    const ids = new RequestIds(() => `id-${++n}`);
    const first = ids.get("confirm");
    expect(ids.get("confirm")).toBe(first); // double click
    expect(ids.get("confirm")).toBe(first); // retry after a refusal (nothing stored server side)
    expect(ids.get("payer")).not.toBe(first); // another intent has its own id
    ids.settle("confirm");
    expect(ids.get("confirm")).not.toBe(first); // a new booking is a new intent
  });

  it("uses real uuids by default", () => {
    expect(new RequestIds().get("confirm")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("quote and confirm send the same payload; the quote key changes only with the inputs", () => {
    const s = { ...filled(), payer: { type: "family" as const } };
    const p = formToPayload(s, "Europe/Zurich", null)!;
    expect(bookingPayloadSchema.safeParse(p).success).toBe(true);
    // 10:00 in Zurich in December = 09:00 UTC.
    expect(p.startsAt).toBe("2026-12-07T09:00:00.000Z");
    expect(quoteKey(formToPayload(s, "Europe/Zurich", null))).toBe(quoteKey(p));
    expect(quoteKey(formToPayload({ ...s, time: "11:00" }, "Europe/Zurich", null))).not.toBe(quoteKey(p));
  });

  it("joins an existing session without coach / time, and refuses an incomplete slot", () => {
    const s = { ...filled(), slotMode: "join" as const, sessionId: SESS };
    const p = formToPayload(s, "Europe/Zurich", P1)!;
    expect(p.sessionId).toBe(SESS);
    expect(p.startsAt).toBeNull();
    expect(p.coachId).toBeNull();
    expect(p.payerId).toBe(P1);
    expect(formToPayload({ ...filled(), time: "" }, "Europe/Zurich", null)).toBeNull();
    expect(formToPayload({ ...filled(), athleteId: "" }, "Europe/Zurich", null)).toBeNull();
  });

  it("sends a price override only with the checkbox, and the availability reason only with the override", () => {
    const s = { ...filled(), price: "80", priceReason: "loyalty", overrideReason: "ok" };
    expect(formToPayload(s, "Europe/Zurich", null)!.price).toBeNull();
    const o = formToPayload({ ...s, priceOverride: true, overrideAvailability: true }, "Europe/Zurich", null)!;
    expect(o.price).toBe(80);
    expect(o.priceReason).toBe("loyalty");
    expect(o.overrideReason).toBe("ok");
    expect(formToPayload(s, "Europe/Zurich", null)!.overrideReason).toBeNull();
  });

  it("converts wall time in the club zone across DST", () => {
    expect(slotInstant("2026-07-01", "10:00", "Europe/Zurich")).toBe("2026-07-01T08:00:00.000Z");
    expect(slotInstant("2026-07-01", "", "Europe/Zurich")).toBeNull();
  });
});

describe("Bill To (payer selection)", () => {
  const cands: PayerCandidates = {
    payers: [
      { id: P1, kind: "sponsor", name: "Sponsor AG", email: "billing@example.test", athlete_id: null },
      // a sibling's saved payer is offered too (same family)
      { id: P2, kind: "athlete", name: "Sibling", email: null, athlete_id: SIB },
    ],
    guardians: [
      { profile_id: G1, full_name: "Guardian One", email: "g1@example.test", payer_id: P1 },
      { profile_id: G2, full_name: "Guardian Two", email: "g2@example.test", payer_id: null },
    ],
    family_default: { name: "Family Contact", email: "family@example.test" },
  };
  const athlete = { id: ATH, name: "Test Athlete", familyId: FAM };

  it("offers the family default, saved payers (incl. siblings'), guardians once, and the athlete", () => {
    const opts = buildPayerOptions(cands, athlete);
    expect(opts.map((o) => o.key)).toEqual(["family", `payer:${P1}`, `payer:${P2}`, `guardian:${G2}`, "athlete"]);
    expect(opts[0].label).toBe("Family Contact");
    // guardian with an existing payer record is not listed twice
    expect(opts.filter((o) => o.key === `payer:${P1}`)).toHaveLength(1);
  });

  it("does not offer the athlete again when they already have a payer record", () => {
    const own: PayerCandidates = { ...cands, payers: [...cands.payers, { id: "p-own", kind: "athlete", name: "Test Athlete", email: null, athlete_id: ATH }] };
    expect(buildPayerOptions(own, athlete).some((o) => o.key === "athlete")).toBe(false);
    expect(resolvePayer({ type: "athlete" }, own, athlete, emptyBookingForm().newPayer)).toEqual({ kind: "ready", payerId: "p-own" });
  });

  it("resolves existing choices to an id and the rest to a payer to create", () => {
    const f = emptyBookingForm().newPayer;
    expect(resolvePayer({ type: "family" }, cands, athlete, f)).toEqual({ kind: "ready", payerId: null });
    expect(resolvePayer({ type: "payer", payerId: P2 }, cands, athlete, f)).toEqual({ kind: "ready", payerId: P2 });
    expect(resolvePayer({ type: "payer", payerId: "unknown" }, cands, athlete, f)).toEqual({ kind: "invalid", reason: "PAYER_NOT_FOUND" });
    expect(resolvePayer({ type: "guardian", profileId: G1 }, cands, athlete, f)).toEqual({ kind: "ready", payerId: P1 });
    const g2 = resolvePayer({ type: "guardian", profileId: G2 }, cands, athlete, f);
    expect(g2).toMatchObject({ kind: "create", payer: { kind: "guardian", profileId: G2, familyId: FAM, name: "Guardian Two" } });
    expect(resolvePayer({ type: "athlete" }, cands, athlete, f)).toMatchObject({ kind: "create", payer: { kind: "athlete", athleteId: ATH, familyId: FAM } });
  });

  it("a new sponsor needs a name and carries the billing address, not the family", () => {
    expect(resolvePayer({ type: "new", kind: "sponsor" }, cands, athlete, emptyBookingForm().newPayer)).toEqual({ kind: "invalid", reason: "PAYER_NAME_REQUIRED" });
    const r = resolvePayer({ type: "new", kind: "sponsor" }, cands, athlete, filled().newPayer);
    expect(r).toMatchObject({ kind: "create", payer: { kind: "sponsor", name: "Sponsor AG", city: "Lausanne", postalCode: "1000", country: "CH", familyId: null } });
  });

  it("payer keys are stable for the radio list", () => {
    expect(payerKey({ type: "payer", payerId: P1 })).toBe(`payer:${P1}`);
    expect(payerKey({ type: "new", kind: "other" })).toBe("new:other");
    expect(payerKey({ type: "family" })).toBe("family");
  });
});
