import { describe, expect, it } from "vitest";
import { isPlatformHint, orgMatchesTenant } from "@/lib/tenant/server";
import { parseTenantHost } from "@/lib/tenant/host";

const CLUB_A = "00000000-0000-0000-0000-00000000000a";
const CLUB_B = "00000000-0000-0000-0000-00000000000b";

describe("orgMatchesTenant", () => {
  it("refuses another club's admin on a host that names a club", () => {
    expect(orgMatchesTenant(CLUB_B, { id: CLUB_A, source: "subdomain" })).toBe(false);
    expect(orgMatchesTenant(CLUB_B, { id: CLUB_A, source: "custom_domain" })).toBe(false);
    expect(orgMatchesTenant(CLUB_A, { id: CLUB_A, source: "subdomain" })).toBe(true);
  });
  it("lets a self-signed-up club act on the platform host (apex/app/preview)", () => {
    // Apex falls back to DEFAULT_ORG_SLUG (the founding club): that must not
    // block a different club from saving its own branding.
    expect(orgMatchesTenant(CLUB_B, { id: CLUB_A, source: "default" })).toBe(true);
    expect(orgMatchesTenant(null, { id: CLUB_A, source: "default" })).toBe(false);
  });
  it("does not block when the tenant is unresolved", () => {
    expect(orgMatchesTenant(CLUB_B, { id: null, source: "fallback" })).toBe(true);
  });
});

describe("isPlatformHint", () => {
  it("treats apex, www, app and preview hosts as platform hosts", () => {
    for (const host of ["clubos.app", "www.clubos.app", "my-branch.vercel.app", "localhost"]) {
      expect(isPlatformHint(parseTenantHost(host, "clubos.app"))).toBe(true);
    }
  });
  it("treats club subdomains and custom domains as tenant hosts", () => {
    expect(isPlatformHint(parseTenantHost("riverside.clubos.app", "clubos.app"))).toBe(false);
    expect(isPlatformHint(parseTenantHost("members.riverside.org", "clubos.app"))).toBe(false);
  });
});
