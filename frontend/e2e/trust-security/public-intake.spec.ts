// Agent H audit: public intake + public subprocessor feed need no login.
import { expect, test } from "@playwright/test";
import { API } from "../helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("unauthenticated vuln intake accepted without PII echo", async ({ request }) => {
  const tag = Date.now().toString(36);
  const r = await request.post(`${API}/api/v1/incidents/reports/vulnerability`, {
    data: {
      title: `audit probe ${tag}`,
      details: "probe details with enough length for validation",
      reporter_contact: "audit@tollma.ai",
    },
  });
  expect(r.status()).toBe(201);
  expect(Object.keys(await r.json()).sort()).toEqual(["id", "received_at", "status"]);
});

test("public subprocessor list exposes only the F10 shape", async ({ request }) => {
  const r = await request.get(`${API}/api/v1/subprocessors`);
  expect(r.status()).toBe(200);
  const items = (await r.json()) as Array<Record<string, unknown>>;
  expect(Array.isArray(items)).toBeTruthy();
  for (const item of items) {
    expect(Object.keys(item).sort()).toEqual(["location", "name", "purpose", "status"]);
  }
});

test("public legal documents readable without login", async ({ request }) => {
  const r = await request.get(`${API}/api/v1/legal/documents`);
  expect(r.status()).toBe(200);
  expect(Array.isArray(await r.json())).toBeTruthy();
});
