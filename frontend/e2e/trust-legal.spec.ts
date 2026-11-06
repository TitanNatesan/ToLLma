// Legal center index + viewer (Agent E, Wave 3, live registry).
import { expect, test } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test("legal index lists the 20 live documents without degraded note", async ({ page }) => {
  await apiLoginAs(page, "trust-legal");
  await page.goto("/legal");
  await expect(page.getByTestId("legal-page")).toBeVisible();
  await expect(page.getByTestId("legal-doc-list")).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid^="legal-doc-row-"]')).toHaveCount(20);
  await expect(page.getByTestId("legal-degraded-note")).toHaveCount(0);
  await expect(page.getByTestId("legal-doc-terms-of-service")).toBeVisible();
  await expect(page.getByTestId("legal-reaccept-banner")).toHaveCount(0);
});

test("legal viewer surfaces the live acceptance state", async ({ page }) => {
  await apiLoginAs(page, "trust-viewer");
  await page.goto("/legal/privacy-notice");
  await expect(page.getByTestId("legal-doc-page")).toBeVisible();
  await expect(page.getByTestId("legal-viewer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("legal-viewer-meta")).toContainText("en-IN");
  // Signup auto-accepts all 20 published docs, so a fresh user already shows
  // the recorded state from acceptances/me (the submit path is covered by
  // the trust service unit tests; it activates on major version bumps).
  await expect(page.getByTestId("legal-accept-unavailable")).toHaveCount(0);
  await expect(page.getByTestId("legal-accept-done")).toContainText("accepted", { timeout: 15000 });
});

test("legal viewer shows not-found for unknown slugs", async ({ page }) => {
  await apiLoginAs(page, "trust-missing");
  await page.goto("/legal/no-such-document-xyz");
  await expect(page.getByTestId("legal-doc-missing")).toBeVisible({ timeout: 15000 });
});

test("legal index degrades to the bundled catalogue when the API is absent", async ({ page }) => {
  await apiLoginAs(page, "trust-degraded");
  await page.route("**/api/v1/legal/documents*", (route) => route.abort());
  await page.goto("/legal");
  await expect(page.getByTestId("legal-degraded-note")).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid^="legal-doc-row-"]')).toHaveCount(20);
  await page.unroute("**/api/v1/legal/documents*");
});

test("legal viewer shows seed body with unavailable note when the API is absent", async ({ page }) => {
  await apiLoginAs(page, "trust-degraded-doc");
  await page.route("**/api/v1/legal/documents/*", (route) => route.abort());
  await page.goto("/legal/privacy-notice");
  await expect(page.getByTestId("legal-viewer")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("legal-accept-unavailable")).toBeVisible();
  await page.unroute("**/api/v1/legal/documents/*");
});
