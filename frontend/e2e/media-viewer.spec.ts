// Media viewer + card validation against EXISTING generated assets.
// No generation, no paid API calls: it logs in, finds a conversation that
// already contains a generated image/video attachment, and validates the
// unified viewer + media card rendering.
//
//   npx playwright test e2e/media-viewer.spec.ts --headed --workers=1
import { expect, test, type Page } from "@playwright/test";
import { API } from "./helpers";

test.use({ viewport: { width: 1920, height: 1080 } });

const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";

async function login(page: Page): Promise<void> {
  // API login sets the httpOnly session cookies for the shared request context
  // (the UI login flow keeps the access token in memory for its own calls).
  const response = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!response.ok()) throw new Error(`e2e login failed: ${response.status()} ${await response.text()}`);
}

/** First conversation whose detail contains an attachment of the given kind. */
async function conversationWith(page: Page, kind: "image" | "video"): Promise<string | null> {
  const conversations = await (await page.request.get(`${API}/api/v1/conversations`)).json();
  for (const conversation of conversations as Array<{ id: string }>) {
    const detail = await (await page.request.get(`${API}/api/v1/conversations/${conversation.id}`)).json();
    for (const message of detail.messages ?? []) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.kind === kind) return conversation.id;
      }
    }
  }
  return null;
}

test("generated image card opens the unified viewer (blur, zoom, ESC)", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  page.setDefaultTimeout(20_000);
  await login(page);

  const conversationId = await conversationWith(page, "image");
  test.skip(!conversationId, "no existing generated image found");
  await page.goto(`/c/${conversationId}`);

  const card = page.getByTestId("media-card-image").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card.locator("figcaption")).toContainText(".png");
  const cardBox = await card.boundingBox();
  expect(cardBox && cardBox.width <= 512 + 2).toBeTruthy();
  await page.screenshot({ path: "test-results/media-card-image.png" });

  await card.locator("button").first().click();
  const viewer = page.getByTestId("media-viewer");
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  // Gaussian blur backdrop (24px) on a dark translucent overlay.
  const backdrop = await viewer.evaluate((node) => {
    const style = getComputedStyle(node);
    return { blur: style.backdropFilter, className: node.className };
  });
  expect(backdrop.blur).toContain("blur(24px)");
  // Dark translucent overlay (Tailwind's bg-black/65).
  expect(backdrop.className).toContain("bg-black/65");
  for (const control of ["lightbox-zoom-in", "lightbox-zoom-out", "lightbox-fit", "lightbox-actual", "lightbox-download", "lightbox-close"]) {
    await expect(page.getByTestId(control)).toBeVisible();
  }
  const image = page.getByTestId("lightbox-image");
  const before = await image.evaluate((node) => (node as HTMLElement).style.transform);
  await page.getByTestId("lightbox-zoom-in").click();
  const after = await image.evaluate((node) => (node as HTMLElement).style.transform);
  expect(after).not.toBe(before);
  await page.screenshot({ path: "test-results/media-viewer-image.png" });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});

test("generated video card opens the unified viewer with native controls", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  page.setDefaultTimeout(20_000);
  await login(page);

  const conversationId = await conversationWith(page, "video");
  test.skip(!conversationId, "no existing generated video found");
  await page.goto(`/c/${conversationId}`);

  const card = page.getByTestId("media-card-video").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  const cardBox = await card.boundingBox();
  expect(cardBox && cardBox.width <= 720 + 2).toBeTruthy();
  await expect(card.locator("figcaption")).toContainText(".mp4");
  await page.screenshot({ path: "test-results/media-card-video.png" });

  // Click the frame (above the native control bar) — no separate fullscreen button.
  await expect(card.locator('[data-testid^="message-video-expand-"]')).toHaveCount(0);
  await card.locator("video").click({ position: { x: 60, y: 40 } });
  const viewer = page.getByTestId("media-viewer");
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  const video = page.getByTestId("lightbox-video");
  await expect(video).toBeVisible();
  expect(await video.evaluate((node) => (node as HTMLVideoElement).controls)).toBe(true);
  await expect(page.getByTestId("lightbox-video-duration")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("lightbox-video-resolution")).toBeVisible();
  await page.screenshot({ path: "test-results/media-viewer-video.png" });
  await page.getByTestId("lightbox-close").click();
  await expect(viewer).toHaveCount(0);
});
