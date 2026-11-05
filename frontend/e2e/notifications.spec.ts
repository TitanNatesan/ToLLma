import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "./helpers";

/** Notifications page: bell entry, personal + org groups, mark-all-read. */
test.describe("notifications", () => {
  test.setTimeout(120000);
  test("bell opens notifications with personal and org groups; mark-all-read works", async ({
    page,
    playwright,
  }) => {
    await apiLoginAs(page, "notif");
    // Dedicated user owns an org (root), so the org group resolves its name.
    const orgRes = await page.request.post(`${API}/api/v1/orgs`, {
      data: { name: `Notif Org ${Date.now()}` },
    });
    expect(orgRes.ok(), await orgRes.text()).toBeTruthy();
    const org = (await orgRes.json()) as { id: string; name: string };

    // Seed one org-group notification: invite B in an isolated context, B accepts.
    const invitee = await playwright.request.newContext();
    const inviteeEmail = `pw-e2e-notif-${Date.now()}@tollma.ai`;
    const signup = await invitee.post(`${API}/auth/signup`, {
      data: { email: inviteeEmail, password: "Password123" },
    });
    expect(signup.ok()).toBeTruthy();
    const vtoken = (await signup.json()).debug_verification_token as string | null;
    if (vtoken) await invitee.get(`${API}/auth/verify`, { params: { token: vtoken } });
    const inv = await page.request.post(`${API}/api/v1/orgs/${org.id}/invitations`, {
      data: { email: inviteeEmail, set_ids: [] },
    });
    expect(inv.ok(), await inv.text()).toBeTruthy();
    const invId = ((await inv.json()) as { id: string }).id;
    const mine = await invitee.get(`${API}/api/v1/orgs/invitations/mine`);
    expect(mine.ok()).toBeTruthy();
    const item = ((await mine.json()) as { id: string; token: string }[]).find(
      (i) => i.id === invId,
    );
    expect(item).toBeTruthy();
    const acc = await invitee.post(
      `${API}/api/v1/orgs/invitations/by-token/${item!.token}/accept`,
      { data: {} },
    );
    expect(acc.ok(), await acc.text()).toBeTruthy();
    await invitee.dispose();

    await page.goto("/");
    await expect(page.getByTestId("left-sidebar")).toBeVisible({ timeout: 20000 });
    // Bell lives in the SidebarHeader: accessible name always starts with Notifications.
    await page.getByTestId("left-sidebar").getByRole("button", { name: /Notifications/ }).click();
    await expect(page).toHaveURL(/\/notifications/, { timeout: 20000 });

    const notifPage = page.getByTestId("notifications-page");
    await expect(notifPage).toBeVisible({ timeout: 20000 });
    // Personal group always renders (empty state here); the seeded org group shows the org name.
    await expect(page.getByTestId("notifications-empty-personal")).toBeVisible();
    await expect(notifPage.getByRole("heading", { name: org.name })).toBeVisible();
    await expect(notifPage.getByText("joined")).toBeVisible();
    await expect(page.getByTestId("notifications-unread-badge")).toBeVisible();

    await page.getByTestId("notifications-mark-all-read").click();
    await expect(page.getByTestId("notifications-unread-badge")).toHaveCount(0, {
      timeout: 20000,
    });
    await expect(page.getByTestId("notifications-mark-all-read")).toBeDisabled();
  });
});
