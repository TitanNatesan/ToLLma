// Platform admin dashboard: access gate + stacked-section rendering.
//   npx playwright test e2e/admin.spec.ts --headed --workers=1
// The admin half uses the promoted live account (read-only analytics page).
import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

test.use({ viewport: { width: 1920, height: 1080 } });

const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";

const SECTIONS = [
  "overview",
  "usage",
  "costs",
  "tokens",
  "providers",
  "models",
  "users",
  "media",
  "cache",
  "errors",
  "health",
] as const;

test("regular users see the forbidden state and no admin navigation", async ({ page }) => {
  await apiLoginAs(page, "admin-gate");
  await page.goto("/admin");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible({ timeout: 20_000 });
  // The Admin nav entry and the admin section navigator are role-gated.
  await expect(page.getByTestId("sidebar-admin-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-admin")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-admin-overview")).toHaveCount(0);
});

test("platform admin sees one section at a time with hash navigation", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  page.setDefaultTimeout(20_000);
  const response = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!response.ok()) throw new Error(`admin login failed: ${response.status()}`);

  await page.goto("/admin");
  // The app nav region is revealed by the profile-settings toggle.
  await page.getByTestId("profile-settings-btn").click();
  await expect(page.getByTestId("sidebar-admin-nav")).toBeVisible({ timeout: 20_000 });

  // The sidebar is now a dedicated admin section navigator, not conversations.
  await expect(page.getByTestId("sidebar-admin")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("conversation-search")).toHaveCount(0);
  await expect(page.getByTestId("new-chat")).toHaveCount(0);
  for (const section of SECTIONS) {
    await expect(page.getByTestId(`sidebar-admin-${section}`)).toBeVisible();
  }

  // Exactly ONE section renders — no stacked duplicate panels.
  await expect(page.getByTestId("admin-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("admin-panel-overview")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-testid^='admin-panel-']")).toHaveCount(1);
  await expect(page.getByTestId("admin-kpi-requests")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("admin-kpi-cost")).toBeVisible();
  await expect(page.locator(".recharts-responsive-container").first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: "test-results/admin-overview.png", fullPage: false });

  // Hash navigation swaps the rendered section in place.
  await page.getByTestId("sidebar-admin-tokens").click();
  await expect(page).toHaveURL(/#tokens$/);
  await expect(page.getByTestId("admin-panel-tokens")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-testid^='admin-panel-']")).toHaveCount(1);
  await expect(page.getByTestId("admin-panel-overview")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-admin-tokens")).toHaveAttribute("aria-current", "location");
  await page.screenshot({ path: "test-results/admin-tokens.png", fullPage: false });

  // Deep sections are reachable the same way (health uses its own panel).
  await page.getByTestId("sidebar-admin-health").click();
  await expect(page).toHaveURL(/#health$/);
  await expect(page.getByTestId("admin-panel-health")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-testid^='admin-panel-']")).toHaveCount(1);
  await page.screenshot({ path: "test-results/admin-health.png", fullPage: false });

  // Range switching re-queries and keeps the dashboard alive.
  await page.getByTestId("admin-range-last_30d").click();
  await page.getByTestId("sidebar-admin-overview").click();
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.getByTestId("admin-kpi-requests")).toBeVisible({ timeout: 20_000 });
});

test("live health streams over SSE and updates cards and charts", async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);
  page.setDefaultTimeout(25_000);
  const response = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!response.ok()) throw new Error(`admin login failed: ${response.status()}`);

  await page.goto("/admin#health");
  // Live badge + populated live cards from the first SSE frame.
  await expect(page.getByTestId("admin-health-stream-status")).toContainText(/live/i, { timeout: 25_000 });
  await expect(page.getByTestId("admin-health-cpu")).toContainText("%", { timeout: 25_000 });
  await expect(page.getByTestId("admin-health-memory")).toContainText("%", { timeout: 25_000 });
  await expect(page.getByTestId("admin-health-disk")).toContainText("%", { timeout: 25_000 });
  await expect(page.getByTestId("admin-health-db-status")).toContainText(/ok|down|degraded/i, { timeout: 25_000 });
  await expect(page.getByTestId("admin-health-queue-running")).toBeVisible();

  // Live charts render and keep the rolling window.
  for (const chart of ["cpu", "memory", "requests", "generations"]) {
    await expect(page.getByTestId(`admin-health-chart-${chart}`)).toBeVisible();
  }

  // A second SSE tick (2s interval) must extend the rolling window.
  const readSamples = async () => {
    const text = await page.getByTestId("admin-health-stream-samples").textContent();
    return parseInt(text ?? "0", 10);
  };
  const first = await readSamples();
  await page.waitForTimeout(4000);
  const second = await readSamples();
  expect(second).toBeGreaterThan(first);
  await page.screenshot({ path: "test-results/admin-health-live.png" });
});
