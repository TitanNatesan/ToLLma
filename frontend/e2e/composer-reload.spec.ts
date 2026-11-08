// Reload persistence: the last model selection must survive a hard refresh.
// Route-stubbed (no provider/LLM/backend egress for chat data): the page shell
// comes from the dev server; every localhost:8000 call is fulfilled in-page.
// Covers the live-bug shape: persisted tollma-chat carries provider/model/draft
// while tollma-chat-key has no serving key yet (pre-BYOK selection), so the
// composer must re-bind the persisted model to its serving key once key data
// arrives — never wipe the persisted ids, and never blame "select a model"
// while key data is merely still loading.
import { expect, test, type Page, type Route } from "@playwright/test";

// Ids mirror the live-bug report.
const PROVIDER_ID = "f299e729-2ac8-4101-9aeb-4eb5c4f58f99";
const MODEL_ID = "4f0f892b-6c6b-49ae-ae8c-547b08345773";
const KEY_ID = "b1c2d3e4-5f67-4890-abcd-ef0123456789";
const DRAFT = "hello!";

const modelRow = {
  id: MODEL_ID,
  provider_id: PROVIDER_ID,
  model_id: "gpt-oss-20b",
  name: "GPT OSS 20B",
  description: "Stub model",
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
  supports_reasoning: false,
  supports_embeddings: false,
  supports_streaming: true,
  context_window: 131072,
  max_output_tokens: 8192,
  release_date: null,
  repository_model_key: null,
  metadata: {},
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

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
  model_count: 1,
};

const convBody = {
  id: "conv-1",
  title: "New conversation",
  is_pinned: false,
  provider_id: PROVIDER_ID,
  model_id: MODEL_ID,
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

interface StubControl {
  streamPayloads: Array<Record<string, unknown>>;
  releaseKeyModels: () => void;
}

async function installStubs(page: Page, opts: { holdKeyModels?: boolean } = {}): Promise<StubControl> {
  const streamPayloads: Array<Record<string, unknown>> = [];
  let releaseKeyModels = () => {};
  let keyModelsHeld = false;
  const holdGate =
    opts.holdKeyModels === true
      ? new Promise<void>((resolve) => {
          releaseKeyModels = resolve;
        })
      : null;
  await page.route("http://localhost:8000/**/*", async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === "/api/v1/providers" && method === "GET") return route.fulfill({ json: [providerRow] });
    if (path === "/api/v1/models" && method === "GET") return route.fulfill({ json: [modelRow] });
    if (path === "/api/v1/chat/keys" && method === "GET") return route.fulfill({ json: [keyRow] });
    if (path === "/api/v1/chat/models" && method === "GET") {
      if (holdGate && !keyModelsHeld) {
        keyModelsHeld = true;
        await holdGate;
      }
      return route.fulfill({ json: [modelRow] });
    }
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
  return { streamPayloads, releaseKeyModels };
}

// Seed the persisted stores exactly as the app persists them — then leave
// localStorage alone so a hard reload exercises real survival (seed only when
// absent; a reload must keep whatever the runtime persisted).
async function seedPersistedSelection(page: Page) {
  await page.context().addCookies([{ name: "tollma_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(
    ({ providerId, modelId, draft }) => {
      if (!localStorage.getItem("tollma-chat")) {
        localStorage.setItem(
          "tollma-chat",
          JSON.stringify({ state: { providerId, modelId, draft }, version: 0 }),
        );
      }
      if (!localStorage.getItem("tollma-chat-key")) {
        localStorage.setItem("tollma-chat-key", JSON.stringify({ state: { keyId: null }, version: 0 }));
      }
    },
    { providerId: PROVIDER_ID, modelId: MODEL_ID, draft: DRAFT },
  );
}

test.describe("composer reload persistence (stubbed backend)", () => {
  test("hard reload keeps the persisted model sendable with its key", async ({ page }) => {
    const { streamPayloads } = await installStubs(page);
    await seedPersistedSelection(page);
    await page.goto("/");
    // The label resolves through the registry even before key data lands.
    await expect(page.getByTestId("model-selector")).toContainText("GPT OSS 20B", { timeout: 15000 });
    await expect(page.getByTestId("chat-input")).toHaveValue(DRAFT, { timeout: 15000 });

    await page.reload();
    // Post-reload the composer re-binds the persisted model to its serving
    // key: the label still names it AND Send is enabled.
    await expect(page.getByTestId("model-selector")).toContainText("GPT OSS 20B", { timeout: 15000 });
    await expect(page.getByTestId("chat-input")).toHaveValue(DRAFT, { timeout: 15000 });
    await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 15000 });

    await page.getByTestId("send-button").click();
    await expect(page).toHaveURL(/\/c\/conv-1/, { timeout: 15000 });
    await expect
      .poll(() => streamPayloads.length, { timeout: 15000 })
      .toBeGreaterThan(0);
    const sent = streamPayloads[0] as Record<string, unknown>;
    expect(sent["provider_id"]).toBe(PROVIDER_ID);
    expect(sent["model_id"]).toBe(MODEL_ID);
    expect(sent["key_id"]).toBe(KEY_ID);
  });

  test("key-loading send attempt reports loading, not a missing model", async ({ page }) => {
    const { streamPayloads, releaseKeyModels } = await installStubs(page, { holdKeyModels: true });
    await seedPersistedSelection(page);
    try {
      await page.goto("/");
      // Registry resolves the label while the key-model mapping is held back.
      await expect(page.getByTestId("model-selector")).toContainText("GPT OSS 20B", { timeout: 15000 });
      await expect(page.getByTestId("chat-input")).toHaveValue(DRAFT, { timeout: 15000 });

      // Enter reaches handleSend even while the button is disabled: while key
      // data is in flight this must say "still loading", never "select a
      // model" (the persisted selection is intact, just unresolved).
      await page.getByTestId("chat-input").press("Enter");
      await expect(page.locator('[data-sileo-toast]', { hasText: "still loading" })).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator('[data-sileo-toast]', { hasText: "Select a model to send" })).toHaveCount(0);
      expect(streamPayloads.length).toBe(0);
    } finally {
      releaseKeyModels();
    }

    // Once key data lands the persisted selection binds and sends.
    await expect(page.getByTestId("send-button")).toBeEnabled({ timeout: 15000 });
    await page.getByTestId("send-button").click();
    await expect
      .poll(() => streamPayloads.length, { timeout: 15000 })
      .toBeGreaterThan(0);
    expect((streamPayloads[0] as Record<string, unknown>)["key_id"]).toBe(KEY_ID);
  });
});
