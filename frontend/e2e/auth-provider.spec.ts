// Provider-aware auth: local accounts manage passwords, Google accounts see
// provider information. The Google UI state is exercised by stubbing /auth/me
// (a real OAuth round trip needs Google credentials).
import { expect, test, type Page } from "@playwright/test";
import { apiLoginAs } from "./helpers";

test.beforeAll(async () => {});

async function signup(page: Page, tag: string) {
  await apiLoginAs(page, tag);
}

async function stubGoogleUser(page: Page) {
  await page.route("**/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        provider: "google",
        has_password: false,
        auth_provider: "GOOGLE",
        email: "google-user@gmail.com",
      },
    });
  });
}

test("local accounts see password management", async ({ page }) => {
  await signup(page, "authprov-local");
  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();

  await expect(page.getByTestId("password-current")).toBeVisible();
  await expect(page.getByTestId("password-new")).toBeVisible();
  await expect(page.getByTestId("password-confirm")).toBeVisible();
  await expect(page.getByTestId("password-submit")).toBeVisible();
  await expect(page.getByTestId("provider-auth-section")).toHaveCount(0);
});

test("google accounts see provider information instead of password management", async ({ page }) => {
  await signup(page, "authprov-google");
  await stubGoogleUser(page);

  await page.goto("/settings");
  await expect(page.getByTestId("settings-page")).toBeVisible();

  await expect(page.getByTestId("provider-auth-section")).toBeVisible();
  await expect(page.getByTestId("provider-connected-badge")).toContainText("Connected");
  await expect(page.getByTestId("provider-name")).toContainText("Google OAuth");
  await expect(page.getByTestId("google-account-link")).toBeVisible();
  // The password UI is gone entirely.
  await expect(page.getByTestId("password-current")).toHaveCount(0);
  await expect(page.getByTestId("password-submit")).toHaveCount(0);
});

test("password policy is enforced on the change form", async ({ page }) => {
  await signup(page, "authprov-policy");
  await page.goto("/settings");
  await page.getByTestId("password-current").fill("Password123");
  await page.getByTestId("password-new").fill("alllowercase1");
  await expect(page.getByTestId("password-policy-hint")).toContainText("uppercase letter");
  await expect(page.getByTestId("password-submit")).toBeDisabled();

  await page.getByTestId("password-new").fill("NewPassword456");
  await page.getByTestId("password-confirm").fill("NewPassword456");
  await expect(page.getByTestId("password-submit")).toBeEnabled();
});

test("login page links to forgot password and the response is generic", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-page")).toBeVisible();

  await page.getByTestId("forgot-password-link").click();
  await expect(page.getByTestId("forgot-password-page")).toBeVisible();

  await page.getByTestId("forgot-email").fill(`nobody-${Date.now()}@example.com`);
  await page.getByTestId("forgot-submit").click();
  await expect(page.getByTestId("forgot-password-sent")).toContainText(
    "If an account exists for this email, a password reset link has been sent.",
  );
});

test("reset page rejects an invalid or expired token", async ({ page }) => {
  await page.goto("/auth/reset-password?token=definitely-not-a-valid-token-value");
  await expect(page.getByTestId("reset-password-invalid")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("reset-invalid")).toContainText("invalid, expired, or already used");
  await expect(page.getByTestId("reset-password")).toHaveCount(0);
});

test("sessions list shows the authentication provider", async ({ page }) => {
  await signup(page, "authprov-sessions");
  await page.goto("/settings");
  await expect(page.getByTestId("sessions-list")).toBeVisible();
  await expect(page.getByTestId("sessions-list")).toContainText("Email & Password");
});
