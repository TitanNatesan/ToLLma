// Command Palette -> Theme Studio (appearance + glass + accent).
import { expect, test, type Page } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

async function openPalette(page: Page): Promise<void> {
  await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10000 });
}

async function openStudio(page: Page): Promise<void> {
  await openPalette(page);
  const item = page.getByTestId("cmd-theme");
  await expect(item).toBeVisible({ timeout: 10000 });
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(page.getByTestId("theme-studio")).toBeVisible({ timeout: 10000 });
}

/** React-compatible range/color input write (native setter + bubbled events). */
async function setSlider(page: Page, testId: string, value: string): Promise<void> {
  await page.getByTestId(testId).evaluate((node, v) => {
    const el = node as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

const glassVar = (page: Page, name: string) =>
  page.evaluate((n) => document.documentElement.style.getPropertyValue(n).trim(), name);

test("theme item opens studio over the palette, preserves query, Esc unwinds", async ({ page }) => {
  await apiLoginAs(page, "theme-layer");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openPalette(page);

  // Query narrows the list but keeps the Theme entry (value contains "theme").
  await page.getByTestId("command-palette-input").fill("them");
  await expect(page.getByTestId("cmd-theme")).toBeVisible();

  await page.getByTestId("cmd-theme").click();
  await expect(page.getByTestId("theme-studio")).toBeVisible({ timeout: 10000 });
  // Studio sits above the still-open palette; the query is untouched.
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await expect(page.getByTestId("command-palette-input")).toHaveValue("them");

  // First Esc closes the studio only; second Esc closes the palette.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("theme-studio")).toHaveCount(0);
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toHaveCount(0);
});

test("glass sliders apply live; transparency toggle disables dependents", async ({ page }) => {
  await apiLoginAs(page, "theme-sliders");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openStudio(page);

  // Live: moving blur updates the engine-owned CSS var on <html>.
  await setSlider(page, "theme-blur", "30");
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("30px");

  // Appearance buttons flip the theme classes immediately (dark IS the deep-black palette).
  await expect(page.getByTestId("theme-appearance-black")).toHaveCount(0);
  await page.getByTestId("theme-appearance-light").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(false);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("black"))).toBe(false);
  await page.getByTestId("theme-appearance-dark").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("black"))).toBe(false);
  await expect.poll(() => glassVar(page, "--glass-bg")).toContain("0 0 0");

  // Transparency off forces blur to 0 and locks the dependent sliders.
  await page.getByTestId("theme-glass-enabled").click();
  await expect(page.getByTestId("theme-blur")).toBeDisabled();
  await expect(page.getByTestId("theme-refraction")).toBeDisabled();
  await expect(page.getByTestId("theme-depth")).toBeDisabled();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("0px");

  // Back on: sliders unlock and the chosen blur applies again.
  await page.getByTestId("theme-glass-enabled").click();
  await expect(page.getByTestId("theme-blur")).toBeEnabled();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("30px");
});

test("reset restores defaults, revert restores the pre-open snapshot, config persists", async ({ page }) => {
  await apiLoginAs(page, "theme-reset");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openStudio(page);

  // Diverge from defaults (dark, blur 16px), then revert to the open snapshot.
  await setSlider(page, "theme-blur", "30");
  await page.getByTestId("theme-appearance-light").click();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("30px");
  await page.getByTestId("theme-revert").click();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("16px");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  // Reset restores factory defaults even after new edits.
  await setSlider(page, "theme-blur", "30");
  await page.getByTestId("theme-appearance-light").click();
  await page.getByTestId("theme-reset").click();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("16px");
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("black"))).toBe(false);

  // Persistence: an edited value is written to tollma-glass and the store
  // rehydrates it on the next load (the engine only writes inline vars on
  // update, so assert the persisted config + the rehydrated slider value).
  await setSlider(page, "theme-blur", "27");
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("27px");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tollma-glass") ?? ""))
    .toContain('"blur":27');
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("theme-studio")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.reload();
  await page.waitForLoadState("networkidle");
  await openStudio(page);
  await expect(page.getByTestId("theme-blur")).toHaveValue("27");
});

test("legacy black appearance migrates to dark on load", async ({ page }) => {
  await apiLoginAs(page, "theme-legacy-black");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    const payload = JSON.stringify({
      state: {
        config: {
          appearance: "black",
          transparencyEnabled: true,
          transparency: 25,
          blur: 16,
          refraction: 35,
          depth: 30,
          notificationPosition: "bottom-right",
        },
        userId: null,
      },
      version: 0,
    });
    localStorage.setItem("tollma-glass", payload);
  });
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("black")))
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--glass-bg").trim()),
    )
    .toContain("0 0 0");
});

test("accent change from the studio applies globally and reaches the backend", async ({ page }) => {
  await apiLoginAs(page, "theme-accent");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openStudio(page);

  await page.getByTestId("accent-purple").click();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--color-tollma-500").trim()))
    .toBe("#7e22ce");
  await expect
    .poll(async () => (await (await page.request.get(`${API}/api/v1/settings/preferences`)).json()).accent)
    .toBe("purple");

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--color-tollma-500").trim()))
    .toBe("#7e22ce");
});

test("notification position picker toasts at the new spot and persists", async ({ page }) => {
  await apiLoginAs(page, "theme-notify");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openStudio(page);

  // Start from factory defaults so the toast copy is deterministic.
  await page.getByTestId("theme-reset").click();
  await expect(page.getByTestId("theme-notification-top-left")).toBeVisible();

  await page.getByTestId("theme-notification-top-left").click();

  // Confirmation toast fires AT the new position with from -> to copy.
  const moved = page.locator("[data-sileo-toast]", { hasText: "Notification position changed" });
  await expect(moved).toBeVisible({ timeout: 10000 });
  await expect(moved).toContainText("from bottom right to top left");

  // Persisted to tollma-glass.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tollma-glass") ?? ""))
    .toContain('"notificationPosition":"top-left"');

  // Reload: the picker still shows top-left selected. The active zone renders
  // a preview instead of a button, so its testid is absent while the old
  // default becomes clickable again.
  await page.reload();
  await page.waitForLoadState("networkidle");
  await openStudio(page);
  await expect(page.getByTestId("theme-notification-top-left")).toHaveCount(0);
  await expect(page.getByTestId("theme-notification-bottom-right")).toBeVisible();
  await expect(page.getByTestId("theme-notification-picker")).toContainText(
    "Notifications appear at top left",
  );

  // Leave a clean state for later runs.
  await page.getByTestId("theme-notification-bottom-right").click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tollma-glass") ?? ""))
    .toContain('"notificationPosition":"bottom-right"');
});

test("blur slider value reaches glass components", async ({ page }) => {
  await apiLoginAs(page, "theme-blur-glass");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openStudio(page);

  const computedGlassVar = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--glass-blur").trim());
  const dialogBackdrop = () =>
    page.evaluate(() => {
      const palette = document.querySelector('[data-testid="command-palette"]');
      const dlg = (palette?.closest('[role="dialog"]') ?? palette) as HTMLElement | null;
      return dlg ? getComputedStyle(dlg).backdropFilter : "";
    });

  await setSlider(page, "theme-blur", "30");
  await expect.poll(computedGlassVar).toBe("30px");
  await expect.poll(dialogBackdrop).toContain("blur(30px)");

  await setSlider(page, "theme-blur", "0");
  await expect.poll(dialogBackdrop).toContain("blur(0px)");

  // Hermetic: restore factory defaults for later runs.
  await page.getByTestId("theme-reset").click();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("16px");
});

test("glass extremes map to engine vars and toaster inverts in dark mode", async ({ page }) => {
  await apiLoginAs(page, "theme-extremes");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await openStudio(page);

  // Hermetic start from factory defaults (dark, blur 16px).
  await page.getByTestId("theme-reset").click();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("16px");
  await page.getByTestId("theme-appearance-dark").click();
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);

  // Blur slider now spans 0–100 with a % readout.
  await expect(page.getByTestId("theme-blur")).toHaveAttribute("max", "100");
  await setSlider(page, "theme-blur", "100");
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("100px");

  // Transparency is literal: 100% see-through -> alpha 0.02 on the surface fill.
  await setSlider(page, "theme-transparency", "100");
  await expect.poll(() => glassVar(page, "--glass-bg")).toContain("/ 0.02");

  // Toast inversion: dark app -> light toast. The position picker fires a
  // confirmation toast; Sileo paints the visible fill as SVG rects
  // ([data-sileo-pill]), the toast element itself stays transparent by design.
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(true);
  await page.getByTestId("theme-notification-top-left").click();
  const moved = page.locator("[data-sileo-toast]", { hasText: "Notification position changed" });
  await expect(moved).toBeVisible({ timeout: 10000 });

  // Viewport theme is inverted vs the dark app.
  await expect
    .poll(() => page.evaluate(() => document.querySelector("[data-sileo-viewport]")?.getAttribute("data-theme")))
    .toBe("light");
  // Visible fill is white-ish: attribute #ffffff, computed rgb(255, 255, 255).
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector("[data-sileo-toast] [data-sileo-pill]")?.getAttribute("fill") ?? "",
      ),
    )
    .toMatch(/ffffff/i);
  const computedFill = await page.evaluate(() => {
    const pill = document.querySelector("[data-sileo-toast] [data-sileo-pill]");
    return pill ? getComputedStyle(pill).getPropertyValue("fill") : "";
  });
  expect(computedFill).toContain("255, 255, 255");

  // Hermetic reset: factory defaults restore blur/transparency/position.
  await page.getByTestId("theme-reset").click();
  await expect.poll(() => glassVar(page, "--glass-blur")).toBe("16px");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("tollma-glass") ?? ""))
    .toContain('"notificationPosition":"bottom-right"');
});
