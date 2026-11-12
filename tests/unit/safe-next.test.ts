import { describe, expect, it } from "vitest";
import { isSafeNextPath } from "@/lib/auth/safe-next";

describe("isSafeNextPath", () => {
  it("allows same-site paths", () => {
    for (const p of ["/", "/admin/dashboard", "/parent/invoices?id=1#x"]) expect(isSafeNextPath(p)).toBe(true);
  });
  it("rejects open-redirect shapes", () => {
    for (const p of ["@evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "evil.com", "/ x", ".evil.com"])
      expect(isSafeNextPath(p)).toBe(false);
  });
});
