import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptLegalDocument,
  listReacceptRequired,
  setConsent,
  submitDSR,
} from "@/services/trust";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonMock(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("trust service", () => {
  it("posts the F2 acceptance shape (slug only, method is server-set)", async () => {
    const fetchMock = jsonMock({ id: "a1", document_slug: "privacy-notice" });
    vi.stubGlobal("fetch", fetchMock);
    await acceptLegalDocument({ slug: "privacy-notice" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/legal/acceptances"),
      expect.objectContaining({ method: "POST", body: JSON.stringify({ slug: "privacy-notice" }) }),
    );
  });

  it("returns null when reaccept-required fails (backend 500 tolerated)", async () => {
    vi.stubGlobal("fetch", jsonMock({ error: "boom" }, 500));
    await expect(listReacceptRequired()).resolves.toBeNull();
  });

  it("puts consent grants with the settings_ui source", async () => {
    const fetchMock = jsonMock({ category: "analytics", status: "granted" });
    vi.stubGlobal("fetch", fetchMock);
    await setConsent("analytics", true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toMatchObject({ category: "analytics", granted: true });
  });

  it("posts DSR submits with type and detail", async () => {
    const fetchMock = jsonMock({ id: "d1", type: "access", status: "submitted" });
    vi.stubGlobal("fetch", fetchMock);
    await submitDSR("access", "copy please");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ type: "access", detail: "copy please" });
  });
});
