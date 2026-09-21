/** Provider-aware auth surface decisions (pure, unit-testable). */

export type AuthProviderKind = "local" | "google";
export type AccountSecurityMode = "password" | "provider";

/**
 * Which account-security surface an account gets:
 * - "password": email + password accounts manage their local password.
 * - "provider": OAuth accounts have no local password, so they see provider info.
 */
export function accountSecurityMode(provider?: string | null): AccountSecurityMode {
  return provider === "google" ? "provider" : "password";
}

export function authProviderKind(provider?: string | null): AuthProviderKind {
  return provider === "google" ? "google" : "local";
}

/** Human label used in the sessions list and provider card. */
export function authProviderLabel(provider?: string | null): string {
  return authProviderKind(provider) === "google" ? "Google OAuth" : "Email & Password";
}

/** Local password management is only meaningful for local accounts. */
export function canManagePassword(provider?: string | null, hasPassword?: boolean): boolean {
  return authProviderKind(provider) === "local" && hasPassword !== false;
}
