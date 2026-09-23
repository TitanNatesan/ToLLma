// Live validation: media generation inside the chat conversation.
//   LIVE_OPENAI_KEY=sk-... npx playwright test e2e/live-chat-media.spec.ts --headed --workers=1
import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:8000";
const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";
const IMAGE = process.env.LIVE_IMAGE ?? "/home/ond/Downloads/Ben_10_Omnitrix.png";

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_OPENAI_KEY, "LIVE_OPENAI_KEY not set — live chat-media suite skipped");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 30_000 });
}

async function modelsByModelId(page: Page): Promise<Record<string, string>> {
  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const openai = providers
    .filter((p: { name: string }) => p.name.startsWith("OpenAI 179"))
    .sort((a: { created_at: string }, b: { created_at: string }) => (a.created_at < b.created_at ? 1 : -1))[0];
  const models = await (
    await page.request.get(`${API}/api/v1/models`, { params: { provider_id: openai.id } })
  ).json();
  return Object.fromEntries(models.map((m: { id: string; model_id: string }) => [m.model_id, m.id]));
}

async function selectModel(page: Page, modelId: string) {
  await page.getByTestId("model-selector").click();
  await page.getByTestId(`model-option-${modelId}`).click();
}

test("live chat media: image in chat, streaming progress, refresh persistence", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await login(page);
  // Home route must mint a conversation and move to /c/{id}.
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{8,}/, { timeout: 30_000 });
  const conversationUrl = page.url();
  console.log(`ROUTE home -> ${conversationUrl}`);

  const models = await modelsByModelId(page);
  await selectModel(page, models["gpt-image-1"]);
  await page.getByTestId("chat-input").fill("pink square");
  await page.getByTestId("send-button").click();

  // Immediate activity: the assistant card streams generation progress.
  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).toContainText(/Generating image/i, { timeout: 20_000 });
  console.log("PROGRESS image generation card visible while working");
  await page.screenshot({ path: "test-results/chat-media-progress.png" });

  // Result: assistant message completes and renders the image attachment.
  await expect(assistant).toContainText(/Generated image/i, { timeout: 180_000 });
  await expect(assistant.getByTestId("message-attachments")).toBeVisible({ timeout: 30_000 });
  await expect(assistant.locator('[data-testid="message-attachments"] img').first()).toBeVisible({
    timeout: 30_000,
  });
  console.log("RESULT image rendered inside the conversation");
  await page.screenshot({ path: "test-results/chat-media-image.png" });

  // Refresh/URL persistence: same route, same media, no regeneration.
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(page.url()).toBe(conversationUrl);
  const restored = page.getByTestId("message-assistant").last();
  await expect(restored.locator('[data-testid="message-attachments"] img').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("message-assistant")).toHaveCount(1);
  console.log("HISTORY image restored after refresh, no duplicate assistant row");
});

test("live chat media: video in chat with progress and player", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await login(page);
  const models = await modelsByModelId(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/c\//, { timeout: 30_000 });
  await selectModel(page, models["sora-2"]);
  await page.getByTestId("chat-input").fill("moving blue circle");
  await page.getByTestId("send-button").click();

  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).toContainText(/Generating video/i, { timeout: 20_000 });
  await expect(assistant).toContainText(/Generated video/i, { timeout: 420_000 });
  const video = assistant.locator("video").first();
  await expect(video).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).videoWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  console.log("RESULT video player rendered inside the conversation");
  await page.screenshot({ path: "test-results/chat-media-video.png" });
});

test("live chat media: retry a failed media message in place", async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  page.setDefaultTimeout(20_000);
  await login(page);

  // The pre-fix conversation holds failed gpt-image-1/sora-2 rows; retry in place.
  const conversations = await (await page.request.get(`${API}/api/v1/conversations`)).json();
  let target: { id: string } | null = null;
  for (const conversation of conversations) {
    const detail = await (
      await page.request.get(`${API}/api/v1/conversations/${conversation.id}`)
    ).json();
    const failedMedia = (detail.messages ?? []).find(
      (m: { role: string; status?: string }) => m.role === "assistant" && m.status === "failed",
    );
    if (failedMedia) {
      target = conversation;
      break;
    }
  }
  test.skip(!target, "no failed media message found to retry");
  await page.goto(`/c/${target!.id}`);
  const retry = page.locator('[data-testid^="retry-"]').last();
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await retry.click();
  const assistant = page.getByTestId("message-assistant").last();
  await expect(assistant).not.toContainText(/Generation failed/i, { timeout: 240_000 });
  // Videos can take 60-120s to render before the attachment lands.
  await expect(assistant.getByTestId("message-attachments")).toBeVisible({ timeout: 300_000 });
  console.log("RETRY failed media message regenerated in place");
  await page.screenshot({ path: "test-results/chat-media-retry.png" });
});
