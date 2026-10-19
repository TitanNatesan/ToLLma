import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

/** Organization sidebar mode + API-key model selector lifecycle. */

test.describe("org sidebar + key model lifecycle", () => {
  test.setTimeout(180000);
  test("management pages show workspaces, chat keeps conversations", async ({ page }) => {
    await apiLoginAs(page, "side");
    await page.goto("/settings#organizations");
    await expect(page.getByTestId("workspace-menu-trigger")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("settings-section-organizations")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("settings-organizations")).toBeVisible();
    // Workspace selection lives in the explicit chevron button showing "Personal".
    await expect(page.getByTestId("workspace-menu-trigger")).toContainText("Personal");
    await expect(page.getByTestId("workspace-menu-trigger")).toHaveRole("button");
    await page.getByTestId("workspace-menu-trigger").click();
    await expect(page.getByTestId("workspace-menu")).toBeVisible();
    await expect(page.getByTestId("workspace-menu-personal")).toBeVisible();
    const newOrg = page.getByTestId("workspace-menu-new-org");
    await expect(newOrg).toBeVisible();
    await expect(newOrg).toContainText("New organization");
    // Join lives on the Settings organizations page now — no menu entry.
    await expect(page.getByTestId("workspace-menu-join-org")).toHaveCount(0);
    // Single entry point links to the settings organizations section.
    await expect(page.getByTestId("workspace-menu").locator('a[href="/settings#organizations"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    // No conversation chrome on management pages.
    await expect(page.getByTestId("left-sidebar")).toContainText("Organizations");
    await page.goto("/api-keys");
    await expect(page.getByTestId("workspace-menu-trigger")).toBeVisible({ timeout: 20000 });
    // Personal scope: personal nav visible, org nav hidden.
    await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible();
    await expect(page.getByTestId("sidebar-org-nav")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-footer")).toBeVisible();
    // Log out is the last row of the bottom-anchored nav (not the footer).
    await expect(page.getByTestId("logout-btn")).toBeVisible();
    await expect(page.getByTestId("logout-btn")).toContainText("Log out");
    // Chat keeps the conversation sidebar alongside the profile menu.
    await page.goto("/");
    await expect(page.getByTestId("workspace-menu-trigger")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("conversation-search")).toBeVisible({ timeout: 20000 });
    // Personal Chat entry links home and is active on "/".
    await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible();
    await expect(page.getByTestId("sidebar-nav-chat")).toHaveAttribute("href", "/");
    await expect(page.getByTestId("sidebar-nav-chat")).toHaveAttribute("aria-current", "page");
  });

  test("workspace list, switching, empty state", async ({ page, request }) => {
    const { email } = await apiLoginAs(page, "side-orgs");
    void email;
    // Empty state for a user with no orgs.
    await page.goto("/settings#organizations");
    await expect(page.getByTestId("workspace-menu-trigger")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("settings-organizations")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("settings-organizations")).toContainText("No organizations yet", { timeout: 20000 });
    // Create two orgs via UI.
    for (const name of ["Sidebar Org A", "Sidebar Org B"]) {
      await page.getByTestId("org-create-open").click();
      await page.getByTestId("org-create-name").fill(`${name} ${Date.now()}`);
      await page.getByTestId("org-create-submit").click();
      await expect(page.getByTestId("org-create-dialog")).toBeHidden({ timeout: 20000 });
    }
    await expect(page.getByTestId("settings-organizations")).toContainText("Sidebar Org A", { timeout: 20000 });
    await expect(page.getByTestId("settings-organizations")).toContainText("Sidebar Org B", { timeout: 20000 });
    // Workspace menu lists both orgs.
    await page.getByTestId("workspace-menu-trigger").click();
    await expect(page.getByTestId("workspace-menu")).toBeVisible();
    const items = page.locator('[data-testid^="workspace-menu-org-"]');
    await expect(items).toHaveCount(2, { timeout: 20000 });
    // Switch context by clicking the second org.
    await items.nth(1).click();
    await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}/, { timeout: 20000 });
    // Final nav rule: org scope shows ONLY the org nav (personal hidden).
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-workspace-switcher")).toHaveCount(0);
    await expect(page.locator('[data-testid^="sidebar-ws-"]')).toHaveCount(0);
    await expect(page.getByTestId("workspace-menu-trigger")).not.toContainText("Personal");
    // Unified org nav: all 13 items (Chat second) with exact-pathname unified hrefs.
    for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
      await expect(page.getByTestId(`sidebar-org-${section}`)).toBeVisible();
    }
    await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
    await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("href", "/providers");
    await expect(page.getByTestId("sidebar-org-keys")).toHaveAttribute("href", "/api-keys");
    await expect(page.getByTestId("sidebar-org-analytics")).toHaveAttribute("href", "/analytics");
    await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("href", "/docs");
    // ORG header block has no toggle.
    await expect(page.getByTestId("sidebar-org-toggle")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-org-nav").getByRole("button")).toHaveCount(0);
    // Active context highlighted.
    const active = page.locator('[aria-current="page"]');
    await expect(active.first()).toBeVisible();
    // Chat entry links home and highlights on "/" in org scope.
    await page.goto("/");
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
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
    await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("aria-current", "page");
  });

  test("org scope unified pages, legacy redirects, operations tabs", async ({ page }) => {
    await apiLoginAs(page, "side-unified");
    const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
      data: { name: `Unified Org ${Date.now()}` },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const orgId = (await orgRes.json()).id as string;
    const orgName = (await orgRes.json()).name as string;
    const provRes = await page.request.post(`${API}/api/v1/orgs/${orgId}/providers`, {
      data: { name: `UnifiedProv ${Date.now()}`, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
    });
    expect(provRes.ok(), await provRes.text()).toBeTruthy();
    const provName = (await provRes.json()).name as string;
    // Enter org scope via the detail page (writes the workspace context).
    await page.goto(`/organizations/${orgId}`);
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);

    // Unified pages render org data in org scope with remount per org.
    await page.goto("/providers");
    await expect(page.getByTestId("provider-scope-org")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("provider-scope-org")).toContainText(orgName);
    await expect(page.locator("section[aria-label='Provider list']").getByText(provName)).toBeVisible();
    await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
    await page.goto("/api-keys");
    await expect(page.getByTestId("api-keys-scope-chip")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("api-keys-scope-chip")).toContainText("Organization");
    await expect(page.getByTestId("org-keys")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("sidebar-org-keys")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
    await page.goto("/analytics");
    await expect(page.getByTestId("analytics-page")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("analytics-scope")).toContainText(orgName);
    await expect(page.getByTestId("sidebar-org-analytics")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
    await page.goto("/docs");
    await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);

    // Legacy deep links redirect to the unified pages.
    await page.goto(`/organizations/${orgId}?section=providers`);
    await expect(page).toHaveURL(/\/providers/, { timeout: 20000 });
    await page.goto(`/organizations/${orgId}?section=analytics`);
    await expect(page).toHaveURL(/\/analytics/, { timeout: 20000 });
    await page.goto(`/organizations/${orgId}?section=operations&tab=keys`);
    await expect(page).toHaveURL(/\/api-keys/, { timeout: 20000 });
    await page.goto(`/organizations/${orgId}?section=keys`);
    await expect(page).toHaveURL(/\/api-keys/, { timeout: 20000 });

    // Operations has only requests + invitations tabs.
    await page.goto(`/organizations/${orgId}?section=operations`);
    await expect(page.getByTestId("org-operations")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("org-ops-tabs")).toBeVisible();
    await expect(page.getByTestId("org-ops-tab-requests")).toBeVisible();
    await expect(page.getByTestId("org-ops-tab-invitations")).toBeVisible();
    await expect(page.getByTestId("org-ops-tab-keys")).toHaveCount(0);
    // Chat entry links home and highlights on "/" in org scope.
    await page.goto("/");
    await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
    await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  });

  test("deleted provider models vanish from key creation (UI)", async ({ page, request }) => {
    await apiLoginAs(page, "side-key");
    async function addProviderWithModel(pname: string, mid: string, mname: string) {
      const prov = await page.request.post(`${API}/api/v1/providers`, {
        data: { name: pname, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
      });
      expect(prov.ok(), await prov.text()).toBeTruthy();
      const providerId = (await prov.json()).id as string;
      const model = await page.request.post(`${API}/api/v1/models`, {
        data: {
          provider_id: providerId, model_id: mid, name: mname,
          endpoint_type: "chat_completions", input_price: "1", output_price: "2",
        },
      });
      expect(model.ok(), await model.text()).toBeTruthy();
      return providerId;
    }
    const doomedId = await addProviderWithModel("Ephemeral", "ephemeral-model", "Ephemeral Model");
    await addProviderWithModel("Survivor", "survivor-model", "Survivor Model");
    // Both models visible before deletion.
    await page.goto("/api-keys");
    await page.getByTestId("create-key-button").click();
    await expect(page.getByTestId("model-permissions-search")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("model-permissions-search").fill("ephemeral-model");
    await expect(page.getByText("Ephemeral Model").first()).toBeVisible({ timeout: 20000 });
    await page.keyboard.press("Escape");
    // Delete one provider connection.
    const del = await page.request.delete(`${API}/api/v1/providers/${doomedId}`);
    expect([200, 204]).toContain(del.status());
    // Reopen: deleted models absent, survivor still selectable, no duplicates.
    await page.goto("/api-keys");
    await page.getByTestId("create-key-button").click();
    await expect(page.getByTestId("model-permissions-search")).toBeVisible({ timeout: 20000 });
    await page.getByTestId("model-permissions-search").fill("ephemeral-model");
    await expect(page.getByText("Ephemeral Model")).toHaveCount(0);
    await page.getByTestId("model-permissions-search").fill("survivor-model");
    await expect(page.getByText("Survivor Model").first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Survivor Model")).toHaveCount(1);
    await page.keyboard.press("Escape");
  });

  test("canonical family grouping with logos (UI)", async ({ page, request }) => {
    await apiLoginAs(page, "side-group");
    const prov = await page.request.post(`${API}/api/v1/providers`, {
      data: { name: "GroupMe", provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
    });
    const providerId = (await prov.json()).id as string;
    await page.request.post(`${API}/api/v1/models`, {
      data: {
        provider_id: providerId, model_id: "group-model", name: "Group Model",
        endpoint_type: "chat_completions", input_price: "1", output_price: "2",
      },
    });
    await page.goto("/api-keys");
    await page.getByTestId("create-key-button").click();
    await expect(page.getByTestId("model-permissions-search")).toBeVisible({ timeout: 20000 });
    // CUSTOM family group exists; connection name shown on the row.
    await expect(page.getByTestId("model-group-CUSTOM")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("model-group-CUSTOM")).toContainText("GroupMe");
    // No raw-URL groups; provider logos render or fall back gracefully.
    await expect(page.locator("[data-testid^='model-group-']:not([data-testid^='model-group-CUSTOM']):not([data-testid^='model-group-OPENAI']):not([data-testid^='model-group-ANTHROPIC_MESSAGES']):not([data-testid^='model-group-GEMINI']):not([data-testid^='model-group-VERTEX_AI']):not([data-testid^='model-group-BEDROCK_CONVERSE'])")).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
