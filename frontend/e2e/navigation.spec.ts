// Sidebar-first navigation: nav hidden until the profile gear toggles it.
import { expect, test } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test("navigation reveals only via the profile settings toggle", async ({ page }) => {
  await apiLoginAs(page, "nav");
  await page.goto("/");

  // No top navigation bar anywhere.
  await expect(page.getByTestId("top-navigation")).toHaveCount(0);

  // Sidebar chrome with nav hidden by default.
  await expect(page.getByTestId("left-sidebar")).toBeVisible();
  await expect(page.getByTestId("app-logo")).toBeVisible();
  await expect(page.getByTestId("new-chat")).toBeVisible();
  await expect(page.getByTestId("conversation-search")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-providers")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-nav-analytics")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-nav-settings")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("user-avatar")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toBeVisible();

  // Gear reveals the nav.
  await page.getByTestId("profile-settings-btn").click();
  await expect(page.getByTestId("sidebar-nav-providers")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-analytics")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-settings")).toBeVisible();

  // Gear hides it again (the nav can need a settle click while it re-renders).
  await expect(async () => {
    if ((await page.getByTestId("sidebar-nav-providers").count()) > 0) {
      await page.getByTestId("profile-settings-btn").click();
    }
    await expect(page.getByTestId("sidebar-nav-providers")).toHaveCount(0);
  }).toPass({ timeout: 15000 });

  // Providers context: provider tools, nav minus Providers, hidden after navigate.
  await page.getByTestId("profile-settings-btn").click();
  await page.getByTestId("sidebar-nav-providers").click();
  await expect(page).toHaveURL(/\/providers/);
  await expect(page.getByTestId("provider-search")).toBeVisible();
  await expect(page.getByTestId("add-provider")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-providers")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();

  // Analytics context: report shortcuts, nav minus Analytics.
  await page.getByTestId("profile-settings-btn").click();
  await expect(page.getByTestId("sidebar-nav-analytics")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-settings")).toBeVisible();
  await page.getByTestId("sidebar-nav-analytics").click();
  await expect(page).toHaveURL(/\/analytics/);
  await expect(page.getByTestId("analytics-page")).toBeVisible();
  await expect(page.getByTestId("sidebar-report-usage")).toBeVisible();
  await expect(page.getByTestId("sidebar-nav-analytics")).toHaveCount(0);

  // Settings page reachable through the revealed nav.
  await page.getByTestId("profile-settings-btn").click();
  await page.getByTestId("sidebar-nav-settings").click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("sidebar-settings-appearance")).toBeVisible();

  // Logo returns home: chat is the home page.
  await page.getByTestId("app-logo").click();
  // Home is now the draft chat: it stays at "/" until the first message.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("new-chat")).toBeVisible();
  await expect(page.getByTestId("top-navigation")).toHaveCount(0);
});
