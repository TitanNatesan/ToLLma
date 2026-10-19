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

  // Logout returns to login and kills the session (log out is a nav row now).
  await page.goto("/");
  const logoutBtn = page.getByTestId("logout-btn");
  await expect(logoutBtn).toBeVisible();
  await expect(logoutBtn).toContainText("Log out");
  await expect(page.getByTestId("sidebar-footer").getByTestId("logout-btn")).toHaveCount(0);
  await logoutBtn.click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/providers");
  await expect(page).toHaveURL(/\/login/);
});

test("login rejects bad credentials", async ({ page }) => {
  await page.goto("/login");
  // Restyle: labels are htmlFor-linked to their inputs.
  await expect(page.locator('label[for="login-email"]')).toBeVisible();
  await expect(page.locator('label[for="login-password"]')).toBeVisible();
  await expect(page.getByTestId("login-email")).toHaveAttribute("id", "login-email");
  await expect(page.getByTestId("login-password")).toHaveAttribute("id", "login-password");
  // Restyle: show/hide toggle exposes an accessible name.
  await expect(page.locator("#login-password ~ button")).toHaveAttribute(
    "aria-label",
    /show password|hide password/i,
  );
  // Restyle: trust row under the form.
  await expect(page.getByTestId("login-page")).toContainText("Encrypted credentials");
  await expect(page.getByTestId("login-page")).toContainText("SSO via Google");
  await page.getByTestId("login-email").fill("nobody@tollma.ai");
  await page.getByTestId("login-password").fill("wrongpass1");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-error")).toBeVisible();
  // Restyle: errors surface via role=alert.
  await expect(page.getByTestId("login-error")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("login-page").getByRole("alert")).toBeVisible();
});

test("signup restyle: labels, toggle, strength meter, trust row", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByTestId("signup-page")).toBeVisible();
  // Labels are htmlFor-linked to their inputs.
  await expect(page.locator('label[for="signup-name"]')).toBeVisible();
  await expect(page.locator('label[for="signup-email"]')).toBeVisible();
  await expect(page.locator('label[for="signup-password"]')).toBeVisible();
  await expect(page.getByTestId("signup-password")).toHaveAttribute("id", "signup-password");
  await expect(page.getByTestId("signup-password")).toHaveAttribute(
    "aria-describedby",
    "signup-strength",
  );
  // Show/hide toggle exposes an accessible name.
  await expect(page.locator("#signup-password ~ button")).toHaveAttribute(
    "aria-label",
    /show password|hide password/i,
  );
  // Strength meter is hidden until typing, then appears with a rating label.
  await expect(page.locator("#signup-strength")).toHaveCount(0);
  await page.getByTestId("signup-password").fill("Password123");
  await expect(page.locator("#signup-strength")).toBeVisible();
  await expect(page.locator("#signup-strength")).toContainText(/weak|okay|strong|very strong/i);
  // Trust row under the form.
  await expect(page.getByTestId("signup-page")).toContainText("Encrypted credentials");
  await expect(page.getByTestId("signup-page")).toContainText("SSO via Google");
  // NOTE: the caps-lock warning ("Caps lock is on") is driven by
  // getModifierState("CapsLock") on keyup — OS-level state that is flaky
  // under headless Chromium, so it is intentionally not asserted here.
  // NOTE: the post-signup toast now reads "Verification email sent — check
  // your inbox to continue." but it only fires when SMTP delivers
  // (verification_sent=true); the suite's SMTP-down path auto-logs-in
  // instead, so the toast is not asserted.
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
