// Focused live check: repair gpt-image-1's endpoint and verify the Reasoning UI
// for gpt-5-mini on the Responses endpoint. Skipped without LIVE_OPENAI_KEY.
import { expect, test } from "@playwright/test";

const API = "http://localhost:8000";
const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";
const OPENAI_KEY = process.env.LIVE_OPENAI_KEY ?? "";

test.skip(!OPENAI_KEY, "LIVE_OPENAI_KEY not set");

test("live: fix gpt-image-1 endpoint and show gpt-5-mini reasoning", async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 30_000 });

  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const openai = providers
    .filter((p: { name: string }) => p.name.startsWith("OpenAI 179"))
    .sort((a: { created_at: string }, b: { created_at: string }) =>
      a.created_at < b.created_at ? 1 : -1,
    )[0];
  const models = await (
    await page.request.get(`${API}/api/v1/models`, { params: { provider_id: openai.id } })
  ).json();
  const byId = (modelId: string) => models.find((m: { model_id: string }) => m.model_id === modelId);

  // Repair the endpoint registered before the draft-validate fix.
  const imageModel = byId("gpt-image-1");
  const patched = await page.request.patch(`${API}/api/v1/models/${imageModel.id}`, {
    data: { primary_endpoint: "images/generations", supported_endpoints: ["images/generations"] },
  });
  expect(patched.ok()).toBeTruthy();
  const after = await patched.json();
  console.log(`PATCHED gpt-image-1 endpoint=${after.primary_endpoint} supported=${after.supported_endpoints}`);

  // Reasoning UI on the Responses endpoint (effort=low, summary=auto).
  const reasoningModel = byId("gpt-5-mini");
  await page.goto("/");
  await page.getByTestId("model-selector").click();
  await page.getByTestId(`model-option-${reasoningModel.id}`).click();
  await page.getByTestId("reasoning-selector").hover();
  await page.getByTestId("reasoning-level-low").click().catch(async () => {
    await page.getByTestId("reasoning-selector").click();
  });

  await page.getByTestId("chat-input").fill("Think briefly, then answer in one word: what is 2+2?");
  await page.getByTestId("send-button").click();
  const assistant = page.getByTestId("message-assistant").last();
  await expect(page.getByTestId("stop-button")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 180_000 });

  const toggle = assistant.getByTestId("reasoning-toggle");
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.click();
  const panel = assistant.getByTestId("reasoning-panel");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  console.log(`REASONING UI OK: ${(await panel.innerText()).replace(/\s+/g, " ").slice(0, 200)}`);
  await page.screenshot({ path: "test-results/live-reasoning-panel.png" });
});
