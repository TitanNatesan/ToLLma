"use client";

import { useState } from "react";
import { AlertTriangle, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, SettingItem } from "@/components/ui";
import { useUpdateProfile } from "@/hooks/useSettings";
import { useAuthStore } from "@/store/auth";
import type { User } from "@/types";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Profile: name, username, email, avatar URL. Email changes re-verify. */
export function ProfileSection() {
  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();
  const [draft, setDraft] = useState(() => profileDraft(user));
  const [error, setError] = useState<string | null>(null);
  const [syncedUser, setSyncedUser] = useState(user);

  // Server truth changed (save succeeded): adopt it during render, not in an
  // effect — the documented derive-state-from-props pattern.
  if (user && user !== syncedUser) {
    setSyncedUser(user);
    setDraft(profileDraft(user));
  }

  if (!user) return null;

  const { fullName, username, email, avatarUrl } = draft;
  const set = (patch: Partial<typeof draft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const initial = (user.full_name?.trim()?.[0] ?? user.email[0] ?? "?").toUpperCase();
  const usernameValid = username === "" || USERNAME_RE.test(username);
  const emailValid = EMAIL_RE.test(email);
  const avatarValid = avatarUrl === "" || avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://");
  const dirty =
    fullName !== (user.full_name ?? "") ||
    username !== (user.username ?? "") ||
    email !== user.email ||
    avatarUrl !== (user.avatar_url ?? "");
  const valid = usernameValid && emailValid && avatarValid;

  function save() {
    if (!user) return;
    setError(null);
    if (!valid) {
      setError(
        !usernameValid
          ? "Username must be 3–30 characters (letters, numbers, _ - .)."
          : !emailValid
            ? "Enter a valid email address."
            : "Avatar must be an http(s) URL.",
      );
      return;
    }
    update.mutate(
      {
        full_name: fullName.trim() || null,
        username: username.trim().toLowerCase() || null,
        ...(email !== user.email ? { email } : {}),
        avatar_url: avatarUrl.trim() || null,
      },
      {
        onSuccess: () => toast.success("Profile updated"),
        onError: (e) => {
          setError(e.message.includes("409") ? "That email or username is already in use." : e.message);
          toast.error("Could not update profile");
        },
      },
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-4" data-testid="profile-summary">
        {avatarValid && avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="size-14 rounded-full border border-zinc-200 object-cover dark:border-zinc-800"
            data-testid="profile-avatar"
          />
        ) : (
          <span className="flex size-14 items-center justify-center rounded-full bg-zinc-100 text-lg font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
            {initial}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {user.full_name?.trim() || "Unnamed user"}
          </p>
          <p className="flex items-center gap-1.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            <Mail className="size-3" />
            {user.email}
            {!user.email_verified && (
              <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400" data-testid="profile-unverified">
                <AlertTriangle className="size-3" /> unverified
              </span>
            )}
          </p>
        </div>
      </div>

      <SettingItem label="Name" description="Shown in the sidebar and messages.">
        <Input
          value={fullName}
          onChange={(e) => set({ fullName: e.target.value })}
          maxLength={255}
          placeholder="Ada Lovelace"
          aria-label="Full name"
          data-testid="profile-name"
          className="h-8 w-64 text-xs"
        />
      </SettingItem>

      <SettingItem label="Username" description="3–30 characters: letters, numbers, _ - .">
        <Input
          value={username}
          onChange={(e) => set({ username: e.target.value })}
          maxLength={30}
          placeholder="ada_lovelace"
          aria-label="Username"
          data-testid="profile-username"
          className="h-8 w-64 font-mono text-xs"
          spellCheck={false}
        />
      </SettingItem>

      <SettingItem label="Email" description="Changing it deactivates verification until you confirm the new address.">
        <Input
          type="email"
          value={email}
          onChange={(e) => set({ email: e.target.value })}
          aria-label="Email"
          data-testid="profile-email"
          className="h-8 w-64 text-xs"
          spellCheck={false}
        />
      </SettingItem>

      <SettingItem label="Profile picture URL" description="Any public https image URL.">
        <Input
          value={avatarUrl}
          onChange={(e) => set({ avatarUrl: e.target.value })}
          placeholder="https://…"
          aria-label="Avatar URL"
          data-testid="profile-avatar-url"
          className="h-8 w-64 text-xs"
          spellCheck={false}
        />
      </SettingItem>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <UserRound className="size-3" />
          {dirty ? "Unsaved changes" : "Profile is up to date"}
        </p>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-[11px] text-red-500" data-testid="profile-error">
              {error}
            </span>
          )}
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || !valid || update.isPending}
            data-testid="profile-save"
            className="text-xs"
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </>
  );
}

interface ProfileDraft {
  fullName: string;
  username: string;
  email: string;
  avatarUrl: string;
}

function profileDraft(user: User | null): ProfileDraft {
  return {
    fullName: user?.full_name ?? "",
    username: user?.username ?? "",
    email: user?.email ?? "",
    avatarUrl: user?.avatar_url ?? "",
  };
}
