import { beforeEach, describe, expect, it, vi } from "vitest";
import { tenantReturnOrigin } from "@/lib/tenant/url";

const ENV = { rootDomain: "clubos.example", siteUrl: "https://app.clubos.example" };
const DLANG = { slug: "dlang", customDomain: "pay.club-a.example" };

describe("tenantReturnOrigin (pure)", () => {
  it("returns to the org's subdomain or custom domain the user is on", () => {
    expect(tenantReturnOrigin(DLANG, "dlang.clubos.example", ENV)).toBe("https://dlang.clubos.example");
    expect(tenantReturnOrigin(DLANG, "DLANG.clubos.example:443", ENV)).toBe("https://dlang.clubos.example");
    expect(tenantReturnOrigin(DLANG, "pay.club-a.example", ENV)).toBe("https://pay.club-a.example");
  });

  it("returns to the platform host (NEXT_PUBLIC_SITE_URL) only when the user is on it", () => {
    expect(tenantReturnOrigin(DLANG, "app.clubos.example", ENV)).toBe("https://app.clubos.example");
    expect(
      tenantReturnOrigin({ slug: "dlang" }, "localhost:3000", { rootDomain: null, siteUrl: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
  });

  it("ignores hosts that do not belong to the org (spoofed Host header)", () => {
    // Another club's subdomain, an attacker domain, garbage: canonical org host instead.
    expect(tenantReturnOrigin(DLANG, "other.clubos.example", ENV)).toBe("https://pay.club-a.example");
    expect(tenantReturnOrigin(DLANG, "evil.example", ENV)).toBe("https://pay.club-a.example");
    expect(tenantReturnOrigin(DLANG, "evil.example/@dlang.clubos.example", ENV)).toBe("https://pay.club-a.example");
    expect(tenantReturnOrigin({ slug: "dlang" }, "evil.example", ENV)).toBe("https://dlang.clubos.example");
    // Platform host on a different port is not the platform host.
    expect(
      tenantReturnOrigin({ slug: "dlang" }, "localhost:4444", { rootDomain: null, siteUrl: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
  });

  it("uses the org's canonical host when there is no request (webhooks, jobs)", () => {
    expect(tenantReturnOrigin(DLANG, null, ENV)).toBe("https://pay.club-a.example");
    expect(tenantReturnOrigin({ slug: "dlang" }, undefined, ENV)).toBe("https://dlang.clubos.example");
    expect(tenantReturnOrigin(null, null, ENV)).toBe("https://app.clubos.example");
    expect(tenantReturnOrigin(null, null, { rootDomain: null, siteUrl: null })).toBe("http://localhost:3000");
  });

  it("supports <slug>.localhost in local development, keeping the port", () => {
    expect(tenantReturnOrigin({ slug: "dlang" }, "dlang.localhost:3000", { rootDomain: null, siteUrl: "http://localhost:3000" })).toBe(
      "http://dlang.localhost:3000",
    );
    expect(tenantReturnOrigin({ slug: "dlang" }, "other.localhost:3000", { rootDomain: null, siteUrl: "http://localhost:3000" })).toBe(
      "http://localhost:3000",
    );
  });
});

// --- Integration: the Stripe calls use the tenant origin, not NEXT_PUBLIC_SITE_URL ---

const state = vi.hoisted(() => ({
  host: null as string | null,
  org: { slug: "dlang", custom_domain: null as string | null },
  orgQueries: [] as string[],
  sessions: [] as Record<string, unknown>[],
  links: [] as Record<string, unknown>[],
  accounts: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.host ? { host: state.host } : {}),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: 0, error: null }),
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            state.orgQueries.push(id);
            return { data: state.org, error: null };
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          state.sessions.push(params);
          return { url: "https://checkout.stripe.test/s" };
        },
      },
    },
    accountLinks: {
      create: async (params: Record<string, unknown>) => {
        state.links.push(params);
        return { url: "https://connect.stripe.test/l" };
      },
    },
    accounts: {
      create: async (params: Record<string, unknown>) => {
        state.accounts.push(params);
        return { id: "acct_new", type: "express", charges_enabled: false, payouts_enabled: false, details_submitted: false };
      },
    },
  }),
}));

const { createInvoiceCheckout, createOnboardingLink, ensureConnectAccount } = await import("@/lib/stripe-connect");

const ORG = "00000000-0000-0000-0000-00000000000a";
const profile = {
  orgId: ORG,
  name: "Test Club",
  country: "CH",
  region: "CH",
  currency: "CHF",
  settings: { stripe: { account_id: "acct_club", charges_enabled: true } },
  stripeAccountId: "acct_club",
  stripeReady: true,
  taxLabel: "VAT",
  swiss: {},
} as unknown as Parameters<typeof createInvoiceCheckout>[0]["profile"];

describe("Stripe return URLs use the tenant's own host", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_ROOT_DOMAIN", "clubos.example");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.clubos.example");
    vi.stubEnv("STRIPE_CONNECT_ACCOUNT_TYPE", "express");
    state.host = null;
    state.org = { slug: "dlang", custom_domain: null };
    state.orgQueries.length = 0;
    state.sessions.length = 0;
    state.links.length = 0;
    state.accounts.length = 0;
  });

  it("Checkout success/cancel go back to the club subdomain the parent paid from", async () => {
    state.host = "dlang.clubos.example";
    await createInvoiceCheckout({
      profile,
      invoiceId: "inv_1",
      invoiceNumber: "2026-0001",
      currency: "CHF",
      amount: 1,
      methods: [
        { key: "card", label: "Card", via: "stripe", stripeType: "card", delayedSettlement: false },
        { key: "twint", label: "TWINT", via: "stripe", stripeType: "twint", delayedSettlement: false },
      ],
    });
    const s = state.sessions[0]!;
    expect(s.success_url).toBe("https://dlang.clubos.example/parent/invoices/inv_1?paid=1");
    expect(s.cancel_url).toBe("https://dlang.clubos.example/parent/invoices/inv_1");
    expect(s.payment_method_types).toEqual(["card", "twint"]);
    expect(state.orgQueries).toEqual([ORG]);
  });

  it("a spoofed Host never becomes a Stripe return URL", async () => {
    state.host = "evil.example";
    state.org = { slug: "dlang", custom_domain: "pay.club-a.example" };
    await createInvoiceCheckout({ profile, invoiceId: "inv_2", invoiceNumber: "2", currency: "CHF", amount: 5, methods: [] });
    expect(state.sessions[0]!.success_url).toBe("https://pay.club-a.example/parent/invoices/inv_2?paid=1");
  });

  it("Connect onboarding refresh/return use the admin's host; platform host falls back to NEXT_PUBLIC_SITE_URL", async () => {
    state.host = "dlang.clubos.example";
    await createOnboardingLink("acct_club", ORG);
    expect(state.links[0]).toMatchObject({
      refresh_url: "https://dlang.clubos.example/api/stripe/connect/onboard",
      return_url: "https://dlang.clubos.example/api/stripe/connect/return",
    });
    state.host = "app.clubos.example";
    await createOnboardingLink("acct_club", ORG);
    expect(state.links[1]).toMatchObject({ return_url: "https://app.clubos.example/api/stripe/connect/return" });
  });

  it("new Express CH accounts request twint_payments", async () => {
    await ensureConnectAccount({ ...profile, stripeAccountId: null, settings: {} });
    expect(state.accounts[0]!.capabilities).toEqual({
      card_payments: { requested: true },
      transfers: { requested: true },
      twint_payments: { requested: true },
    });
  });
});
