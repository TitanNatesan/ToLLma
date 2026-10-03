import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

/** Organization sidebar mode + API-key model selector lifecycle. */

test.describe("org sidebar + key model lifecycle", () => {
  test.setTimeout(180000);
  test("management pages show workspaces, chat keeps conversations", async ({ page }) => {
    await apiLoginAs(page, "side");
    await page.goto("/organizations");
    await expect(page.getByTestId("sidebar-workspaces")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("sidebar-context-personal")).toBeVisible();
    await expect(page.getByTestId("sidebar-new-organization")).toBeVisible();
    // No conversation chrome on management pages.
    await expect(page.getByTestId("left-sidebar")).toContainText("Organizations");
    await page.goto("/api-keys");
    await expect(page.getByTestId("sidebar-workspaces")).toBeVisible({ timeout: 20000 });
    // Chat keeps the conversation sidebar.
    await page.goto("/");
    await expect(page.getByTestId("sidebar-workspaces")).toHaveCount(0);
  });

  test("workspace list, switching, empty state", async ({ page, request }) => {
    const { email } = await apiLoginAs(page, "side-orgs");
    void email;
    // Empty state for a user with no orgs.
    await page.goto("/organizations");
    await expect(page.getByTestId("sidebar-orgs-empty")).toBeVisible({ timeout: 20000 });
    // Create two orgs via UI.
    for (const name of ["Sidebar Org A", "Sidebar Org B"]) {
      await page.getByTestId("org-create-open").click();
      await page.getByTestId("org-create-name").fill(`${name} ${Date.now()}`);
      await page.getByTestId("org-create-submit").click();
      await expect(page.getByTestId("org-create-dialog")).toBeHidden({ timeout: 20000 });
    }
    const items = page.locator('[data-testid^="sidebar-context-org-"]');
    await expect(items).toHaveCount(2, { timeout: 20000 });
    // Switch context by clicking the second org.
    await items.nth(1).click();
    await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}/, { timeout: 20000 });
    // Organization detail shows the section nav; workspaces list stays on
    // the management overview pages.
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
    // Active context highlighted.
    const active = page.locator('[aria-current="page"]');
    await expect(active.first()).toBeVisible();
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
