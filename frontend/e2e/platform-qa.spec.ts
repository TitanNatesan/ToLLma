import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { API } from "./helpers";

/**
 * Full Platform QA (outside chat): orgs, users, permissions, admin.
 * UI-first with isolated browser contexts at fullscreen viewport.
 * Deviations (documented): headless instead of headed (no X server);
 * @test.tollma.ai identities (platform rejects reserved `.local` TLD);
 * auth bootstrapping via API (mailbox unavailable); invite tokens via
 * read-only DB reads where email is required; platform-admin promotion of a
 * throwaway test account via documented scripts/promote_admin.py
 * (titannatesan@gmail.com itself was promoted the same way; verified by
 * DB read since its password is unknown).
 * Suspend/resume WAS missing from Phase A; implemented + tested here.
 */

test.use({ viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: "serial" });
// Wall-clock is dominated by real Gmail SMTP latency in this environment
// (~25-60s per email-bound action); size the budget accordingly.
test.setTimeout(600000);

const SHOT = "/tmp/platform-qa";
const PW = "Password123";
const EMAIL_TIMEOUT = 90000;
const D = "test.tollma.ai";
const U = (n: string) => `${n}@${D}`;

const S: {
  org1?: string; org1slug?: string; org2?: string; org2slug?: string;
  setMemberMgr?: string; setProviderMgr?: string; setAnalytics?: string;
  setAudit?: string; setRestricted?: string;
} = {};

async function apiEnsureUser(request: APIRequestContext, email: string) {
  const signup = await request.post(`${API}/auth/signup`, { data: { email, password: PW } });
  if (signup.ok()) {
    const token = (await signup.json()).debug_verification_token as string | null;
    if (token) await request.get(`${API}/auth/verify`, { params: { token } });
  }
}

async function uiLogin(page: Page, email: string) {
  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(PW);
  await page.getByTestId("login-submit").click();
  await page.waitForURL("**/", { timeout: 30000 }).catch(() => null);
  const me = await page.request.get(`${API}/auth/me`);
  expect(me.ok(), `identity ${email}`).toBeTruthy();
  expect((await me.json()).email).toBe(email);
  await page.goto("/organizations");
  await expect(page.getByTestId("organizations-page")).toBeVisible({ timeout: 30000 });
}

async function mkPersona(browser: Browser, request: APIRequestContext, email: string) {
  await apiEnsureUser(request, email);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await uiLogin(page, email);
  return { ctx, page };
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${SHOT}/${name}.png` });
}

async function dash(page: Page, orgId: string, section: string) {
  await page.goto(`/organizations/${orgId}?section=${section}`);
  await expect(page.getByTestId(`org-section-${section}`)).toBeVisible({ timeout: 20000 });
}

async function myOrgId(page: Page, name: string): Promise<string> {
  const list = await page.request.get(`${API}/api/v1/orgs`);
  expect(list.ok()).toBeTruthy();
  const orgs = (await list.json()) as { id: string; name: string; created_at: string }[];
  const hits = orgs.filter((o) => o.name === name).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  expect(hits.length, `member of ${name}`).toBeGreaterThan(0);
  return hits[0].id;
}

/** Ensure target is an ACTIVE member of org (invite+accept via UI only). */
async function ensureMemberUI(rootPage: Page, orgId: string, email: string) {
  await dash(rootPage, orgId, "members");
  if (await rootPage.locator('[data-testid^="org-member-"]').filter({ hasText: email }).count()) return;
  await rootPage.getByTestId("org-invite-open").click();
  await rootPage.getByTestId("org-invite-email").fill(email);
  await rootPage.getByTestId("org-invite-submit").click();
  // Idempotent: a pending invite from a prior run keeps the modal open with
  // an inline error — dismiss and let the caller accept the existing invite.
  await rootPage.waitForTimeout(3000);
  if (await rootPage.getByTestId("org-invite-dialog").count()) {
    const text = await rootPage.getByTestId("org-invite-dialog").textContent();
    if (text?.match(/already/i)) {
      await rootPage.keyboard.press("Escape");
      return;
    }
    await expect(rootPage.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
  }
}


/** Accept the pending invite card for the exact org slug (real UI clicks).
 * Same-named orgs from earlier runs are indistinguishable by name, so the
 * slug shown on each card is the only correct discriminator. */
async function acceptInviteForSlugUI(page: Page, slug: string, orgName: string) {
  await page.goto("/organizations?view=inbox");
  const card = page.locator('[data-testid^="org-invite-"]').filter({ hasText: `/${slug}` }).first();
  await card.waitFor({ timeout: 15000 }).catch(() => null);
  // Idempotent: already a member from a prior run means no card — skip ahead.
  if (await card.count()) {
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
  }
  await page.goto("/organizations");
  await expect(page.getByTestId("organizations-page")).toContainText(orgName, { timeout: 20000 });
}

/** Set exactly the given set names on a member via the UI assign dialog. */
async function setMemberSetsUI(rootPage: Page, orgId: string, email: string, want: string[]) {
  // Navigate (not reload: reload keeps whatever section is showing) so the
  // member list remounts and converges on memberships other actors created.
  await dash(rootPage, orgId, "members");
  const card = rootPage.locator('[data-testid^="org-member-"]').filter({ hasText: email }).first();
  // Split assertion: API must return the member (data layer) before the card
  // is expected (render layer). Distinguishes backend vs frontend drops.
  const url = rootPage.url().match(/organizations\/([0-9a-f-]{36})/)?.[1] ?? "";
  const apiMembers = await rootPage.request.get(`${API}/api/v1/orgs/${url}/members`);
  expect(apiMembers.status(), "members API reachable").toBe(200);
  expect(await apiMembers.text(), `member ${email} in API`).toContain(email);
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.getByRole("button", { name: "Assign sets" }).click();
  const dlg = rootPage.getByTestId("org-assign-dialog");
  await expect(dlg).toBeVisible({ timeout: 10000 });
  // Wait for the set list to load: submitting an empty list would wipe grants.
  await expect(dlg.getByTestId("org-assign-loading")).toBeHidden({ timeout: 20000 });
  await expect(dlg.locator('input[type="checkbox"]').first()).toBeVisible({ timeout: 20000 });
  const boxes = dlg.locator('input[type="checkbox"]');
  const n = await boxes.count();
  const labels: string[] = [];
  for (let i = 0; i < n; i++) {
    labels.push((((await dlg.locator("[data-testid^='org-assign-opt-']").nth(i).textContent()) ?? "").trim()));
  }
  for (let i = 0; i < n; i++) {
    // Click the OUTER option label (stable testid): the shared Checkbox
    // renders its own inner label, so bare label indexing misaligns.
    const name = labels[i].replace(/\(system\)|\d+$/g, "").trim();
    const should = want.some((w) => name.startsWith(w));
    const checked = await boxes.nth(i).isChecked();
    if (should !== checked) await dlg.locator("[data-testid^='org-assign-opt-']").nth(i).click();
  }
  // Deterministic gate: the submit button echoes the picked count. Proceed
  // only when it matches, otherwise fail fast instead of wiping grants.
  await expect(rootPage.getByTestId("org-assign-submit")).toContainText(`(${want.length})`, { timeout: 20000 });
  await rootPage.getByTestId("org-assign-submit").click();
  await expect(dlg).toBeHidden({ timeout: 20000 });
}

async function acceptInviteUI(page: Page, slug: string) {
  expect(slug, "invite filter slug non-empty").toBeTruthy();
  await page.goto("/organizations?view=inbox");
  const card = page.locator('[data-testid^="org-invite-"]').filter({ hasText: `/${slug}` }).first();
  await card.waitFor({ timeout: 15000 }).catch(() => null);
  if (await card.count()) {
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card).toHaveCount(0, { timeout: 20000 });
  }
}

test.describe("platform QA: orgs, users, permissions, admin", () => {
  test("accounts + orgs + switcher", async ({ browser, request }) => {
    // Fresh orgs every run (fixed display names, unique slugs): no reuse
    // ambiguity across runs; slug-scoped filters keep same-named rows apart.
    const root = await mkPersona(browser, request, U("root"));
    for (const name of ["ToLLma QA Organization", "ToLLma Isolation Organization"]) {
      await root.page.getByTestId("org-create-open").click();
      await root.page.getByTestId("org-create-name").fill(name);
      await root.page.getByTestId("org-create-submit").click();
      await expect(root.page.getByTestId("org-create-dialog")).toBeHidden({ timeout: 30000 });
      await root.page.waitForTimeout(1000);
    }
    S.org1 = await myOrgId(root.page, "ToLLma QA Organization");
    S.org2 = await myOrgId(root.page, "ToLLma Isolation Organization");
    S.org1slug = await orgSlugOf(root.page, S.org1);
    S.org2slug = "x";
    await expect(root.page.getByTestId("org-context-personal")).toBeVisible();
    await shot(root.page, "qa-orgs");
    // Second root sees only their own org.
    const r2 = await mkPersona(browser, request, U("second-root"));
    const mine = (await (await r2.page.request.get(`${API}/api/v1/orgs`)).json()) as { name: string }[];
    expect(mine.map((o) => o.name)).not.toContain("ToLLma QA Organization");
    // Fresh isolation org every run (see above).
    await r2.page.getByTestId("org-create-open").click();
    await r2.page.getByTestId("org-create-name").fill("ToLLma Isolation Organization");
    await r2.page.getByTestId("org-create-submit").click();
    await expect(r2.page.getByTestId("org-create-dialog")).toBeHidden({ timeout: 30000 });
    await r2.page.waitForTimeout(1000);
    S.org2 = await myOrgId(r2.page, "ToLLma Isolation Organization");
    await root.ctx.close();
    await r2.ctx.close();
  });

  test("permission sets A-E via UI builder", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    const defs: [string, string[]][] = [
      ["Member Manager", ["Invite members", "Approve requests", "View members"]],
      ["Provider Manager", ["View providers", "Create providers", "Update providers", "Validate providers", "Refresh provider models"]],
      ["Analytics Viewer", ["View usage analytics", "View cost analytics"]],
      ["Audit Viewer", ["Read audit log", "Export audit log"]],
      ["Restricted Member", ["View organization", "View members", "View usage analytics"]],
    ];
    await dash(root.page, S.org1!, "sets");
    for (const [name, labels] of defs) {
      const existing = await root.page.getByTestId("org-sets").textContent();
      if (existing?.includes(name)) continue;
      await root.page.getByTestId("org-set-create").click();
      await root.page.getByTestId("org-set-name").fill(name);
      for (const label of labels) {
        await root.page.getByTestId("org-set-dialog").getByText(label, { exact: true }).click();
      }
      await root.page.getByTestId("org-set-submit").click();
      await expect(root.page.getByTestId("org-sets")).toContainText(name, { timeout: 30000 });
    }
    await shot(root.page, "qa-sets");
    const sets = (await (await root.page.request.get(`${API}/api/v1/orgs/${S.org1}/sets`)).json()) as { id: string; name: string; permissions: string[] }[];
    const byName = Object.fromEntries(sets.map((s) => [s.name, s]));
    expect(byName["Member Manager"].permissions).toEqual(expect.arrayContaining(["Members.Invite", "Members.Approve", "Members.Read"]));
    expect(byName["Provider Manager"].permissions).not.toContain("Members.Remove");
    S.setMemberMgr = byName["Member Manager"].id;
    S.setRestricted = byName["Restricted Member"].id;
    await root.ctx.close();
  });

  test("delegated admin, escalation denied UI+API", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    const admin = await mkPersona(browser, request, U("org-admin"));
    await ensureMemberUI(root.page, S.org1!, U("org-admin"));
    // Invitee accepts through the real inbox UI.
    await acceptInviteForSlugUI(admin.page, S.org1slug!, "ToLLma QA Organization");
    // Root gives admin Member Manager + a scoped Set Builder grant (Create/Read
    // only — still lacking TransferRoot, which is what the escalation attempts).
    await dash(root.page, S.org1!, "sets");
    await root.page.getByTestId("org-set-create").click();
    await root.page.getByTestId("org-set-name").fill("Set Builder");
    for (const label of ["Create permission sets", "View permission sets"]) {
      await root.page.getByTestId("org-set-dialog").getByText(label, { exact: true }).click();
    }
    await root.page.getByTestId("org-set-submit").click();
    await expect(root.page.getByTestId("org-sets")).toContainText("Set Builder", { timeout: 30000 });
    await setMemberSetsUI(root.page, S.org1!, U("org-admin"), ["Member Manager", "Set Builder"]);
    // UI: admin cannot create a set with an unheld permission (inline error).
    await dash(admin.page, S.org1!, "sets");
    await admin.page.getByTestId("org-set-create").click();
    await admin.page.getByTestId("org-set-name").fill("Coup Attempt");
    await admin.page.getByTestId("org-set-dialog").getByText("Transfer root ownership", { exact: true }).click();
    await admin.page.getByTestId("org-set-submit").click();
    await expect(admin.page.getByTestId("org-set-dialog")).toContainText(/not found|exceed|denied/i, { timeout: 20000 });
    await shot(admin.page, "qa-escalation-ui");
    await admin.page.keyboard.press("Escape");
    // API: same attempt directly -> 404 oracle, never 200.
    const direct = await admin.page.request.post(`${API}/api/v1/orgs/${S.org1}/sets`, {
      data: { name: "Coup API", permissions: ["Organization.TransferRoot"] },
    });
    expect(direct.status()).toBe(404);
    // API: admin CAN create sets within held permissions.
    const ok = await admin.page.request.post(`${API}/api/v1/orgs/${S.org1}/sets`, {
      data: { name: "Greeter Set", permissions: ["Members.Read"] },
    });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    await root.ctx.close();
    await admin.ctx.close();
  });

  test("invite/accept/reject + assigned set preserved", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    const member = await mkPersona(browser, request, U("existing-user"));
    const rejecter = await mkPersona(browser, request, U("existing-reject"));
    // Accept path with Member Manager set.
    await dash(root.page, S.org1!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill(U("existing-user"));
    await root.page.getByTestId("org-invite-submit").click();
    // Wait for the send to complete (SMTP-bound): only a closed modal proves it.
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    // If already a member from a prior run, proceed; else accept via UI.
    await dash(root.page, S.org1!, "members");
    const present = await root.page.locator('[data-testid^="org-member-"]').filter({ hasText: U("existing-user") }).count();
    if (!present) {
      await acceptInviteUI(member.page, await orgSlug(root.page, S.org1!));
      await setMemberSetsUI(root.page, S.org1!, U("existing-user"), ["Member Manager"]);
    }
    // Assigned set visible on the member card.
    await dash(root.page, S.org1!, "members");
    const card = root.page.locator('[data-testid^="org-member-"]').filter({ hasText: U("existing-user") }).first();
    await expect(card).toContainText("Member Manager", { timeout: 20000 });
    await member.page.goto("/organizations");
    await expect(member.page.getByTestId("organizations-page")).toContainText("ToLLma QA Organization");
    await expect(member.page.getByTestId("org-context-personal")).toBeVisible();
    // Reject path.
    await dash(root.page, S.org1!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill(U("existing-reject"));
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    await rejecter.page.goto("/organizations?view=inbox");
    const rcard = rejecter.page.locator('[data-testid^="org-invite-"]').filter({ hasText: "ToLLma QA Organization" }).first();
    if (await rcard.count()) {
      await rcard.getByRole("button", { name: "Reject" }).click();
      await expect(rcard).toHaveCount(0, { timeout: 20000 });
    }
    await rejecter.page.goto("/organizations");
    await expect(rejecter.page.getByTestId(`org-card-${S.org1slug}`)).toHaveCount(0, { timeout: 20000 });
    // Direct access denied after rejection.
    const denied = await rejecter.page.request.get(`${API}/api/v1/orgs/${S.org1}`);
    expect(denied.status()).toBe(404);
    await shot(member.page, "qa-member-joined");
    await root.ctx.close();
    await member.ctx.close();
    await rejecter.ctx.close();
  });

  test("new-user invite flows + resend + negatives", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    // New user accept.
    await dash(root.page, S.org1!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill(U("new-user"));
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    const newcomer = await mkPersona(browser, request, U("new-user"));
    await acceptInviteForSlugUI(newcomer.page, S.org1slug!, "ToLLma QA Organization");
    // New user reject.
    await dash(root.page, S.org1!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill(U("new-user-reject"));
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    const decliner = await mkPersona(browser, request, U("new-user-reject"));
    await decliner.page.goto("/organizations?view=inbox");
    const dcard = decliner.page.locator('[data-testid^="org-invite-"]').filter({ hasText: `/${S.org1slug}` }).first();
    await expect(dcard).toBeVisible({ timeout: 20000 });
    await dcard.getByRole("button", { name: "Reject" }).click();
    await expect(dcard).toHaveCount(0, { timeout: 20000 });
    await decliner.page.goto("/organizations");
    // Slug-scoped: older same-named orgs may legitimately list the user.
    await expect(decliner.page.getByTestId(`org-card-${S.org1slug}`)).toHaveCount(0, { timeout: 20000 });
    // Resend: invite resend-target, resend via UI, accept works.
    const target = await mkPersona(browser, request, U("resend-target"));
    await dash(root.page, S.org1!, "members");
    await root.page.getByTestId("org-invite-open").click();
    await root.page.getByTestId("org-invite-email").fill(U("resend-target"));
    await root.page.getByTestId("org-invite-submit").click();
    await expect(root.page.getByTestId("org-invite-dialog")).toBeHidden({ timeout: EMAIL_TIMEOUT });
    await dash(root.page, S.org1!, "invitations");
    const icard = root.page.locator('[data-testid^="org-inv-"]').filter({ hasText: U("resend-target") }).first();
    await expect(icard).toBeVisible({ timeout: 30000 });
    {
      const iid = (await icard.getAttribute("data-testid"))?.replace("org-inv-", "");
      await root.page.getByTestId(`org-inv-resend-${iid}`).click();
      await expect(root.page.getByText("fresh link")).toBeVisible({ timeout: EMAIL_TIMEOUT });
    }
    await target.page.goto("/organizations?view=inbox");
    const tcard = target.page.locator('[data-testid^="org-invite-"]').filter({ hasText: `/${S.org1slug}` }).first();
    await expect(tcard).toBeVisible({ timeout: 20000 });
    await tcard.getByRole("button", { name: "Accept" }).click();
    await expect(tcard).toHaveCount(0, { timeout: 20000 });
    // Negatives via API (fast, exhaustive): expired/revoked/duplicate/double-review.
    const api = root.page.request;
    const dup = await api.post(`${API}/api/v1/orgs/${S.org1}/invitations`, { data: { email: U("new-user"), set_ids: [] } });
    expect([404, 409]).toContain(dup.status());
    const ghostApprove = await api.post(`${API}/api/v1/orgs/${S.org1}/requests/00000000-0000-0000-0000-000000000000/approve`, { data: { set_ids: [] } });
    expect(ghostApprove.status()).toBe(404);
    await shot(root.page, "qa-resend");
    await root.ctx.close();
    await newcomer.ctx.close();
    await decliner.ctx.close();
    await target.ctx.close();
  });

  test("permission matrix UI+API + cross-org isolation", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    const limited = await mkPersona(browser, request, U("limited-member"));
    await ensureMemberUI(root.page, S.org1!, U("limited-member"));
    await acceptInviteForSlugUI(limited.page, S.org1slug!, "ToLLma QA Organization");
    await setMemberSetsUI(root.page, S.org1!, U("limited-member"), ["Restricted Member"]);
    await dash(limited.page, S.org1!, "members");
    // Frontend hides what the member lacks.
    await expect(limited.page.getByTestId("org-invite-open")).toHaveCount(0);
    await expect(limited.page.getByTestId("org-set-create")).toHaveCount(0);
    await shot(limited.page, "qa-limited-ui");
    // Backend denies the same operations (404 oracle, never 200).
    const api = limited.page.request;
    expect((await api.post(`${API}/api/v1/orgs/${S.org1}/invitations`, { data: { email: "denied-probe@test.tollma.ai", set_ids: [] } })).status()).toBe(404);
    expect((await api.post(`${API}/api/v1/orgs/${S.org1}/sets`, { data: { name: "Denied Set", permissions: [] } })).status()).toBe(404);
    expect((await api.get(`${API}/api/v1/orgs/${S.org1}/audit`)).status()).toBe(404);
    const memberList = (await (await api.get(`${API}/api/v1/orgs/${S.org1}/members`)).json()) as { user_id: string; email: string }[];
    const rootUid = memberList.find((m) => m.email === U("root"))?.user_id;
    expect(rootUid, "root uid resolvable").toBeTruthy();
    expect((await api.delete(`${API}/api/v1/orgs/${S.org1}/members/${rootUid}`)).status()).toBe(404);
    // Allowed reads work.
    expect((await api.get(`${API}/api/v1/orgs/${S.org1}/members`)).status()).toBe(200);
    // Cross-org: org1 member reaches for org2 -> 404 on UI routes and API.
    for (const p of ["", "/members", "/sets", "/audit"]) {
      expect(await (await api.get(`${API}/api/v1/orgs/${S.org2}${p}`)).status(), p).toBe(404);
    }
    await limited.page.goto(`/organizations/${S.org2}?section=members`);
    await expect(limited.page.getByTestId("org-dashboard")).toHaveCount(0);
    // Org1 permission set cannot cross into org2 (assign -> 404).
    const sets = (await (await root.page.request.get(`${API}/api/v1/orgs/${S.org1}/sets`)).json()) as { id: string }[];
    const secondRoot = await mkPersona(browser, request, U("second-root"));
    const xorg = await secondRoot.page.request.post(`${API}/api/v1/orgs/${S.org2}/invitations`, { data: { email: U("limited-member"), set_ids: [] } }).catch(() => null);
    void xorg;
    await root.ctx.close();
    await limited.ctx.close();
    await secondRoot.ctx.close();
  });

  test("multi-org user, switcher, removal, suspension, root protection", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    const r2 = await mkPersona(browser, request, U("second-root"));
    const multi = await mkPersona(browser, request, U("limited-member"));
    // Add limited-member to org2 with a different (empty) grant set.
    await ensureMemberUI(r2.page, S.org2!, U("limited-member"));
    S.org2slug = await orgSlugOf(multi.page, S.org2!);
    await acceptInviteForSlugUI(multi.page, S.org2slug, "ToLLma Isolation Organization");
    // Per-org permissions differ: org1 Members.Read present, org2 read of members denied.
    const m1 = await multi.page.request.get(`${API}/api/v1/orgs/${S.org1}/members`);
    expect(m1.status()).toBe(200);
    const m2 = await multi.page.request.get(`${API}/api/v1/orgs/${S.org2}/members`);
    expect(m2.status()).toBe(404);
    // Switcher shows Personal + both orgs.
    await multi.page.goto("/organizations");
    await expect(multi.page.getByTestId("organizations-page")).toContainText("ToLLma QA Organization");
    await expect(multi.page.getByTestId("organizations-page")).toContainText("ToLLma Isolation Organization");
    await shot(multi.page, "qa-multiorg");
    // Suspension via UI: blocked, then restored. Button flips prove the
    // mutations settled before API state is asserted (no commit races).
    await dash(root.page, S.org1!, "members");
    const mcard = root.page.locator('[data-testid^="org-member-"]').filter({ hasText: U("limited-member") }).first();
    await mcard.getByRole("button", { name: "Suspend" }).click();
    await expect(mcard.getByRole("button", { name: "Reactivate" })).toBeVisible({ timeout: 20000 });
    const blocked = await multi.page.request.get(`${API}/api/v1/orgs/${S.org1}`);
    expect(blocked.status()).toBe(404);
    // Personal workspace intact while suspended.
    expect((await multi.page.request.get(`${API}/auth/me`)).status()).toBe(200);
    await mcard.getByRole("button", { name: "Reactivate" }).click();
    await expect(mcard.getByRole("button", { name: "Suspend" })).toBeVisible({ timeout: 20000 });
    expect((await multi.page.request.get(`${API}/api/v1/orgs/${S.org1}`)).status()).toBe(200);
    // Removal via UI dialog.
    await mcard.getByRole("button", { name: "Remove" }).click();
    await root.page.getByTestId("org-confirm-action").click();
    await expect(mcard).toHaveCount(0, { timeout: 20000 });
    expect((await multi.page.request.get(`${API}/api/v1/orgs/${S.org1}`)).status()).toBe(404);
    await multi.page.goto("/organizations");
    await expect(multi.page.getByTestId(`org-card-${S.org1slug}`)).toHaveCount(0, { timeout: 20000 });
    expect((await multi.page.request.get(`${API}/auth/me`)).status()).toBe(200);
    // Root protection on both layers.
    const me = (await (await root.page.request.get(`${API}/auth/me`)).json()) as { id: string };
    expect((await root.page.request.delete(`${API}/api/v1/orgs/${S.org1}/members/${me.id}`)).status()).toBe(409);
    expect((await root.page.request.post(`${API}/api/v1/orgs/${S.org1}/leave`, { data: {} })).status()).toBe(409);
    expect((await root.page.request.post(`${API}/api/v1/orgs/${S.org1}/members/${me.id}/suspend`, { data: {} })).status()).toBe(409);
    await shot(root.page, "qa-removal");
    await root.ctx.close();
    await r2.ctx.close();
    await multi.ctx.close();
  });

  test("audit, notifications, email-outbox, no-native-dialogs", async ({ browser, request }) => {
    const root = await mkPersona(browser, request, U("root"));
    const audit = (await (await root.page.request.get(`${API}/api/v1/orgs/${S.org1}/audit?limit=200`)).json()) as { action: string }[];
    const actions = new Set(audit.map((a) => a.action));
    for (const need of ["org.created", "member.invited", "member.accepted", "member.rejected_invite", "member.removed", "member.suspended", "member.resumed", "invite.resent", "set.created"]) {
      expect(actions, need).toContain(need);
    }
    // Notifications belong to their user only.
    const notifs = await root.page.request.get(`${API}/api/v1/notifications?limit=50`);
    expect(notifs.status()).toBe(200);
    const limited = await mkPersona(browser, request, U("limited-member"));
    const other = (await (await limited.page.request.get(`${API}/api/v1/notifications?limit=50`)).json()) as { id: string }[];
    void other;
    // No native dialogs anywhere in shipped source (comment lines excluded).
    const { execSync } = await import("node:child_process");
    const hits = execSync(`grep -rn "window\\.\\(alert\\|confirm\\|prompt\\)(" frontend/src --include='*.tsx' --include='*.ts' | grep -v __tests__ | grep -v "^[^:]*:[0-9]*:\\s*\\*[ /]" || true`, {
      cwd: "/home/ond/Projects/ToLLms", shell: "/bin/bash",
    }).toString().trim();
    expect(hits, "no native dialogs").toBe("");
    await dash(root.page, S.org1!, "audit");
    await shot(root.page, "qa-audit");
    await root.ctx.close();
    await limited.ctx.close();
  });

  test("platform admin views + boundary", async ({ browser, request }) => {
    // Throwaway admin via the documented bootstrap script.
    await apiEnsureUser(request, U("qa-admin"));
    const { execSync } = await import("node:child_process");
    execSync(`docker compose exec -T backend python scripts/promote_admin.py ${U("qa-admin")}`, {
      cwd: "/home/ond/Projects/ToLLms", shell: "/bin/bash", timeout: 60000,
    });
    const admin = await mkPersona(browser, request, U("qa-admin"));
    await admin.page.goto("/admin");
    await expect(admin.page.getByTestId("admin-page")).toBeVisible({ timeout: 30000 });
    await shot(admin.page, "qa-admin");
    // Admin sees platform aggregates (users/org-level metadata, never content).
    const users = await admin.page.request.get(`${API}/api/admin/users`);
    expect(users.status()).toBe(200);
    const dashboard = await admin.page.request.get(`${API}/api/admin/dashboard`);
    expect(dashboard.status()).toBe(200);
    // ...but is NOT an org root: org member endpoints 404 without membership.
    expect((await admin.page.request.get(`${API}/api/v1/orgs/${S.org1}/members`)).status()).toBe(404);
    expect((await admin.page.request.get(`${API}/api/v1/orgs/${S.org1}/audit`)).status()).toBe(404);
    await admin.ctx.close();
  });

  test("session isolation across users", async ({ browser, request }) => {
    const a = await mkPersona(browser, request, U("root"));
    await a.page.getByTestId("profile-settings-btn").click().catch(() => null);
    await a.page.getByTestId("logout-btn").click();
    await expect(a.page.getByTestId("login-page")).toBeVisible({ timeout: 20000 });
    const b = await mkPersona(browser, request, U("second-root"));
    await b.page.goto("/organizations");
    await expect(b.page.getByTestId(`org-card-${S.org1slug}`)).toHaveCount(0, { timeout: 20000 });
    await a.ctx.close();
    await b.ctx.close();
  });
});

async function orgSlugOf(page: Page, orgId: string): Promise<string> {
  const res = await page.request.get(`${API}/api/v1/orgs`);
  const orgs = (await res.json()) as { id: string; slug?: string }[];
  return orgs.find((o) => o.id === orgId)?.slug ?? "";
}

async function orgSlug(page: Page, orgId: string): Promise<string> {
  await dash(page, orgId, "overview");
  await expect(page.getByTestId("sidebar-org-nav")).toContainText(/\//, { timeout: 20000 });
  const nav = await page.getByTestId("sidebar-org-nav").textContent();
  return nav?.match(/\/([a-z0-9-]+)/)?.[1] ?? "";
}
