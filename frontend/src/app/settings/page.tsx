"use client";

import { useEffect } from "react";
import { PageContainer, PageHeader } from "@/components/ui";
import {
  SETTINGS_SECTION_IDS,
} from "@/components/Sidebar/SidebarSettings";
import { useHashSection } from "@/hooks/useHashSection";
import { SettingsCard } from "./components/SettingsCard";
import { AppearanceSection } from "./components/AppearanceSection";
import { ChatPreferencesSection } from "./components/ChatPreferencesSection";
import { ProfileSection } from "./components/ProfileSection";
import { AccountSecuritySection } from "./components/AccountSecuritySection";
import { DangerZoneSection } from "./components/DangerZoneSection";
import { SessionsSection } from "./components/SessionsSection";
import { ProvidersSection } from "./components/ProvidersSection";
import { WorkspaceLoggingSection } from "@/components/logging/WorkspaceLoggingSection";
import { OrganizationsSection } from "./components/OrganizationsSection";

/** Settings: profile, appearance (accent system), chat prefs, password, sessions. */
export default function SettingsPage() {
  // The URL hash is the single source of truth for the highlighted section.
  // Deep links (`/settings#appearance`) and sidebar clicks both drive it.
  const activeId = useHashSection(SETTINGS_SECTION_IDS, "profile");

  // Deep links and hash changes scroll the card into view inside the
  // scrollable main container (scroll-margin on the cards clears the header).
  useEffect(() => {
    document.getElementById(activeId)?.scrollIntoView({ block: "start" });
  }, [activeId]);

  return (
    <PageContainer
      header={<PageHeader title="Settings" subtitle="Account, appearance, chat behavior, providers, and organizations." />}
      testId="settings-page"
    >
          <SettingsCard
            id="profile"
            active={activeId === "profile"}
            title="Profile"
            description="How you appear across ToLLma."
            testId="settings-section-profile"
          >
            <ProfileSection />
          </SettingsCard>

          <SettingsCard
            id="appearance"
            active={activeId === "appearance"}
            title="Appearance"
            description="Theme and accent color — applied instantly, everywhere."
            testId="settings-section-appearance"
          >
            <AppearanceSection />
          </SettingsCard>

          <SettingsCard
            id="chat"
            active={activeId === "chat"}
            title="Chat preferences"
            description="Composer behavior, reasoning defaults and streaming."
            testId="settings-section-chat"
          >
            <ChatPreferencesSection />
          </SettingsCard>

          <SettingsCard
            id="account"
            active={activeId === "account"}
            title="Account & security"
            description="Sign-in method and password management."
            testId="settings-section-account"
          >
            <AccountSecuritySection />
          </SettingsCard>

          <SettingsCard
            id="sessions"
            active={activeId === "sessions"}
            title="Login & sessions"
            description="Every device currently signed in to your account."
            testId="settings-section-sessions"
          >
            <SessionsSection />
          </SettingsCard>

          <SettingsCard
            id="providers"
            active={activeId === "providers"}
            title="Providers"
            description="Model providers connected to this workspace."
            testId="settings-section-providers"
          >
            <ProvidersSection />
          </SettingsCard>

          <SettingsCard
            id="logging"
            active={activeId === "logging"}
            title="Prompt logging"
            description="Which requests keep message bodies. Global toggle, effective state, and full controls."
            testId="settings-section-logging"
          >
            <WorkspaceLoggingSection canManage />
          </SettingsCard>

          <SettingsCard
            id="organizations"
            active={activeId === "organizations"}
            title="Organizations"
            description="Workspaces you belong to. Create, join, or switch."
            testId="settings-section-organizations"
          >
            <OrganizationsSection />
          </SettingsCard>

          <SettingsCard
            id="danger-zone"
            active={activeId === "danger-zone"}
            title="Danger zone"
            description="Irreversible account actions."
            testId="danger-zone-section"
            className="border-red-200 dark:border-red-950"
          >
            <DangerZoneSection />
          </SettingsCard>
    </PageContainer>
  );
}
