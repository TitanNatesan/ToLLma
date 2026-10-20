// Scenario 1: wizard registration + persistence (nothing saved before step 4).
import { expect, test } from "@playwright/test";
import { API, MOCK_URL, wizardRegister, apiLoginAs } from "./helpers";
import { startMockLLM } from "./mock-server";

test.beforeAll(async () => {
  await startMockLLM();
});

test("wizard registers only on finish, then persists", async ({ page, request }) => {
  await apiLoginAs(page, "prov");
  const name = `pw-prov-${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(name);
  await page.getByTestId("provider-platform-CUSTOM").click();
  // Abandon at step 1: nothing may be persisted.
  await page.keyboard.press("Escape");
  const list = await (await page.request.get(`${API}/api/v1/providers`)).json();
  expect(list.some((p: { name: string }) => p.name === name)).toBe(false);

  await wizardRegister(page, { name, type: "CUSTOM", baseUrl: MOCK_URL });

  // Detail view opens for the new provider (registration auto-selects it).
  const detail = page.getByTestId("provider-detail");
  await expect(detail).toContainText(name);

  // Only two provider actions exist: Validate + Refresh models.
  await expect(detail.getByRole("button", { name: "Validate" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Refresh models" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Catalog Import" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Sync models" })).toHaveCount(0);

  // Reload -> persists (database, not just client state).
  await page.reload();
  await expect(page.locator("section[aria-label='Provider list']").getByText(name)).toBeVisible();
});

test("org scope renders org providers with scope chip and remounts per org", async ({ page }) => {
  await apiLoginAs(page, "prov-org");
  const orgARes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `ProvScope A ${Date.now()}` },
  });
  expect(orgARes.ok(), await orgARes.text()).toBeTruthy();
  const orgA = await orgARes.json();
  const orgBRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `ProvScope B ${Date.now()}` },
  });
  expect(orgBRes.ok(), await orgBRes.text()).toBeTruthy();
  const orgB = await orgBRes.json();
  for (const [org, pname] of [[orgA, `ScopeAProv ${Date.now()}`], [orgB, `ScopeBProv ${Date.now()}`]] as const) {
    const r = await page.request.post(`${API}/api/v1/orgs/${(org as { id: string }).id}/providers`, {
      data: { name: pname, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  const provAName = (await (await page.request.get(`${API}/api/v1/orgs/${orgA.id}/providers`)).json())[0].name as string;
  const provBName = (await (await page.request.get(`${API}/api/v1/orgs/${orgB.id}/providers`)).json())[0].name as string;

  // Enter org A scope via its detail page, then the unified providers page shows org A data.
  await page.goto(`/organizations/${orgA.id}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("workspace-menu-trigger")).toContainText(orgA.name, { timeout: 20000 });
  // ORG header block has no toggle; unified items use exact pathnames.
  await expect(page.getByTestId("sidebar-org-toggle")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav").getByRole("button")).toHaveCount(0);
  // Unified org nav: all 13 items (Chat second).
  for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await expect(page.getByTestId(`sidebar-org-${section}`)).toBeVisible();
  }
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("href", "/providers");
  await page.goto("/providers");
  await expect(page.getByTestId("provider-scope-org")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("provider-scope-org")).toContainText(orgA.name);
  // Final nav rule: org scope shows ONLY the org nav (personal hidden).
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  // Org scope keeps the same bottom-anchored nav: logout stays visible as its last row.
  await expect(page.getByTestId("logout-btn")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toContainText("Log out");
  await expect(page.locator("section[aria-label='Provider list']").getByText(provAName)).toBeVisible();
  await expect(page.locator("section[aria-label='Provider list']").getByText(provBName)).toHaveCount(0);

  // Switching orgs remounts with the other org's data (key={orgId} per scope).
  await page.goto(`/organizations/${orgB.id}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("workspace-menu-trigger")).toContainText(orgB.name, { timeout: 20000 });
  await page.goto("/providers");
  await expect(page.getByTestId("provider-scope-org")).toContainText(orgB.name);
  await expect(page.locator("section[aria-label='Provider list']").getByText(provBName)).toBeVisible();
  await expect(page.locator("section[aria-label='Provider list']").getByText(provAName)).toHaveCount(0);

  // Legacy ?section=providers redirects to the unified page.
  await page.goto(`/organizations/${orgB.id}?section=providers`);
  await expect(page).toHaveURL(/\/providers/, { timeout: 20000 });
  // Chat entry links home and highlights on "/" in org scope.
  await page.goto("/");
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
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
});

test("org scope exposes register and view-details actions on available models", async ({ page }) => {
  await apiLoginAs(page, "prov-org-reg");
  const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `ProvReg Org ${Date.now()}` },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const org = await orgRes.json();
  const provRes = await page.request.post(`${API}/api/v1/orgs/${org.id}/providers`, {
    data: { name: `RegScopeProv ${Date.now()}`, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
  });
  expect(provRes.ok(), await provRes.text()).toBeTruthy();
  const prov = await provRes.json();
  // Seed one unregistered discovery entry so the Available panel has a row.
  const seed = await page.request.patch(`${API}/api/v1/orgs/${org.id}/providers/${prov.id}`, {
    data: {
      metadata: {
        discovery: {
          models: [
            {
              model_id: "mock-org-a",
              name: "Org Mock A",
              endpoint_type: "chat_completions",
              primary_endpoint: null,
              supported_endpoints: ["chat_completions"],
              context_window: null,
              max_output_tokens: null,
              repository_model_key: null,
              match_type: "fallback",
              suggested: { input_price: 2, output_price: 8 },
              repository_match: {},
            },
          ],
          last_discovery_at: new Date().toISOString(),
        },
      },
    },
  });
  expect(seed.ok(), await seed.text()).toBeTruthy();

  // Enter org scope, then the unified providers page shows org data.
  await page.goto(`/organizations/${org.id}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await page.goto("/providers");
  await expect(page.getByTestId("provider-scope-org")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("provider-scope-org")).toContainText(org.name);
  const section = page.locator("section[aria-label='Provider details']");
  await expect(section.getByTestId("available-row-mock-org-a")).toBeVisible({ timeout: 20000 });
  await expect(section.getByTestId("register-mock-org-a")).toBeVisible();
  await expect(section.getByTestId("available-details-mock-org-a")).toBeVisible();
});
