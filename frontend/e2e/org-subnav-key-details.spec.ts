import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

/** Org section pages have an empty sidebar body + org key details with analytics. */
test.describe("org nav (no subnav) + key details", () => {
  test.setTimeout(120000);
  test("org section page shows no subnav, no conversations list, only bottom org nav", async ({ page }) => {
    await apiLoginAs(page, "subnav");
    const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
      data: { name: `Subnav Org ${Date.now()}` },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const orgId = ((await orgRes.json()) as { id: string }).id;

    await page.goto(`/organizations/${orgId}?section=members`);
    // Body subnav was removed: it never renders on org routes.
    await expect(page.getByTestId("sidebar-org-subnav")).toHaveCount(0);
    // Org routes never render the conversations list.
    await expect(page.getByTestId("conversation-search")).toHaveCount(0);
    await expect(page.getByTestId("new-chat")).toHaveCount(0);
    // Bottom-anchored full org nav is the single navigation.
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
    // All 13 unified sections render (root sees the full set).
    for (const section of [
      "overview",
      "chat",
      "providers",
      "keys",
      "analytics",
      "docs",
      "members",
      "teams",
      "sets",
      "operations",
      "budgets",
      "audit",
      "settings",
    ] as const) {
      await expect(page.getByTestId(`sidebar-org-${section}`)).toBeVisible();
    }
    await expect(page.getByTestId("sidebar-org-members")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("org-section-members")).toBeVisible();
  });

  test("org key row opens details with analytics", async ({ page }) => {
    await apiLoginAs(page, "orgkeydet");
    const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
      data: { name: `KeyDet Org ${Date.now()}` },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = (await orgRes.json()) as { id: string; name: string };
    // Seed one org provider + model so the allowlist chip has live names.
    const provName = `KeyDetProv ${Date.now()}`;
    const provRes = await page.request.post(`${API}/api/v1/orgs/${org.id}/providers`, {
      data: { name: provName, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
    });
    expect(provRes.ok(), await provRes.text()).toBeTruthy();
    const provider = (await provRes.json()) as { id: string };
    const modelIdStr = `det-model-${Date.now()}`;
    const modelRes = await page.request.post(
      `${API}/api/v1/orgs/${org.id}/providers/${provider.id}/models`,
      {
        data: {
          model_id: modelIdStr,
          name: "Det Model",
          endpoint_type: "chat_completions",
          input_price: "1",
          output_price: "2",
        },
      },
    );
    expect(modelRes.ok(), await modelRes.text()).toBeTruthy();
    const model = (await modelRes.json()) as { id: string };
    const me = (await (await page.request.get(`${API}/auth/me`)).json()) as { id: string };
    const keyRes = await page.request.post(`${API}/api/v1/orgs/${org.id}/keys`, {
      data: {
        assignee_user_id: me.id,
        name: `det-key-${Date.now()}`,
        model_permissions: [{ provider_id: provider.id, model_id: model.id }],
      },
    });
    expect(keyRes.ok(), await keyRes.text()).toBeTruthy();
    const kid = ((await keyRes.json()) as { key: { id: string } }).key.id;

    // Enter org scope, then the unified keys page renders org data.
    await page.goto(`/organizations/${org.id}`);
    await expect(page.getByTestId("sidebar-org-nav")).toBeVisible({ timeout: 20000 });
    await page.goto("/api-keys");
    const row = page.getByTestId(`org-key-row-${kid}`);
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();
    await expect(page.getByTestId("org-key-details-panel")).toBeVisible({ timeout: 20000 });
    // Model allowlist renders `provider / model` names, never raw UUIDs.
    const chips = page.getByTestId(`org-key-models-${kid}`);
    await expect(chips).toBeVisible({ timeout: 20000 });
    await expect(chips).toContainText(`${provName} /`);
    await expect(chips).toContainText(modelIdStr);
    await expect(chips).not.toContainText(provider.id);
    await expect(chips).not.toContainText(model.id);
    await expect(page.getByTestId("org-key-tab-analytics")).toBeVisible();
    await expect(page.getByTestId("key-analytics")).toBeVisible({ timeout: 30000 });
  });

  test("org member drawer shows profile and assigned keys", async ({ page, playwright }) => {
    await apiLoginAs(page, "orgmember");
    const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
      data: { name: `Member Org ${Date.now()}` },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = (await orgRes.json()) as { id: string };
    // Second identity lives in an isolated API context (page.request stays the root).
    const invitee = await playwright.request.newContext();
    const inviteeEmail = `pw-e2e-member-${Date.now()}@tollma.ai`;
    const signup = await invitee.post(`${API}/auth/signup`, {
      data: { email: inviteeEmail, password: "Password123" },
    });
    expect(signup.ok(), await signup.text()).toBeTruthy();
    const vtoken = (await signup.json()).debug_verification_token as string | null;
    if (vtoken) await invitee.get(`${API}/auth/verify`, { params: { token: vtoken } });
    const inviteeMe = (await (await invitee.get(`${API}/auth/me`)).json()) as { id: string };
    const inv = await page.request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email: inviteeEmail, set_ids: [] },
    });
    expect(inv.ok(), await inv.text()).toBeTruthy();
    const invId = (await inv.json()).id as string;
    const mine = await invitee.get(`${API}/api/v1/orgs/invitations/mine`);
    expect(mine.ok(), await mine.text()).toBeTruthy();
    const item = (await mine.json()).find((i: { id: string }) => i.id === invId) as
      | { token: string }
      | undefined;
    expect(item, "invite visible in inbox").toBeTruthy();
    const acc = await invitee.post(
      `${API}/api/v1/orgs/invitations/by-token/${item!.token}/accept`,
      { data: {} },
    );
    expect(acc.ok(), await acc.text()).toBeTruthy();
    await invitee.dispose();
    // Org key assigned to the new member.
    const keyName = `member-key-${Date.now()}`;
    const keyRes = await page.request.post(`${API}/api/v1/orgs/${org.id}/keys`, {
      data: { assignee_user_id: inviteeMe.id, name: keyName },
    });
    expect(keyRes.ok(), await keyRes.text()).toBeTruthy();
    const kid = ((await keyRes.json()) as { key: { id: string } }).key.id;

    await page.goto(`/organizations/${org.id}?section=members`);
    await expect(page.getByTestId("org-section-members")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("org-members")).toBeVisible({ timeout: 20000 });
    await page.getByTestId(`org-view-${inviteeMe.id}`).click();
    const drawer = page.getByTestId("org-member-detail");
    await expect(drawer).toBeVisible({ timeout: 20000 });
    await expect(drawer).toContainText("Profile");
    await expect(drawer).toContainText("Assigned API keys");
    await expect(page.getByTestId("org-member-keys")).toBeVisible();
    const assigned = page.getByTestId(`org-member-key-${kid}`);
    await expect(assigned).toBeVisible();
    await expect(assigned).toContainText(keyName);
  });
});
