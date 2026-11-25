import { describe, expect, it } from "vitest";
import { DEFAULT_CHILD_LINK, isInviteToken, participantErrorCode, relativeInviteSchema } from "@/lib/participants/validation";
import { addLinked, type LinkedRecipient } from "@/lib/notifications/linked";
import { portalPathFor } from "@/lib/booking/dispatch-core";
import { render } from "@/lib/notifications/templates";
import { isReservedPath } from "@/lib/site/paths";

// Relatives for one child (migration 20250420106500). Synthetic data only.
describe("relative invitation input", () => {
  it("normalises the e-mail and keeps the per-child defaults", () => {
    const p = relativeInviteSchema.parse({ email: "  Synthetic.Aunt@Example.TEST ", permissions: {} });
    expect(p.email).toBe("synthetic.aunt@example.test");
    expect(p.permissions).toEqual(DEFAULT_CHILD_LINK);
    expect(p.permissions.canConsent).toBe(false);
  });
  it("refuses an invalid e-mail and booking without paying", () => {
    expect(relativeInviteSchema.safeParse({ email: "nope", permissions: {} }).success).toBe(false);
    expect(relativeInviteSchema.safeParse({ email: "a@example.test", permissions: { canRegister: true, canPay: false } }).success).toBe(false);
  });
  it("recognises the token shape (32 random bytes, base64url)", () => {
    expect(isInviteToken("A".repeat(43))).toBe(true);
    expect(isInviteToken("A".repeat(42))).toBe(false);
    expect(isInviteToken("../" + "A".repeat(40))).toBe(false);
  });
  it("maps the new database error codes", () => {
    for (const c of ["EMAIL_MISMATCH", "INVITE_LIMIT", "RATE_LIMITED", "ALREADY_GUARDIAN", "CARER_CONSENT_DISABLED", "INVITE_USED"]) {
      expect(participantErrorCode(`ERROR: ${c}`)).toBe(c);
    }
  });
  it("reserves the invitation path on club websites", () => {
    expect(isReservedPath("/link-invite/abc")).toBe(true);
  });
});

describe("linked recipients", () => {
  const l = (profileId: string): LinkedRecipient => ({ athleteId: "k1", profileId, email: null, name: null });
  it("adds linked relatives once (a guardian who is also linked gets one copy)", () => {
    expect(addLinked(["g1", "g2"], [l("g2"), l("r1"), l("r1")])).toEqual(["g1", "g2", "r1"]);
    expect(addLinked([], [])).toEqual([]);
  });
  it("booking notices to a linked relative open the bookings list", () => {
    expect(portalPathFor("linked", true, "b1")).toBe("/parent/bookings");
    expect(portalPathFor("linked", false, "b1")).toBeUndefined();
  });
});

describe("invitation e-mail", () => {
  it("names the child (first name), the inviter and the relation, links the token page", () => {
    const r = render("relative_invitation", {
      athlete_name: "Synthkid", booker_name: "Synthetic Parent", relation: "grandparent",
      portal_path: "/link-invite/" + "A".repeat(43), expires_at: "2030-01-15T10:00:00Z", club_name: "Synthetic Club",
    }, { baseUrl: "https://club.example.test" });
    expect(r.subject).toContain("Synthkid");
    expect(r.html).toContain("Synthetic Parent");
    expect(r.html).toContain("Grandparent");
    expect(r.html).toContain("/link-invite/");
    expect(r.html).not.toMatch(/\{(child|inviter|relation)\}/);
  });
});
