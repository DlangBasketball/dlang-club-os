import { describe, expect, it } from "vitest";
import { applyBillingEntity, resolveQrBillAccount, type PaymentSettings } from "@/lib/swiss-payments";
import { openByActivity, openByFamilyActivity, openInvoices } from "@/lib/payments/open-invoices";
import {
  BILLING_ACTIVITIES, MANUAL_INVOICE_CATEGORIES, SELECTABLE_CATEGORIES, billingErrorCode, categoryLabelKey, isBillingActivity,
} from "@/lib/billing/activities";

const club: PaymentSettings = {
  creditorName: "Synthetic Club", creditorStreet: "Rue A", creditorBuilding: "1", creditorZip: "1000", creditorCity: "Lausanne",
  creditorCountry: "CH", iban: "CH9300762011623852957", qrIban: "CH4431999123000889012", twintNumber: "", referenceType: "QRR", referencePrefix: "21",
};

describe("issuing entity on the QR-bill (applyBillingEntity)", () => {
  it("keeps today's settings without a snapshot", () => {
    expect(applyBillingEntity(club, null)).toEqual(club);
    expect(applyBillingEntity(club, "nope")).toEqual(club);
  });

  it("uses the entity's legal name, address and accounts as blocks", () => {
    const s = applyBillingEntity(club, {
      name: "Academy", legal_name: "Synthetic Academy SA", street: "Chemin B", building_number: "2", postal_code: "1200",
      city: "Genève", country: "ch", iban: "CH5604835012345678009", qr_iban: null,
    });
    expect(s.creditorName).toBe("Synthetic Academy SA");
    expect([s.creditorStreet, s.creditorBuilding, s.creditorZip, s.creditorCity, s.creditorCountry]).toEqual(["Chemin B", "2", "1200", "Genève", "CH"]);
    // The entity's account replaces both club accounts: never mix one entity's address with another's QR-IBAN.
    expect(s.iban).toBe("CH5604835012345678009");
    expect(s.qrIban).toBe("");
    expect(resolveQrBillAccount(s, "210000000003139471430009017")).toBeNull();
    expect(s.twintNumber).toBe(club.twintNumber);
  });

  it("keeps the club's account when the entity has none", () => {
    const s = applyBillingEntity(club, { name: "Academy" });
    expect(s.creditorName).toBe("Academy");
    expect(s.iban).toBe(club.iban);
    expect(s.qrIban).toBe(club.qrIban);
  });
});

describe("open balances per revenue category", () => {
  const rows = [
    { id: "a", familyId: "f1", status: "sent", dueDate: null, currency: "CHF", total: 1000, adjustmentsTotal: 0, activity: "club_membership" },
    { id: "b", familyId: "f1", status: "partially_paid", dueDate: null, currency: "CHF", total: 3000, adjustmentsTotal: 0, activity: "selection" },
    { id: "c", familyId: "f2", status: "overdue", dueDate: null, currency: "CHF", total: 200, adjustmentsTotal: -50, activity: "selection" },
    { id: "d", familyId: "f2", status: "sent", dueDate: null, currency: "CHF", total: 75, adjustmentsTotal: 0 },
    { id: "e", familyId: "f1", status: "paid", dueDate: null, currency: "CHF", total: 10, adjustmentsTotal: 0, activity: "shop" },
  ];
  const pays = new Map([["b", [{ amount: 500, status: "succeeded" }]]]);
  const open = openInvoices(rows, pays);

  it("carries the activity (legacy rows count as other)", () => {
    expect(open.map((o) => [o.id, o.activity])).toEqual([["a", "club_membership"], ["b", "selection"], ["c", "selection"], ["d", "other"]]);
  });

  it("never merges club and selection money", () => {
    expect(openByActivity(open)).toEqual({
      club_membership: { count: 1, totals: { CHF: 1000 } },
      selection: { count: 2, totals: { CHF: 2650 } },
      other: { count: 1, totals: { CHF: 75 } },
    });
    const fam = openByFamilyActivity(open);
    expect(fam.get("f1")).toEqual({ club_membership: { count: 1, totals: { CHF: 1000 } }, selection: { count: 1, totals: { CHF: 2500 } } });
    expect(fam.get("f2")?.selection).toEqual({ count: 1, totals: { CHF: 150 } });
  });
});

describe("category constants and error codes", () => {
  it("'other' is legacy only", () => {
    expect(BILLING_ACTIVITIES).toContain("other");
    expect(SELECTABLE_CATEGORIES).not.toContain("other" as never);
    expect(MANUAL_INVOICE_CATEGORIES).not.toContain("club_membership" as never);
    expect(BILLING_ACTIVITIES).not.toContain("booking" as never);
    expect(isBillingActivity("training")).toBe(true);
    expect(isBillingActivity("booking")).toBe(false);
    expect(categoryLabelKey("selection")).toBe("billing.activities.selection");
    expect(categoryLabelKey("nonsense")).toBe("billing.activities.other");
  });

  it("maps SQL errors to codes", () => {
    expect(billingErrorCode("ACTIVITY_MISMATCH: the credit belongs to another activity")).toBe("ACTIVITY_MISMATCH");
    expect(billingErrorCode("NUMBER_LOCKED: the number of an issued invoice cannot change")).toBe("NUMBER_LOCKED");
    expect(billingErrorCode("ERROR: ALLOCATION_EXCEEDS_RECEIPT")).toBe("ALLOCATION_EXCEEDS_RECEIPT");
    expect(billingErrorCode("something else")).toBeNull();
  });
});
