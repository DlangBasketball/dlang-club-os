import { describe, expect, it } from "vitest";
import { pagedIn, PAGE_ROWS } from "@/lib/data/paged";

describe("pagedIn: aggregates read every row", () => {
  it("chunks the id list and pages each chunk past the response cap", async () => {
    // A fake table: 2500 rows for id "a", 3 for "b"; the server returns at
    // most PAGE_ROWS rows per request, like PostgREST.
    const table = [
      ...Array.from({ length: 2500 }, (_, i) => ({ k: "a", n: i })),
      ...Array.from({ length: 3 }, (_, i) => ({ k: "b", n: i })),
    ];
    const calls: string[] = [];
    const { rows, error } = await pagedIn(["a", "b", "a"], async (chunk, from, to) => {
      calls.push(`${chunk.join()}:${from}`);
      const all = table.filter((r) => chunk.includes(r.k));
      return { data: all.slice(from, Math.min(to + 1, from + PAGE_ROWS)), error: null };
    }, 1);
    expect(error).toBeNull();
    // Regression: one plain read stopped at 1000 of the 2503 rows.
    expect(rows).toHaveLength(2503);
    expect(calls).toEqual(["a:0", "a:1000", "a:2000", "b:0"]);
  });

  it("stops and reports a query error", async () => {
    const r = await pagedIn(["x"], async () => ({ data: null, error: { message: "boom" } }));
    expect(r.error).toBe("boom");
  });
});
