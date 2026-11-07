// Responsive SidebarHeader: at the default 260px width the header renders the
// compact two-row layout (brand row + utility row) with nothing clipped, and
// the palette button opens the command palette.
import { expect, test } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test("compact header shows full brand and all utility buttons", async ({ page }) => {
  await apiLoginAs(page, "sidehead");
  await page.goto("/");
  await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });

  // Full "ToLLma" brand text (never truncated, even in the compact layout).
  const brand = page.getByTestId("app-logo");
  await expect(brand).toBeVisible();
  await expect(brand).toContainText("ToLLma");

  // Utility row: palette + theme buttons all visible (nothing clipped).
  const paletteBtn = page.getByTestId("sidebar-command-palette-btn");
  const themeBtn = page.getByTestId("theme-toggle-btn");
  await expect(paletteBtn).toBeVisible();
  await expect(themeBtn).toBeVisible();

  // Nothing clipped: every header control sits inside the sidebar bounds.
  const sidebarBox = await page.getByTestId("left-sidebar").boundingBox();
  expect(sidebarBox).not.toBeNull();
  for (const control of [brand, paletteBtn, themeBtn, page.getByTestId("left-sidebar-toggle")]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(sidebarBox!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width + 1);
  }
});

test("header palette button opens the command palette", async ({ page }) => {
  await apiLoginAs(page, "sidehead-palette");
  await page.goto("/");
  await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });

  await page.getByTestId("sidebar-command-palette-btn").click();
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toBeHidden({ timeout: 10000 });
});
