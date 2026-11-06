// Agent H audit: API security headers live + SSRF gate live (422s, mock 201).
import { expect, test } from "@playwright/test";
import { API, apiLoginAs } from "../helpers";

test("api responses carry hardening headers", async ({ page }) => {
  await apiLoginAs(page, "audit-headers");
  const r = await page.request.get(`${API}/api/v1/legal/documents`);
  expect(r.status()).toBe(200);
  const h = r.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["permissions-policy"]).toContain("microphone");
  expect(h["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
});

test("ssrf-blocked base urls rejected, public host accepted (prod dns pinned)", async ({ page }) => {
  await apiLoginAs(page, "audit-ssrf");
  const bad = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8000/x",
    "file:///etc/passwd",
    "gopher://evil.example/x",
    "http://user:pass@example.com/",
    "http://printer.local/",
  ];
  for (const base_url of bad) {
    const r = await page.request.post(`${API}/api/v1/providers`, {
      data: { name: `ssrf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, provider_type: "CUSTOM", credentials: { base_url } },
    });
    expect(r.status(), base_url).toBe(422);
  }
  // Prod path enforces DNS: unresolvable mock-style hosts are refused live
  // (they pass only under pytest mock transports — covered by backend tests).
  const mock = await page.request.post(`${API}/api/v1/providers`, {
    data: { name: `ssrf-mock-${Date.now()}`, provider_type: "CUSTOM", credentials: { base_url: "http://mock" } },
  });
  expect(mock.status()).toBe(422);
  // A legitimate public host passes the gate and persists.
  const ok = await page.request.post(`${API}/api/v1/providers`, {
    data: { name: `ssrf-ok-${Date.now()}`, provider_type: "CUSTOM", credentials: { base_url: "https://api.openai.com/v1" } },
  });
  expect(ok.status()).toBe(201);
});
