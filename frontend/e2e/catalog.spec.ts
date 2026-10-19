import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, selectDropdown } from "./helpers";

async function verifiedSignupAndVerify(request: APIRequestContext, tag: string): Promise<string> {
  const email = `pw-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tollma.ai`;
  const signup = await request.post(`${API}/auth/signup`, { data: { email, password: "Password123" } });
  if (!signup.ok()) throw new Error(`e2e signup failed: ${await signup.text()}`);
  const token = (await signup.json()).debug_verification_token as string | null;
  if (token) await request.get(`${API}/auth/verify`, { params: { token } });
  return email;
}

/** Provider catalog E2E: discovery metadata, logos, search/filter,
 * gateway distinction, and personal/org connection flows. */

test.describe("provider catalog", () => {
  test("catalog loads with stats, search, and gateway filter (UI)", async ({ page, request }) => {
    await verifiedSignupAndVerify(request, "catalog");
    await page.goto("/providers");
    await page.getByTestId("browse-catalog").click();
    await expect(page.getByTestId("catalog-dialog")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("catalog-stats")).toContainText("providers", { timeout: 30000 });
    const cards = page.locator('[data-testid^="catalog-card-"]');
    await expect(cards.first()).toBeVisible({ timeout: 30000 });
    // Pagination density is 12/page (redesigned cards): page 1 holds >0 and <=12.
    const pageOneCount = await cards.count();
    expect(pageOneCount).toBeGreaterThan(0);
    expect(pageOneCount).toBeLessThanOrEqual(12);
    await expect(page.getByTestId("catalog-results-count")).toContainText(/Showing \d+ of \d+ providers?/);
    if (await page.getByTestId("catalog-pages").count()) {
      await expect(page.getByTestId("catalog-pages")).toContainText(/Page \d+ of \d+/);
    }
    // Search narrows to anthropic.
    await page.getByTestId("catalog-search").fill("anthropic");
    await page.getByTestId("catalog-search").press("Enter");
    await expect(page.getByTestId("catalog-card-anthropic")).toBeVisible({ timeout: 20000 });
    // Gateway-supported badge + logo img (or graceful fallback, never broken).
    const card = page.getByTestId("catalog-card-anthropic");
    await expect(card).toContainText("Gateway supported");
    const imgs = card.locator("img");
    if (await imgs.count()) {
      await expect(imgs.first()).toHaveAttribute("src", "https://models.dev/logos/anthropic.svg");
      await expect(imgs.first()).toHaveAttribute("alt", /Anthropic logo/);
    }
    // Catalog-only filter hides gateway-supported rows.
    await selectDropdown(page, "catalog-gateway-filter", "catalog-only");
    await expect(page.getByTestId("catalog-card-anthropic")).toHaveCount(0, { timeout: 20000 });
    // Supported filter shows them again.
    await selectDropdown(page, "catalog-gateway-filter", "supported");
    await expect(page.getByTestId("catalog-card-anthropic")).toBeVisible({ timeout: 20000 });
    await page.keyboard.press("Escape");
  });

  test("catalog-only provider cannot be configured (UI)", async ({ page, request }) => {
    await verifiedSignupAndVerify(request, "catalog-block");
    await page.goto("/providers");
    await page.getByTestId("browse-catalog").click();
    await expect(page.getByTestId("catalog-dialog")).toBeVisible({ timeout: 20000 });
    await selectDropdown(page, "catalog-gateway-filter", "catalog-only");
    const first = page.locator('[data-testid^="catalog-card-"]').first();
    await expect(first).toBeVisible({ timeout: 30000 });
    await expect(first).toContainText("Catalog only");
    // Configure is disabled; no wizard opens.
    const btn = first.getByRole("button", { name: "Configure" });
    await expect(btn).toBeDisabled();
    await page.keyboard.press("Escape");
  });

  test("catalog configure launches gateway wizard prefilled (UI)", async ({ page, request }) => {
    await verifiedSignupAndVerify(request, "catalog-config");
    await page.goto("/providers");
    await page.getByTestId("browse-catalog").click();
    await expect(page.getByTestId("catalog-dialog")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("catalog-search").fill("anthropic");
    await page.getByTestId("catalog-search").press("Enter");
    await page.getByTestId("catalog-configure-anthropic").click();
    // Wizard opens with the Anthropic family preselected (step: credentials).
    await expect(page.getByTestId("wizard-step-1")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("wizard-step-1")).toContainText("Anthropic");
    await page.keyboard.press("Escape");
  });

  test("wizard SEARCH card previews picked provider (UI)", async ({ page, request }) => {
    await verifiedSignupAndVerify(request, "catalog-search-card");
    await page.goto("/providers");
    await page.getByTestId("add-provider").click();
    await expect(page.getByTestId("wizard-step-1")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("provider-platform-SEARCH").click();
    await expect(page.getByTestId("catalog-dialog")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("catalog-search").fill("anthropic");
    await page.getByTestId("catalog-search").press("Enter");
    await expect(page.getByTestId("catalog-card-anthropic")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("catalog-configure-anthropic").click();
    // Wizard returns to step 1 with the Anthropic family preselected.
    await expect(page.getByTestId("wizard-step-1")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("wizard-step-1")).toContainText("Anthropic");
    // SEARCH card previews the picked provider's name/logo.
    const searchCard = page.getByTestId("provider-platform-SEARCH");
    await expect(searchCard).toContainText("Anthropic");
    await expect(searchCard.locator('img[alt*="logo"]')).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("provider connections keep working (API)", async ({ request }) => {
    await verifiedSignupAndVerify(request, "catalog-conn");
    const prov = await request.post(`${API}/api/v1/providers`, {
      data: { name: "CatalogConn", provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
    });
    expect(prov.ok(), await prov.text()).toBeTruthy();
    const val = await request.post(`${API}/api/v1/providers/${(await prov.json()).id}/validate`, { data: {} });
    expect([200, 422]).toContain(val.status());
  });

  test("admin catalog section shows stats + top providers (UI)", async ({ page, request }) => {
    const email = await verifiedSignupAndVerify(request, "catalog-admin");
    const { execSync } = await import("node:child_process");
    execSync(`docker compose exec -T backend python scripts/promote_admin.py ${email}`, {
      cwd: "/home/ond/Projects/ToLLms", shell: "/bin/bash", timeout: 60000,
    });
    await page.goto("/login");
    await page.getByTestId("login-email").fill(email);
    await page.getByTestId("login-password").fill("Password123");
    await page.getByTestId("login-submit").click();
    await page.goto("/admin#catalog");
    await expect(page.getByTestId("admin-catalog")).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("admin-catalog-active")).not.toBeEmpty({ timeout: 30000 });
    await expect(page.getByTestId("admin-catalog-supported")).toBeVisible();
    await expect(page.getByTestId("admin-catalog-sync")).toBeVisible();
  });
});
