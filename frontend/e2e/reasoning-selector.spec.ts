// Thinking-level selector: click cycling, discrete snap points, aligned
// labels, wheel stepping, None-mode request payload, capability gating.
import { expect, test, type Page } from "@playwright/test";
import { startMockLLM } from "./mock-server";
import { apiCreateModel, apiCreateProvider, apiLoginAs, selectProviderModel, sendMessage } from "./helpers";

test.beforeAll(async () => {
  await startMockLLM();
});

async function setupChat(page: Page, tag: string, modelExtra: Record<string, unknown> = {}) {
  await apiLoginAs(page, tag);
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-reason-${stamp}`);
  // "reasoner" avoids the mock's slow/think pacing modes.
  const m = await apiCreateModel(page.request, p.id, `reasoner-${stamp}`, "2", "8", {
    supports_reasoning: true,
    ...modelExtra,
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await selectProviderModel(page, p.id, m.id);
  return { p, m, stamp };
}

test("click cycles None → Low → Medium → High → None without opening the scale", async ({ page }) => {
  await setupChat(page, "rc-cycle");
  const indicator = page.getByTestId("reasoning-value");
  const scale = page.getByTestId("reasoning-scale");
  await expect(indicator).toContainText("low"); // default stays the first on-level

  // Programmatic clicks (no hover, no focus): the level cycles and the scale
  // stays shut — clicking is never the opener.
  for (const expected of ["medium", "high", "none", "low"]) {
    await indicator.evaluate((el) => (el as HTMLElement).click());
    await expect(indicator).toContainText(expected);
    await expect(scale).toHaveCSS("opacity", "0");
  }
});

test("hover still reveals the scale; leaving closes it after the delay", async ({ page }) => {
  await setupChat(page, "rc-hover");
  const scale = page.getByTestId("reasoning-scale");
  await expect(scale).toHaveCSS("opacity", "0");

  await page.getByTestId("reasoning-value").hover();
  await expect(scale).toHaveCSS("opacity", "1");

  await page.getByTestId("chat-input").hover();
  await page.waitForTimeout(50); // well inside REASONING_CLOSE_DELAY_MS
  await expect(scale).toHaveCSS("opacity", "1"); // still open right after leaving
  await expect(scale).toHaveCSS("opacity", "0", { timeout: 2000 }); // then closes
});

test("slider snaps to discrete stops and is keyboard accessible", async ({ page }) => {
  await setupChat(page, "rc-keys");
  const indicator = page.getByTestId("reasoning-value");
  await indicator.hover();
  const slider = page.getByTestId("reasoning-slider");
  await slider.focus();

  await slider.press("ArrowRight"); // Low → Medium
  await expect(indicator).toContainText("medium");
  await expect(slider).toHaveValue("2");

  await slider.press("End");
  await expect(indicator).toContainText("high");
  await expect(slider).toHaveValue("3");

  await slider.press("Home");
  await expect(indicator).toContainText("none");
  await expect(slider).toHaveValue("0");

  // Already at the first stop: no intermediate value can appear.
  await slider.press("ArrowDown");
  await expect(slider).toHaveValue("0");
  await expect(indicator).toContainText("none");
});

test("labels align with their stops and select immediately on click", async ({ page }) => {
  await setupChat(page, "rc-labels");
  const indicator = page.getByTestId("reasoning-value");
  await indicator.hover();

  // Label centers sit on the stop dots (same geometry as the thumb travel).
  for (const level of ["none", "low", "high"]) {
    const label = await page.getByTestId(`reasoning-level-${level}`).boundingBox();
    const stop = await page.getByTestId(`reasoning-stop-${level}`).boundingBox();
    expect(label, `label ${level}`).not.toBeNull();
    expect(stop, `stop ${level}`).not.toBeNull();
    expect(Math.abs(label!.x + label!.width / 2 - (stop!.x + stop!.width / 2))).toBeLessThan(2);
  }

  const labels = { none: "none", low: "low", medium: "medium", high: "high" } as const;
  for (const level of ["none", "low", "medium", "high"] as const) {
    await page.getByTestId(`reasoning-level-${level}`).click();
    await expect(indicator).toContainText(labels[level]);
    await expect(page.getByTestId(`reasoning-level-${level}`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`reasoning-stop-${level}`)).toHaveClass(/bg-tollma-600/);
  }
});

test("mouse wheel steps levels over the selector only", async ({ page }) => {
  await setupChat(page, "rc-wheel");
  const indicator = page.getByTestId("reasoning-value");
  await indicator.hover();

  await page.mouse.wheel(0, -120); // Low → Medium
  await expect(indicator).toContainText("medium");

  await page.waitForTimeout(200); // outside the wheel cooldown
  await page.mouse.wheel(0, -120); // Medium → High
  await expect(indicator).toContainText("high");

  await page.waitForTimeout(200);
  await page.mouse.wheel(0, -120); // clamped at the last stop
  await expect(indicator).toContainText("high");

  await page.waitForTimeout(200);
  await page.mouse.wheel(0, 120); // High → Medium
  await expect(indicator).toContainText("medium");

  // Outside the selector the level must not change.
  await page.getByTestId("chat-input").hover();
  await page.waitForTimeout(400); // let the scale close
  await page.mouse.wheel(0, 120);
  await expect(indicator).toContainText("medium");
});

test("None sends an explicit reasoning-disabled payload; on-levels stay explicit", async ({ page }) => {
  await setupChat(page, "rc-none");
  const payloads: Array<Record<string, unknown>> = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/v1/gateway/stream")) payloads.push(req.postDataJSON());
  });

  await page.getByTestId("reasoning-value").hover();
  await page.getByTestId("reasoning-level-none").click();
  await expect(page.getByTestId("reasoning-value")).toContainText("none");
  await sendMessage(page, "answer without thinking");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from", { timeout: 15000 });
  expect(payloads).toHaveLength(1);
  expect(payloads[0].reasoning_level).toBe("none");

  await page.getByTestId("reasoning-value").hover();
  await page.getByTestId("reasoning-level-low").click();
  await sendMessage(page, "think a little");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Hello from", { timeout: 15000 });
  expect(payloads).toHaveLength(2);
  expect(payloads[1].reasoning_level).toBe("low");
});

test("selector hides for non-reasoning models and honors declared levels", async ({ page }) => {
  await apiLoginAs(page, "rc-caps");
  const stamp = Date.now();
  const p = await apiCreateProvider(page.request, `pw-rcaps-${stamp}`);
  const plain = await apiCreateModel(page.request, p.id, `plain-${stamp}`);
  const custom = await apiCreateModel(page.request, p.id, `custom-${stamp}`, "2", "8", {
    supports_reasoning: true,
    metadata: { reasoning_levels: ["low", "high"] },
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  await selectProviderModel(page, p.id, plain.id);
  await expect(page.getByTestId("reasoning-selector")).toHaveCount(0);

  await selectProviderModel(page, p.id, custom.id);
  await expect(page.getByTestId("reasoning-selector")).toBeVisible();
  await expect(page.getByTestId("reasoning-value")).toContainText("low");

  await page.getByTestId("reasoning-value").hover();
  await expect(page.getByTestId("reasoning-level-none")).toBeVisible();
  await expect(page.getByTestId("reasoning-level-low")).toBeVisible();
  await expect(page.getByTestId("reasoning-level-high")).toBeVisible();
  await expect(page.getByTestId("reasoning-level-medium")).toHaveCount(0);
});
