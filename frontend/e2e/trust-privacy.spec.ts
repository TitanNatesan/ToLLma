// Settings privacy cards (Agent E, Wave 3, live privacy API).
import { expect, test } from "@playwright/test";
import { apiLoginAs, selectDropdown } from "./helpers";

test("consent toggle persists across reload", async ({ page }) => {
  await apiLoginAs(page, "trust-consent");
  await page.goto("/settings#privacy");
  const toggle = page.getByTestId("consent-toggle-analytics");
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("consent-locked-functional")).toBeVisible();
  const before = await toggle.getAttribute("data-state");
  await toggle.click();
  await expect(toggle).not.toHaveAttribute("data-state", before ?? "", { timeout: 15000 });
  await page.reload();
  await expect(page.getByTestId("consent-toggle-analytics")).not.toHaveAttribute("data-state", before ?? "", { timeout: 15000 });
});

test("retention save persists across reload", async ({ page }) => {
  await apiLoginAs(page, "trust-retention");
  await page.goto("/settings#retention");
  const days = page.getByTestId("retention-days-conversations");
  await expect(days).toBeVisible({ timeout: 15000 });
  await days.fill("30");
  await page.getByTestId("retention-save-conversations").click();
  await page.reload();
  await expect(page.getByTestId("retention-days-conversations")).toHaveValue("30", { timeout: 15000 });
});

test("cookie toggle persists on this device", async ({ page }) => {
  await apiLoginAs(page, "trust-cookies");
  await page.goto("/settings#cookies");
  const toggle = page.getByTestId("cookie-toggle-analytics");
  await expect(toggle).toBeVisible({ timeout: 15000 });
  await toggle.click();
  await page.reload();
  await expect(page.getByTestId("cookie-toggle-analytics")).toHaveAttribute("data-state", "checked", { timeout: 15000 });
});

test("dsr submit appears in the request list; export downloads", async ({ page }) => {
  await apiLoginAs(page, "trust-dsr");
  await page.goto("/settings#data-rights");
  await expect(page.getByTestId("privacy-data-rights")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("dsr-empty")).toBeVisible();
  await selectDropdown(page, "dsr-type", "access");
  await page.getByTestId("dsr-detail").fill("Please send me a copy of my data");
  await page.getByTestId("dsr-submit").click();
  await expect(page.getByTestId("dsr-empty")).toHaveCount(0, { timeout: 15000 });

  const download = page.waitForEvent("download");
  await page.getByTestId("dsr-export").click();
  const path = await (await download).path();
  expect(path).toBeTruthy();
});

test("age banner stays hidden for confirmed users", async ({ page }) => {
  await apiLoginAs(page, "trust-age");
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("age-confirm-banner")).toHaveCount(0);
});
