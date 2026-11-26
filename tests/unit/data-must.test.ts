import { describe, expect, it } from "vitest";
import { must } from "@/lib/data/must";

describe("must: list loaders surface query errors", () => {
  it("returns the rows, or [] for no data", () => {
    expect(must({ data: [1, 2], error: null }, "x")).toEqual([1, 2]);
    expect(must({ data: null, error: null }, "x")).toEqual([]);
  });
  it("throws on an error instead of rendering an empty list", () => {
    // Regression: documents, consents, staff, audit, e-mail log and deletion
    // requests rendered "nothing yet" when their query failed.
    expect(() => must({ data: null, error: { message: "permission denied" } }, "documents")).toThrow("documents: permission denied");
  });
});
