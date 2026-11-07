import { expect, test } from "@playwright/test";

// Temporary verification. Deleted after run.
test("sidebar toggle uses glass engine", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 20000 });
  const snap = () =>
    page.evaluate(() => ({
      dark: document.documentElement.classList.contains("dark"),
      black: document.documentElement.classList.contains("black"),
      bg: getComputedStyle(document.documentElement).getPropertyValue("--glass-bg").trim(),
      blur: getComputedStyle(document.documentElement).getPropertyValue("--glass-blur").trim(),
      stored: JSON.parse(localStorage.getItem("tollma-glass") ?? "{}")?.state?.config?.appearance,
    }));
  // ensure known start: dark via studio
  await page.keyboard.press("Control+k");
  await page.getByTestId("cmd-theme").click();
  await page.getByTestId("theme-appearance-dark").click();
  await page.getByTestId("theme-studio-close").click();
  await page.keyboard.press("Escape");

  // toggle -> light: classes + recomputed vars + persisted
  await page.getByTestId("theme-toggle-btn").click();
  let s = await snap();
  console.log("AFTER_TOGGLE_LIGHT=" + JSON.stringify(s));
  expect(s.dark).toBe(false);
  expect(s.bg.startsWith("rgb(255 255 255")).toBe(true);
  expect(s.stored).toBe("light");

  // studio reflects it
  await page.keyboard.press("Control+k");
  await page.getByTestId("cmd-theme").click();
  await expect(page.getByTestId("theme-appearance-light")).toHaveAttribute("aria-pressed", "true");
  // black via studio, then toggle -> light (black cleared, vars recomputed)
  await page.getByTestId("theme-appearance-black").click();
  await page.getByTestId("theme-studio-close").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("theme-toggle-btn").click();
  s = await snap();
  console.log("AFTER_BLACK_TOGGLE=" + JSON.stringify(s));
  expect(s.dark).toBe(false);
  expect(s.black).toBe(false);
  expect(s.bg.startsWith("rgb(255 255 255")).toBe(true);
  expect(s.stored).toBe("light");

  // toggle back -> dark with engine vars
  await page.getByTestId("theme-toggle-btn").click();
  s = await snap();
  console.log("AFTER_TOGGLE_DARK=" + JSON.stringify(s));
  expect(s.dark).toBe(true);
  expect(s.bg.startsWith("rgb(24 24 27")).toBe(true);
  expect(s.stored).toBe("dark");

  // persistence across reload
  await page.reload();
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout: 20000 });
  s = await snap();
  console.log("AFTER_RELOAD=" + JSON.stringify(s));
  expect(s.dark).toBe(true);
  expect(s.stored).toBe("dark");
  await page.screenshot({ path: "/tmp/shot-toggle-theme.png" });
});
