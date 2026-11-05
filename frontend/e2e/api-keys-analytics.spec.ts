// Targeted headed check for the rich API-key observability tabs.
//   DISPLAY=:0 npx playwright test e2e/api-keys-analytics.spec.ts --headed --workers=1 --retries=1
// Uses the live account and the seeded "smoke" key (2 requests from the smoke run).
import { copyFileSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

/** Mirror artifacts outside test-results; concurrent suites wipe that folder. */
function mirror(source: string): void {
  const dir = "/tmp/opencode/tollma-shots";
  mkdirSync(dir, { recursive: true });
  copyFileSync(source, `${dir}/${source.split("/").pop()}`);
}

test.use({ viewport: { width: 1600, height: 1000 } });

const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";

test("analytics and network tabs render rich observability for the smoke key", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  page.setDefaultTimeout(30_000);

  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  expect(login.ok(), `login failed: ${login.status()}`).toBeTruthy();

  const keysResponse = await page.request.get(`${API}/api/v1/keys`);
  expect(keysResponse.ok(), `list keys failed: ${keysResponse.status()}`).toBeTruthy();
  const keys = (await keysResponse.json()) as Array<{ id: string; name: string }>;
  const smoke = keys.find((key) => key.name === "smoke") ?? keys[0];
  expect(smoke, "no API keys available for the live account").toBeTruthy();

  await page.goto("/api-keys");
  await expect(page.getByTestId("api-keys-page")).toBeVisible();

  // Open the details panel through the row action menu.
  await page.getByTestId(`key-actions-${smoke.id}`).click();
  await page.getByRole("menuitem", { name: /Details & analytics/ }).click();
  const panel = page.getByTestId("key-details-panel");
  await expect(panel).toBeVisible();

  // --- Analytics tab --------------------------------------------------------
  await page.getByTestId("key-tab-analytics").click();
  await expect(page.getByTestId("key-analytics-body")).toBeVisible({ timeout: 45_000 });

  // Four metric groups with their tiles.
  await expect(page.getByTestId("key-analytics-metrics")).toBeVisible();
  for (const group of ["requests", "performance", "cost", "tokens"]) {
    await expect(page.getByTestId(`key-metrics-${group}`)).toBeVisible();
  }

  // Insights panel and the cache-savings card.
  await expect(page.getByTestId("key-insights")).toBeVisible();
  await expect(page.getByTestId("key-cache-savings")).toBeVisible();

  // At least three Recharts containers (volume, cost/tokens, usage, latency, donuts…).
  const recharts = panel.locator(".recharts-responsive-container");
  await expect(recharts.first()).toBeVisible();
  expect(await recharts.count()).toBeGreaterThanOrEqual(3);

  // Filters: presets and refresh are present.
  await expect(page.getByTestId("key-range-24h")).toBeVisible();
  await expect(page.getByTestId("key-range-refresh")).toBeVisible();

  await page.screenshot({ path: "test-results/api-keys-analytics.png", fullPage: true });
  mirror("test-results/api-keys-analytics.png");
  await panel.screenshot({ path: "test-results/api-keys-analytics-panel.png" });
  mirror("test-results/api-keys-analytics-panel.png");

  // --- Network tab ----------------------------------------------------------
  await page.getByTestId("key-tab-network").click();
  await expect(page.getByTestId("key-network")).toBeVisible();
  await expect(page.getByTestId("key-network-clients")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("key-network-clients-donut")).toBeVisible();
  await expect(
    page.getByTestId("key-network-ip-table").or(page.getByTestId("key-network-ip-table-empty")),
  ).toBeVisible();

  // Client distribution chart uses Recharts when at least one client exists.
  await expect(
    page.getByTestId("key-network-clients").locator(".recharts-responsive-container"),
  ).toHaveCount(1);

  await page.screenshot({ path: "test-results/api-keys-network.png", fullPage: true });
  mirror("test-results/api-keys-network.png");
  await panel.screenshot({ path: "test-results/api-keys-network-panel.png" });
  mirror("test-results/api-keys-network-panel.png");
});

test("endpoint breakdown labels in-app traffic as Chat app", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  page.setDefaultTimeout(30_000);

  await apiLoginAs(page, "epbreak");
  const keyRes = await page.request.post(`${API}/api/v1/keys`, {
    data: { name: `ep-key-${Date.now()}` },
  });
  expect(keyRes.ok(), await keyRes.text()).toBeTruthy();
  const kid = ((await keyRes.json()) as { key: { id: string } }).key.id;

  // Shape the summary from the live shape: keep every field, inject one
  // in-app (`endpoint: "chat"`) row. Label-only assertions stay backend-agnostic.
  const live = await page.request.get(`${API}/api/analytics/api-keys/${kid}`, {
    params: { preset: "7d" },
  });
  expect(live.ok(), await live.text()).toBeTruthy();
  const summary = (await live.json()) as Record<string, unknown>;
  const requests = {
    ...((summary.requests ?? {}) as Record<string, unknown>),
    total: 5,
    success: 5,
    failed: 0,
  };
  const mocked = {
    ...summary,
    requests,
    endpoints: [{ endpoint: "chat", requests: 5, spend: "0.01", share: 1.0 }],
  };

  await page.route("**/api/analytics/api-keys/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/timeseries") || url.includes("/network") || url.includes("/insights")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mocked),
    });
  });

  await page.goto("/api-keys");
  const row = page.getByTestId(`key-row-${kid}`);
  await expect(row).toBeVisible({ timeout: 20000 });
  await row.click();
  await expect(page.getByTestId("key-details-panel")).toBeVisible({ timeout: 20000 });
  // Analytics is the default tab; the endpoint card renders the mocked rows.
  await expect(page.getByTestId("key-analytics-body")).toBeVisible({ timeout: 45000 });
  await expect(page.getByTestId("key-endpoint-table")).toContainText("Chat app");
  const caption = page.getByTestId("key-endpoints-caption");
  await expect(caption).toBeVisible();
  await expect(caption).toContainText("Totals include in-app chat-page traffic.");
});
