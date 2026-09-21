"use client";

import { accountSecurityMode } from "@/lib/authProvider";
import { useAuthStore } from "@/store/auth";
import { PasswordSection } from "./PasswordSection";
import { ProviderAuthSection } from "./ProviderAuthSection";

/**
 * Provider-aware account security: local accounts manage a password, OAuth
 * accounts see their provider instead (they have no local password).
 */
export function AccountSecuritySection() {
  const user = useAuthStore((state) => state.user);
  if (accountSecurityMode(user?.provider) === "provider") {
    return <ProviderAuthSection />;
  }
  return <PasswordSection />;
}
