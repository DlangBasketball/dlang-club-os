import { defineConfig } from "vitest/config";
import path from "node:path";

// Pin the time zone before workers start so Intl date/time output is stable
// regardless of the machine (CI runs in UTC, the club lives in Europe/Zurich).
process.env.TZ = "Europe/Zurich";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next.js ships `server-only` internally; outside Next it is a no-op.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
});
