import { describe, expect, it } from "vitest";
import {
  adminRegistrationAlert,
  bookingConfirmation,
  coachBookingAlert,
  invoiceIssued,
  overdueReminder,
  paymentReceived,
  registrationConfirmation,
} from "@/lib/email/templates";

const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/[’']/g, "'");

describe("transactional email templates", () => {
  it("registration confirmation lists every child and pluralises", () => {
    const one = registrationConfirmation({ parentName: "Carla", programName: "Summer Camp W1", children: ["Mateo Lopes"], invoiceNumber: "INV-2026-0001", totalChf: 490, dueDateLabel: "30.06.2026", manageUrl: "https://x.test/m" });
    expect(one.subject).toBe("Registration received — Summer Camp W1 (INV-2026-0001)");
    expect(one.html).toContain(">Participant<");
    expect(norm(one.html)).toContain("CHF 490.00");
    const two = registrationConfirmation({ parentName: "Carla", programName: "P", children: ["A", "B"], invoiceNumber: "I", totalChf: 1, dueDateLabel: "d", manageUrl: "u" });
    expect(two.html).toContain(">Participants<");
    expect(two.html.match(/<li /g)).toHaveLength(2);
  });

  it("invoice and overdue emails carry number, amount and pay link", () => {
    const d = { parentName: "Carla", invoiceNumber: "INV-2026-0211", description: null, totalChf: 1490, dueDateLabel: "30.04.2026", payUrl: "https://x.test/pay" };
    const inv = invoiceIssued(d);
    expect(norm(inv.subject)).toBe("Invoice INV-2026-0211 — CHF 1'490.00");
    expect(inv.html).toContain("https://x.test/pay");
    const od = overdueReminder(d);
    expect(od.subject).toBe("Reminder: invoice INV-2026-0211 is overdue");
    expect(od.html).toContain("Was due 30.04.2026");
  });

  it("optional invoice description is omitted when null", () => {
    const base = { parentName: "C", invoiceNumber: "I", totalChf: 1, dueDateLabel: "d", payUrl: "u" };
    expect(invoiceIssued({ ...base, description: null }).html).not.toContain("color:#B8B8B8");
    expect(invoiceIssued({ ...base, description: "Camp fee" }).html).toContain("Camp fee");
  });

  it("payment receipt shows amount and remaining balance", () => {
    const r = paymentReceived({ parentName: "C", invoiceNumber: "I-1", amountChf: 100, balanceChf: 190 });
    expect(norm(r.html)).toContain("+ CHF 100.00");
    expect(norm(r.html)).toContain("Remaining balance: CHF 190.00");
  });

  it("booking and admin alerts render all fields", () => {
    expect(bookingConfirmation({ parentName: "C", athleteName: "M", serviceName: "1:1 Skills", coachName: "Derrick", when: "Mon 17:00", payNote: "Paid with 1 credit" }).html).toContain("Paid with 1 credit");
    expect(coachBookingAlert({ coachName: "Derrick", athleteName: "Mateo", serviceName: "S", when: "W" }).subject).toBe("New booking — Mateo");
    expect(adminRegistrationAlert({ programName: "P", parentName: "C", children: ["A", "B"], totalChf: 2, invoiceNumber: "I" }).html).toContain("A, B");
  });
});
