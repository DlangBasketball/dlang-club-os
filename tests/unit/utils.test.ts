import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cn, formatCHF, formatDate, formatTime, initials, timeAgo } from "@/lib/utils";

/** Intl uses narrow no-break spaces and typographic apostrophes; normalise for assertions. */
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/[’']/g, "'");

describe("formatCHF", () => {
  it("formats with CHF prefix, Swiss grouping and two decimals", () => {
    expect(norm(formatCHF(1490))).toBe("CHF 1'490.00");
    expect(norm(formatCHF(290))).toBe("CHF 290.00");
    expect(norm(formatCHF(1234567.891))).toBe("CHF 1'234'567.89");
  });
  it("accepts numeric strings (Postgres numeric comes back as string)", () => {
    expect(norm(formatCHF("1490.5"))).toBe("CHF 1'490.50");
  });
  it("treats null, undefined and non-numeric input as zero", () => {
    expect(norm(formatCHF(null))).toBe("CHF 0.00");
    expect(norm(formatCHF(undefined))).toBe("CHF 0.00");
    expect(norm(formatCHF("abc"))).toBe("CHF 0.00");
    expect(norm(formatCHF(Number.NaN))).toBe("CHF 0.00");
    expect(norm(formatCHF(Number.POSITIVE_INFINITY))).toBe("CHF 0.00");
  });
  it("formats negatives (refunds/credits) with a sign", () => {
    expect(norm(formatCHF(-50))).toMatch(/^CHF.?-50\.00$|^-CHF 50\.00$/);
  });
  it("rounds to cents", () => {
    expect(norm(formatCHF(0.1 + 0.2))).toBe("CHF 0.30");
    expect(norm(formatCHF(10.005))).toMatch(/^CHF 10\.0[01]$/);
  });
});

describe("formatDate / formatTime", () => {
  it("formats Swiss medium dates", () => {
    expect(formatDate("2026-05-23")).toBe("23.05.2026");
    expect(formatDate(new Date(2026, 0, 2))).toBe("02.01.2026");
  });
  it("returns an em dash for empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatTime(null)).toBe("—");
  });
  it("formats 24h time in the club's time zone", () => {
    expect(formatTime("2026-05-23T15:00:00Z")).toBe("17:00"); // CEST = UTC+2
    expect(formatTime("2026-01-10T08:05:00Z")).toBe("09:05"); // CET = UTC+1
  });
});

describe("initials", () => {
  it("takes the first letter of up to two words, uppercased", () => {
    expect(initials("Derrick Lang")).toBe("DL");
    expect(initials("carla maria lopes")).toBe("CM");
    expect(initials("Mateo")).toBe("M");
  });
  it("is robust to empty values and extra spaces", () => {
    expect(initials(null)).toBe("?");
    expect(initials("")).toBe("?");
    expect(initials("  Ana  Rossi ")).toBe("AR");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-05-23T12:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("buckets into just now / minutes / hours / days", () => {
    expect(timeAgo(ago(10_000))).toBe("just now");
    expect(timeAgo(ago(5 * 60_000))).toBe("5m ago");
    expect(timeAgo(ago(3 * 3_600_000))).toBe("3h ago");
    expect(timeAgo(ago(2 * 86_400_000))).toBe("2d ago");
  });
  it("falls back to a date after a week", () => {
    expect(timeAgo(ago(10 * 86_400_000))).toBe("13.05.2026");
  });
  it("accepts ISO strings and handles empty input", () => {
    expect(timeAgo("2026-05-23T11:00:00Z")).toBe("1h ago");
    expect(timeAgo(null)).toBe("");
  });
});

describe("cn", () => {
  it("merges conflicting Tailwind classes, last wins", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-red-500", false && "hidden", undefined, "text-white")).toBe("text-white");
  });
});
