import { describe, expect, it } from "vitest";
import { MODE_HOME, effectiveRoles, isAppMode, modeLabelKey, modeOfPath, modesForRoles } from "@/lib/auth/modes";

describe("role switcher modes", () => {
  it("derives modes from real roles", () => {
    expect(modesForRoles(["admin", "coach", "parent"])).toEqual(["admin", "coach", "parent"]);
    expect(modesForRoles(["finance", "coach"])).toEqual(["admin", "coach"]);
    expect(modesForRoles(["admin"])).toEqual(["admin"]);
    expect(modesForRoles(["parent", "player"])).toEqual(["parent"]);
    expect(modesForRoles([])).toEqual([]);
  });

  it("keeps only the roles of the active mode (same rule as mode_allows_role)", () => {
    const all = ["admin", "coach", "parent"] as const;
    expect(effectiveRoles([...all], "admin")).toEqual(["admin", "coach"]);
    expect(effectiveRoles([...all], "coach")).toEqual(["coach"]);
    expect(effectiveRoles([...all], "parent")).toEqual(["parent"]);
    expect(effectiveRoles(["finance", "coach"], "admin")).toEqual(["finance", "coach"]);
  });

  it("leaves single-mode people unchanged", () => {
    expect(effectiveRoles(["admin", "finance"], null)).toEqual(["admin", "finance"]);
    expect(effectiveRoles(["parent"], null)).toEqual(["parent"]);
  });

  it("maps paths to their mode area", () => {
    expect(modeOfPath("/admin/registrations?x=1")).toBe("admin");
    expect(modeOfPath("/coach")).toBe("coach");
    expect(modeOfPath("/coach/trainings/abc/attendance")).toBe("coach");
    expect(modeOfPath("/parent/invoices/1")).toBe("parent");
    expect(modeOfPath("/administrator")).toBeNull();
    expect(modeOfPath("/player")).toBeNull();
    expect(modeOfPath("/")).toBeNull();
  });

  it("homes and labels", () => {
    expect(MODE_HOME).toEqual({ admin: "/admin/dashboard", coach: "/coach", parent: "/parent/home" });
    expect(modeLabelKey("admin", ["finance", "coach"])).toBe("finance");
    expect(modeLabelKey("admin", ["admin", "finance"])).toBe("admin");
    expect(isAppMode("coach")).toBe(true);
    expect(isAppMode("finance")).toBe(false);
  });
});
