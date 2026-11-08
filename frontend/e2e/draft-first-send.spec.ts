// Route-stubbed regression spec: the first user message in a draft ("/")
// conversation must render exactly ONE user bubble while the assistant
// streams. Stubs the backend at the network layer (no provider/egress):
// the persisted conversation read truthfully returns the user row mid-stream,
// which used to overlap the optimistic echo and render twice.
import { expect, test, type Page } from "@playwright/test";

const TEXT = "stubbed first message";

const userRow = {
  id: "msg-user-1",
  role: "user",
  content: TEXT,
  conversation_id: "conv-1",
  parent_message_id: null,
  version_number: 1,
  status: "complete",
  started_at: null,
  completed_at: null,
  error: null,
  error_code: null,
  generations: [],
  active_generation_id: null,
  versions_count: 1,
  metadata: {},
  usage_estimated: false,
  thinking_ms: null,
  attachments: [],
  provider_id: "prov-1",
  model_id: "model-1",
  prompt_tokens: 3,
  completion_tokens: 0,
  total_tokens: 3,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  reasoning_tokens: 0,
  input_cost: "0",
  output_cost: "0",
  total_cost: "0",
  cache_read_cost: "0",
  cache_write_cost: "0",
  reasoning_cost: "0",
  created_at: new Date().toISOString(),
};

const convBody = {
  id: "conv-1",
  title: "New conversation",
  is_pinned: false,
  provider_id: "prov-1",
  model_id: "model-1",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  messages: [userRow],
};

const SSE_MID_STREAM =
  `data: ${JSON.stringify({ conversation_id: "conv-1", generation_id: "gen-1", message_id: "msg-asst-1", status: "running" })}\n\n` +
  `data: ${JSON.stringify({ delta: "Hello from stub" })}\n\n`;

// NOTE: the stream deliberately carries no terminal `done` frame. The reader
// ends on connection close without settling, so the app stays mid-stream —
// exactly the window the duplicate lived in.
async function installStubs(page: Page) {
  const counts = { mint: 0, stream: 0, path: 0, tree: 0 };
  await page.route("http://localhost:8000/**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    if (path === "/api/v1/providers" && method === "GET")
      return route.fulfill({ json: [{ id: "prov-1", name: "Stub Provider" }] });
    if (path === "/api/v1/models" && method === "GET")
      return route.fulfill({
        json: [{ id: "model-1", provider_id: "prov-1", name: "Stub Model", is_active: true }],
      });
    if (path === "/api/v1/chat/keys" && method === "GET")
      return route.fulfill({
        json: [
          { id: "key-1", name: "Stub Key", scope: "personal", org_id: null, org_name: null, enabled: true, model_count: 1 },
        ],
      });
    if (path === "/api/v1/chat/models" && method === "GET")
      return route.fulfill({
        json: [{ id: "model-1", provider_id: "prov-1", name: "Stub Model", is_active: true }],
      });
    if (path === "/api/v1/conversations" && method === "POST") {
      counts.mint += 1;
      return route.fulfill({ json: { ...convBody, messages: [] } });
    }
    if (path === "/api/v1/conversations" && method === "GET") return route.fulfill({ json: [] });
    if (path === "/api/v1/conversations/conv-1" && method === "GET")
      return route.fulfill({ json: convBody });
    if (path === "/api/v1/conversations/conv-1" && (method === "PATCH" || method === "POST"))
      return route.fulfill({ json: convBody });
    if (path === "/api/v1/conversations/conv-1/path") {
      counts.path += 1;
      // Persisted truth mid-stream: the backend already stored the user row
      // while the assistant generation is still running.
      return route.fulfill({ json: { path: [userRow], active_leaf_id: userRow.id } });
    }
    if (path === "/api/v1/conversations/conv-1/tree") {
      counts.tree += 1;
      return route.fulfill({
        json: {
          nodes: [
            { id: userRow.id, parent_message_id: null, role: "user", version_number: 1, status: "complete", created_at: userRow.created_at },
          ],
          active_leaf_id: userRow.id,
        },
      });
    }
    if (path === "/api/v1/conversations/conv-1/usage")
      return route.fulfill({
        json: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, total_cost: "0" },
      });
    if (path === "/api/v1/conversations/conv-1/active-generation") return route.fulfill({ status: 404, json: { detail: "none" } });
    if (path.startsWith("/api/v1/gateway/generations/by-client/")) return route.fulfill({ status: 404, json: { detail: "none" } });
    if (path === "/api/v1/gateway/stream" && method === "POST") {
      counts.stream += 1;
      return route.fulfill({ contentType: "text/event-stream", body: SSE_MID_STREAM });
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
  return counts;
}

async function startDrafted(page: Page) {
  // Presence-cookie gate + preselected provider/model/key (persisted stores).
  await page.context().addCookies([{ name: "tollma_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("tollma-chat", JSON.stringify({ state: { providerId: "prov-1", modelId: "model-1" }, version: 0 }));
    localStorage.setItem("tollma-chat-key", JSON.stringify({ state: { keyId: "key-1" }, version: 0 }));
  });
}

test.describe("draft first send (stubbed backend)", () => {
  test("first send renders a single user bubble mid-stream", async ({ page }) => {
    const counts = await installStubs(page);
    await startDrafted(page);
    await page.goto("/");
    await page.getByTestId("chat-input").fill(TEXT);
    await expect(page.getByTestId("send-button")).toBeEnabled();
    await page.getByTestId("send-button").click();

    // Draft mint adopts /c/conv-1; the stream meta renders the assistant
    // overlay (proof the app is mid-stream).
    await expect(page).toHaveURL(/\/c\/conv-1/, { timeout: 10000 });
    await expect(page.getByTestId("message-assistant")).toBeVisible({ timeout: 10000 });
    // Settle window: any unpaused persisted fetch lands in ms against stubs.
    await page.waitForTimeout(1500);

    // The persisted twin must never be fetched while the echo is live.
    expect(counts.path).toBe(0);
    expect(counts.tree).toBe(0);
    await expect(page.getByTestId("message-user")).toHaveCount(1);
    await expect(page.getByTestId("message-assistant")).toHaveCount(1);
    expect(counts.mint).toBe(1);
    expect(counts.stream).toBe(1);
  });

  test("fast double-Enter sends exactly once", async ({ page }) => {
    const counts = await installStubs(page);
    await startDrafted(page);
    await page.goto("/");
    const input = page.getByTestId("chat-input");
    await input.fill(TEXT);
    await expect(page.getByTestId("send-button")).toBeEnabled();
    await input.press("Enter");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/c\/conv-1/, { timeout: 10000 });
    await expect(page.getByTestId("message-assistant")).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    expect(counts.path).toBe(0);
    expect(counts.tree).toBe(0);
    await expect(page.getByTestId("message-user")).toHaveCount(1);
    expect(counts.mint).toBe(1);
    expect(counts.stream).toBe(1);
  });
});
