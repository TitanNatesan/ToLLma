// Manual live-provider suite: real OpenAI + OpenWebUI API calls.
// Skipped unless LIVE_OPENAI_KEY is set. Run headed:
//   LIVE_OPENAI_KEY=sk-... LIVE_IMAGE=/home/ond/Downloads/Ben_10_Omnitrix.png \
//   npx playwright test e2e/live-openai.spec.ts --headed --workers=1
import { expect, test, type Page } from "@playwright/test";

const API = "http://localhost:8000";
const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";
const OPENAI_KEY = process.env.LIVE_OPENAI_KEY ?? "";
const IMAGE = process.env.LIVE_IMAGE ?? "/home/ond/Downloads/Ben_10_Omnitrix.png";
const OPENWEBUI_NAME = process.env.LIVE_OPENWEBUI_NAME ?? "OpenWebUI";

test.describe.configure({ mode: "serial" });
test.skip(!OPENAI_KEY, "LIVE_OPENAI_KEY not set — live provider suite skipped");

async function sendAndWait(page: Page, prompt: string, timeout = 240_000): Promise<string> {
  await page.getByTestId("chat-input").fill(prompt);
  await page.getByTestId("send-button").click();
  const assistant = page.getByTestId("message-assistant").last();
  await expect
    .poll(async () => (await assistant.innerText()).trim().length, { timeout })
    .toBeGreaterThan(0);
  await expect(page.getByTestId("send-button")).toBeVisible({ timeout: 60_000 });
  return (await assistant.innerText()).trim();
}

async function selectModel(page: Page, modelId: string): Promise<void> {
  await page.getByTestId("model-selector").click();
  await page.getByTestId(`model-option-${modelId}`).click();
}

test("live: OpenAI provider registration and model matrix", async ({ page }) => {
  test.setTimeout(35 * 60 * 1000);
  page.setDefaultTimeout(20_000);

  // --- UI login as the real account ---------------------------------------
  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 30_000 });
  console.log("CHECKPOINT login ok");

  // --- Provider wizard: OpenAI card, real key, real validation/discovery ---
  const providerName = `OpenAI ${Date.now()}`;
  await page.goto("/providers");
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(providerName);
  await page.getByTestId("provider-platform-OPENAI").click();
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("cred-api_key").fill(OPENAI_KEY);
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("wiz-validate").click();
  await expect(page.getByTestId("wiz-validation-result")).toContainText("Validation successful", {
    timeout: 120_000,
  });
  console.log("CHECKPOINT validation ok");
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-4")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("wiz-selection-count")).toContainText(/\d+ of \d+/, { timeout: 120_000 });
  console.log("CHECKPOINT discovery ok");

  // The wizard starts with every discovered model selected; clear, then pick.
  await page.getByTestId("wiz-deselect-filtered").click();
  await expect(page.getByTestId("wiz-selection-count")).toContainText("0 of", { timeout: 30_000 });
  for (const modelId of ["gpt-4.1-nano", "gpt-image-1", "sora-2", "gpt-5-mini"]) {
    await page.getByTestId("wiz-model-search").fill(modelId);
    const checkbox = page.getByTestId(`wiz-select-${modelId}`);
    await expect(checkbox).toBeVisible({ timeout: 30_000 });
    await checkbox.check({ force: true });
    await expect(checkbox).toBeChecked();
    console.log(`CHECKPOINT selected ${modelId}`);
  }

  // gpt-4.1-nano has no repository entry -> enable vision + file attachments.
  await page.getByTestId("wiz-model-search").fill("gpt-4.1-nano");
  await page.getByTestId("wiz-edit-gpt-4.1-nano").click();
  await expect(page.getByTestId("wiz-edit-drawer")).toBeVisible();
  await page.getByTestId("madd-cap-supports_vision").check({ force: true });
  await page.getByTestId("madd-cap-supports_files").check({ force: true });
  await page.getByTestId("madd-save").click();
  console.log("CHECKPOINT edited gpt-4.1-nano (vision+files)");

  // sora-2 routes through the Videos endpoint (endpoint-aware registration).
  await page.getByTestId("wiz-model-search").fill("sora-2");
  await page.getByTestId("wiz-edit-sora-2").click();
  await expect(page.getByTestId("wiz-edit-drawer")).toBeVisible();
  await page.getByTestId("madd-endpoint").selectOption("video/generations");
  await page.getByTestId("madd-save").click();
  console.log("CHECKPOINT edited sora-2 (video/generations)");

  // gpt-5-mini uses the Responses endpoint so reasoning summaries stream.
  await page.getByTestId("wiz-model-search").fill("gpt-5-mini");
  await page.getByTestId("wiz-edit-gpt-5-mini").click();
  await expect(page.getByTestId("wiz-edit-drawer")).toBeVisible();
  await page.getByTestId("madd-endpoint").selectOption("responses");
  await page.getByTestId("madd-save").click();
  console.log("CHECKPOINT edited gpt-5-mini (responses)");

  await page.getByTestId("wiz-model-search").fill("");
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-5")).toBeVisible();
  const finishCards = page.locator('[data-testid^="wiz-finish-model-"]');
  await expect(finishCards).toHaveCount(4);
  console.log(`CHECKPOINT step5 reachable, finish cards=${await finishCards.count()}`);
  await page.screenshot({ path: "test-results/live-step5.png" });
  await page.getByTestId("wiz-register").click();
  console.log("CHECKPOINT register clicked");
  await expect(page.getByTestId("provider-detail")).toContainText(providerName, { timeout: 120_000 });
  console.log("CHECKPOINT provider registered");
  await page.screenshot({ path: "test-results/live-provider-registered.png" });

  const providers = await (await page.request.get(`${API}/api/v1/providers`)).json();
  const provider = providers.find((p: { name: string }) => p.name === providerName);
  const models = await (
    await page.request.get(`${API}/api/v1/models`, { params: { provider_id: provider.id } })
  ).json();
  const idOf = (modelId: string) => models.find((m: { model_id: string }) => m.model_id === modelId)?.id;
  expect(models).toHaveLength(4);

  // --- gpt-4.1-nano: text -> text -----------------------------------------
  await page.goto("/");
  await selectModel(page, idOf("gpt-4.1-nano"));
  const textReply = await sendAndWait(page, "Say Hello");
  expect(textReply.toLowerCase()).toContain("hello");
  console.log(`LIVE gpt-4.1-nano text: ${textReply.slice(0, 120)}`);
  await page.screenshot({ path: "test-results/live-gpt-4.1-nano-text.png" });

  // --- gpt-4.1-nano: image -> text with the real attachment ----------------
  await page.setInputFiles('[data-testid="attach-input"]', IMAGE);
  await expect(page.locator("[data-testid^='attachment-chip-']").first()).toHaveAttribute(
    "data-status",
    "ready",
    { timeout: 60_000 },
  );
  const visionReply = await sendAndWait(page, "What do you see? One short sentence.");
  expect(visionReply.length).toBeGreaterThan(5);
  console.log(`LIVE gpt-4.1-nano vision: ${visionReply.slice(0, 140)}`);
  await page.screenshot({ path: "test-results/live-gpt-4.1-nano-vision.png" });

  // --- gpt-5-mini on Responses: reasoning UI -------------------------------
  await selectModel(page, idOf("gpt-5-mini"));
  await page.getByTestId("reasoning-selector").click().catch(() => {});
  await page.getByTestId("reasoning-level-low").click().catch(() => {});
  const reasoningReply = await sendAndWait(page, "Think briefly, then answer: what is 2+2?");
  const toggle = page.getByTestId("message-assistant").last().getByTestId("reasoning-toggle");
  const reasoningVisible = await toggle.count();
  if (reasoningVisible) {
    await toggle.click();
    const panel = page.getByTestId("message-assistant").last().getByTestId("reasoning-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    console.log(`LIVE gpt-5-mini reasoning panel: ${(await panel.innerText()).slice(0, 140)}`);
  }
  console.log(`LIVE gpt-5-mini reply: ${reasoningReply.slice(0, 120)} · reasoning_ui=${reasoningVisible > 0}`);
  await page.screenshot({ path: "test-results/live-gpt-5-mini-reasoning.png" });

  // --- every registered OpenWebUI model ------------------------------------
  const openwebui = providers.find((p: { name: string }) => p.name === OPENWEBUI_NAME);
  expect(openwebui).toBeTruthy();
  const openwebuiModels = await (
    await page.request.get(`${API}/api/v1/models`, { params: { provider_id: openwebui.id } })
  ).json();
  for (const model of openwebuiModels) {
    await page.goto("/");
    await selectModel(page, model.id);
    try {
      const reply = await sendAndWait(page, "Say Hi", 240_000);
      console.log(`LIVE ${OPENWEBUI_NAME} PASS ${model.model_id}: ${reply.slice(0, 120)}`);
      await page.screenshot({
        path: `test-results/live-openwebui-${String(model.model_id).replace(/[^a-z0-9]+/gi, "_")}.png`,
      });
    } catch (error) {
      console.log(
        `LIVE ${OPENWEBUI_NAME} FAIL ${model.model_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
});
