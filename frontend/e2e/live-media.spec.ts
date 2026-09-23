// Live media generation in the UI: image (text->image) and video
// (text->video, image->video) through /generate. Full-screen headed run:
//   LIVE_OPENAI_KEY=sk-... npx playwright test e2e/live-media.spec.ts --headed --workers=1
import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:8000";
const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";
const IMAGE = process.env.LIVE_IMAGE ?? "/home/ond/Downloads/Ben_10_Omnitrix.png";

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: "serial" });
test.skip(!process.env.LIVE_OPENAI_KEY, "LIVE_OPENAI_KEY not set — live media suite skipped");

async function login(page: Page) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 30_000 });
}

async function latestOpenAIModels(page: Page): Promise<Array<{ id: string; model_id: string }>> {
  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const openai = providers
    .filter((p: { name: string }) => p.name.startsWith("OpenAI 179"))
    .sort((a: { created_at: string }, b: { created_at: string }) => (a.created_at < b.created_at ? 1 : -1))[0];
  return (await (await page.request.get(`${API}/api/v1/models`, { params: { provider_id: openai.id } })).json()).map(
    (m: { id: string; model_id: string }) => ({ id: m.id, model_id: m.model_id }),
  );
}

async function generateVideoAndWait(page: Page, attempts = 2): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.getByTestId("media-generate").click();
    await expect(page.getByTestId("media-status")).toBeVisible();
    const video = page.getByTestId("media-result-video");
    try {
      await expect(video).toBeVisible({ timeout: 240_000 });
      await expect
        .poll(async () => video.evaluate((el) => (el as HTMLVideoElement).videoWidth), { timeout: 30_000 })
        .toBeGreaterThan(0);
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const message = (await page.getByTestId("media-error").innerText().catch(() => "unknown")) ?? "unknown";
      console.log(`MEDIA video attempt ${attempt} failed (${message.slice(0, 160)}), retrying`);
    }
  }
}

test("live media: image generation, text->video, image->video", async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await login(page);
  const models = await latestOpenAIModels(page);
  const idOf = (modelId: string) => models.find((m) => m.model_id === modelId)?.id;
  await page.goto("/generate");
  await expect(page.getByTestId("media-model")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: "test-results/media-page.png" });

  // --- text -> image (gpt-image-1, low quality) ----------------------------
  await page.getByTestId("media-model").selectOption(`${idOf("gpt-image-1")}:image`);
  await page.getByTestId("media-prompt").fill("green circle");
  await page.getByTestId("media-quality").selectOption("low");
  await page.getByTestId("media-generate").click();
  const image = page.getByTestId("media-result-img");
  await expect(image).toBeVisible({ timeout: 180_000 });
  await expect
    .poll(async () => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 30_000 })
    .toBeGreaterThan(0);
  console.log("MEDIA image ok: prompt='green circle' quality=low");
  await page.screenshot({ path: "test-results/media-image.png" });

  // --- text -> video (sora-2, 4s) ------------------------------------------
  await page.getByTestId("media-model").selectOption(`${idOf("sora-2")}:video`);
  await page.getByTestId("media-prompt").fill("A green circle pulsing gently on a black background");
  await page.getByTestId("media-seconds").selectOption("4");
  await generateVideoAndWait(page);
  console.log("MEDIA text->video ok: sora-2 4s 1280x720 (API minimum)");
  await page.screenshot({ path: "test-results/media-video-text.png" });

  // --- image -> video (sora-2 with the reference image) --------------------
  await page.setInputFiles('[data-testid="media-reference"]', IMAGE);
  await expect(page.getByText("Ben_10_Omnitrix.png")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("media-prompt").fill("The character from the reference image waves at the camera");
  await generateVideoAndWait(page);
  console.log("MEDIA image->video ok: sora-2 with Ben_10 reference");
  await page.screenshot({ path: "test-results/media-video-image.png" });
});
