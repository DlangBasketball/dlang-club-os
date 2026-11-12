import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (Playwright). Thin layer over the money/safety paths — see
 * TESTING_AND_LAUNCH_PLAN.md §2.
 *
 *   npm run test:e2e                         # builds nothing; starts `next start` (run `npm run build` first)
 *   E2E_BASE_URL=https://staging… npm run test:e2e   # against a deployed preview
 *   E2E_DEV=1 npm run test:e2e               # use `next dev` instead of `next start`
 *   PW_CHROMIUM_PATH=/path/to/chrome   # use a preinstalled browser instead of `npx playwright install`
 *
 * Specs that need a seeded Supabase backend skip themselves unless
 * E2E_BACKEND=1 (see testing/README.md).
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
    {
      name: "chromium-mobile",
      use: {
        ...devices["Pixel 7"],
        launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.E2E_DEV ? `npx next dev -p ${PORT}` : `npx next start -p ${PORT}`,
        url: `${baseURL}/login`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
