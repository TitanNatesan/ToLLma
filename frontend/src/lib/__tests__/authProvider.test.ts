import { describe, expect, it } from "vitest";
import { accountSecurityMode, authProviderLabel, canManagePassword } from "../authProvider";

describe("accountSecurityMode", () => {
  it("gives local accounts password management", () => {
    expect(accountSecurityMode("local")).toBe("password");
    expect(canManagePassword("local", true)).toBe(true);
  });

  it("gives Google accounts provider information instead", () => {
    expect(accountSecurityMode("google")).toBe("provider");
    expect(canManagePassword("google", false)).toBe(false);
    expect(canManagePassword("google", true)).toBe(false);
  });

  it("defaults to password mode when the provider is unknown", () => {
    expect(accountSecurityMode(undefined)).toBe("password");
    expect(accountSecurityMode(null)).toBe("password");
  });
});

describe("authProviderLabel", () => {
  it("labels both providers for the sessions list", () => {
    expect(authProviderLabel("google")).toBe("Google OAuth");
    expect(authProviderLabel("local")).toBe("Email & Password");
    expect(authProviderLabel(null)).toBe("Email & Password");
  });
});
