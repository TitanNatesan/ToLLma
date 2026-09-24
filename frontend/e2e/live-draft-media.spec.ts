// Draft-chat + media preview validation.
//   LIVE_OPENAI_KEY=sk-... npx playwright test e2e/live-draft-media.spec.ts --headed --workers=1
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { API, apiCreateModel, apiCreateProvider, apiLoginAs, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

test.use({ viewport: { width: 1920, height: 1080 } });

const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";

async function countConversations(page: Page): Promise<number> {
  const list = await (await page.request.get(`${API}/api/v1/conversations`)).json();
  return Array.isArray(list) ? list.length : 0;
}

test("draft chat: no conversation until the first message", async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await apiLoginAs(page, "draft");
  const stamp = Date.now();
  const provider = await apiCreateProvider(page.request, `draft-p-${stamp}`);
  const model = await apiCreateModel(page.request, provider.id, `draft-m-${stamp}`);

  const before = await countConversations(page);

  await page.goto("/");
  await expect(page.getByTestId("chat-composer")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/$/);
  console.log("DRAFT home: no redirect, no conversation");

  await page.getByTestId("new-chat").click();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/$/);

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/\/$/);
  expect(await countConversations(page)).toBe(before);
  console.log("DRAFT new-chat + refresh: still no conversation in the database");

  await selectProviderModel(page, provider.id, model.id);
  await sendMessage(page, `draft probe ${stamp}`);
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{8,}/, { timeout: 30_000 });
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from mock", { timeout: 20_000 });
  expect(await countConversations(page)).toBe(before + 1);
  console.log("DRAFT first message created the conversation and adopted the URL");
});

test("image generation shows the skeleton instantly and opens the lightbox", async ({ page }) => {
  test.skip(!process.env.LIVE_OPENAI_KEY, "LIVE_OPENAI_KEY not set");
  test.setTimeout(10 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 30_000 });

  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const openai = providers.find((p: { name: string }) => p.name.startsWith("OpenAI 179"));
  const models = await (
    await page.request.get(`${API}/api/v1/models`, { params: { provider_id: openai.id } })
  ).json();
  const imageModel = models.find((m: { model_id: string }) => m.model_id === "gpt-image-1");

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await selectProviderModel(page, openai.id, imageModel.id);
  await page.getByTestId("chat-input").fill("pink square");
  await page.getByTestId("send-button").click();

  // Skeleton appears immediately, before the provider answers.
  await expect(page.getByTestId("media-skeleton-image")).toBeVisible({ timeout: 15_000 });
  console.log("SKELETON image placeholder visible while generating");
  await page.screenshot({ path: "test-results/draft-skeleton-image.png" });

  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant.getByTestId("message-attachments")).toBeVisible({ timeout: 180_000 });
  const imageButton = assistant.locator('[data-testid^="message-image-"]').first();
  await expect(imageButton).toBeVisible({ timeout: 30_000 });
  await imageButton.click();

  const lightbox = page.getByTestId("media-lightbox");
  await expect(lightbox).toBeVisible({ timeout: 15_000 });
  const image = page.getByTestId("lightbox-image");
  await expect(image).toBeVisible();
  const box = await image.boundingBox();
  expect(box && box.width <= 1920 * 0.9 + 2 && box.height <= 1080 * 0.9 + 2).toBeTruthy();
  await page.getByTestId("lightbox-zoom-in").click();
  await page.screenshot({ path: "test-results/draft-lightbox-image.png" });
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  console.log(`LIGHTBOX image opened (${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}) and closed on ESC`);
});

test("video preview opens the fullscreen lightbox", async ({ page }) => {
  test.skip(!process.env.LIVE_OPENAI_KEY, "LIVE_OPENAI_KEY not set");
  test.setTimeout(5 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 30_000 });

  // Find an existing conversation that already contains a generated video.
  const conversations = await (await page.request.get(`${API}/api/v1/conversations`)).json();
  let target: string | null = null;
  for (const conversation of conversations) {
    const detail = await (await page.request.get(`${API}/api/v1/conversations/${conversation.id}`)).json();
    if ((detail.attachments ?? []).length >= 0 && JSON.stringify(detail).includes('"kind":"video"')) {
      target = conversation.id;
      break;
    }
  }
  test.skip(!target, "no conversation with a video attachment found");
  await page.goto(`/c/${target}`);
  const expand = page.locator('[data-testid^="message-video-expand-"]').first();
  await expect(expand).toBeVisible({ timeout: 30_000 });
  await expand.click();
  await expect(page.getByTestId("media-lightbox")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lightbox-video")).toBeVisible();
  await expect(page.getByTestId("lightbox-video-duration")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("lightbox-video-resolution")).toBeVisible();
  await page.screenshot({ path: "test-results/draft-lightbox-video.png" });
  console.log("LIGHTBOX video opened with duration + resolution");
});
