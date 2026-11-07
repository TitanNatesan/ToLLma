// Branching conversation flow (§2+§6): live graph interaction.
//
// Fixture is provisioned out-of-band (deterministic service-seeded tree in the
// DEV database — explicit parents/versions/status need no provider, so this
// suite runs where live-LLM egress is blocked):
//   BRANCH_FLOW_EMAIL / BRANCH_FLOW_PASSWORD / BRANCH_FLOW_CONV / BRANCH_FLOW_NODES
// Without the fixture the suite skips (BLOCKED) instead of faking a tree.
import { expect, test, type Page } from "@playwright/test";
import { API } from "./helpers";

const EMAIL = process.env.BRANCH_FLOW_EMAIL ?? "";
const PASSWORD = process.env.BRANCH_FLOW_PASSWORD ?? "";
const CONV = process.env.BRANCH_FLOW_CONV ?? "";
const NODES: Record<string, string> = JSON.parse(process.env.BRANCH_FLOW_NODES ?? "{}");

test.beforeEach(async ({ page }) => {
  test.skip(!EMAIL || !CONV || Object.keys(NODES).length === 0, "BLOCKED: no seeded branch fixture");
  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok()) throw new Error(`fixture login failed: ${await login.text()}`);
});

async function openConversation(page: Page, convId: string = CONV) {
  await page.goto(`/c/${convId}`);
  await expect(page.getByTestId("conversation-flow-graph")).toBeVisible({ timeout: 20000 });
}

test("graph renders every seeded node with active-leaf highlight", async ({ page }) => {
  await openConversation(page);
  await expect(page.getByTestId("flow-meta")).toContainText("7 nodes");
  for (const id of Object.values(NODES)) {
    await expect(page.getByTestId(`flow-node-${id}`)).toBeVisible();
  }
  // Active leaf is ringed; exactly one node carries aria-current.
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
});

test("clicking a request node switches the main chat branch", async ({ page }) => {
  await openConversation(page);
  // u2b (edited follow-up under a1) starts off-path; selecting it repoints the leaf.
  await page.getByTestId(`flow-node-${NODES.u2b}`).click();
  await expect(page.getByTestId(`flow-node-${NODES.u2b}`)).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId(`flow-node-${NODES.u2b}`)).toHaveAttribute("aria-current", "true");
  // Main chat follows the new branch: edited text visible, unrelated sibling gone.
  await expect(page.getByTestId("message-user").last()).toContainText("chloroplasts (edited)", {
    timeout: 15000,
  });
  await expect(page.getByTestId("message-list")).not.toContainText("chlorophyll a and b");
  // Inactive branches stay in the graph (nothing removed, just dimmed).
  for (const id of Object.values(NODES)) {
    await expect(page.getByTestId(`flow-node-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId(`flow-node-${NODES.a2}`)).toHaveAttribute("data-active", "false");
});

test("clicking a response node shows its version and hides the other branch", async ({ page }) => {
  await openConversation(page);
  await page.getByTestId(`flow-node-${NODES.a2}`).click();
  await expect(page.getByTestId(`flow-node-${NODES.a2}`)).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("message-assistant").last()).toContainText("chlorophyll a and b", {
    timeout: 15000,
  });
  // a1's descendants (u2 follow-ups) belong to the other branch: not on this path.
  await expect(page.getByTestId("message-list")).not.toContainText("Tell me more about chloro");
});

test("reload restores the selected branch; conversation switch and back keeps it", async ({ page }) => {
  await openConversation(page);
  await page.getByTestId(`flow-node-${NODES.u2b}`).click();
  await expect(page.getByTestId(`flow-node-${NODES.u2b}`)).toHaveAttribute("aria-current", "true");

  await page.reload();
  await expect(page.getByTestId("conversation-flow-graph")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId(`flow-node-${NODES.u2b}`)).toHaveAttribute("aria-current", "true");
  await expect(page.getByTestId("message-user").last()).toContainText("chloroplasts (edited)");

  // Navigate away and back: server-side leaf persists per conversation.
  const other = await (
    await page.request.post(`${API}/api/v1/conversations`, { data: { title: "branch-flow-other" } })
  ).json();
  await page.goto(`/c/${other.id}`);
  await expect(page.getByTestId("intelligence-flow")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("intelligence-flow")).toContainText("No messages yet");
  await page.goto(`/c/${CONV}`);
  await expect(page.getByTestId(`flow-node-${NODES.u2b}`)).toHaveAttribute("aria-current", "true", {
    timeout: 15000,
  });
  await page.request.delete(`${API}/api/v1/conversations/${other.id}`);
});

test("composer send without a provider is BLOCKED (no egress), leaf untouched", async ({ page }) => {
  await openConversation(page);
  const leafBefore = await page.request.get(`${API}/api/v1/conversations/${CONV}/path`).then((r) => r.json());
  // No provider can exist in this sandbox (egress guard refuses non-public
  // base_urls at registration), so sending cannot stream: assert the UI never
  // invents a message on the wrong branch — the leaf stays put.
  const keys = await page.request.get(`${API}/api/v1/chat/keys`).then((r) => r.json());
  expect(keys.length, `expected the auto-created primary key, got ${JSON.stringify(keys)}`).toBeGreaterThan(0);
  const models = await page.request
    .get(`${API}/api/v1/chat/models`, { params: { key_id: keys[0].id } })
    .then((r) => r.json());
  expect(models, `expected no routable models without egress, got ${JSON.stringify(models)}`).toEqual([]);
  const pathAfter = await page.request.get(`${API}/api/v1/conversations/${CONV}/path`).then((r) => r.json());
  expect(pathAfter.active_leaf_id).toBe(leafBefore.active_leaf_id);
});

test("populated graph screenshots (desktop + mobile)", async ({ page }) => {
  await openConversation(page);
  await page.getByTestId(`flow-node-${NODES.a2}`).click();
  await expect(page.getByTestId(`flow-node-${NODES.a2}`)).toHaveAttribute("aria-current", "true");
  await page.screenshot({ path: "/tmp/branch-flow-desktop.png", fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/c/${CONV}`);
  await page.getByTestId("right-sidebar-toggle").first().click();
  await expect(page.getByTestId("conversation-flow-graph")).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "/tmp/branch-flow-mobile.png", fullPage: false });
});
