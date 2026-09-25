// API-keys micro-UX: budget usage bar, styled create-form controls (no native
// number spinners / selects) and the admin "API Keys" section.
//   DISPLAY=:0 npx playwright test e2e/api-keys-ux.spec.ts --headed --workers=1 --retries=1
// Uses the promoted live account (read-only console + key create/delete probe).
import { expect, test } from "@playwright/test";
import { API } from "./helpers";

test.use({ viewport: { width: 1920, height: 1080 } });

const EMAIL = process.env.LIVE_EMAIL ?? "titannatesan@gmail.com";
const PASSWORD = process.env.LIVE_PASSWORD ?? "TitanDev@123";

test("api keys console: budget bar, styled form, admin section", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  page.setDefaultTimeout(30_000);

  // Drop the storageState account's stale bearer so the page bootstraps from
  // the freshly logged-in cookies instead of refresh-retrying a dead token.
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem("tollma_access_token");
    } catch {
      // storage unavailable
    }
  });

  const login = await page.request.post(`${API}/auth/login`, {
    data: { email: EMAIL, password: PASSWORD },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()} ${await login.text()}`);
  const { access_token: accessToken } = (await login.json()) as { access_token?: string };
  const authHeaders: Record<string, string> = accessToken
    ? { Authorization: `Bearer ${accessToken}` }
    : {};

  // A budgeted key guarantees the usage bar renders deterministically.
  const created = await page.request.post(`${API}/api/v1/keys`, {
    headers: authHeaders,
    data: {
      name: `e2e-ux-${Date.now()}`,
      description: "Playwright micro-UX probe",
      policy: { max_budget_usd: 1, budget_reset_days: 30, rpm: 60, tpm: 100000 },
    },
  });
  if (!created.ok()) throw new Error(`create key failed: ${created.status()} ${await created.text()}`);
  const createdKey = (await created.json()) as { key: { id: string } };

  try {
    await page.goto("/api-keys");
    await expect(page.getByTestId("keys-table")).toBeVisible({ timeout: 45_000 });

    // 1) Budget bar: percent used + remaining in one micro-meter.
    const row = page.getByTestId(`key-row-${createdKey.key.id}`);
    await expect(row).toBeVisible();
    const budget = row.getByTestId("key-budget-usage");
    await expect(budget).toContainText(/% used/);
    await expect(budget).toContainText(/remaining/);
    await page.screenshot({ path: "test-results/api-keys-table.png" });

    // 2) Create form renders fully styled controls.
    await page.getByTestId("create-key-button").click();
    const dialog = page.getByTestId("key-form-dialog");
    await expect(dialog).toBeVisible();

    const numberInputs = dialog.locator('input[type="number"]');
    const numberCount = await numberInputs.count();
    expect(numberCount).toBeGreaterThanOrEqual(6);
    for (let index = 0; index < numberCount; index += 1) {
      const appearance = await numberInputs
        .nth(index)
        .evaluate((element) => getComputedStyle(element).appearance);
      expect(appearance).toContain("textfield");
    }

    // Custom steppers replace native spinners; no native <select> anywhere.
    await expect(page.getByTestId("policy-budget-increase")).toBeVisible();
    await expect(page.getByTestId("policy-budget-decrease")).toBeVisible();
    await expect(dialog.locator("select")).toHaveCount(0);

    // Radix popover select: open, pick a reset window, verify the trigger label.
    await page.getByTestId("policy-reset").click();
    await expect(page.getByTestId("policy-reset-menu")).toBeVisible();
    await page.getByTestId("policy-reset-option-7").click();
    await expect(page.getByTestId("policy-reset")).toContainText("Every 7 days");

    await page.screenshot({ path: "test-results/api-keys-ux.png" });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // 3) Admin section: KPIs when the endpoint is live, empty state otherwise.
    await page.goto("/admin#api-keys");
    await expect(page.getByTestId("admin-panel-api-keys")).toBeVisible({ timeout: 45_000 });
    await expect(
      page
        .getByTestId("admin-api-keys-kpi-total")
        .or(page.getByTestId("admin-api-keys-unavailable")),
    ).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: "test-results/admin-api-keys.png" });
  } finally {
    if (createdKey?.key?.id) {
      await page.request
        .delete(`${API}/api/v1/keys/${createdKey.key.id}`, { headers: authHeaders })
        .catch(() => undefined);
    }
  }
});
