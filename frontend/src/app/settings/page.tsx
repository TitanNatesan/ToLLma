"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageContainer, PageHeader } from "@/components/ui";
import {
  SETTINGS_SECTION_IDS,
} from "@/components/Sidebar/SidebarSettings";
import { useHashSection } from "@/hooks/useHashSection";
import { SettingsCard } from "./components/SettingsCard";
import { AgeConfirmBanner } from "./components/AgeConfirmBanner";
import { PrivacyConsentsSection } from "./components/PrivacyConsentsSection";
import { RetentionSection } from "./components/RetentionSection";
import { CookiesSection } from "./components/CookiesSection";
import { DataRightsSection } from "./components/DataRightsSection";
import { ChatPreferencesSection } from "./components/ChatPreferencesSection";
import { ProfileSection } from "./components/ProfileSection";
import { AccountSecuritySection } from "./components/AccountSecuritySection";
import { DangerZoneSection } from "./components/DangerZoneSection";
import { SessionsSection } from "./components/SessionsSection";
import { PromptLogsSettings } from "@/app/prompt-logs/components/PromptLogsSettings";
import { OrganizationsSection } from "./components/OrganizationsSection";

/** Settings: profile, appearance, chat prefs, password, sessions. Content order
 *  follows SETTINGS_SECTIONS in SidebarSettings (providers removed). */
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
      header={<PageHeader title="Settings" subtitle="Account, appearance, chat behavior, and organizations." />}
      testId="settings-page"
    >
          <AgeConfirmBanner />

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
            id="logging"
            active={activeId === "logging"}
            title="Prompt logging"
            description="Which requests keep message bodies. Global toggle, effective state, and full controls."
            testId="settings-section-logging"
          >
            <PromptLogsSettings isOrg={false} canManage />
            <p className="px-4 pb-4 text-[11px] text-zinc-400">
              <Link href="/prompt-logs" data-testid="settings-logging-open" className="font-medium text-tollma-600 hover:underline dark:text-tollma-400">
                Open Prompt Logs exploration
              </Link>{" "}to browse and filter recorded requests.
            </p>
          </SettingsCard>

          <SettingsCard
            id="privacy"
            active={activeId === "privacy"}
            title="Privacy"
            description="Consent preferences per category. Functional is always on."
            testId="settings-section-privacy"
          >
            <PrivacyConsentsSection />
          </SettingsCard>

          <SettingsCard
            id="retention"
            active={activeId === "retention"}
            title="Data retention"
            description="How long your data is kept, per category. Blank uses the platform default."
            testId="settings-section-retention"
          >
            <RetentionSection />
          </SettingsCard>

          <SettingsCard
            id="cookies"
            active={activeId === "cookies"}
            title="Cookies"
            description="Device-local cookie preferences."
            testId="settings-section-cookies"
          >
            <CookiesSection />
          </SettingsCard>

          <SettingsCard
            id="data-rights"
            active={activeId === "data-rights"}
            title="Your data"
            description="Export a copy, submit data requests, or head to deletion."
            testId="settings-section-data-rights"
          >
            <DataRightsSection />
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
