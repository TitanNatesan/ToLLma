// Key status agreement + analytics error/empty + refresh refetch.
// Uses fresh signups + route mocking only (no live provider calls).
// Stable seams only: keys-table, key-row-*, key-details-panel,
// key-status-*, key-analytics-empty, key-analytics-body, key-range-refresh.
import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

function apiKeyRow(overrides: Record<string, unknown> = {}) {
  const id = `key-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  return {
    id,
    name: `Mock ${id}`,
    description: null,
    key_prefix: "tma_sk_live_mock123456",
    masked: "tma_sk_live_mo…",
    enabled: true,
    expires_at: null,
    last_used_at: null,
    rotation_count: 0,
    created_at: now,
    updated_at: now,
    policy: null,
    ip_rules: [],
    model_permissions: [],
    is_primary: false,
    is_default: false,
    ...overrides,
  };
}

function emptySummary(keyId: string) {
  return {
    range: { preset: "7d" },
    key: { id: keyId },
    requests: { total: 0, success: 0, failed: 0, cancelled: 0, timeout: 0, retry: 0 },
    performance: {
      avg_latency_ms: null, p50_ms: null, p90_ms: null, p95_ms: null,
      p99_ms: null, slowest_ms: null, fastest_ms: null,
    },
    cost: { total: 0, today: 0, last_7d: 0, last_30d: 0, projected_month: 0, cost_per_request: 0, cost_per_token: 0, most_expensive_request: null },
    tokens: { prompt: 0, completion: 0, reasoning: 0, cache_read: 0, cache_write: 0, total: 0, per_request: 0 },
    cache_savings: { tokens_saved: 0, money_saved: 0, by_provider: [] },
    providers: [],
    models: [],
    endpoints: [],
    insights: [],
  };
}

function emptyTimeseries() {
  return {
    range: { preset: "7d" },
    points: [],
    stacked: [],
    dual: [],
    latency: [],
  };
}

test.describe("api keys status + analytics seams", () => {
  test("listing and detail share the same usage-aware status", async ({ page }) => {
    await apiLoginAs(page, "keystatus");
    const usedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const expiredAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const used = apiKeyRow({ name: "Used key", last_used_at: usedAt });
    const unused = apiKeyRow({ name: "Unused key", last_used_at: null });
    const disabled = apiKeyRow({ name: "Disabled key", enabled: false, last_used_at: usedAt });
    const expired = apiKeyRow({ name: "Expired key", expires_at: expiredAt, last_used_at: usedAt });
    const byId: Record<string, typeof used> = {
      [used.id]: used, [unused.id]: unused, [disabled.id]: disabled, [expired.id]: expired,
    };

    await page.route("**/api/v1/keys**", async (route) => {
      const req = route.request();
      if (req.method() !== "GET") { await route.continue(); return; }
      const url = req.url();
      // List.
      if (url.endsWith("/api/v1/keys")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Object.values(byId)) });
        return;
      }
      // Detail for the KeyAnalytics keyQuery.
      const match = url.match(/\/api\/v1\/keys\/([^/?]+)(\?preset=.*)?$/);
      if (match && byId[match[1]]) {
        // Budget lookup (personal analytics) shares the same path with ?preset.
        if (url.includes("/analytics")) { await route.continue(); return; }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(byId[match[1]]) });
        return;
      }
      await route.continue();
    });
    // Rich analytics: always empty so the detail panel renders (status pill is above the tabs).
    await page.route("**/api/analytics/api-keys/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/timeseries")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptyTimeseries()) });
        return;
      }
      if (url.includes("/insights") || url.includes("/network")) {
        const empty = url.includes("/insights")
          ? { range: { preset: "7d" }, insights: [] }
          : { range: { preset: "7d" }, unique_ips: 0, blocked_ips: 0, allowed_ips: 0, new_ips: 0, ips: [], locations: [], devices: [], clients: [] };
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(empty) });
        return;
      }
      const id = url.split("/").pop()?.split("?")[0] ?? "mock";
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(emptySummary(id)) });
    });

    await page.goto("/api-keys");
    await expect(page.getByTestId("keys-table")).toBeVisible({ timeout: 20000 });

    // Table: usage-aware statuses (shared keyStatus basis).
    await expect(page.getByTestId(`key-row-${used.id}`)).toBeVisible();
    await expect(page.getByTestId(`key-row-${used.id}`).getByTestId("key-status-enabled")).toBeVisible();
    await expect(page.getByTestId(`key-row-${unused.id}`).getByTestId("key-status-inactive")).toBeVisible();
    await expect(page.getByTestId(`key-row-${disabled.id}`).getByTestId("key-status-disabled")).toBeVisible();
    await expect(page.getByTestId(`key-row-${expired.id}`).getByTestId("key-status-expired")).toBeVisible();

    // Detail: same pill for the same payload (no drift between list + detail).
    for (const [key, status] of [[used, "enabled"], [unused, "inactive"], [disabled, "disabled"], [expired, "expired"]] as const) {
      await page.getByTestId(`key-row-${key.id}`).click();
      await expect(page.getByTestId("key-details-panel")).toBeVisible({ timeout: 20000 });
      await expect(page.getByTestId("key-details-panel").getByTestId(`key-status-${status}`)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("key-details-panel")).not.toBeVisible();
    }
  });

  test("analytics error vs empty stay distinct", async ({ page }) => {
    await apiLoginAs(page, "keyerr");
    const created = await page.request.post(`${API}/api/v1/keys`, { data: { name: `err-${Date.now()}` } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const kid = ((await created.json()) as { key: { id: string } }).key.id;

    // Live shape keeps the test backend-agnostic; empty = zero traffic.
    const live = await page.request.get(`${API}/api/analytics/api-keys/${kid}`, { params: { preset: "7d" } });
    expect(live.ok(), await live.text()).toBeTruthy();
    const liveSummary = (await live.json()) as Record<string, unknown>;

    let mode: "error" | "empty" = "error";
    await page.route("**/api/analytics/api-keys/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/timeseries") || url.includes("/network") || url.includes("/insights")) {
        await route.continue();
        return;
      }
      if (mode === "error") {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom" }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(liveSummary) });
    });

    await page.goto("/api-keys");
    await expect(page.getByTestId(`key-row-${kid}`).or(page.getByTestId("keys-table"))).toBeVisible({ timeout: 20000 });
    const row = page.getByTestId(`key-row-${kid}`);
    if (await row.count()) {
      await row.click();
    } else {
      // List route not mocked here; fall back to the first row.
      await page.getByTestId("keys-table").locator("tbody tr").first().click();
    }
    await expect(page.getByTestId("key-details-panel")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("key-tab-analytics")).toBeVisible();
    // Error seam: retryable error state, never the empty-traffic copy.
    await expect(page.getByText("Could not load analytics")).toBeVisible({ timeout: 45000 });
    await expect(page.getByTestId("key-analytics-empty")).toHaveCount(0);

    // Empty seam: valid empty payload renders the empty state, not the error.
    mode = "empty";
    await page.getByTestId("key-range-refresh").click();
    await expect(page.getByTestId("key-analytics-empty")).toBeVisible({ timeout: 45000 });
    await expect(page.getByText("Could not load analytics")).toHaveCount(0);
  });

  test("refresh refetches analytics", async ({ page }) => {
    await apiLoginAs(page, "keyrefresh");
    const created = await page.request.post(`${API}/api/v1/keys`, { data: { name: `refresh-${Date.now()}` } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const kid = ((await created.json()) as { key: { id: string } }).key.id;
    const live = await page.request.get(`${API}/api/analytics/api-keys/${kid}`, { params: { preset: "7d" } });
    expect(live.ok(), await live.text()).toBeTruthy();
    const summary = (await live.json()) as Record<string, unknown>;

    let hits = 0;
    await page.route("**/api/analytics/api-keys/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/timeseries") || url.includes("/network") || url.includes("/insights")) {
        await route.continue();
        return;
      }
      hits += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(summary) });
    });

    await page.goto("/api-keys");
    await expect(page.getByTestId(`key-row-${kid}`).or(page.getByTestId("keys-table"))).toBeVisible({ timeout: 20000 });
    const row = page.getByTestId(`key-row-${kid}`);
    if (await row.count()) await row.click();
    else await page.getByTestId("keys-table").locator("tbody tr").first().click();
    await expect(page.getByTestId("key-details-panel")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("key-tab-analytics")).toBeVisible();
    // Wait for the first analytics fetch (empty or not, the query must have run).
    await expect(page.getByTestId("key-analytics").or(page.getByTestId("key-analytics-empty"))).toBeVisible({ timeout: 45000 });
    const before = hits;
    expect(before).toBeGreaterThan(0);
    await page.getByTestId("key-range-refresh").click();
    await expect.poll(async () => hits, { timeout: 20000 }).toBeGreaterThan(before);
  });
});
