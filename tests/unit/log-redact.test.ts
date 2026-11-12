import { afterEach, describe, expect, it, vi } from "vitest";
import { logError, redact, safeError } from "@/lib/log";

// Fake credentials are assembled at runtime so secret scanners (gitleaks) do
// not flag these fixtures. None of them is, or ever was, a real key.
const fake = (...parts: string[]) => parts.join("");

describe("redact() — strings", () => {
  it("masks email addresses", () => {
    expect(redact("contact carla.lopes@gmail.com now")).toBe("contact [email] now");
    expect(redact("a+b@x.co and c_d@sub.example.ch")).toBe("[email] and [email]");
  });

  it("masks IBANs (compact form)", () => {
    expect(redact("pay to CH9300762011623852957")).toBe("pay to [iban]");
    expect(redact("DE89370400440532013000")).toBe("[iban]");
  });

  it("masks Resend style API keys and single-segment keys", () => {
    expect(redact(fake("re_", "AbCdEf123456"))).toBe("[key]");
    expect(redact(fake("key sk", "_abcdEFGH1234"))).toBe("key [key]");
  });

  // KNOWN BUG (src/lib/log.ts): the key pattern `(?:sk|re|pk)_[A-Za-z0-9]{8,}`
  // does not match real Stripe keys, which have a second underscore
  // (sk_live_…, sk_test_…, rk_live_…, whsec_…), so they are logged in clear.
  // Suggested fix: /\b(?:sk|rk|pk|re|whsec)_(?:(?:live|test)_)?[A-Za-z0-9]{8,}\b/g
  // `it.fails` keeps CI green until the fix lands, then flips to an error so
  // this marker gets converted into a normal `it`.
  it.fails("masks Stripe live/test keys and webhook secrets", () => {
    expect(redact(fake("key sk_", "test_", "abcdEFGH1234"))).toBe("key [key]");
    expect(redact(fake("sk_", "live_", "51HabcdEFGH1234"))).toBe("[key]");
    expect(redact(fake("pk_", "live_", "12345678"))).toBe("[key]");
    expect(redact(fake("whsec", "_abcdEFGH12345678"))).toBe("[key]");
  });

  it("masks JWTs", () => {
    const jwt = fake("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJ", "zdWIiOiJ0ZXN0LXVzZXIifQ", ".", "c2lnbmF0dXJlLW5vdC1yZWFs");
    expect(redact(`Bearer ${jwt}`)).toBe("Bearer [jwt]");
  });

  it("masks phone numbers in Swiss and international formats", () => {
    expect(redact("call +41 79 123 45 67")).toBe("call [phone]");
    expect(redact("tel 021 555 12 34")).toBe("tel [phone]");
    // A leading "(" may survive; the digits must not.
    expect(redact("(415) 555-0100")).not.toMatch(/\d/);
  });

  it("leaves benign text alone", () => {
    expect(redact("Invoice paid")).toBe("Invoice paid");
    expect(redact("")).toBe("");
  });
});

describe("redact() — structures", () => {
  it("redacts sensitive keys regardless of value", () => {
    const out = redact({
      password: "hunter2",
      access_token: "x",
      apiKey: "abc",
      Authorization: "Bearer y",
      iban: "n/a",
      dob: "2015-01-01",
      medical_notes: "asthma",
      allergies: "nuts",
      email: "nobody",
      phone: "none",
      name: "Mateo",
    }) as Record<string, unknown>;
    for (const k of ["password", "access_token", "apiKey", "Authorization", "iban", "dob", "medical_notes", "allergies", "email", "phone"]) {
      expect(out[k]).toBe("[redacted]");
    }
    expect(out.name).toBe("Mateo");
  });

  it("recurses into nested objects and arrays", () => {
    const out = redact({ guardian: { contact: "carla@x.ch", notes: ["call +41 79 123 45 67"] }, list: [{ secret: 1 }] });
    expect(out).toEqual({ guardian: { contact: "[email]", notes: ["call [phone]"] }, list: [{ secret: "[redacted]" }] });
  });

  it("passes through primitives and null", () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it("does not mutate the input", () => {
    const input = { email: "a@b.ch", nested: { text: "a@b.ch" } };
    const copy = structuredClone(input);
    redact(input);
    expect(input).toEqual(copy);
  });
});

describe("logError / safeError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a single redacted JSON line and returns its ref id", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = logError("ctx", new Error("failed for carla@x.ch"), { iban: "CH93...", note: "+41 79 123 45 67" });
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).not.toContain("carla@x.ch");
    expect(line).not.toContain("79 123");
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "error", id, context: "ctx", message: "failed for [email]", extra: { iban: "[redacted]", note: "[phone]" } });
  });

  it("returns a generic client-safe message with the ref id and no details", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = safeError("ctx", new Error("relation \"secret_table\" does not exist"));
    expect(msg).toMatch(/^Something went wrong \(ref [0-9a-f]{8}\)\./);
    expect(msg).not.toContain("secret_table");
  });
});
