// Sidebar-first navigation: personal nav renders directly (no gear toggle).
import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

test("personal nav renders directly without the gear toggle", async ({ page }) => {
  await apiLoginAs(page, "nav");
  await page.goto("/");

  // No top navigation bar anywhere.
  await expect(page.getByTestId("top-navigation")).toHaveCount(0);

  // Sidebar chrome: the profile card is split — a non-interactive identity
  // block plus an explicit chevron workspace button showing the current name.
  await expect(page.getByTestId("left-sidebar")).toBeVisible();
  const workspaceTrigger = page.getByTestId("workspace-menu-trigger");
  await expect(workspaceTrigger).toBeVisible();
  await expect(workspaceTrigger).toHaveRole("button");
  await expect(workspaceTrigger).toHaveAttribute("aria-label", /current workspace Personal/i);
  await expect(workspaceTrigger).toContainText("Personal");
  await expect(page.getByTestId("user-avatar")).toHaveAttribute("aria-hidden", "true");
  // Workspace selection lives in the chevron dropdown menu.
  await workspaceTrigger.click();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  await expect(page.getByTestId("workspace-menu-personal")).toBeVisible();
  await expect(page.getByTestId("workspace-menu-new-org")).toBeVisible();
  await expect(page.getByTestId("workspace-menu-new-org")).toContainText("New organization");
  // Join lives on the Settings organizations page now — no menu entry.
  await expect(page.getByTestId("workspace-menu-join-org")).toHaveCount(0);
  // Single entry point links to the settings organizations section.
  await expect(page.getByTestId("workspace-menu").locator('a[href="/settings#organizations"]')).toHaveCount(1);
  // Redesigned menu: "Workspaces" label, identity header (signed-in email),
  // per-item descriptions, and the plain full-width New organization item.
  await expect(page.getByTestId("workspace-menu")).toContainText("Workspaces");
  await expect(page.getByTestId("workspace-menu")).toContainText("@tollma.ai");
  await expect(page.getByTestId("workspace-menu-personal")).toContainText("Private to you");
  // No "Organization actions" group — just the single New organization item.
  await expect(
    page.getByTestId("workspace-menu").getByRole("group", { name: "Organization actions" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("app-logo")).toBeVisible();
  await expect(page.getByTestId("new-chat")).toBeVisible();
  await expect(page.getByTestId("conversation-search")).toBeVisible();

  // Personal scope: personal nav visible, org nav hidden.
  const personalNav = page.getByTestId("sidebar-personal-nav");
  await expect(personalNav).toBeVisible();
  await expect(page.getByTestId("sidebar-org-nav")).toHaveCount(0);
  await expect(personalNav.getByTestId("sidebar-nav-chat")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-providers")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-api-keys")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-analytics")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-api-docs")).toBeVisible();
  await expect(personalNav.getByTestId("sidebar-nav-settings")).toBeVisible();

  // Settings lives in the personal nav (footer gear was replaced by the nav chevron).
  await expect(page.getByTestId("sidebar-nav-settings")).toHaveAttribute("href", "/settings");
  // Chat is first in the personal nav, links home, and is active on "/".
  await expect(personalNav.getByTestId("sidebar-nav-chat")).toHaveAttribute("href", "/");
  await expect(personalNav.getByTestId("sidebar-nav-chat")).toHaveAttribute("aria-current", "page");
  await expect(personalNav.locator("a").first()).toHaveAttribute("href", "/");

  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("user-avatar")).toBeVisible();
  // Log out is the last row of the bottom-anchored nav (not the footer).
  const logoutBtn = page.getByTestId("logout-btn");
  await expect(logoutBtn).toBeVisible();
  await expect(logoutBtn).toContainText("Log out");
  await expect(page.getByTestId("sidebar-footer").getByTestId("logout-btn")).toHaveCount(0);
  // Footer chevron pins the bottom nav open/closed on click — logout hides with it.
  const collapseBtn = page.getByTestId("sidebar-collapse-btn");
  await collapseBtn.click();
  await expect(personalNav).toBeHidden({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeHidden({ timeout: 10000 });
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();

  // Peek: hovering the hidden chevron temporarily shows the nav.
  await collapseBtn.hover();
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeVisible({ timeout: 10000 });
  // Moving pointer + focus away hides it again after the ~1s grace.
  await page.getByTestId("app-logo").hover();
  await collapseBtn.blur();
  await expect(personalNav).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await expect(personalNav).toBeHidden({ timeout: 10000 });

  // Keyboard peek: focusing the chevron shows the nav, blur hides it.
  await collapseBtn.focus();
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await collapseBtn.blur();
  await page.getByTestId("app-logo").hover();
  await expect(personalNav).toBeHidden({ timeout: 10000 });

  // Click-to-pin while hidden: stays visible after moving away + blur.
  await collapseBtn.click();
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("app-logo").hover();
  await collapseBtn.blur();
  await page.waitForTimeout(1500);
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeVisible({ timeout: 10000 });

  // Keyboard pin: hide again, focus chevron, Enter pins it open.
  await collapseBtn.click();
  await expect(personalNav).toBeHidden({ timeout: 10000 });
  await collapseBtn.focus();
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Enter");
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await collapseBtn.blur();
  await page.getByTestId("app-logo").hover();
  await page.waitForTimeout(1500);
  await expect(personalNav).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();

  // Providers context: provider tools, personal nav keeps Providers highlighted.
  await personalNav.getByTestId("sidebar-nav-providers").click();
  await expect(page).toHaveURL(/\/providers/);
  await expect(page.getByTestId("provider-search")).toBeVisible();
  await expect(page.getByTestId("add-provider")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-providers")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toContainText("Log out");

  // Analytics context: report shortcuts, personal nav keeps Analytics highlighted.
  await page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-analytics").click();
  await expect(page).toHaveURL(/\/analytics/);
  await expect(page.getByTestId("analytics-page")).toBeVisible();
  await expect(page.getByTestId("sidebar-report-usage")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-analytics")).toHaveAttribute("aria-current", "page");

  // Settings page reachable through the personal nav directly.
  await page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-settings").click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await expect(page.getByTestId("sidebar-settings-appearance")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav").getByTestId("sidebar-nav-settings")).toHaveAttribute("aria-current", "page");

  // Logo returns home: chat is the home page.
  await page.getByTestId("app-logo").click();
  // Home is now the draft chat: it stays at "/" until the first message.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("new-chat")).toBeVisible();
  await expect(page.getByTestId("top-navigation")).toHaveCount(0);

  // Workspace switching via the profile menu: create an org, switch to its detail page.
  const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `Nav Org ${Date.now()}`, description: "e2e nav" },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const orgId = (await orgRes.json()).id as string;
  const orgName = (await orgRes.json()).name as string;
  await page.getByTestId("workspace-menu-trigger").click();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  const menuOrgs = page.locator('[data-testid^="workspace-menu-org-"]');
  await expect.poll(async () => menuOrgs.count(), { timeout: 20000 }).toBeGreaterThanOrEqual(1);
  await menuOrgs.first().click();
  await expect(page).toHaveURL(/\/organizations\/[0-9a-f-]{36}/, { timeout: 20000 });
  await expect(page.getByTestId("workspace-menu-trigger")).toContainText(orgName);
  // Final nav rule: org scope shows ONLY the org nav (personal hidden).
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-workspace-switcher")).toHaveCount(0);
  await expect(page.locator('[data-testid^="sidebar-ws-"]')).toHaveCount(0);
  // Unified org nav: Overview/Chat/Providers/API Keys/Analytics/API Docs/Members/Teams/Permission Sets/Operations/Budgets/Audit/Settings (13 items).
  for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await expect(page.getByTestId(`sidebar-org-${section}`)).toBeVisible();
  }
  // Unified hrefs use exact pathnames.
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("href", "/providers");
  await expect(page.getByTestId("sidebar-org-keys")).toHaveAttribute("href", "/api-keys");
  await expect(page.getByTestId("sidebar-org-analytics")).toHaveAttribute("href", "/analytics");
  await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("href", "/docs");
  // ORG header block (name/slug) has no toggle.
  await expect(page.getByTestId("sidebar-org-toggle")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav").getByRole("button")).toHaveCount(0);

  // Seed one org provider so the unified providers page has org data to render.
  const provRes = await page.request.post(`${API}/api/v1/orgs/${orgId}/providers`, {
    data: { name: `NavOrgProv ${Date.now()}`, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
  });
  expect(provRes.ok(), await provRes.text()).toBeTruthy();
  const provName = (await provRes.json()).name as string;

  // /providers renders org data in org scope (scope chip + remount per org).
  await page.goto("/providers");
  await expect(page.getByTestId("provider-scope-org")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("provider-scope-org")).toContainText(orgName);
  await expect(page.locator("section[aria-label='Provider list']").getByText(provName)).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL(/^[^?]*\/providers$/);

  // /api-keys renders org data in org scope.
  await page.goto("/api-keys");
  await expect(page.getByTestId("api-keys-page")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("api-keys-scope-chip")).toBeVisible();
  await expect(page.getByTestId("api-keys-scope-chip")).toContainText("Organization");
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-keys")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  // Org scope keeps the same bottom-anchored nav: logout stays visible as its last row.
  await expect(page.getByTestId("logout-btn")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toContainText("Log out");

  // /analytics renders org data in org scope.
  await page.goto("/analytics");
  await expect(page.getByTestId("analytics-page")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("analytics-scope")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-analytics")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toBeVisible();
  await expect(page.getByTestId("logout-btn")).toContainText("Log out");

  // /docs in org scope keeps the org nav with API Docs highlighted.
  await page.goto("/docs");
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("href", "/docs");
  await expect(page.getByTestId("sidebar-org-docs")).toHaveAttribute("aria-current", "page");

  // Chat entry in org scope links home and highlights on "/" and "/c/*" (plain pathname).
  await page.goto("/");
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-personal-nav")).toHaveCount(0);
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("href", "/");
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("aria-current", "page");
  await page.goto("/c/00000000-0000-0000-0000-000000000000");
  await expect(page.getByTestId("sidebar-org-chat")).toHaveAttribute("aria-current", "page");

  // Legacy deep links redirect to the unified pages (context is already org).
  await page.goto(`/organizations/${orgId}?section=providers`);
  await expect(page).toHaveURL(/\/providers/, { timeout: 20000 });
  await page.goto(`/organizations/${orgId}?section=analytics`);
  await expect(page).toHaveURL(/\/analytics/, { timeout: 20000 });
  await page.goto(`/organizations/${orgId}?section=operations&tab=keys`);
  await expect(page).toHaveURL(/\/api-keys/, { timeout: 20000 });
  await page.goto(`/organizations/${orgId}?section=keys`);
  await expect(page).toHaveURL(/\/api-keys/, { timeout: 20000 });

  // Operations has only requests + invitations tabs (keys moved to /api-keys).
  await page.goto(`/organizations/${orgId}?section=operations`);
  await expect(page.getByTestId("org-operations")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("org-ops-tab-requests")).toBeVisible();
  await expect(page.getByTestId("org-ops-tab-invitations")).toBeVisible();
  await expect(page.getByTestId("org-ops-tab-keys")).toHaveCount(0);

  // Switch back to the personal workspace via the chevron menu.
  await page.getByTestId("workspace-menu-trigger").click();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  await page.getByTestId("workspace-menu-personal").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible();
  await expect(page.getByTestId("sidebar-org-nav")).toHaveCount(0);
  await expect(page.getByTestId("workspace-menu-trigger")).toContainText("Personal");
  // Personal providers scope is back (remount per scope).
  await page.goto("/providers");
  await expect(page.getByTestId("provider-scope-personal")).toBeVisible({ timeout: 20000 });
  // Bottom-anchored nav persists on every workspace page.
  for (const route of ["/", "/providers", "/api-keys", "/settings"] as const) {
    await page.goto(route);
    await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("sidebar-org-nav")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-footer")).toBeVisible();
    await expect(page.getByTestId("logout-btn")).toBeVisible();
    await expect(page.getByTestId("logout-btn")).toContainText("Log out");
  }
});

test("org sidebar marks exactly one active item per route", async ({ page }) => {
  test.setTimeout(120000);
  await apiLoginAs(page, "nav-active");
  const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `NavActive Org ${Date.now()}` },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const orgId = ((await orgRes.json()) as { id: string }).id;

  async function expectSingleOrgActive(expectedTestId: string): Promise<void> {
    const nav = page.getByTestId("sidebar-org-nav");
    await expect(nav).toBeVisible({ timeout: 20000 });
    // Exactly ONE nav item may carry aria-current="page" at a time.
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page.getByTestId(expectedTestId)).toHaveAttribute("aria-current", "page");
  }

  // Enter org scope via the detail page (writes the workspace context).
  await page.goto(`/organizations/${orgId}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expectSingleOrgActive("sidebar-org-overview");

  // Unified items match by pathname (Chat also matches /c/*); Overview only
  // wins when no unified item matches.
  await page.goto("/");
  await expectSingleOrgActive("sidebar-org-chat");
  await page.goto("/providers");
  await expectSingleOrgActive("sidebar-org-providers");
  await page.goto("/api-keys");
  await expectSingleOrgActive("sidebar-org-keys");
  await page.goto("/analytics");
  await expectSingleOrgActive("sidebar-org-analytics");
  await page.goto("/docs");
  await expectSingleOrgActive("sidebar-org-docs");

  // /c/<id>: reuse an existing conversation when the suite has one, else
  // create one; skip the route when neither is available.
  let convId: string | null = null;
  try {
    const listRes = await page.request.get(`${API}/api/v1/conversations`);
    if (listRes.ok()) {
      const list = (await listRes.json()) as Array<{ id: string }>;
      if (Array.isArray(list) && list.length > 0) convId = list[0].id;
    }
  } catch {
    convId = null;
  }
  if (!convId) {
    const created = await page.request.post(`${API}/api/v1/conversations`, { data: {} });
    if (created.ok()) convId = ((await created.json()) as { id: string }).id;
  }
  if (convId) {
    await page.goto(`/c/${convId}`);
    await expectSingleOrgActive("sidebar-org-chat");
  }

  // Org detail pages: no unified match, so the section (or Overview) is active.
  await page.goto(`/organizations/${orgId}`);
  await expect(page.getByTestId("org-section-overview")).toBeVisible({ timeout: 20000 });
  await expectSingleOrgActive("sidebar-org-overview");
  for (const section of ["members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await page.goto(`/organizations/${orgId}?section=${section}`);
    await expect(page.getByTestId(`org-section-${section}`)).toBeVisible({ timeout: 20000 });
    await expectSingleOrgActive(`sidebar-org-${section}`);
  }
});

test("command palette Go-to navigates, org entries gated, providers scoped", async ({ page }) => {
  test.setTimeout(120000);
  await apiLoginAs(page, "nav-palette");
  const stamp = Date.now();
  const personalProvName = `NavPalettePersonal ${stamp}`;
  const orgProvName = `NavPaletteOrg ${stamp}`;
  const personalRes = await page.request.post(`${API}/api/v1/providers`, {
    data: { name: personalProvName, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
  });
  expect(personalRes.ok(), await personalRes.text()).toBeTruthy();
  const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `NavPalette Org ${stamp}` },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const orgId = ((await orgRes.json()) as { id: string }).id;
  const orgProvRes = await page.request.post(`${API}/api/v1/orgs/${orgId}/providers`, {
    data: { name: orgProvName, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
  });
  expect(orgProvRes.ok(), await orgProvRes.text()).toBeTruthy();

  async function openPalette(): Promise<void> {
    await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-palette")).toBeVisible({ timeout: 10000 });
  }

  // Personal scope: Go-to group lists the shared pages; no org-only entries.
  await page.goto("/");
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 20000 });
  await openPalette();
  for (const id of ["cmd-nav-chat", "cmd-nav-providers", "cmd-nav-keys", "cmd-nav-analytics", "cmd-nav-docs"] as const) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.locator('[data-testid^="cmd-nav-org-"]')).toHaveCount(0);
  // Provider shortcuts follow the scope: personal providers only.
  const palette = page.getByTestId("command-palette");
  await expect(palette.getByText(personalProvName, { exact: true })).toBeVisible();
  await expect(palette.getByText(orgProvName, { exact: true })).toHaveCount(0);
  // Personal Go-to entries navigate to the right URLs.
  await page.getByTestId("cmd-nav-providers").click();
  await expect(page).toHaveURL(/\/providers/);
  await openPalette();
  await page.getByTestId("cmd-nav-keys").click();
  await expect(page).toHaveURL(/\/api-keys/);
  await openPalette();
  await page.getByTestId("cmd-nav-analytics").click();
  await expect(page).toHaveURL(/\/analytics/);
  await openPalette();
  await page.getByTestId("cmd-nav-docs").click();
  await expect(page).toHaveURL(/\/docs/);
  await openPalette();
  await page.getByTestId("cmd-nav-chat").click();
  await expect(page).toHaveURL(/\/$/);

  // Org scope: root passes the same permission gate as the sidebar, so every
  // org-only entry is present alongside the shared pages.
  await page.goto(`/organizations/${orgId}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await openPalette();
  for (const id of [
    "cmd-nav-chat",
    "cmd-nav-providers",
    "cmd-nav-keys",
    "cmd-nav-analytics",
    "cmd-nav-docs",
    "cmd-nav-org-overview",
    "cmd-nav-org-members",
    "cmd-nav-org-teams",
    "cmd-nav-org-sets",
    "cmd-nav-org-operations",
    "cmd-nav-org-budgets",
    "cmd-nav-org-audit",
    "cmd-nav-org-settings",
  ] as const) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  // Provider shortcuts follow the scope: org providers only.
  await expect(palette.getByText(orgProvName, { exact: true })).toBeVisible();
  await expect(palette.getByText(personalProvName, { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).not.toBeVisible();

  // Each org entry navigates to its URL.
  const orgTargets = [
    ["cmd-nav-org-overview", new RegExp(`/organizations/${orgId}/?$`)],
    ["cmd-nav-org-members", /section=members/],
    ["cmd-nav-org-teams", /section=teams/],
    ["cmd-nav-org-sets", /section=sets/],
    ["cmd-nav-org-operations", /section=operations/],
    ["cmd-nav-org-budgets", /section=budgets/],
    ["cmd-nav-org-audit", /section=audit/],
    ["cmd-nav-org-settings", /section=settings/],
  ] as const;
  for (const [id, url] of orgTargets) {
    await openPalette();
    await page.getByTestId(id).click();
    await expect(page).toHaveURL(url, { timeout: 20000 });
  }
});

test("collapsed rail mirrors scope, controls, and shared nav visibility", async ({ page }) => {
  await apiLoginAs(page, "nav-rail");
  await page.goto("/");
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-reveal-rail")).toHaveCount(0);

  // Collapse via the header toggle: the slim rail replaces the sidebar.
  await page.getByTestId("left-sidebar-toggle").click();
  await expect(page.getByTestId("sidebar-reveal-rail")).toBeVisible({ timeout: 20000 });

  // Top: expand + command palette + notifications.
  await expect(page.getByTestId("rail-expand")).toBeVisible();
  await expect(page.getByTestId("rail-expand")).toHaveAttribute("aria-label", "Expand sidebar");
  await expect(page.getByTestId("rail-command-palette")).toBeVisible();
  await expect(page.getByTestId("rail-command-palette")).toHaveAttribute("aria-label", "Open command palette");
  const notifications = page.getByTestId("rail-notifications");
  await expect(notifications).toBeVisible();
  await expect(notifications).toHaveAttribute("aria-label", /Notifications/);

  // Palette opens from the rail and closes again.
  await page.getByTestId("rail-command-palette").click();
  await expect(page.getByTestId("command-palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette")).toBeHidden();

  // Notifications route to the settings organizations section; the rail
  // persists there in the personal scope with Settings active.
  await notifications.click();
  await expect(page).toHaveURL(/\/settings#organizations/);
  await expect(page.getByTestId("sidebar-reveal-rail")).toBeVisible();
  await expect(page.getByTestId("rail-nav-settings")).toHaveAttribute("aria-current", "page");

  // Middle: personal icons with the active entry marked (client-side hops
  // keep the collapsed state, so no reload persistence is asserted here).
  await page.getByTestId("rail-nav-chat").click();
  await expect(page).toHaveURL(/\/$/);
  for (const id of ["chat", "providers", "api-keys", "analytics", "api-docs", "settings"] as const) {
    await expect(page.getByTestId(`rail-nav-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId("rail-nav-chat")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-nav-providers")).not.toHaveAttribute("aria-current", "page");
  await page.getByTestId("rail-nav-providers").click();
  await expect(page).toHaveURL(/\/providers/);
  await expect(page.getByTestId("rail-nav-providers")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-nav-chat")).not.toHaveAttribute("aria-current", "page");

  // Bottom: the rail toggle shares navVisible with the expanded sidebar.
  const railToggle = page.getByTestId("rail-nav-toggle");
  await expect(railToggle).toBeVisible();
  await expect(railToggle).toHaveAttribute("aria-label", "Hide navigation");
  await railToggle.click();
  await expect(railToggle).toHaveAttribute("aria-label", "Show navigation");
  await page.getByTestId("rail-expand").click();
  await expect(page.getByTestId("sidebar-personal-nav")).toBeHidden({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeHidden({ timeout: 10000 });
  await expect(page.getByTestId("sidebar-footer")).toBeVisible();
  // Peek: hovering the hidden chevron temporarily shows the nav.
  const expandedCollapseBtn = page.getByTestId("sidebar-collapse-btn");
  await expandedCollapseBtn.hover();
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 10000 });
  // Moving pointer + focus away hides it again after the ~1s grace.
  await page.getByTestId("app-logo").hover();
  await expandedCollapseBtn.blur();
  await expect(page.getByTestId("sidebar-personal-nav")).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await expect(page.getByTestId("sidebar-personal-nav")).toBeHidden({ timeout: 10000 });
  // The expanded sidebar's own chevron pins it open — persists after moving away.
  await expandedCollapseBtn.click();
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeVisible({ timeout: 10000 });
  await page.getByTestId("app-logo").hover();
  await expandedCollapseBtn.blur();
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("logout-btn")).toBeVisible({ timeout: 10000 });

  // Avatar opens the same workspace menu as the profile trigger.
  await page.getByTestId("left-sidebar-toggle").click();
  await expect(page.getByTestId("sidebar-reveal-rail")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("rail-profile-menu").click();
  await expect(page.getByTestId("workspace-menu")).toBeVisible();
  await expect(page.getByTestId("workspace-menu-personal")).toBeVisible();
  await expect(page.getByTestId("workspace-menu-new-org")).toBeVisible();
  await page.keyboard.press("Escape");

  // Org scope: the rail shows the permission-filtered org set — the same
  // entries as the expanded org list — with active state.
  const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
    data: { name: `NavRail Org ${Date.now()}` },
  });
  expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
  const orgId = (await orgRes.json()).id as string;
  await page.getByTestId("rail-expand").click();
  await expect(page.getByTestId("sidebar-personal-nav")).toBeVisible({ timeout: 20000 });
  await page.goto(`/organizations/${orgId}`);
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await expect(page.getByTestId(`sidebar-org-${section}`)).toBeVisible();
  }
  const expandedCount = await page.getByTestId("sidebar-org-nav").locator('a[data-testid^="sidebar-org-"]').count();
  await page.getByTestId("left-sidebar-toggle").click();
  await expect(page.getByTestId("sidebar-reveal-rail")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-reveal-rail").locator("nav")).toHaveAttribute("aria-label", "Organization sections");
  for (const section of ["overview", "chat", "providers", "keys", "analytics", "docs", "members", "teams", "sets", "operations", "budgets", "audit", "settings"] as const) {
    await expect(page.getByTestId(`rail-org-${section}`)).toBeVisible();
  }
  expect(await page.locator('[data-testid^="rail-org-"]').count()).toBe(expandedCount);
  await expect(page.getByTestId("rail-org-overview")).toHaveAttribute("aria-current", "page");
  await page.getByTestId("rail-org-providers").click();
  await expect(page).toHaveURL(/\/providers/);
  await expect(page.getByTestId("rail-org-providers")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("rail-org-overview")).not.toHaveAttribute("aria-current", "page");
  // Personal icons are gone in org scope; expanding restores the org nav.
  await expect(page.getByTestId("rail-nav-chat")).toHaveCount(0);
  await page.getByTestId("rail-expand").click();
  await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("sidebar-org-providers")).toHaveAttribute("aria-current", "page");
});

test("workspace menu opens on hover with grace-hide, click still toggles", async ({ page }) => {
  test.setTimeout(120000);
  await apiLoginAs(page, "nav-ws-hover");
  await page.goto("/");
  await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });

  const trigger = page.getByTestId("workspace-menu-trigger");
  const menu = page.getByTestId("workspace-menu");
  await expect(trigger).toBeVisible({ timeout: 20000 });
  await expect(trigger).toContainText("Personal", { timeout: 20000 });
  // Normalize: ensure the menu starts hidden (Escape is a no-op if already hidden).
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden({ timeout: 10000 });

  // Hover opens the menu without any click.
  await trigger.hover();
  await expect(menu).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("workspace-menu-personal")).toBeVisible({ timeout: 10000 });

  // Moving the pointer away keeps it briefly (1s grace), then hides it.
  await page.getByTestId("app-logo").hover();
  await expect(menu).toBeVisible({ timeout: 2000 });
  await expect(menu).toBeHidden({ timeout: 10000 });
  await page.waitForTimeout(1200);
  await expect(menu).toBeHidden({ timeout: 10000 });

  // Click toggle still works: click opens, Escape closes, click opens again.
  await trigger.click();
  await expect(menu).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden({ timeout: 10000 });
  await trigger.click();
  await expect(menu).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden({ timeout: 10000 });
});
