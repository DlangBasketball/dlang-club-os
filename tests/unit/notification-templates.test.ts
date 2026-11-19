import { describe, expect, it } from "vitest";
import { applyVars, ENUM_FOR, render, TEMPLATES, type NotifType } from "@/lib/notifications/templates";

const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/[’']/g, "'");

describe("applyVars", () => {
  it("substitutes known placeholders, tolerant of whitespace and case", () => {
    expect(applyVars("Hi {{parent_name}}, {{ athlete_name }} / {{ATHLETE_NAME}}", { parent_name: "Carla", athlete_name: "Mateo" })).toBe("Hi Carla, Mateo / ");
  });

  it("formats amount_due as CHF and due_date as a Swiss date", () => {
    expect(norm(applyVars("Pay {{amount_due}} by {{due_date}}", { amount_due: 1490, due_date: "2026-06-30" }))).toBe("Pay CHF 1'490.00 by 30.06.2026");
  });

  it("removes missing or null variables instead of leaking braces", () => {
    expect(applyVars("Hi {{parent_name}}!", {})).toBe("Hi !");
    expect(applyVars("x{{unknown_var}}y", {})).toBe("xy");
  });

  it("does not re-expand placeholders injected through values", () => {
    expect(applyVars("{{message}}", { message: "{{parent_name}}", parent_name: "Carla" })).toBe("{{parent_name}}");
  });

  it("leaves non-placeholder braces untouched", () => {
    expect(applyVars("{single} {{ bad-key }}", {})).toBe("{single} {{ bad-key }}");
  });

  it("renders zero amounts (not treated as missing)", () => {
    expect(norm(applyVars("{{amount_due}}", { amount_due: 0 }))).toBe("CHF 0.00");
  });
});

describe("notification TEMPLATES", () => {
  const types = Object.keys(TEMPLATES) as NotifType[];

  it("covers every NotifType and maps each to a notification_type enum label", () => {
    expect(new Set(types)).toEqual(new Set(Object.keys(ENUM_FOR)));
    expect(ENUM_FOR.announcement).toBe("system");
    for (const t of types.filter((t) => t !== "announcement")) expect(ENUM_FOR[t]).toBe(t);
  });

  it.each(types)("%s renders with no variables without throwing or leaking 'undefined'", (t) => {
    const r = render(t, {});
    for (const field of [r.title, r.body, r.subject, r.html]) {
      expect(typeof field).toBe("string");
      expect(field).not.toMatch(/undefined|null|NaN|\{\{/);
    }
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.html).toMatch(/^<!doctype html>/);
    if (r.link) expect(r.link.startsWith("/")).toBe(true);
  });

  it("puts invoice details into overdue reminders", () => {
    const r = render("payment_overdue", { parent_name: "Carla", invoice_number: "INV-2026-0211", amount_due: 290, due_date: "2026-04-30", payment_link: "https://example.test/pay" });
    expect(r.subject).toBe("Reminder: invoice INV-2026-0211 is overdue");
    expect(norm(r.body)).toBe("CHF 290.00 was due 30.04.2026.");
    expect(r.html).toContain("https://example.test/pay");
    expect(r.html).toContain("Hi Carla,");
  });

  it("announcement applies vars in the message body and converts newlines", () => {
    const r = render("announcement", { title: "Camp update", message: "Hi {{parent_name}}\nSee you {{when}}", parent_name: "Carla", when: "Monday" });
    expect(r.body).toBe("Hi Carla\nSee you Monday");
    expect(r.html).toContain("Hi Carla<br/>See you Monday");
    expect(r.subject).toBe("Camp update");
  });
});
