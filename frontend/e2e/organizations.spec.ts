import { expect, test, type APIRequestContext } from "@playwright/test";
import { API } from "./helpers";

/** Sign up + verify (org routes require a verified account). */
async function signupVerified(request: APIRequestContext, tag: string): Promise<{ email: string }> {
  const email = `pw-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tollma.ai`;
  const signup = await request.post(`${API}/auth/signup`, { data: { email, password: "Password123" } });
  if (!signup.ok()) throw new Error(`e2e signup failed: ${await signup.text()}`);
  const token = (await signup.json()).debug_verification_token as string | null;
  if (token) {
    const verify = await request.get(`${API}/auth/verify`, { params: { token } });
    if (!verify.ok()) throw new Error(`e2e verify failed: ${await verify.text()}`);
  }
  return { email };
}

/**
 * Organizations Phase A E2E (10 scenarios). API drives multi-user setup
 * (auth cookies persist per request context); the page drives UI assertions.
 */

async function orgAs(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/api/v1/orgs`, {
    data: { name, description: "e2e org" },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

test.describe("organizations phase A", () => {
  test.setTimeout(120000);
  test("scenario 1: create organization (UI)", async ({ page, request }) => {
    await signupVerified(request, "org-create");
    await page.goto("/organizations");
    await page.getByTestId("org-create-open").click();
    const name = `E2E Org ${Date.now()}`;
    await page.getByTestId("org-create-name").fill(name);
    await page.getByTestId("org-create-submit").click();
    await expect(page.getByTestId("organizations-page")).toContainText(name);
  });

  test("scenario 2+4: invite existing user, accept via inbox (UI)", async ({ page, request, playwright }) => {
    const org = await orgAs(page.request, `Invite Org ${Date.now()}`);
    // Invitee lives in an isolated API context (page.request stays the root).
    const invitee = await playwright.request.newContext();
    const inviteeEmail = `pw-e2e-invitee-${Date.now()}@tollma.ai`;
    const signup = await invitee.post(`${API}/auth/signup`, {
      data: { email: inviteeEmail, password: "Password123" },
    });
    expect(signup.ok()).toBeTruthy();
    const vtoken = (await signup.json()).debug_verification_token as string | null;
    if (vtoken) await invitee.get(`${API}/auth/verify`, { params: { token: vtoken } });
    // Root (page user) invites the invitee.
    const inv = await page.request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email: inviteeEmail, set_ids: [] },
    });
    expect(inv.ok(), await inv.text()).toBeTruthy();
    const invId = (await inv.json()).id as string;
    // Invitee sees the invite in their own inbox and accepts.
    const mine = await invitee.get(`${API}/api/v1/orgs/invitations/mine`);
    expect(mine.ok()).toBeTruthy();
    const item = (await mine.json()).find((i: { id: string }) => i.id === invId);
    expect(item).toBeTruthy();
    const acc = await invitee.post(`${API}/api/v1/orgs/invitations/by-token/${item.token}/accept`, {
      data: {},
    });
    expect(acc.ok(), await acc.text()).toBeTruthy();
    await invitee.dispose();
    // Root sees the new member and gets an acceptance notification.
    const members = await page.request.get(`${API}/api/v1/orgs/${org.id}/members`);
    expect(members.ok()).toBeTruthy();
    expect((await members.json()).map((m: { email: string }) => m.email)).toContain(inviteeEmail);
    // UI: root's inbox shows the acceptance notification.
    await page.goto("/organizations?view=inbox");
    await expect(page.getByTestId("org-inbox")).toContainText("joined");
  });

  test("scenario 4: accept invitation via inbox UI", async ({ page, request }) => {
    await signupVerified(request, "org-uiaccept");
    const org = await orgAs(request, `UIAccept Org ${Date.now()}`);
    const me = await page.request.get(`${API}/auth/me`);
    expect(me.ok()).toBeTruthy();
    const myEmail = (await me.json()).email as string;
    const inv = await request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email: myEmail, set_ids: [] },
    });
    expect(inv.ok(), await inv.text()).toBeTruthy();
    const invId = (await inv.json()).id as string;
    await page.goto("/organizations?view=inbox");
    await expect(page.getByTestId("org-inbox")).toContainText(org.name);
    await page.getByTestId(`org-invite-accept-${invId}`).click();
    await expect(page.getByTestId(`org-invite-${invId}`)).toHaveCount(0);
    await page.goto("/organizations");
    await expect(page.getByTestId("organizations-page")).toContainText(org.name);
  });

  test("scenario 3: invite new user (API)", async ({ request }) => {
    await signupVerified(request, "org-newuser");
    const org = await orgAs(request, `NewUser Org ${Date.now()}`);
    const fresh = `pw-fresh-${Date.now()}@tollma.ai`;
    const inv = await request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email: fresh, set_ids: [] },
    });
    expect(inv.ok(), await inv.text()).toBeTruthy();
    expect((await inv.json()).status).toBe("pending");
  });

  test("scenario 5: reject invitation (API)", async ({ page, request }) => {
    await signupVerified(request, "org-reject");
    const org = await orgAs(request, `Reject Org ${Date.now()}`);
    const email = `pw-e2e-reject-${Date.now()}@tollma.ai`;
    const signup = await page.request.post(`${API}/auth/signup`, {
      data: { email, password: "Password123" },
    });
    const token = (await signup.json()).debug_verification_token as string | null;
    if (token) await page.request.get(`${API}/auth/verify`, { params: { token } });
    const inv = await request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email, set_ids: [] },
    });
    const invId = (await inv.json()).id as string;
    const mine = await page.request.get(`${API}/api/v1/orgs/invitations/mine`);
    const item = (await mine.json()).find((i: { id: string }) => i.id === invId);
    const rej = await page.request.post(`${API}/api/v1/orgs/invitations/by-token/${item.token}/reject`, {
      data: {},
    });
    expect(rej.ok(), await rej.text()).toBeTruthy();
  });

  test("scenario 6+7: request join, approve (API)", async ({ page, request }) => {
    await signupVerified(request, "org-approve");
    const org = await orgAs(request, `Approve Org ${Date.now()}`);
    const email = `pw-e2e-joiner-${Date.now()}@tollma.ai`;
    const signup = await page.request.post(`${API}/auth/signup`, {
      data: { email, password: "Password123" },
    });
    const token = (await signup.json()).debug_verification_token as string | null;
    if (token) await page.request.get(`${API}/auth/verify`, { params: { token } });
    const reqJoin = await page.request.post(`${API}/api/v1/orgs/${org.id}/requests`, { data: {} });
    expect(reqJoin.ok(), await reqJoin.text()).toBeTruthy();
    const queue = await request.get(`${API}/api/v1/orgs/${org.id}/requests`);
    const item = (await queue.json())[0];
    const appr = await request.post(`${API}/api/v1/orgs/${org.id}/requests/${item.id}/approve`, {
      data: { set_ids: [] },
    });
    expect(appr.ok(), await appr.text()).toBeTruthy();
  });

  test("scenario 8: remove member (API)", async ({ page, request }) => {
    await signupVerified(request, "org-remove");
    const org = await orgAs(request, `Remove Org ${Date.now()}`);
    const email = `pw-e2e-gone-${Date.now()}@tollma.ai`;
    const signup = await page.request.post(`${API}/auth/signup`, {
      data: { email, password: "Password123" },
    });
    const token = (await signup.json()).debug_verification_token as string | null;
    if (token) await page.request.get(`${API}/auth/verify`, { params: { token } });
    const userId = (await signup.json()).user.id as string;
    const inv = await request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email, set_ids: [] },
    });
    const invId = (await inv.json()).id as string;
    const mine = await page.request.get(`${API}/api/v1/orgs/invitations/mine`);
    const item = (await mine.json()).find((i: { id: string }) => i.id === invId);
    await page.request.post(`${API}/api/v1/orgs/invitations/by-token/${item.token}/accept`, { data: {} });
    const del = await request.delete(`${API}/api/v1/orgs/${org.id}/members/${userId}`);
    expect(del.ok(), await del.text()).toBeTruthy();
  });

  test("scenario 9: permission set management (UI)", async ({ page, request }) => {
    const org = await orgAs(page.request, `Sets Org ${Date.now()}`);
    await page.goto(`/organizations/${org.id}?section=sets`);
    await expect(page.getByTestId("sidebar-org-sets")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("org-sets")).toContainText("Owner");
    await expect(page.getByTestId("org-sets")).toContainText("Members");
    await page.getByTestId("org-set-create").click();
    await page.getByTestId("org-set-name").fill("E2E Leads");
    await page.getByTestId("org-set-submit").click();
    await expect(page.getByTestId("org-sets")).toContainText("E2E Leads");
  });

  test("scenario 10: organization switching (UI)", async ({ page, request }) => {
    await orgAs(page.request, `Switch A ${Date.now()}`);
    await orgAs(page.request, `Switch B ${Date.now()}`);
    await page.goto("/organizations");
    await expect(page.getByTestId("org-context-card")).toContainText("Switch A");
    await page.getByTestId("org-context-personal").click();
    await expect(page.getByTestId("org-context-personal")).toBeVisible();
  });

  test("scenario 11: sidebar section navigation (UI)", async ({ page }) => {
    const org = await orgAs(page.request, `Nav Org ${Date.now()}`);
    await page.goto(`/organizations/${org.id}`);
    // Nested sidebar replaces horizontal tabs: no tab bar exists.
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
    await expect(page.getByTestId("org-section-overview")).toBeVisible();
    // Phase B modules render disabled with a "soon" badge.
    await expect(page.getByTestId("sidebar-org-teams")).toContainText("soon");
    await expect(page.getByTestId("sidebar-org-analytics")).toContainText("soon");
    // Click Members in the sidebar; section + active state follow.
    await page.getByTestId("sidebar-org-members").click();
    await expect(page.getByTestId("org-section-members")).toBeVisible();
    await expect(page.getByTestId("sidebar-org-members")).toHaveAttribute("aria-current", "page");
    // Keyboard: tab to the sets link and activate with Enter.
    await page.getByTestId("sidebar-org-sets").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("org-section-sets")).toBeVisible();
    // Settings renders cards, including the danger zone.
    await page.getByTestId("sidebar-org-settings").click();
    await expect(page.getByTestId("org-settings")).toContainText("Danger Zone");
    await expect(page.getByTestId("org-settings")).toContainText("Privacy");
  });

  test("cross-org isolation (API)", async ({ page, request }) => {
    await signupVerified(request, "org-iso");
    const org = await orgAs(request, `Iso Org ${Date.now()}`);
    const email = `pw-e2e-iso-${Date.now()}@tollma.ai`;
    const signup = await page.request.post(`${API}/auth/signup`, {
      data: { email, password: "Password123" },
    });
    expect(signup.ok()).toBeTruthy();
    const vtoken = (await signup.json()).debug_verification_token as string | null;
    if (vtoken) await page.request.get(`${API}/auth/verify`, { params: { token: vtoken } });
    for (const path of ["", "/members", "/sets", "/audit"]) {
      const r = await page.request.get(`${API}/api/v1/orgs/${org.id}${path}`);
      expect(r.status(), path).toBe(404);
    }
  });

  test("root protection (API)", async ({ request }) => {
    await signupVerified(request, "org-rootprot");
    const org = await orgAs(request, `RootProt Org ${Date.now()}`);
    const me = await request.get(`${API}/auth/me`);
    const myId = (await me.json()).id as string;
    const del = await request.delete(`${API}/api/v1/orgs/${org.id}/members/${myId}`);
    expect(del.status()).toBe(409);
    const leave = await request.post(`${API}/api/v1/orgs/${org.id}/leave`, { data: {} });
    expect(leave.status()).toBe(409);
  });
});