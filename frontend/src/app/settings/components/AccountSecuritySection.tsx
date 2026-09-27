"use client";

import { accountSecurityMode } from "@/lib/authProvider";
import { useAuthStore } from "@/store/auth";
import { CreatePasswordSection } from "./CreatePasswordSection";
import { PasswordSection } from "./PasswordSection";
import { ProviderAuthSection } from "./ProviderAuthSection";

/**
 * Provider- and password-aware account security:
 * - has_password unknown (older /auth/me): hide both password variants (safe default).
 * - Google accounts always keep their provider card; the password form below it is
 *   "create" when no local password exists yet, "change" once one does.
 * - Local accounts manage their password as before.
 */
export function AccountSecuritySection() {
  const user = useAuthStore((state) => state.user);
  if (user?.has_password === undefined) return null;
  const isProvider = accountSecurityMode(user?.provider) === "provider";
  if (!user.has_password) {
    return (
      <>
        {isProvider && <ProviderAuthSection hasPassword={false} />}
        <CreatePasswordSection />
      </>
    );
  }
  return (
    <>
      {isProvider && <ProviderAuthSection hasPassword />}
      <PasswordSection />
    </>
  );
}
