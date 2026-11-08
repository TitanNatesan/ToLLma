// Thinking "None" across every reasoning control kind (effort / budget /
// toggle): the off switch is always offered, persists per model, and sends
// reasoning_level="none" — never null. Route-stubbed (no provider/LLM/backend
// egress for chat data): the page shell comes from the dev server; every
// localhost:8000 call is fulfilled in-page. No live providers (tester covers
// live).
import { expect, test, type Page, type Route } from "@playwright/test";
import { selectProviderModel, sendMessage } from "./helpers";

const PROVIDER_ID = "e4f1a2b3-0000-4000-8000-000000000001";
const KEY_ID = "e4f1a2b3-0000-4000-8000-000000000002";
const EFFORT_A_ID = "e4f1a2b3-0000-4000-8000-000000000011";
const EFFORT_B_ID = "e4f1a2b3-0000-4000-8000-000000000012";
const BUDGET_ID = "e4f1a2b3-0000-4000-8000-000000000013";
const TOGGLE_ID = "e4f1a2b3-0000-4000-8000-000000000014";

function modelRow(
  id: string,
  name: string,
  reasoningOptions: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    id,
    provider_id: PROVIDER_ID,
    model_id: `mock-${name}`,
    name,
    description: "Stub reasoning model",
    endpoint_type: "chat_completions",
    primary_endpoint: "chat_completions",
    supported_endpoints: ["chat_completions"],
    input_price: "2",
    output_price: "8",
    cache_read_price: "0",
    cache_write_price: "0",
    supports_text: true,
    supports_vision: false,
    supports_audio_input: false,
    supports_audio_output: false,
    supports_image_generation: false,
    supports_tool_calling: false,
    supports_reasoning: true,
    supports_embeddings: false,
    supports_streaming: true,
    reasoning_options: reasoningOptions,
    context_window: 131072,
    max_output_tokens: 8192,
    release_date: null,
    repository_model_key: null,
    metadata: {},
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Effort models deliberately omit "none" from values: the UI must offer the
// off switch anyway (the gateway accepts it even when unlisted).
const EFFORT_A = modelRow(EFFORT_A_ID, "reasoner-effort-a", [
  { type: "effort", values: ["low", "high"], default: "low" },
]);
const EFFORT_B = modelRow(EFFORT_B_ID, "reasoner-effort-b", [
  { type: "effort", values: ["low", "high"], default: "low" },
]);
const BUDGET = modelRow(BUDGET_ID, "reasoner-budget", [
  { type: "budget_tokens", min: 1024, max: 8192, default: "2048" },
]);
const TOGGLE = modelRow(TOGGLE_ID, "reasoner-toggle", [{ type: "toggle", default: "high" }]);
const ALL_MODELS = [EFFORT_A, EFFORT_B, BUDGET, TOGGLE];

const providerRow = {
  id: PROVIDER_ID,
  name: "Stub Provider",
  provider_type: "CUSTOM",
  credentials_masked: {},
  metadata: {},
  is_active: true,
  validation_status: "unknown",
  validation_message: null,
  last_validated_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const keyRow = {
  id: KEY_ID,
  name: "Stub Key",
  scope: "personal",
  org_id: null,
  org_name: null,
  enabled: true,
  model_count: 4,
};

const convBody = {
  id: "conv-1",
  title: "New conversation",
  is_pinned: false,
  provider_id: PROVIDER_ID,
  model_id: EFFORT_A_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  messages: [],
};

const emptyUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  total_cost: "0",
  cache_savings: "0",
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  by_provider: [],
  by_model: [],
};

const DONE_SSE =
  `data: ${JSON.stringify({ done: true, message_id: "msg-asst-1", generation_id: "gen-1", status: "completed", content: "Stub answer" })}\n\n`;

async function installStubs(page: Page): Promise<Array<Record<string, unknown>>> {
  const streamPayloads: Array<Record<string, unknown>> = [];
  await page.route("http://localhost:8000/**/*", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === "/api/v1/providers" && method === "GET") return route.fulfill({ json: [providerRow] });
    if (path === "/api/v1/models" && method === "GET") return route.fulfill({ json: ALL_MODELS });
    if (path === "/api/v1/chat/keys" && method === "GET") return route.fulfill({ json: [keyRow] });
    if (path === "/api/v1/chat/models" && method === "GET") return route.fulfill({ json: ALL_MODELS });
    if (path === "/api/v1/conversations" && method === "POST") return route.fulfill({ json: convBody });
    if (path === "/api/v1/conversations" && method === "GET") return route.fulfill({ json: [] });
    if (path === "/api/v1/conversations/conv-1" && method === "GET") return route.fulfill({ json: convBody });
    if (path === "/api/v1/conversations/conv-1" && (method === "PATCH" || method === "POST"))
      return route.fulfill({ json: convBody });
    if (path === "/api/v1/conversations/conv-1/path")
      return route.fulfill({ json: { path: [], active_leaf_id: null } });
    if (path === "/api/v1/conversations/conv-1/tree")
      return route.fulfill({ json: { nodes: [], active_leaf_id: null } });
    if (path === "/api/v1/conversations/conv-1/usage") return route.fulfill({ json: emptyUsage });
    if (path === "/api/v1/conversations/conv-1/active-generation")
      return route.fulfill({ status: 404, json: { detail: "none" } });
    if (path.startsWith("/api/v1/gateway/generations/by-client/"))
      return route.fulfill({ status: 404, json: { detail: "none" } });
    if (path === "/api/v1/gateway/stream" && method === "POST") {
      streamPayloads.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
      return route.fulfill({ contentType: "text/event-stream", body: DONE_SSE });
    }
    if (path === "/auth/me") return route.fulfill({ json: { id: "u-1", email: "stub@tollma.ai" } });
    if (path === "/api/v1/settings/preferences" && method === "GET")
      return route.fulfill({
        json: {
          accent: "green",
          accent_color: null,
          enter_behavior: "send",
          default_thinking_level: null,
          auto_scroll: true,
          stream_animations: true,
        },
      });
    if (method === "GET") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  return streamPayloads;
}

async function seedSession(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "tollma_session", value: "1", domain: "localhost", path: "/" }]);
}

test.describe("thinking None across control kinds (stubbed backend)", () => {
  test("effort from reasoning_options offers None and sends reasoning_level none", async ({ page }) => {
    const streamPayloads = await installStubs(page);
    await seedSession(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await selectProviderModel(page, PROVIDER_ID, EFFORT_A_ID);
    // Fresh model resolves to the catalog default (first on-level).
    await expect(page.getByTestId("reasoning-value")).toContainText("low", { timeout: 15000 });

    // None is offered even though the catalog never lists it.
    await page.getByTestId("reasoning-value").hover();
    await expect(page.getByTestId("reasoning-level-none")).toBeVisible();
    await page.getByTestId("reasoning-level-none").click();
    await expect(page.getByTestId("reasoning-value")).toContainText("none");

    await sendMessage(page, "answer without thinking");
    await expect.poll(() => streamPayloads.length, { timeout: 15000 }).toBe(1);
    expect(streamPayloads[0]["reasoning_level"]).toBe("none");

    // The draft send navigates / -> /c/:id; the dev-server route commit can
    // land after the instant stubbed stream, remounting the workspace and
    // dropping hover state. Settle navigation before interacting again.
    await page.waitForURL("**/c/conv-1", { timeout: 15000 });
    await page.waitForLoadState("networkidle");

    // An on-level still sends explicitly.
    await page.getByTestId("reasoning-value").hover();
    await page.getByTestId("reasoning-level-high").click();
    await expect(page.getByTestId("reasoning-value")).toContainText("high");
    await sendMessage(page, "think hard");
    await expect.poll(() => streamPayloads.length, { timeout: 15000 }).toBe(2);
    expect(streamPayloads[1]["reasoning_level"]).toBe("high");
  });

  test("None persists per model across switches and a hard reload", async ({ page }) => {
    await installStubs(page);
    await seedSession(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await selectProviderModel(page, PROVIDER_ID, EFFORT_A_ID);
    await expect(page.getByTestId("reasoning-value")).toContainText("low", { timeout: 15000 });
    await page.getByTestId("reasoning-value").hover();
    await page.getByTestId("reasoning-level-none").click();
    await expect(page.getByTestId("reasoning-value")).toContainText("none");

    // Model B keeps its own level; switching back restores A's None (no stale High).
    await selectProviderModel(page, PROVIDER_ID, EFFORT_B_ID);
    await expect(page.getByTestId("reasoning-value")).toContainText("low");
    await page.getByTestId("reasoning-value").hover();
    await page.getByTestId("reasoning-level-high").click();
    await expect(page.getByTestId("reasoning-value")).toContainText("high");

    await selectProviderModel(page, PROVIDER_ID, EFFORT_A_ID);
    await expect(page.getByTestId("reasoning-value")).toContainText("none");

    // The persisted per-model store survives a hard reload.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("model-selector")).toContainText("reasoner-effort-a", { timeout: 15000 });
    await expect(page.getByTestId("reasoning-value")).toContainText("none", { timeout: 15000 });
  });

  test("budget offers a None switch: off sends none, numbers send through", async ({ page }) => {
    const streamPayloads = await installStubs(page);
    await seedSession(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await selectProviderModel(page, PROVIDER_ID, BUDGET_ID);

    await expect(page.getByTestId("reasoning-budget")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("reasoning-budget-input")).toHaveValue("2048");
    await page.getByTestId("reasoning-budget-none").click();
    await expect(page.getByTestId("reasoning-budget-none")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("reasoning-budget-input")).toHaveValue("");

    await sendMessage(page, "answer without thinking");
    await expect.poll(() => streamPayloads.length, { timeout: 15000 }).toBe(1);
    expect(streamPayloads[0]["reasoning_level"]).toBe("none");

    await page.getByTestId("reasoning-budget-input").fill("4096");
    await sendMessage(page, "think with budget");
    await expect.poll(() => streamPayloads.length, { timeout: 15000 }).toBe(2);
    expect(streamPayloads[1]["reasoning_level"]).toBe("4096");
  });

  test("toggle off sends none, on sends the on-value", async ({ page }) => {
    const streamPayloads = await installStubs(page);
    await seedSession(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await selectProviderModel(page, PROVIDER_ID, TOGGLE_ID);

    const toggle = page.getByTestId("reasoning-toggle-switch");
    await expect(toggle).toBeVisible({ timeout: 15000 });
    // Fresh toggle is explicitly off (never an unstated null).
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await sendMessage(page, "answer without thinking");
    await expect.poll(() => streamPayloads.length, { timeout: 15000 }).toBe(1);
    expect(streamPayloads[0]["reasoning_level"]).toBe("none");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await sendMessage(page, "think a little");
    await expect.poll(() => streamPayloads.length, { timeout: 15000 }).toBe(2);
    expect(streamPayloads[1]["reasoning_level"]).toBe("high");
  });
});
