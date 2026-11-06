// Trust Center hub + registry surfaces (Agent E, Wave 3, live backend).
import { expect, test } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test("trust hub renders and navigates to security with live policies", async ({ page }) => {
  await apiLoginAs(page, "trust-hub");
  await page.goto("/trust");
  await expect(page.getByTestId("trust-page")).toBeVisible();
  await expect(page.getByTestId("trust-hub")).toBeVisible();
  for (const card of ["trust-hub-security", "trust-hub-legal", "trust-hub-subprocessors", "trust-hub-disclosure"]) {
    await expect(page.getByTestId(card)).toBeVisible();
  }
  await page.getByTestId("trust-hub-security").click();
  await expect(page).toHaveURL(/\/trust\/security/);
  await expect(page.getByTestId("trust-security-page")).toBeVisible();
  // Live F8 registry: seeded provider policies render in the table.
  await expect(page.getByTestId("trust-policies-table")).toBeVisible({ timeout: 15000 });
});

test("subprocessors page renders live registry state", async ({ page }) => {
  await apiLoginAs(page, "trust-sub");
  await page.goto("/trust/subprocessors");
  await expect(page.getByTestId("trust-subprocessors-page")).toBeVisible();
  // Empty (no active vendors seeded) or populated — never an error.
  await expect(
    page.getByTestId("trust-subprocessors-empty").or(page.getByTestId("trust-subprocessors-table")),
  ).toBeVisible({ timeout: 15000 });
});

test("disclosure form submits a vuln report and echoes a receipt", async ({ page }) => {
  await apiLoginAs(page, "trust-disc");
  await page.goto("/trust/disclosure");
  await expect(page.getByTestId("trust-disclosure-page")).toBeVisible();
  await page.getByTestId("trust-disclosure-title").fill(" Reflected XSS in share preview ");
  await page.getByTestId("trust-disclosure-details").fill("Steps: open a crafted share link with script payload in title");
  await page.getByTestId("trust-disclosure-contact").fill("reporter@tollma.ai");
  await page.getByTestId("trust-disclosure-submit").click();
  await expect(page.getByTestId("trust-disclosure-receipt")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("trust-disclosure-mailto")).toHaveAttribute("href", /^mailto:/);
});

test("admin compliance sections are forbidden for non-admins", async ({ page }) => {
  await apiLoginAs(page, "trust-admingate");
  await page.goto("/admin#incidents");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible({ timeout: 20000 });
});

test("trust hub smoke on a mobile viewport", async ({ page }) => {
  await apiLoginAs(page, "trust-mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/trust");
  await expect(page.getByTestId("trust-hub")).toBeVisible();
  await expect(page.getByTestId("trust-hub-disclosure")).toBeVisible();
});
