import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAuthAndCredentialCache, useAuthStore } from "@/store/auth";

describe("auth store and cache cleanup", () => {
  const store: Record<string, string> = {};

  const mockLocalStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) {
        delete store[k];
      }
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };

  beforeEach(() => {
    mockLocalStorage.clear();
    vi.stubGlobal("window", {});
    vi.stubGlobal("localStorage", mockLocalStorage);
    vi.stubGlobal("document", { cookie: "" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears auth tokens and provider credentials while preserving theme", () => {
    mockLocalStorage.setItem("tollma_access_token", "secret-token");
    mockLocalStorage.setItem("tollma-wizard-draft", JSON.stringify({ creds: { api_key: "key-123" } }));
    mockLocalStorage.setItem("tollma_provider_draft", "some-provider-info");
    mockLocalStorage.setItem("theme", "dark");

    clearAuthAndCredentialCache();

    expect(mockLocalStorage.getItem("tollma_access_token")).toBeNull();
    expect(mockLocalStorage.getItem("tollma-wizard-draft")).toBeNull();
    expect(mockLocalStorage.getItem("tollma_provider_draft")).toBeNull();
    expect(mockLocalStorage.getItem("theme")).toBe("dark");
  });

  it("reset() wipes credentials, tokens, and resets auth state", () => {
    mockLocalStorage.setItem("tollma_access_token", "old-token");
    mockLocalStorage.setItem("tollma-wizard-draft", "creds");
    useAuthStore.setState({ user: { id: "1", email: "u@test.com" } as any, accessToken: "old-token", checked: true });

    useAuthStore.getState().reset();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(mockLocalStorage.getItem("tollma_access_token")).toBeNull();
    expect(mockLocalStorage.getItem("tollma-wizard-draft")).toBeNull();
  });
});
