import { expect, test, type Page } from "@playwright/test";
import en from "../../src/messages/en.json";

/**
 * Prospect demo journey on a deployed staging app, through the normal screens.
 * It is the UI check of docs/demo/PROSPECT_DEMO.md §4 and records the raw
 * footage for the sales video (one .webm per test in test-results/).
 *
 *   DEMO_E2E=1 E2E_BASE_URL=https://dlang-staging.vercel.app \
 *     npx playwright test e2e/demo --project=chromium-desktop
 *
 * Skipped unless DEMO_E2E=1 (needs a staging deployment with
 * DEMO_SANDBOX_ENABLED=true and the 20250420107000 migration applied).
 * Each test starts its own sandbox (fresh browser context = fresh demo cookie).
 */
test.skip(process.env.DEMO_E2E !== "1", "set DEMO_E2E=1 and E2E_BASE_URL to run the demo journey on staging");
test.use({ video: { mode: "on", size: { width: 1440, height: 900 } }, viewport: { width: 1440, height: 900 } });
test.setTimeout(180_000);

const s = en.demo.roles;

async function startAs(page: Page, button: string) {
  await page.goto("/demo");
  await page.getByRole("button", { name: button }).click();
  await page.waitForLoadState("networkidle");
}

async function hold(page: Page, ms = 1500) {
  await page.waitForTimeout(ms); // readable pauses in the recording
}

test("handoff: parent registers Alex -> admin approves -> Coach Taylor sees Alex and marks present -> Alex sees it", async ({ page }) => {
  // 1. Parent: switch Alex <-> Sam, then submit Alex's U14 Falcons request.
  await startAs(page, s.parent.button);
  await expect(page).toHaveURL(/\/parent\/home/);
  await page.getByRole("button", { name: /Sam/ }).first().click();
  await hold(page);
  await page.getByRole("button", { name: /Alex/ }).first().click();
  await hold(page);
  await page.goto("/parent/club-programmes");
  const falcons = page.locator("li, article, div").filter({ hasText: "U14 Falcons" }).filter({ has: page.getByRole("button", { name: en.approvals.programs.submit }) }).last();
  await falcons.getByText("Alex", { exact: false }).first().click().catch(() => undefined);
  await falcons.getByRole("button", { name: en.approvals.programs.submit }).click();
  await expect(page.getByText(/pending|awaiting/i).first()).toBeVisible();
  await hold(page, 2500);

  // 2. Club admin approves Alex.
  await startAs(page, s.admin.button);
  await expect(page).toHaveURL(/\/admin\/approvals/);
  await expect(page.getByText("Alex Morgan").first()).toBeVisible();
  await page.getByRole("button", { name: en.approvals.reviewer.confirm }).first().click();
  await expect(page.getByText(en.approvals.reviewer.done.confirmed).or(page.getByText(en.approvals.reviewer.done.approved))).toBeVisible();
  await hold(page, 3000);

  // 3. Coach Taylor: Alex on the U14 Falcons roster, then today's practice -> present -> finalize.
  await startAs(page, s.coach.button);
  await page.goto("/coach/team");
  await expect(page.getByText("Alex Morgan").first()).toBeVisible();
  await hold(page, 3000);
  await page.goto("/coach/trainings");
  await page.getByRole("link", { name: /U14 Falcons|Team practice/ }).first().click();
  await page.getByRole("link", { name: /attendance/i }).first().click().catch(() => undefined);
  const alexRow = page.locator("li, tr, div").filter({ hasText: "Alex Morgan" }).last();
  await alexRow.getByRole("button", { name: en.teamAttendance.statuses.present }).click();
  await page.getByRole("button", { name: en.coachTrainings.sheet.markAllPresent }).click();
  await page.getByRole("button", { name: en.coachTrainings.finalize.open }).click();
  await page.getByRole("button", { name: en.coachTrainings.finalize.confirm }).click();
  await expect(page.getByText(en.teamAttendance.messages.finalized)).toBeVisible();
  await hold(page, 2000);

  // 4. Alex (athlete view): schedule + attendance shows the practice as present.
  await startAs(page, s.player.button);
  await page.goto("/player/attendance");
  await expect(page.getByText(en.teamAttendance.statuses.present).first()).toBeVisible();
  await hold(page, 3000);
});

test("money: Jamie books the Skills Camp -> Finance finds the matching invoice and sandbox payments", async ({ page }) => {
  await startAs(page, s.parent.button);
  await page.goto("/parent/camps");
  await page.getByRole("link", { name: /Skills Camp/ }).first().click();
  await hold(page);
  // The camp form: Sam, 5 days. Labels come from the camps catalog; adjust here if the form changes.
  await page.getByText("Sam", { exact: false }).first().click().catch(() => undefined);
  await page.getByText("5 days - with lunch").first().click().catch(() => undefined);
  for (const box of await page.getByRole("checkbox").all()) await box.check().catch(() => undefined);
  await page.getByRole("button", { name: /register|book|continue|pay/i }).last().click();
  await expect(page).toHaveURL(/\/parent\/invoices\//);
  const number = (await page.getByText(/DEMO-\d{4}-\d{4}|CAMP/).first().textContent())?.trim() ?? "";
  await hold(page, 2500);

  await startAs(page, s.finance.button);
  await expect(page).toHaveURL(/\/admin\/invoices/);
  await expect(page.getByText("Morgan").first()).toBeVisible();
  if (number) await expect(page.getByText(number).first()).toBeVisible();
  await page.getByText("Casey Brooks").first().click().catch(() => undefined);
  await hold(page, 3000);
});

test("reset restores the starting scenario", async ({ page }) => {
  await startAs(page, s.parent.button);
  await page.goto("/demo");
  await page.getByRole("button", { name: en.demo.reset.button }).click();
  await expect(page.getByText(en.demo.reset.done)).toBeVisible();
  await startAs(page, s.coach.button);
  await page.goto("/coach/team");
  await expect(page.getByText("Alex Morgan")).toHaveCount(0);
});
