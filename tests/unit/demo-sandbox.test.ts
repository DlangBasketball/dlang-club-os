import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_PERSONAS,
  DEMO_ROLES,
  DEMO_ROLE_HOME,
  demoEnabled,
  demoLoginEmail,
  demoMaxPerHour,
  demoWalkthroughUrl,
  hashDemoToken,
  isDemoEmail,
  isDemoRole,
  isWellFormedDemoToken,
  newDemoToken,
  sameOrigin,
} from "@/lib/demo/config";
import { sendEmail } from "@/lib/email/resend";
import { checkEnv } from "@/lib/observability/env-check";
import { getStripe } from "@/lib/stripe";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-anon-key-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-key-server-key-server-key",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("demo switch", () => {
  it("is off unless DEMO_SANDBOX_ENABLED=true", () => {
    expect(demoEnabled({})).toBe(false);
    expect(demoEnabled({ DEMO_SANDBOX_ENABLED: "1" })).toBe(false);
    expect(demoEnabled({ DEMO_SANDBOX_ENABLED: "true", APP_ENV: "staging" })).toBe(true);
  });
  it("is never on in production", () => {
    expect(demoEnabled({ DEMO_SANDBOX_ENABLED: "true", APP_ENV: "production" })).toBe(false);
    expect(demoEnabled({ DEMO_SANDBOX_ENABLED: "true", VERCEL_ENV: "production" })).toBe(false);
    expect(demoEnabled({ DEMO_SANDBOX_ENABLED: "true", APP_ENV: "staging", VERCEL_ENV: "production" })).toBe(true);
  });
  it("env check refuses the flag in production and a live Stripe key while it is on", () => {
    const prod = checkEnv({ ...BASE_ENV, APP_ENV: "production", DEMO_SANDBOX_ENABLED: "true" });
    expect(prod.invalid.map((i) => i.name)).toContain("DEMO_SANDBOX_ENABLED");
    const live = checkEnv({ ...BASE_ENV, APP_ENV: "staging", DEMO_SANDBOX_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_abc" });
    expect(live.invalid.map((i) => i.name)).toContain("STRIPE_SECRET_KEY");
    const ok = checkEnv({ ...BASE_ENV, APP_ENV: "staging", DEMO_SANDBOX_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_abc" });
    expect(ok.invalid.map((i) => i.name)).not.toContain("STRIPE_SECRET_KEY");
  });
  it("walkthrough URL must be https", () => {
    expect(demoWalkthroughUrl({})).toBeNull();
    expect(demoWalkthroughUrl({ DEMO_WALKTHROUGH_URL: "http://cal.example.com/x" })).toBeNull();
    expect(demoWalkthroughUrl({ DEMO_WALKTHROUGH_URL: "not a url" })).toBeNull();
    expect(demoWalkthroughUrl({ DEMO_WALKTHROUGH_URL: "https://cal.example.com/dlang" })).toBe("https://cal.example.com/dlang");
  });
  it("rate limit defaults to 30 per hour", () => {
    expect(demoMaxPerHour({})).toBe(30);
    expect(demoMaxPerHour({ DEMO_MAX_SANDBOXES_PER_HOUR: "5" })).toBe(5);
    expect(demoMaxPerHour({ DEMO_MAX_SANDBOXES_PER_HOUR: "-3" })).toBe(30);
  });
});

describe("demo roles and tokens", () => {
  it("has five roles, each with a first screen", () => {
    expect(DEMO_ROLES).toHaveLength(5);
    for (const r of DEMO_ROLES) expect(DEMO_ROLE_HOME[r]).toMatch(/^\/(parent|admin|coach|player)/);
    expect(isDemoRole("parent")).toBe(true);
    expect(isDemoRole("platform_admin")).toBe(false);
    expect(isDemoRole(undefined)).toBe(false);
  });
  it("personas match the seeded scenario", () => {
    expect(DEMO_PERSONAS).toEqual({ parent: "Jamie Morgan", coach: "Coach Taylor", player: "Alex Morgan" });
  });
  it("tokens are 256-bit base64url and stored as the SHA-256 hex the DB accepts", () => {
    const t = newDemoToken();
    expect(isWellFormedDemoToken(t)).toBe(true);
    expect(newDemoToken()).not.toBe(t);
    expect(hashDemoToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDemoToken(t)).toBe(hashDemoToken(t));
    expect(isWellFormedDemoToken("short")).toBe(false);
    expect(isWellFormedDemoToken(`${t.slice(0, 42)}'`)).toBe(false);
    expect(isWellFormedDemoToken(undefined)).toBe(false);
  });
  it("login e-mails are unique per sandbox and role, on the demo domain", () => {
    expect(demoLoginEmail("a1B2-c3", "parent")).toBe("demo-a1b2c3-parent@demo.example.com");
    expect(isDemoEmail(demoLoginEmail("x", "admin"))).toBe(true);
  });
  it("same-origin check for the POST routes", () => {
    expect(sameOrigin("https://dlang-staging.vercel.app", "dlang-staging.vercel.app")).toBe(true);
    expect(sameOrigin("https://evil.example", "dlang-staging.vercel.app")).toBe(false);
    expect(sameOrigin(null, "dlang-staging.vercel.app")).toBe(false);
    expect(sameOrigin("garbage", "dlang-staging.vercel.app")).toBe(false);
  });
});

describe("outbound kill switches", () => {
  it("recognises only the demo domain", () => {
    expect(isDemoEmail("jamie.morgan@demo.example.com")).toBe(true);
    expect(isDemoEmail("JAMIE@DEMO.EXAMPLE.COM")).toBe(true);
    expect(isDemoEmail("x@mail.demo.example.com")).toBe(true);
    expect(isDemoEmail("someone@example.com")).toBe(false);
    expect(isDemoEmail("someone@notdemo.example.com")).toBe(false);
    expect(isDemoEmail("real.person@gmail.com")).toBe(false);
  });
  it("sendEmail drops demo addresses before the provider, even with a test redirect", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key_123456");
    vi.stubEnv("EMAIL_TEST_REDIRECT", "delivered@resend.dev");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await sendEmail({ to: "jamie.morgan@demo.example.com", subject: "s", html: "<p>h</p>" });
    expect(r).toEqual({ ok: false, error: "email-suppressed-demo" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("no Stripe client for a live key while demo sandboxes are enabled", () => {
    vi.stubEnv("DEMO_SANDBOX_ENABLED", "true");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_123");
    expect(getStripe()).toBeNull();
  });
});

describe("demo catalog", () => {
  it("every role has its copy in English and French", () => {
    for (const r of DEMO_ROLES) {
      for (const k of ["title", "start", "tasks", "button"] as const) {
        expect(en.demo.roles[r][k]).toBeTruthy();
        expect(fr.demo.roles[r][k]).toBeTruthy();
      }
    }
  });
});
