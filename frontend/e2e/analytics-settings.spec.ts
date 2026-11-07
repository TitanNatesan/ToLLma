// Analytics + Settings + global shortcuts overlay: real data end-to-end.
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import {
  API,
  apiCreateModel,
  apiCreateProvider,
  apiLoginAs,
  selectDropdown,
  selectProviderModel,
  sendMessage,
} from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

async function seedUsage(page: Page, tag: string, messages = 2) {
  await apiLoginAs(page, tag);
  const stamp = Date.now();
  const providerName = `pw-analytics-${stamp}`;
  const modelName = `meter-${stamp}`;
  const p = await apiCreateProvider(page.request, providerName);
  const m = await apiCreateModel(page.request, p.id, modelName, "2", "8", {
    supports_reasoning: true,
  });
  for (let i = 0; i < messages; i++) {
    const res = await page.request.post(`${API}/api/v1/gateway/chat`, {
      data: { provider_id: p.id, model_id: m.id, message: `analytics probe ${i}` },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
  }
  return { provider: p, model: m, providerName, modelName, stamp };
}

test("analytics page renders real aggregated data across every section", async ({ page }) => {
  const { providerName, modelName } = await seedUsage(page, "analytics-render");
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");

  await expect(page.getByTestId("analytics-page")).toBeVisible();
  await expect(page.getByTestId("analytics-kpis")).toBeVisible();
  await expect(page.getByTestId("kpi-spend")).toContainText("$");
  await expect(page.getByTestId("kpi-requests")).toContainText("2");
  await expect(page.getByTestId("kpi-tokens")).toContainText("28");
  await expect(page.getByTestId("kpi-active-models")).toContainText("1");

  await expect(page.getByTestId("analytics-insights")).toBeVisible();
  await expect(page.getByTestId("spend-chart")).toBeVisible();
  await expect(page.getByTestId("provider-donut")).toBeVisible();
  await expect(page.getByTestId("model-spend-list")).toContainText(modelName);
  await expect(page.getByTestId("usage-heatmap")).toBeVisible();
  await expect(page.getByTestId("token-chart")).toBeVisible();
  await expect(page.getByTestId("models-table")).toContainText(modelName);
  await expect(page.getByTestId("providers-table")).toContainText(providerName);
  await expect(page.getByTestId("rank-expensive")).toBeVisible();

  // Granularity change re-aggregates without losing the page.
  await page.getByTestId("granularity-day").click();
  await expect(page.getByTestId("spend-chart")).toBeVisible();
  await expect(page.getByTestId("kpi-requests")).toContainText("2");
});

test("analytics range switching + custom range + CSV export", async ({ page }) => {
  await seedUsage(page, "analytics-range");
  await page.goto("/analytics");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("kpi-requests")).toContainText("2");

  // Preset switch keeps real data.
  await page.getByTestId("range-picker").click();
  await page.getByTestId("range-last_7d").click();
  await expect(page.getByTestId("range-resolved")).toBeVisible();

  // Custom range requires both dates, then loads.
  await page.getByTestId("range-picker").click();
  await page.getByTestId("range-custom").click();
  await expect(page.getByTestId("analytics-custom-prompt")).toBeVisible();
  const today = new Date();
  const from = new Date(today.getTime() - 7 * 86400000);
  // Local calendar dates: the backend resolves ranges in the caller's timezone,
  // so toISOString() (UTC) would exclude today's usage east/west of UTC.
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  await page.getByTestId("range-start").fill(iso(from));
  await page.getByTestId("range-end").fill(iso(today));
  await expect(page.getByTestId("kpi-requests")).toContainText("2");

  // CSV export streams a real file from the backend.
  await selectDropdown(page, "export-dataset", "models");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-button").click();
  await page.getByTestId("export-csv").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^tollma-models-\d+\.csv$/);
});

test("accent preference applies globally, persists, and reaches the backend", async ({ page }) => {
  await apiLoginAs(page, "accent");
  // Accent picker lives in Command Palette -> Theme Studio (no settings card).
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("cmd-theme").click();
  await expect(page.getByTestId("theme-studio")).toBeVisible({ timeout: 10000 });

  await page.getByTestId("accent-blue").click();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--color-tollma-500").trim()),
    )
    .toBe("#1d4ed8");

  // Server is the source of truth.
  await expect
    .poll(async () => (await (await page.request.get(`${API}/api/v1/settings/preferences`)).json()).accent)
    .toBe("blue");

  // Survives a reload (persisted palette re-applied before paint).
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--color-tollma-500").trim()),
    )
    .toBe("#1d4ed8");

  // Custom color picker accepts any hex and applies derived shades.
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("cmd-theme").click();
  await expect(page.getByTestId("theme-studio")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("accent-custom").fill("#e11d48");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.style.getPropertyValue("--color-tollma-500").trim()),
    )
    .toBe("#e11d48");
});

test("chat preferences: Enter=New line and default thinking level persist", async ({ page }) => {
  await apiLoginAs(page, "chatprefs");
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("enter-newline").click();
  await selectDropdown(page, "settings-thinking-level", "none");
  await expect
    .poll(async () => (await (await page.request.get(`${API}/api/v1/settings/preferences`)).json()).enter_behavior)
    .toBe("newline");

  const p = await apiCreateProvider(page.request, `pw-chatprefs-${Date.now()}`);
  const m = await apiCreateModel(page.request, p.id, `pref-${Date.now()}`, "2", "8", {
    supports_reasoning: true,
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);

  // Enter inserts a newline instead of sending.
  await page.getByTestId("chat-input").fill("keep typing");
  await page.getByTestId("chat-input").press("Enter");
  await expect(page.getByTestId("chat-input")).toHaveValue("keep typing\n");
  await expect(page.getByTestId("message-user")).toHaveCount(0);

  // Ctrl+Enter sends.
  await page.getByTestId("chat-input").press("Control+Enter");
  await expect(page.getByTestId("message-user").last()).toContainText("keep typing", { timeout: 10000 });
});

test("profile updates persist and reflect in the sidebar", async ({ page }) => {
  await apiLoginAs(page, "profile");
  const username = `ada_${Date.now()}`;
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");

  await page.getByTestId("profile-name").fill("Ada Analytics");
  await page.getByTestId("profile-username").fill(username);
  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("sidebar-profile")).toContainText("Ada Analytics", { timeout: 10000 });

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("profile-name")).toHaveValue("Ada Analytics");
  await expect(page.getByTestId("profile-username")).toHaveValue(username);
});

test("sessions list marks the current device and exposes usage columns", async ({ page }) => {
  await apiLoginAs(page, "sessions");
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await expect(page.getByTestId("sessions-list")).toBeVisible();
  await expect(page.locator("[data-testid^='session-current-']")).toHaveCount(1);
  await expect(page.getByTestId("sessions-list")).toContainText(/Chrome on (Linux|Windows)|Unknown device/);
  await expect(page.getByTestId("sessions-list")).toContainText("0 requests");
});

test("Ctrl+/ opens the searchable shortcuts overlay and G-navigation works", async ({ page }) => {
  await apiLoginAs(page, "shortcuts");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  // Wait for hydration (global key listener lives in AppShell).
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await page.waitForTimeout(500);

  await page.keyboard.press("Control+/");
  await expect(page.getByTestId("shortcuts-overlay")).toBeVisible();
  await expect(page.getByTestId("shortcut-new_chat")).toBeVisible();

  await page.getByTestId("shortcuts-input").fill("regenerate");
  await expect(page.getByTestId("shortcut-regenerate")).toBeVisible();
  await expect(page.getByTestId("shortcut-new_chat")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("shortcuts-overlay")).not.toBeVisible();

  // "G then A" navigates to Analytics (sequence shortcut).
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(/\/analytics/, { timeout: 5000 });

  // Ctrl+K still opens the command palette (single global listener).
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).not.toBeVisible();
});

test("shortcuts overlay exposes every registered command", async ({ page }) => {
  await apiLoginAs(page, "shortcut-all");
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+/");
  for (const id of [
    "new_chat",
    "focus_input",
    "send_message",
    "new_line",
    "regenerate",
    "stop_response",
    "go_chat",
    "go_analytics",
    "go_settings",
    "toggle_conversations",
    "toggle_intelligence",
    "open_model_selector",
    "switch_model",
    "change_thinking",
    "search_conversations",
    "command_palette",
    "shortcuts",
  ]) {
    await expect(page.getByTestId(`shortcut-${id}`)).toBeAttached();
  }
});
