import { expect, test } from "@playwright/test";

/**
 * Smoke tests: the public entry points render without a server error and
 * without leaking internals. These run without a backend (dummy Supabase env).
 */

test.describe("login page", () => {
  test("renders the magic-link sign-in form", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res?.status()).toBeLessThan(400);
    const email = page.locator('input[type="email"]');
    await expect(email).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|send|continue|magic link/i })).toBeVisible();
  });

  test("protected routes redirect signed-out users to /login", async ({ page }) => {
    await page.goto("/admin/dashboard");
    await expect(page).toHaveURL(/\/login(\?|$)/);
    const redirect = new URL(page.url()).searchParams.get("redirect");
    if (redirect !== null) expect(redirect).toBe("/admin/dashboard");
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("has no horizontal overflow on small screens", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/login");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("public registration page", () => {
  const backend = process.env.E2E_BACKEND === "1";
  const slug = process.env.E2E_PROGRAM_SLUG ?? "spsa-summer-camp-w1";

  test("renders a public program with the registration stepper", async ({ page }) => {
    test.skip(!backend, "needs a seeded Supabase backend (E2E_BACKEND=1)");
    const res = await page.goto(`/register/${slug}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/CHF/).first()).toBeVisible();
  });

  test("unknown program slug is a clean 404, not a crash", async ({ page }) => {
    test.skip(!backend, "needs a reachable Supabase backend (E2E_BACKEND=1)");
    const res = await page.goto("/register/this-program-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.locator("body")).not.toContainText(/stack|TypeError|ECONNREFUSED|supabase/i);
  });
});
