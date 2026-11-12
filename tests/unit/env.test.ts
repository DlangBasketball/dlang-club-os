import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertServerEnv, env } from "@/lib/env";

const KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_LEAK_TEST", "RESEND_API_KEY"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const setValid = () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-public";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-value";
};

describe("env accessors", () => {
  it("throws a named error when a required variable is missing or blank", () => {
    expect(() => env.supabaseUrl()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    process.env.SUPABASE_SERVICE_ROLE_KEY = "   ";
    expect(() => env.serviceRoleKey()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
  it("returns undefined for blank optional variables and defaults the site URL", () => {
    process.env.RESEND_API_KEY = "";
    expect(env.resendApiKey()).toBeUndefined();
    expect(env.siteUrl()).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_SITE_URL = "https://club.example";
    expect(env.siteUrl()).toBe("https://club.example");
  });
});

describe("assertServerEnv", () => {
  it("passes with the required variables set", () => {
    setValid();
    expect(() => assertServerEnv()).not.toThrow();
  });
  it("fails fast when a required secret is missing", () => {
    setValid();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => assertServerEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
  it.each(["service_role", ["sk", "live", "x"].join("_"), ["sk", "test", "x"].join("_"), "re" + "_abc"])("refuses a secret-looking NEXT_PUBLIC_* value (%s)", (v) => {
    setValid();
    process.env.NEXT_PUBLIC_LEAK_TEST = v;
    expect(() => assertServerEnv()).toThrow(/NEXT_PUBLIC_LEAK_TEST/);
  });
});
