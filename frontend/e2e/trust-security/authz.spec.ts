// Agent H audit: non-admin API authZ (403s) + admin gating. Live dev backend.
import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "../helpers";

test("non-admin denied on security audit, governance writes, admin compliance", async ({ page }) => {
  await apiLoginAs(page, "audit-authz");
  const checks: Array<[string, string, object?]> = [
    ["GET", `${API}/api/v1/security/audit`],
    ["POST", `${API}/api/v1/governance/provider-policies`, { data: { provider_key: "k", display_name: "K", scope: "global" } }],
    ["GET", `${API}/api/admin/compliance/incidents`],
    ["POST", `${API}/api/admin/compliance/subprocessors`, { data: { name: "X" } }],
    ["GET", `${API}/api/admin/compliance/subprocessors`],
  ];
  for (const [method, url, opts] of checks) {
    const r = await page.request.fetch(url, { method, ...(opts ?? {}) });
    expect(r.status(), `${method} ${url}`).toBe(403);
  }
});

test("abuse-report status transitions are admin-only", async ({ page }) => {
  await apiLoginAs(page, "audit-abuse");
  const rep = await page.request.post(`${API}/api/v1/governance/abuse-reports`, {
    data: { reason_code: "policy_violation", details: "audit probe report body" },
  });
  expect(rep.ok()).toBeTruthy();
  const id = (await rep.json()).id as string;
  const patch = await page.request.patch(`${API}/api/v1/governance/abuse-reports/${id}/status`, {
    data: { status: "under_review" },
  });
  expect(patch.status()).toBe(403);
});

test("admin compliance UI stays forbidden for non-admins", async ({ page }) => {
  await apiLoginAs(page, "audit-admingate");
  await page.goto("/admin#incidents");
  await expect(page.getByTestId("admin-forbidden")).toBeVisible({ timeout: 20000 });
});
