import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { API } from "./helpers";

/**
 * Organization Invitation & Join Flow Validation (UI-first, multi-identity).
 *
 * - Each identity gets an isolated browser context (separate cookie jars =
 *   separate people) at fullscreen viewport, driving ONLY real UI: forms,
 *   modals, dialogs, navigation, clicks. No business-action API calls.
 * - Auth bootstrapping (signup + email verification) uses the API because
 *   mailbox delivery is unavailable in this environment; every login itself
 *   is performed through the real UI login form.
 * - Invite tokens are read from the database (SELECT only) where the brief
 *   explicitly permits it (new-user email path).
 * - Headed mode is unavailable on this host (no X server); headless Chromium
 *   at 1920x1080 is used instead — same rendering path. Documented deviation.
 */

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: "serial" });
test.setTimeout(180000);

const SHOT = "/tmp/org-validation";
// SMTP delivery in this environment can take ~25s; email-bound actions wait longer.
const EMAIL_TIMEOUT = 90000;
const ORG_NAME = "Titan Test Organization";
const PW = "Password123";

const state: { orgId?: string; orgSlug?: string } = {};

function inviteCard(page: Page, slug: string) {
  return page.locator('[data-testid^="org-invite-"]').filter({ hasText: `/${slug}` }).first();
}

async function mkIdentity(browser: Browser, request: APIRequestContext, email: string) {
  const signup = await request.post(`${API}/auth/signup`, { data: { email, password: PW } });
  if (signup.ok()) {
    const token = (await signup.json()).debug_verification_token as string | null;
    if (token) await request.get(`${API}/auth/verify`, { params: { token } });
  }
  // else: account already exists from a previous run — carry on to UI login.
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PW);
  await page.getByTestId("login-submit").click();
  // Let the login round-trip settle before navigating (else goto aborts it).
  await page.waitForURL("**/", { timeout: 30000 }).catch(() => null);
  // Hard identity check: fail fast here instead of cascading as the wrong user.
  const me = await page.request.get(`${API}/auth/me`);
  expect(me.ok(), `identity check for ${email}`).toBeTruthy();
  expect((await me.json()).email, `logged in as ${email}`).toBe(email);
  await page.goto("/organizations");
  await expect(page.getByTestId("organizations-page")).toBeVisible({ timeout: 30000 });
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT}/${name}.png` });
}

async function openOrgDashboard(page: Page, orgId: string, section: string) {
  await page.goto(`/organizations/${orgId}?section=${section}`);
  await expect(page.getByTestId(`org-section-${section}`)).toBeVisible({ timeout: 20000 });
}

function joinResultButton(page: Page) {
  return page
    .locator("[data-testid^='org-join-']:not([data-testid='org-join-open']):not([data-testid='org-join-search']):not([data-testid='org-join-dialog']):not([data-testid='org-join-results'])")
    .first();
}

/** UI-only slate cleanup: revoke all pending invites / reject all pending
 * requests matching an email so reruns start clean (all real clicks). */
async function clearPendingInvitesFor(page: Page, orgId: string, email: string) {
  await openOrgDashboard(page, orgId, "invitations");
  for (let i = 0; i < 5; i++) {
    const card = page.locator('[data-testid^="org-inv-"]').filter({ hasText: email })
      .filter({ hasText: "pending" }).first();
    if (!(await card.count())) break;
    await card.getByRole("button", { name: "Revoke" }).click();
    await page.getByTestId("org-confirm-action").click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
  }
}

/** UI-only rerun hygiene: root removes every non-root member. */
async function clearMembersExceptRoot(page: Page, orgId: string) {
  await openOrgDashboard(page, orgId, "members");
  for (let i = 0; i < 10; i++) {
    const btn = page.locator("[data-testid^='org-remove-']").first();
    if (!(await btn.count())) break;
    await btn.click();
    await page.getByTestId("org-confirm-action").click();
    await page.waitForTimeout(1500);
  }
}

async function clearPendingRequestsFor(page: Page, orgId: string, email: string) {  await openOrgDashboard(page, orgId, "requests");
  for (let i = 0; i < 5; i++) {
    const card = page.locator('[data-testid^="org-req-"]').filter({ hasText: email }).first();
    if (!(await card.count())) break;
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
  }
}

test.describe("org invitation & join validation", () => {
  test("prep: root + Titan Test Organization via UI", async ({ browser, request }) => {
    const { ctx, page } = await mkIdentity(browser, request, "root@test.tollma.ai");
    if (!(await page.getByTestId("organizations-page").textContent())?.includes(ORG_NAME)) {
      await page.getByTestId("org-create-open").click();
      await page.getByTestId("org-create-name").fill(ORG_NAME);
      await page.getByTestId("org-create-description").fill("Validation org for invitation flows");
      await page.getByTestId("org-create-industry").fill("Testing");
      await page.getByTestId("org-create-submit").click();
      await expect(page.getByTestId("organizations-page")).toContainText(ORG_NAME, { timeout: 20000 });
    }
    const href = await page
      .getByTestId("organizations-page")
      .locator("a[href*='/organizations/']")
      .first()
      .getAttribute("href");
    state.orgId = href?.split("/")[2];
    expect(state.orgId, "org id captured").toBeTruthy();
    await openOrgDashboard(page, state.orgId!, "overview");
    await expect(page.getByTestId("sidebar-org-nav")).toContainText(/titan-test-organization-/, { timeout: 20000 });
    const navText = await page.getByTestId("sidebar-org-nav").textContent();
    state.orgSlug = navText?.match(/\/([a-z0-9-]+)/)?.[1];
    expect(state.orgSlug, "org slug captured").toBeTruthy();
    await clearMembersExceptRoot(page, state.orgId!);
    await openOrgDashboard(page, state.orgId!, "overview");
    await shot(page, "01-root-org-overview");
    await ctx.close();
  });

  test("scenario 1: existing-user invite accept (full UI)", async ({ browser, request }) => {
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    const invited = await mkIdentity(browser, request, "existing@test.tollma.ai");
    await clearPendingInvitesFor(root.page, state.orgId!, "existing@test.tollma.ai");
    await openOrgDashboard(root.page, state.orgId!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill("existing@test.tollma.ai");
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    await shot(root.page, "02-root-invite-sent");
    await invited.page.goto("/organizations?view=inbox");
    await expect(invited.page.getByTestId("org-inbox")).toContainText(ORG_NAME, { timeout: 20000 });
    const card = inviteCard(invited.page, state.orgSlug!);
    await expect(card).toBeVisible({ timeout: 20000 });
    await shot(invited.page, "03-invitee-inbox");
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
    await invited.page.goto("/organizations");
    await expect(invited.page.getByTestId("organizations-page")).toContainText(ORG_NAME, { timeout: 20000 });
    await shot(invited.page, "04-invitee-joined");
    await root.ctx.close();
    await invited.ctx.close();
  });

  test("scenario 2: existing-user invite reject (full UI)", async ({ browser, request }) => {
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    const decliner = await mkIdentity(browser, request, "existing-reject@test.tollma.ai");
    await clearPendingInvitesFor(root.page, state.orgId!, "existing-reject@test.tollma.ai");
    await openOrgDashboard(root.page, state.orgId!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill("existing-reject@test.tollma.ai");
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    await decliner.page.goto("/organizations?view=inbox");
    await expect(decliner.page.getByTestId("org-inbox")).toContainText(ORG_NAME, { timeout: 20000 });
    const card = inviteCard(decliner.page, state.orgSlug!);
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.getByRole("button", { name: "Reject" }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
    await decliner.page.goto("/organizations");
    await expect(decliner.page.getByTestId("organizations-page")).not.toContainText(ORG_NAME);
    await shot(decliner.page, "05-invitee-declined");
    await root.ctx.close();
    await decliner.ctx.close();
  });

  test("scenario 3: new-user invite accept via email link (full UI)", async ({ browser, request }) => {
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    await clearPendingInvitesFor(root.page, state.orgId!, "newuser@test.tollma.ai");
    await openOrgDashboard(root.page, state.orgId!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill("newuser@test.tollma.ai");
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    // Token fetched read-only from the DB (brief-permitted email substitute).
    const token = await dbInviteToken("newuser@test.tollma.ai");
    expect(token, "invite token readable").toBeTruthy();
    // Truly fresh identity: real UI registration, real UI verification page,
    // real UI login, then the email link lands on the invite - all UI clicks.
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(`/organizations/invites?token=${token}`);
    // The invite page itself loads (empty queue until authenticated); the
    // signup + login that follow are real UI forms (see shots).
    await expect(page.getByRole("heading", { name: "Invitation", level: 1 })).toBeVisible({ timeout: 30000 });
    await shot(page, "06-newuser-auth-gate");
    await page.goto("/signup");
    await page.getByTestId("signup-email").fill("newuser@test.tollma.ai");
    await page.getByTestId("signup-password").fill(PW);
    await page.getByTestId("signup-submit").click();
    await page.waitForTimeout(2500);
    await verifyUiUser(page, "newuser@test.tollma.ai");
    await page.goto("/login");
    await page.getByTestId("login-email").fill("newuser@test.tollma.ai");
    await page.getByTestId("login-password").fill(PW);
    await page.getByTestId("login-submit").click();
    await page.goto("/organizations");
    await expect(page.getByTestId("organizations-page")).toBeVisible({ timeout: 30000 });
    await page.goto(`/organizations/invites?token=${token}`);
    await expect(page.getByTestId("org-invite-landing")).toContainText(ORG_NAME, { timeout: 20000 });
    await shot(page, "07-newuser-invite-landing");
    await page.getByTestId("org-invite-landing-accept").click();
    await page.goto("/organizations");
    await expect(page.getByTestId("organizations-page")).toContainText(ORG_NAME, { timeout: 20000 });
    // Personal space still exists (context switcher shows Personal).
    await expect(page.getByTestId("org-context-personal")).toBeVisible();
    await shot(page, "08-newuser-joined");
    await root.ctx.close();
    await ctx.close();
  });

  test("scenario 4: new-user invite decline (full UI)", async ({ browser, request }) => {
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    await clearPendingInvitesFor(root.page, state.orgId!, "newuser-decline@test.tollma.ai");
    await openOrgDashboard(root.page, state.orgId!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill("newuser-decline@test.tollma.ai");
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    const token = await dbInviteToken("newuser-decline@test.tollma.ai");
    expect(token, "invite token readable").toBeTruthy();
    const newcomer = await mkIdentity(browser, request, "newuser-decline@test.tollma.ai");
    await newcomer.page.goto(`/organizations/invites?token=${token}`);
    await expect(newcomer.page.getByTestId("org-invite-landing")).toContainText(ORG_NAME, { timeout: 20000 });
    await newcomer.page.getByTestId("org-invite-landing-reject").click();
    await newcomer.page.goto("/organizations");
    await expect(newcomer.page.getByTestId("organizations-page")).not.toContainText(ORG_NAME);
    await root.ctx.close();
    await newcomer.ctx.close();
  });

  test("scenario 5: request-to-join approve (full UI)", async ({ browser, request }) => {
    const requester = await mkIdentity(browser, request, "request@test.tollma.ai");
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    await clearPendingRequestsFor(root.page, state.orgId!, "request@test.tollma.ai");
    await requester.page.getByTestId("org-join-open").click();
    // Search the exact slug: several "Titan Test Organization" rows exist.
    await requester.page.getByTestId("org-join-search").fill(state.orgSlug!);
    const joinBtn = joinResultButton(requester.page);
    await expect(joinBtn).toBeVisible({ timeout: 20000 });
    await shot(requester.page, "09-join-search");
    await joinBtn.click();
    await expect(requester.page.getByTestId("org-join-dialog")).toBeHidden({ timeout: 20000 });
    await openOrgDashboard(root.page, state.orgId!, "requests");
    const reqCard = root.page.locator('[data-testid^="org-req-"]').filter({ hasText: "request@test.tollma.ai" }).first();
    await expect(reqCard).toBeVisible({ timeout: 20000 });
    await shot(root.page, "10-root-requests");
    await reqCard.getByRole("button", { name: "Approve" }).click();
    await expect(root.page.getByTestId("org-approve-dialog")).toBeVisible({ timeout: 10000 });
    await root.page.getByTestId("org-assign-submit").click();
    await expect(reqCard).toHaveCount(0, { timeout: EMAIL_TIMEOUT });
    await requester.page.goto("/organizations");
    await expect(requester.page.getByTestId("organizations-page")).toContainText(ORG_NAME, { timeout: 20000 });
    await shot(requester.page, "11-requester-joined");
    await requester.ctx.close();
    await root.ctx.close();
  });

  test("scenario 6: request-to-join reject (full UI)", async ({ browser, request }) => {
    const requester = await mkIdentity(browser, request, "request-reject@test.tollma.ai");
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    await clearPendingRequestsFor(root.page, state.orgId!, "request-reject@test.tollma.ai");
    await requester.page.getByTestId("org-join-open").click();
    // Search the exact slug: several "Titan Test Organization" rows exist.
    await requester.page.getByTestId("org-join-search").fill(state.orgSlug!);
    const joinBtn = joinResultButton(requester.page);
    await expect(joinBtn).toBeVisible({ timeout: 20000 });
    await joinBtn.click();
    await expect(requester.page.getByTestId("org-join-dialog")).toBeHidden({ timeout: 20000 });
    await openOrgDashboard(root.page, state.orgId!, "requests");
    const reqCard = root.page.locator('[data-testid^="org-req-"]').filter({ hasText: "request-reject@test.tollma.ai" }).first();
    await expect(reqCard).toBeVisible({ timeout: 20000 });
    await reqCard.getByRole("button", { name: "Reject" }).click();
    await expect(reqCard).toHaveCount(0, { timeout: EMAIL_TIMEOUT });
    await requester.page.goto("/organizations");
    await expect(requester.page.getByTestId("organizations-page")).not.toContainText(ORG_NAME);
    await requester.ctx.close();
    await root.ctx.close();
  });

  test("scenario 7: resend invitation (full UI)", async ({ browser, request }) => {
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    const target = await mkIdentity(browser, request, "resend-ui@test.tollma.ai");
    await clearPendingInvitesFor(root.page, state.orgId!, "resend-ui@test.tollma.ai");
    await openOrgDashboard(root.page, state.orgId!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill("resend-ui@test.tollma.ai");
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    await openOrgDashboard(root.page, state.orgId!, "invitations");
    const invCard = root.page.locator('[data-testid^="org-inv-"]').filter({ hasText: "resend-ui@test.tollma.ai" }).first();
    await expect(invCard).toBeVisible({ timeout: 20000 });
    const invId = (await invCard.getAttribute("data-testid"))?.replace("org-inv-", "");
    await root.page.getByTestId(`org-inv-resend-${invId}`).click();
    await expect(root.page.getByText("fresh link")).toBeVisible({ timeout: EMAIL_TIMEOUT });
    await shot(root.page, "12-resent");
    // Target accepts with the fresh link via the real inbox UI.
    await target.page.goto("/organizations?view=inbox");
    await expect(target.page.getByTestId("org-inbox")).toContainText(ORG_NAME, { timeout: 20000 });
    const card = inviteCard(target.page, state.orgSlug!);
    await expect(card).toBeVisible({ timeout: 20000 });
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
    await root.ctx.close();
    await target.ctx.close();
  });

  test("negatives via UI: duplicates, member-invite", async ({ browser, request }) => {
    const root = await mkIdentity(browser, request, "root@test.tollma.ai");
    await openOrgDashboard(root.page, state.orgId!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill("existing@test.tollma.ai");
    await root.page.getByTestId("org-invite-submit").click();
    // Active-member invite surfaces an inline dialog error (modal stays open).
    await expect(root.page.getByTestId("org-invite-dialog")).toContainText(/already a member/i, { timeout: 20000 });
    await shot(root.page, "13-duplicate-error");
    await root.page.keyboard.press("Escape");
    await root.ctx.close();
  });
});

/** Read-only DB token fetch (brief-permitted email substitute). */
async function dbInviteToken(email: string): Promise<string | null> {
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync(
      `set -a; source /home/ond/Projects/ToLLms/.env; set +a; ` +
        `docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc ` +
        `"SELECT token FROM invitations WHERE email='${email}' AND status='pending' AND is_deleted=false ORDER BY created_at DESC LIMIT 1"`,
      { cwd: "/home/ond/Projects/ToLLms", shell: "/bin/bash", timeout: 30000 },
    ).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

/** Verify a UI-registered user through the REAL verify UI page. The token is
 * minted via production code paths (test helper); consumption is the real
 * `/verify` page + real API. */
async function verifyUiUser(page: Page, email: string) {
  const { execSync } = await import("node:child_process");
  const token = execSync(
    `docker compose exec -T backend python /tmp/mint_verify.py '${email}'`,
    { cwd: "/home/ond/Projects/ToLLms", shell: "/bin/bash", timeout: 60000 },
  ).toString().trim();
  if (token === "ALREADY_VERIFIED") return;
  expect(token, `verify token minted for ${email}`).toMatch(/^[A-Za-z0-9-_%.]+$/);
  await page.goto(`/verify?token=${token}`);
  await expect(page.getByTestId("verify-ok")).toBeVisible({ timeout: 30000 });
}
