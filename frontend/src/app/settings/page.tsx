"use client";

import { PageHeader } from "@/components/ui";
import { SettingsCard } from "./components/SettingsCard";
import { AppearanceSection } from "./components/AppearanceSection";
import { ChatPreferencesSection } from "./components/ChatPreferencesSection";
import { ProfileSection } from "./components/ProfileSection";
import { PasswordSection } from "./components/PasswordSection";
import { SessionsSection } from "./components/SessionsSection";
import { ProvidersSection } from "./components/ProvidersSection";

/** Settings: profile, appearance (accent system), chat prefs, password, sessions. */
export default function SettingsPage() {
  return (
    <main
      className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white px-4 py-4 dark:bg-zinc-950"
      data-testid="settings-page"
    >
      <PageHeader title="Settings" subtitle="Account, appearance, chat behavior and sessions." />

      <div className="mt-4 flex min-w-0 flex-1 flex-col gap-4 pb-10">
          <SettingsCard
            id="profile"
            title="Profile"
            description="How you appear across ToLLma."
            testId="settings-section-profile"
          >
            <ProfileSection />
          </SettingsCard>

          <SettingsCard
            id="appearance"
            title="Appearance"
            description="Theme and accent color — applied instantly, everywhere."
            testId="settings-section-appearance"
          >
            <AppearanceSection />
          </SettingsCard>

          <SettingsCard
            id="chat"
            title="Chat preferences"
            description="Composer behavior, reasoning defaults and streaming."
            testId="settings-section-chat"
          >
            <ChatPreferencesSection />
          </SettingsCard>

          <SettingsCard
            id="account"
            title="Account & security"
            description="Password management."
            testId="settings-section-account"
          >
            <PasswordSection />
          </SettingsCard>

          <SettingsCard
            id="sessions"
            title="Login & sessions"
            description="Every device currently signed in to your account."
            testId="settings-section-sessions"
          >
            <SessionsSection />
          </SettingsCard>

          <SettingsCard
            id="providers"
            title="Providers"
            description="Model providers connected to this workspace."
            testId="settings-section-providers"
          >
            <ProvidersSection />
          </SettingsCard>
        </div>
    </main>
  );
}
