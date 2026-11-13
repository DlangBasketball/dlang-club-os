import { describe, expect, it } from "vitest";
import { pickAlertRecipients } from "@/lib/data/alert-recipients";

const ORG_A = "00000000-0000-0000-0000-000000000001";
const ORG_B = "10000000-0000-0000-0000-000000000002";

describe("pickAlertRecipients", () => {
  it("uses the club's own notification_email when set", () => {
    expect(pickAlertRecipients(ORG_A, { notification_email: " office@club-a.test " }, [
      { email: "admin@club-a.test", org_id: ORG_A, is_active: true },
    ])).toEqual(["office@club-a.test"]);
  });

  it("falls back to the club's active admins only", () => {
    expect(pickAlertRecipients(ORG_A, { notification_email: "not-an-email" }, [
      { email: "admin@club-a.test", org_id: ORG_A, is_active: true },
      { email: "admin@club-a.test", org_id: ORG_A, is_active: true },
      { email: "former@club-a.test", org_id: ORG_A, is_active: false },
      { email: "admin@club-b.test", org_id: ORG_B, is_active: true },
      { email: "deleted-x@deleted.invalid", org_id: ORG_A, is_active: null },
      { email: null, org_id: ORG_A, is_active: true },
    ])).toEqual(["admin@club-a.test"]);
  });

  it("returns nobody rather than a shared inbox when the club has no admin", () => {
    expect(pickAlertRecipients(ORG_A, null, [])).toEqual([]);
  });
});
