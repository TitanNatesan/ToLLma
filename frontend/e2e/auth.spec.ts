// Auth: signup -> verify -> login -> me -> logout, isolation, proxy gating.
import { expect, test } from "@playwright/test";
import { API, apiCreateModel, apiCreateProvider, apiLoginAs } from "./helpers";

// These tests manage their own sessions; start cookie-free.
test.use({ storageState: { cookies: [], origins: [] } });

test("proxy gates unauthenticated users to login", async ({ page }) => {
  await page.goto("/providers");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("login-page")).toBeVisible();
});

test("signup, verify, login, me, logout", async ({ page }) => {
  const email = `pw-auth-${Date.now()}@tollma.ai`;
  await page.goto("/signup");
  await page.getByTestId("signup-email").fill(email);
  await page.getByTestId("signup-password").fill("Password123");
  await page.getByTestId("signup-submit").click();
  await expect(page).toHaveURL("/", { timeout: 15000 });

  // Session bootstrapped: avatar shows the account.
  await expect(page.getByTestId("user-avatar")).toBeVisible({ timeout: 15000 });

  // Verify via API (debug token, non-prod) then confirm through the UI page.
  const signup = await page.request.post(`${API}/auth/signup`, {
    data: { email: `pw-verify-${Date.now()}@tollma.ai`, password: "Password123" },
  });
  const token = (await signup.json()).debug_verification_token as string;
  await page.goto(`/verify?token=${encodeURIComponent(token)}`);
  await expect(page.getByTestId("verify-ok")).toBeVisible({ timeout: 15000 });

  // Logout returns to login and kills the session.
  await page.goto("/");
  await page.getByTestId("logout-btn").click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/providers");
  await expect(page).toHaveURL(/\/login/);
});

test("login rejects bad credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByTestId("login-email").fill("nobody@tollma.ai");
  await page.getByTestId("login-password").fill("wrongpass1");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
});

test("users only see their own providers", async ({ page }) => {
  await apiLoginAs(page, "isoA");
  const name = `pw-iso-${Date.now()}`;
  const { id } = await apiCreateProvider(page.request, name);
  await apiCreateModel(page.request, id, "m1");
  await page.goto("/providers");
  await expect(page.locator("section[aria-label='Provider list']").getByText(name)).toBeVisible({
    timeout: 15000,
  });

  // Second user in a fresh context sees nothing.
  const ctx2 = await page.context().browser()?.newContext();
  if (!ctx2) throw new Error("no browser");
  const p2 = await ctx2.newPage();
  const email2 = `pw-iso-b-${Date.now()}@tollma.ai`;
  await p2.request.post(`${API}/auth/signup`, { data: { email: email2, password: "Password123" } });
  await p2.goto("/providers");
  await expect(p2.locator("section[aria-label='Provider list']").getByText(name)).toHaveCount(0);
  await ctx2.close();
});
