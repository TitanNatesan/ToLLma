import type { Page } from "@playwright/test";

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

export async function selectProviderModel(page: Page, providerId: string, modelId: string): Promise<void> {
  await page.getByTestId("provider-select").selectOption(providerId);
  await page.getByTestId("model-select").selectOption(modelId);
}

export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("send-button").click();
}
