// Model Intelligence Repository: read APIs are wired and shaped correctly.
import { expect, test } from "@playwright/test";
import { API } from "./helpers";

test("repository stats shape", async ({ request }) => {
  const stats = await (await request.get(`${API}/api/v1/model-repository/stats`)).json();
  expect(stats.total_models).toBeGreaterThan(0);
  expect(stats.active_models).toBeGreaterThan(0);
  expect(typeof stats.providers_count).toBe("number");
  expect(stats.last_sync.status).toBe("done");
});

test("repository search, filter, pagination", async ({ request }) => {
  const search = await (
    await request.get(`${API}/api/v1/model-repository/models`, { params: { search: "claude", page_size: 5 } })
  ).json();
  expect(search.total).toBeGreaterThan(0);
  expect(search.items.length).toBeLessThanOrEqual(5);

  const filtered = await (
    await request.get(`${API}/api/v1/model-repository/models`, { params: { capability: "supports_vision_input" } })
  ).json();
  expect(filtered.total).toBeGreaterThan(0);
  expect(filtered.items[0].supports_vision_input).toBe(true);

  const bad = await request.get(`${API}/api/v1/model-repository/models`, { params: { capability: "nope" } });
  expect(bad.status()).toBe(422);

  const detail = await (await request.get(`${API}/api/v1/model-repository/models/${search.items[0].id}`)).json();
  expect(detail.raw_source_payload).toBeDefined();
  expect(Object.keys(detail.raw_source_payload).length).toBeGreaterThan(0);
});

test("repository sync history shape", async ({ request }) => {
  const history = await (await request.get(`${API}/api/v1/model-repository/sync-history`)).json();
  expect(history.length).toBeGreaterThan(0);
  // Latest run may be an idempotent re-sync (0 created); assert it ran clean.
  expect(history[0].status).toBe("done");
  expect(history[0].errors_count).toBe(0);
  expect(history.some((r: { models_created: number }) => r.models_created > 0)).toBe(true);
});
