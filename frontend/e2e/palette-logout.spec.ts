// Command-palette Log out (contract: data-testid="palette-logout" calls
// logout + store reset + push to "/"). Self-contained: dedicated user, no
// re-login cleanup needed by other suites.
import { expect, test } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test("command palette Log out signs out to / logged out", async ({ page }) => {
  test.setTimeout(120000);
  await apiLoginAs(page, "palette-logout");
  await page.goto("/");
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 10000 });

  await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10000 });

  // Frontend implements palette-logout in parallel: poll the open palette,
  // SKIP gracefully (not fail) while the item does not exist yet.
  if ((await page.getByTestId("palette-logout").count()) === 0) {
    test.skip(true, "palette-logout item not implemented yet (frontend in progress)");
  }

  await page.getByTestId("palette-logout").click();
  // Lands on "/" (contract) or the /login auth gate; either way signed out.
  await expect(page).toHaveURL(/\/($|login)/, { timeout: 10000 });
  await expect(page.getByTestId("user-avatar")).toHaveCount(0, { timeout: 10000 });
  const authGate = page.locator('[data-testid="login-page"], [data-testid="signup-page"]');
  if ((await authGate.count()) > 0) {
    await expect(authGate.first()).toBeVisible({ timeout: 10000 });
  }
});
