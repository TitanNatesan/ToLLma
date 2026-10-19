// Provider registration wizard: mapping, edit drawer, bulk edit, summary.
import { expect, test } from "@playwright/test";
import { API, MOCK_URL, apiLoginAs, selectDropdown } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard maps, edits and registers with match stats", async ({ page, request }) => {
  await apiLoginAs(page, "wizard");
  const name = `pw-wiz-${Date.now()}`;
  await page.goto("/providers");
  // Reset only the wizard draft (the modal reads it on open). Clearing all
  // storage or reloading here drops the session the app is still bootstrapping.
  await page.evaluate(() => {
    localStorage.removeItem("tollma-wizard-draft");
    localStorage.removeItem("tollma_provider_draft");
  });
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-platform-CUSTOM").click();
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("cred-base_url").fill(MOCK_URL);
  await page.getByTestId("wiz-validate").click();
  await expect(page.getByTestId("wiz-validation-result")).toContainText("Validation successful", { timeout: 20000 });
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-4")).toBeVisible({ timeout: 20000 });

  // Mapping ran: mock ids are unknown to the repository.
  await expect(page.getByTestId("wiz-selection-count")).toContainText("2 of 2");
  // Both mock ids matched as fallback (no repository entry).
  await selectDropdown(page, "wiz-match-filter", "fallback");
  await expect(page.getByTestId("wiz-model-mock-disc-a")).toBeVisible();
  await expect(page.getByTestId("wiz-model-mock-disc-b")).toBeVisible();
  await selectDropdown(page, "wiz-match-filter", "ALL");

  // Search narrows the list.
  await page.getByTestId("wiz-model-search").fill("disc-b");
  await expect(page.getByTestId("wiz-model-mock-disc-a")).not.toBeVisible();
  await page.getByTestId("wiz-model-search").fill("");

  // Per-model edit drawer.
  await page.getByTestId("wiz-edit-mock-disc-a").click();
  await expect(page.getByTestId("wiz-edit-drawer")).toBeVisible();
  await page.getByTestId("madd-name").fill("Disc A Renamed");
  await page.getByTestId("madd-output-price").fill("11");
  await page.getByTestId("madd-save").click();
  await expect(page.getByTestId("wiz-model-mock-disc-a")).toContainText("Disc A Renamed");

  // Summary shows registered models, then registration persists everything.
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-5")).toBeVisible();
  await expect(page.getByTestId("wiz-finish-models-list")).toBeVisible();
  await page.getByTestId("wiz-register").click();
  await expect(page.getByTestId("provider-detail")).toContainText(name, { timeout: 15000 });

  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const provider = providers.find((p: { name: string }) => p.name === name);
  const models = await (await page.request.get(`${API}/api/v1/models`, { params: { provider_id: provider.id } })).json();
  expect(models).toHaveLength(2);
  const renamed = models.find((m: { model_id: string }) => m.model_id === "mock-disc-a");
  expect(renamed.name).toBe("Disc A Renamed");
  expect(renamed.metadata.repository_match.match_type).toBe("fallback");
  expect(parseFloat(renamed.output_price)).toBe(11);
  const untouched = models.find((m: { model_id: string }) => m.model_id === "mock-disc-b");
  expect(untouched.name).toBe("mock-disc-b");
});

test("org scope unified pages and legacy redirects", async ({ page }) => {
  await apiLoginAs(page, "wizard-org");
  const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `WizScope ${Date.now()}` },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const org = await orgRes.json();
  const provRes = await page.request.post(`${API}/api/v1/orgs/${org.id}/providers`, {
    data: { name: `WizOrgProv ${Date.now()}`, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
  });
  expect(provRes.ok(), await provRes.text()).toBeTruthy();
  await page.goto(`/organizations/${org.id}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("workspace-menu-trigger")).toContainText(org.name, { timeout: 20000 });
  // ORG header block has no toggle; unified items use exact pathnames.
  await expect(page.getByTestId("sidebar-org-toggle")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav").getByRole("button")).toHaveCount(0);
  // Unified org nav: all 13 items (Chat second).
  for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await expect(page.getByTestId(`sidebar-org-${section}`)).toBeVisible();
  }
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("href", "/providers");
  await expect(page.getByTestId("sidebar-org-keys")).toHaveAttribute("href", "/api-keys");
  await expect(page.getByTestId("sidebar-org-analytics")).toHaveAttribute("href", "/analytics");
  await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("href", "/docs");
  await page.goto("/providers");
  await expect(page.getByTestId("provider-scope-org")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("provider-scope-org")).toContainText(org.name);
  // Final nav rule: org scope shows ONLY the org nav (personal hidden).
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("aria-current", "page");
  await page.goto("/api-keys");
  await expect(page.getByTestId("api-keys-scope-chip")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-keys")).toHaveAttribute("aria-current", "page");
  await page.goto("/analytics");
  await expect(page.getByTestId("analytics-scope")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-analytics")).toHaveAttribute("aria-current", "page");
  await page.goto("/docs");
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("aria-current", "page");
  await page.goto(`/organizations/${org.id}?section=analytics`);
  await expect(page).toHaveURL(/\/analytics/, { timeout: 20000 });
  await page.goto(`/organizations/${org.id}?section=operations&tab=keys`);
  await expect(page).toHaveURL(/\/api-keys/, { timeout: 20000 });
  await page.goto(`/organizations/${org.id}?section=operations`);
  await expect(page.getByTestId("org-ops-tab-requests")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("org-ops-tab-invitations")).toBeVisible();
  await expect(page.getByTestId("org-ops-tab-keys")).toHaveCount(0);
  // Chat entry links home and highlights on "/" in org scope.
  await page.goto("/");
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("aria-current", "page");
  // Collapsed rail mirrors the org nav set with active state.
  await page.getByTestId("left-sidebar-toggle").click();
  await expect(page.getByTestId("sidebar-reveal-rail")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("rail-expand")).toHaveAttribute("aria-label", "Expand sidebar");
  await expect(page.getByTestId("rail-command-palette")).toHaveAttribute("aria-label", "Open command palette");
  await expect(page.getByTestId("rail-notifications")).toHaveAttribute("aria-label", /Notifications/);
  for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await expect(page.getByTestId(`rail-org-${section}`)).toBeVisible();
  }
  await expect(page.getByTestId("rail-org-chat")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-nav-toggle")).toHaveAttribute("aria-label", "Hide navigation");
  await page.getByTestId("rail-profile-menu").click();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByTestId("rail-expand").click();
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
});
