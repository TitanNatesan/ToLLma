// Sidebar-first navigation: personal nav renders directly (no gear toggle).
import { expect, test } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test("personal nav renders directly without the gear toggle", async ({ page }) => {
  await apiLoginAs(page, "nav");
  await page.goto("/");

  // No top navigation bar anywhere.
  await expect(page.getByTestId("top-navigation")).toHaveCount(0);

  // Sidebar chrome with the global workspace switcher.
  await expect(page.getByTestId("left-sidebar")).toBeVisible();
  await expect(page.getByTestId("sidebar-workspace-switcher")).toBeVisible();
  await expect(page.getByTestId("sidebar-ws-personal")).toBeVisible();
  await expect(page.getByTestId("app-logo")).toBeVisible();
  await expect(page.getByTestId("new-chat")).toBeVisible();
  await expect(page.getByTestId("conversation-search")).toBeVisible();

  // Personal nav links render directly — no gear toggle needed.
  const personalNav = page.getByTestId("sidebar-personal-nav");
  await expect(personalNav).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-providers")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-analytics")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-settings")).toBeVisible();

  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("user-avatar")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toBeVisible();

  // Providers context: provider tools, personal nav minus Providers.
  await personalNav.getByTestId("sidebar-nav-providers").click();
  await expect(page).toHaveURL(/\/providers/);
  await expect(page.getByTestId("provider-search")).toBeVisible();
  await expect(page.getByTestId("add-provider")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-providers")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();

  // Analytics context: report shortcuts, personal nav minus Analytics.
  await page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-analytics").click();
  await expect(page).toHaveURL(/\/analytics/);
  await expect(page.getByTestId("analytics-page")).toBeVisible();
  await expect(page.getByTestId("sidebar-report-usage")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-analytics")).toHaveCount(0);

  // Settings page reachable through the personal nav directly.
  await page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-settings").click();
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
