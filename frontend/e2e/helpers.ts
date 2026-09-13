import { expect, type Page } from "@playwright/test";

export const API = "http://localhost:8000";
// Backend runs in a container; the mock LLM runs on the host.
export const MOCK_URL = "http://host.docker.internal:4899";

export async function apiCreateProvider(name: string, baseUrl: string = MOCK_URL): Promise<{ id: string }> {
  const res = await fetch(`${API}/api/v1/providers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, provider_type: "CUSTOM", credentials: { base_url: baseUrl } }),
  });
  if (!res.ok) throw new Error(`create provider failed: ${await res.text()}`);
  return res.json();
}

export async function apiCreateModel(providerId: string, name: string, inputPrice = "2", outputPrice = "8"): Promise<{ id: string }> {
  const res = await fetch(`${API}/api/v1/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider_id: providerId,
      model_id: `mock-${name}`,
      name,
      endpoint_type: "chat_completions",
      input_price: inputPrice,
      output_price: outputPrice,
    }),
  });
  if (!res.ok) throw new Error(`create model failed: ${await res.text()}`);
  return res.json();
}

/**
 * Selects provider then model using the new dropdown-based chat composer.
 * The new UI has testids: provider-selector (button) → provider-option-{id}
 * and model-selector (button) → model-option-{id}
 */
export async function selectProviderModel(page: Page, _providerId: string, modelId: string): Promise<void> {
  // Click unified model dropdown trigger
  await expect(page.getByTestId("model-selector")).toBeEnabled();
  await page.getByTestId("model-selector").click();
  await page.getByTestId(`model-option-${modelId}`).click();
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("chat-input").fill(text);
  await expect(page.getByTestId("send-button")).toBeEnabled();
  await page.getByTestId("send-button").click();
}

/**
 * Full 5-step wizard registration against the mock LLM (CUSTOM, base_url only).
 * Pass onlyModelIds to register a subset (deselects everything else first).
 */
export async function wizardRegister(
  page: Page,
  opts: { name: string; type?: string; baseUrl?: string; onlyModelIds?: string[] },
): Promise<void> {
  await page.goto("/providers");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByTestId("add-provider").click();
  await page.getByTestId("provider-name").fill(opts.name);
  if (opts.type) await page.getByTestId("provider-type").selectOption(opts.type);
  await page.getByTestId("wiz-next").click();
  if (opts.baseUrl) await page.getByTestId("cred-base_url").fill(opts.baseUrl);
  await page.getByTestId("wiz-next").click();
  await page.getByTestId("wiz-validate").click();
  await expect(page.getByTestId("wiz-validation-result")).toContainText("Validation successful", {
    timeout: 20000,
  });
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-4")).toBeVisible({ timeout: 20000 });
  if (opts.onlyModelIds) {
    await page.getByTestId("wiz-deselect-filtered").click();
    for (const id of opts.onlyModelIds) await page.getByTestId(`wiz-select-${id}`).check();
  }
  await page.getByTestId("wiz-next").click();
  await expect(page.getByTestId("wizard-step-5")).toBeVisible();
  await page.getByTestId("wiz-register").click();
  await expect(page.getByTestId("provider-detail")).toContainText(opts.name, { timeout: 15000 });
}
