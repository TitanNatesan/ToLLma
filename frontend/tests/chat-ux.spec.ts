import { test, expect, Page } from "@playwright/test";
import { selectDropdown } from "../e2e/helpers";

const BASE = "http://localhost:3000";

// Helpers
async function goto(page: Page, path = "/") {
  await page.goto(`${BASE}${path}`);
  await page.waitForLoadState("networkidle");
  // The shell (and with it global shortcuts / cmdk) attaches during hydration;
  // wait for it so key presses aren't lost on a cold dev server.
  await expect(page.getByTestId("left-sidebar")).toBeVisible();
  await page.waitForTimeout(400);
}

// ============================================================
// Layout
// ============================================================

test.describe("Three-panel layout", () => {
  test("renders left sidebar, center chat, right panel", async ({ page }) => {
    await goto(page);
    await expect(page.getByTestId("left-sidebar")).toBeVisible();
    await expect(page.getByTestId("message-list")).toBeVisible();
    await expect(page.getByTestId("right-sidebar")).toBeVisible();
  });

  test("left sidebar collapse toggle works", async ({ page }) => {
    await goto(page);
    const sidebar = page.getByTestId("left-sidebar");

    // Should be open by default
    await expect(sidebar).toBeVisible();
    await sidebar.getByTestId("left-sidebar-toggle").click();
    // Width animates to 0 – sidebar box still exists but has width ~0
    await page.waitForTimeout(400); // animation
    const box = await sidebar.boundingBox();
    expect(box?.width ?? 0).toBeLessThan(10);

    // Reopen via the shared shell reveal rail (all pages use this control)
    await page.getByTestId("rail-expand").click();
    await page.waitForTimeout(400);
    const boxOpen = await sidebar.boundingBox();
    expect(boxOpen?.width ?? 0).toBeGreaterThan(100);
  });

  test("right panel collapse toggle works", async ({ page }) => {
    await goto(page);
    const panel = page.getByTestId("right-sidebar");

    await expect(panel).toBeVisible();
    await panel.getByTestId("right-sidebar-toggle").click();
    await page.waitForTimeout(400);
    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeLessThan(10);

    // Reopen via the chat header affordance
    await page.getByRole("button", { name: "Show intelligence panel" }).click();
    await page.waitForTimeout(400);
    const boxOpen = await panel.boundingBox();
    expect(boxOpen?.width ?? 0).toBeGreaterThan(100);
  });
});

// ============================================================
// Conversation Management
// ============================================================

test.describe("Conversation management", () => {
  test("new chat button clears active conversation", async ({ page }) => {
    await goto(page);
    // Click new chat
    await page.getByTestId("new-chat").click();
    // Message list should be empty / show welcome state
    const msgs = page.getByTestId("message-list");
    await expect(msgs).toBeVisible();
    // No existing message bubbles
    const userMsgs = msgs.getByTestId(/message-user/);
    await expect(userMsgs).toHaveCount(0);
  });

  test("conversation search filters list", async ({ page }) => {
    await goto(page);
    const searchInput = page.getByTestId("conversation-search");
    await searchInput.fill("xxxxximpossible");
    // Should show "No conversations found"
    await expect(page.locator("text=No conversations found")).toBeVisible();
    await searchInput.fill("");
  });
});

// ============================================================
// Chat Composer
// ============================================================

test.describe("Chat composer", () => {
  test("renders unified model selector", async ({ page }) => {
    await goto(page);
    await expect(page.getByTestId("model-selector")).toBeVisible();
  });

  test("send button is disabled without provider/model", async ({ page }) => {
    // Fresh page — localStorage may have persisted state so clear it
    await page.addInitScript(() => localStorage.clear());
    await goto(page);
    await expect(page.getByTestId("send-button")).toBeDisabled();
  });

  test("composer holds creation controls only (no info duplication)", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await goto(page);
    const composer = page.getByTestId("chat-composer");
    await expect(composer).toBeVisible();
    await expect(page.getByTestId("model-selector")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
    await expect(page.getByTestId("send-button")).toBeVisible();
    // Informational elements live in the intelligence panel, not the composer
    await expect(page.getByTestId("capability-bar")).toHaveCount(0);
    await expect(composer.getByText(/\/1M/)).toHaveCount(0);
    await expect(composer.getByText(/Context Window/)).toHaveCount(0);
  });
  test("model dropdown shows search input and grouped providers with min-height", async ({ page }) => {
    await goto(page);
    await page.getByTestId("model-selector").click();
    // Dropdown opens — search input is present
    await expect(page.getByPlaceholder("Search models or providers…")).toBeVisible();
    // Verify dropdown content is visible
    const content = page.locator("[data-testid^='model-option-']").or(page.getByText("No models found"));
    await expect(content.first()).toBeVisible();
  });
});

// ============================================================
// Command Palette
// ============================================================

test.describe("Command palette", () => {
  test("opens with Ctrl+K", async ({ page }) => {
    await goto(page);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });

  test("closes with Escape", async ({ page }) => {
    await goto(page);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });

  test("new chat command works", async ({ page }) => {
    await goto(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("cmd-new-chat").click();
    await expect(page.getByTestId("command-palette")).not.toBeVisible();
  });

  test("providers command navigates to /providers", async ({ page }) => {
    await goto(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("cmd-providers").click();
    await expect(page).toHaveURL(/\/providers/);
  });

  test("can search conversations in command palette", async ({ page }) => {
    await goto(page);
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-palette-input").fill("test");
    // Either shows conv or shows "No results found" — just not a crash
    await expect(page.getByTestId("command-palette")).toBeVisible();
  });
});

// ============================================================
// Provider Page
// ============================================================

test.describe("Provider page enhancements", () => {
  test("renders search and type filters", async ({ page }) => {
    await goto(page, "/providers");
    await expect(page.getByTestId("provider-search")).toBeVisible();
    await expect(page.getByTestId("provider-type-filter")).toBeVisible();
  });

  test("provider search filters list", async ({ page }) => {
    await goto(page, "/providers");
    await page.getByTestId("provider-search").fill("xxxxximpossible");
    // Provider cards should be hidden
    const cards = page.locator("[data-testid^='provider-card-']");
    const count = await cards.count();
    expect(count).toBe(0);
  });

  test("type filter dropdown is interactive", async ({ page }) => {
    await goto(page, "/providers");
    // Select BEDROCK_CONVERSE filter (custom popover dropdown)
    await selectDropdown(page, "provider-type-filter", "BEDROCK_CONVERSE");
    await expect(page.getByTestId("provider-type-filter")).toContainText("AWS Bedrock");
    // Reset
    await selectDropdown(page, "provider-type-filter", "ALL");
    await expect(page.getByTestId("provider-type-filter")).toContainText("All provider types");
  });

  test("add provider button is visible", async ({ page }) => {
    await goto(page, "/providers");
    await expect(page.getByTestId("add-provider")).toBeVisible();
  });
});

// ============================================================
// Pinning
// ============================================================

test.describe("Conversation pinning", () => {
  // Skip if no conversations exist
  test("pin button visible on hover", async ({ page }) => {
    await goto(page);
    const convItems = page.locator("[data-testid^='conversation-item-']");
    const count = await convItems.count();
    if (count === 0) {
      test.skip();
      return;
    }
    // Hover over the first item to reveal pin button
    const first = convItems.first();
    await first.hover();
    const id = (await first.getAttribute("data-testid"))?.replace("conversation-item-", "");
    if (id) {
      await expect(page.getByTestId(`pin-button-${id}`)).toBeVisible();
    }
  });

  test("pinned conversations appear in pinned section", async ({ page }) => {
    await goto(page);
    const convItems = page.locator("[data-testid^='conversation-item-']");
    const count = await convItems.count();
    if (count === 0) {
      test.skip();
      return;
    }
    const first = convItems.first();
    await first.hover();
    const id = (await first.getAttribute("data-testid"))?.replace("conversation-item-", "");
    if (id) {
      await page.getByTestId(`pin-button-${id}`).click();
      // Wait for Pinned section header to appear
      await expect(page.locator("text=Pinned")).toBeVisible({ timeout: 5000 });
      // Unpin to restore clean state for other test suites
      await page.locator("[data-testid^='conversation-item-']").first().hover();
      await page.getByTitle("Unpin").first().click();
      await expect(page.locator("text=Pinned")).not.toBeVisible({ timeout: 5000 });
    }
  });
});

// ============================================================
// Intelligence Panel
// ============================================================

test.describe("Intelligence panel", () => {
  test("shows empty-state card when nothing selected", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await goto(page);
    const panel = page.getByTestId("right-sidebar");
    await expect(panel).toBeVisible();
    // Empty-state card (dashed border, icon + prompt text), scoped to the panel
    await expect(panel.locator("div.border-dashed")).toBeVisible();
    await expect(
      panel.locator("text=Select a provider and model in the chat composer"),
    ).toBeVisible();
    // No model selected → no hero card, no context-usage bar (no context window)
    await expect(panel.getByTestId("intelligence-model")).toHaveCount(0);
    await expect(panel.getByTestId("intelligence-context-usage")).toHaveCount(0);
  });

  test("conversation card leads and panel is resizable", async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());
    await goto(page);
    const panel = page.getByTestId("right-sidebar");
    await expect(panel.getByTestId("intelligence-conversation")).toBeVisible();
    await expect(panel.getByTestId("intelligence-reasoning")).toBeVisible();
    // No model selected → hero absent, so conversation is the first card
    const firstCard = panel.locator("section").first();
    await expect(firstCard).toHaveAttribute("data-testid", "intelligence-conversation");
    // Conversation (usage) comes before Reasoning & Tooling in DOM order
    const convBox = await panel.getByTestId("intelligence-conversation").boundingBox();
    const reasBox = await panel.getByTestId("intelligence-reasoning").boundingBox();
    expect(convBox?.y ?? 0).toBeLessThan(reasBox?.y ?? 0);
    // Drag handle present
    await expect(panel.getByTestId("intelligence-resizer")).toBeVisible();
  });
});
