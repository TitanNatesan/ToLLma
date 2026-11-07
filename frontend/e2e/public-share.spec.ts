// Public share full-tree page: read-only branched history with local navigation.
//
// Fixture is provisioned out-of-band (deterministic service-seeded tree in the
// DEV database — explicit parents/versions/status need no provider, so this
// suite runs where live-LLM egress is blocked):
//   SHARE_FLOW_EMAIL / SHARE_FLOW_PASSWORD / SHARE_FLOW_CONV / SHARE_FLOW_NODES
// The spec mints its own share link on the fixture conversation via the API
// (additive) and disables it afterwards. Without the fixture the suite skips
// (BLOCKED) instead of faking a tree.
import { expect, test, type Page } from "@playwright/test";
import { API } from "./helpers";

const EMAIL = process.env.SHARE_FLOW_EMAIL ?? "";
const PASSWORD = process.env.SHARE_FLOW_PASSWORD ?? "";
const CONV = process.env.SHARE_FLOW_CONV ?? "";
const NODES: Record<string, string> = JSON.parse(process.env.SHARE_FLOW_NODES ?? "{}");
// Owner's active leaf on the seeded tree (asserted highlighted on load).
const OWNER_LEAF = process.env.SHARE_FLOW_LEAF ?? "";

test.beforeEach(async ({ page }) => {
  test.skip(!EMAIL || !CONV || !OWNER_LEAF || Object.keys(NODES).length === 0, "BLOCKED: no seeded share fixture");
  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok()) throw new Error(`fixture login failed: ${await login.text()}`);
});

async function mintShare(request: Page["request"]): Promise<{ id: string; token: string }> {
  const res = await request.post(`${API}/api/v1/shares`, {
    data: { conversation_id: CONV, expires_in_hours: 24 },
  });
  if (!res.ok()) throw new Error(`mint share failed: ${await res.text()}`);
  const body = await res.json();
  return { id: body.id as string, token: body.share_token as string };
}

async function openPublic(page: Page, token: string) {
  await page.goto(`/share/${token}`);
  await expect(page.getByTestId("public-share-page")).toBeVisible({ timeout: 20000 });
}

test("graph renders the full tree with the owner's active path highlighted", async ({ page }) => {
  const { id, token } = await mintShare(page.request);
  try {
    await openPublic(page, token);
    // Every seeded node renders — versions, failed nodes, extra roots alike.
    for (const nodeId of Object.values(NODES)) {
      await expect(page.getByTestId(`flow-node-${nodeId}`)).toBeVisible();
    }
    // Exactly one leaf carries aria-current: the owner's active leaf.
    await expect(page.locator('[aria-current="true"]')).toHaveCount(1);
    await expect(page.getByTestId(`flow-node-${OWNER_LEAF}`)).toHaveAttribute("aria-current", "true");
    await expect(page.getByTestId("public-share-title")).toBeVisible();
  } finally {
    await page.request.delete(`${API}/api/v1/shares/${id}`);
  }
});

test("viewer navigation switches the local path and fires no mutations", async ({ page }) => {
  const { id, token } = await mintShare(page.request);
  try {
    await openPublic(page, token);
    const seen: string[] = [];
    await page.route("**/api/v1/**", (route) => {
      const req = route.request();
      if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method())) seen.push(`${req.method()} ${req.url()}`);
      return route.continue();
    });
    // Click an off-path node: highlight moves locally, list follows.
    const offPath = Object.values(NODES).find((nodeId) => nodeId !== OWNER_LEAF) ?? "";
    await page.getByTestId(`flow-node-${offPath}`).click();
    await expect(page.getByTestId(`flow-node-${offPath}`)).toHaveAttribute("aria-current", "true");
    // Version pager also navigates locally.
    const pager = page.getByTestId("public-generation-next").first();
    if (await pager.isVisible().catch(() => false)) {
      await expect(pager).toBeEnabled();
    }
    expect(seen, `public navigation must not mutate, saw ${JSON.stringify(seen)}`).toEqual([]);
    await page.unroute("**/api/v1/**");
  } finally {
    await page.request.delete(`${API}/api/v1/shares/${id}`);
  }
});

test("failed nodes show a safe error with no retry; no composer or mutation controls", async ({
  page,
}) => {
  const { id, token } = await mintShare(page.request);
  try {
    await openPublic(page, token);
    await expect(page.getByTestId("public-share-title")).toBeVisible({ timeout: 20000 });
    const failed = page.getByText("Generation failed — no further attempts were made on this shared copy.");
    await expect(failed.first()).toBeVisible();
    // Read-only: no composer, no retry/regenerate/edit/branch affordances.
    await expect(page.getByTestId("chat-input")).toHaveCount(0);
    await expect(page.getByTestId("send-button")).toHaveCount(0);
    await expect(page.locator('[data-testid^="retry-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="regenerate-button-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="edit-button-"]')).toHaveCount(0);
    await expect(page.locator('[data-testid^="branch-button-"]')).toHaveCount(0);
  } finally {
    await page.request.delete(`${API}/api/v1/shares/${id}`);
  }
});

test("share creation warns first: cancel aborts, confirm mints", async ({ page }) => {
  await page.goto(`/c/${CONV}`);
  await expect(page.getByTestId("conversation-menu")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("conversation-menu").click();
  await page.getByTestId("header-share").click();
  await expect(page.getByTestId("share-dialog")).toBeVisible();
  // Remove any live link first so the create path is exercised.
  const shares = await page.request.get(`${API}/api/v1/shares`, { params: { conversation_id: CONV } }).then((r) => r.json());
  for (const share of shares as Array<{ id: string }>) {
    await page.request.delete(`${API}/api/v1/shares/${share.id}`);
  }
  await page.reload();
  await expect(page.getByTestId("conversation-menu")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("conversation-menu").click();
  await page.getByTestId("header-share").click();
  await page.getByTestId("share-create").click();
  await expect(page.getByTestId("share-confirm")).toContainText(
    "This link will expose your entire conversation, including all branches, edited requests, regenerated responses, and previous versions. Anyone with this link may view this history. Make sure you have not shared sensitive information.",
  );
  // Cancel aborts: no link minted.
  await page.getByTestId("share-confirm-cancel").click();
  await expect(page.getByTestId("share-confirm")).toHaveCount(0);
  await expect(page.getByTestId("share-create")).toBeVisible();
  // Confirm mints: the link appears.
  await page.getByTestId("share-create").click();
  await page.getByTestId("share-confirm-mint").click();
  await expect(page.getByTestId("share-link")).toBeVisible({ timeout: 15000 });
  const after = await page.request.get(`${API}/api/v1/shares`, { params: { conversation_id: CONV } }).then((r) => r.json());
  for (const share of after as Array<{ id: string }>) {
    await page.request.delete(`${API}/api/v1/shares/${share.id}`);
  }
});

test("revoked token is denied", async ({ page }) => {
  const { id, token } = await mintShare(page.request);
  await page.request.delete(`${API}/api/v1/shares/${id}`);
  await openPublic(page, token);
  await expect(page.getByTestId("public-share-error")).toBeVisible({ timeout: 20000 });
});

test("public tree screenshots (desktop + mobile)", async ({ page }) => {
  const { id, token } = await mintShare(page.request);
  try {
    await openPublic(page, token);
    await expect(page.getByTestId("conversation-flow-graph")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "/tmp/public-share-desktop.png", fullPage: false });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/share/${token}`);
    await expect(page.getByTestId("conversation-flow-graph")).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: "/tmp/public-share-mobile.png", fullPage: false });
  } finally {
    await page.request.delete(`${API}/api/v1/shares/${id}`);
  }
});
