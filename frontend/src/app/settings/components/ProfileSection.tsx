"use client";

import { useState } from "react";
import { AlertTriangle, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, SettingItem } from "@/components/ui";
import { useUpdateProfile } from "@/hooks/useSettings";
import { ApiError, googleLoginUrl } from "@/services/api";
import { parseApiError } from "@/lib/errors";
import { useAuthStore } from "@/store/auth";
import type { User } from "@/types";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Phase 6 email-change copy: inline confirmation + failure hints. */
const EMAIL_PASSWORD_REQUIRED = "Enter your current password to confirm the email change.";
const EMAIL_PASSWORD_MISSING = "Current password is required to change your email.";
const EMAIL_PASSWORD_WRONG = "Incorrect current password. Check it and try again.";
const GOOGLE_FRESH_SIGNIN_HINT =
  "Changing your email requires a recent Google sign-in. If asked, sign in with Google again, then retry.";
const GOOGLE_REAUTH_HINT = "Sign in with Google again, then retry.";

/** Profile: name, username, email, avatar URL. Email changes re-verify. */
export function ProfileSection() {
  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();
  const [draft, setDraft] = useState(() => profileDraft(user));
  const [error, setError] = useState<string | null>(null);
  const [syncedUser, setSyncedUser] = useState(user);
  // Phase 6: email-change confirmation. Never prefilled, cleared on adopt.
  const [currentPassword, setCurrentPassword] = useState("");
  // Phase 6: email-path failure (401/422/403/409) — kept apart from profile-error.
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null);
  const [emailChangeForbidden, setEmailChangeForbidden] = useState(false);
  // Phase 6: last requested change (new + old addresses) for the confirmation.
  const [emailChangeInfo, setEmailChangeInfo] = useState<{
    newEmail: string;
    oldEmail: string;
  } | null>(null);

  // Server truth changed (save succeeded): adopt it during render, not in an
  // effect — the documented derive-state-from-props pattern.
  if (user && user !== syncedUser) {
    setSyncedUser(user);
    setDraft(profileDraft(user));
    setCurrentPassword("");
    // Pending cleared (verified or superseded): drop the stale confirmation.
    if (!user.pending_email && emailChangeInfo) setEmailChangeInfo(null);
  }

  if (!user) return null;

  const { fullName, username, email, avatarUrl } = draft;
  const set = (patch: Partial<typeof draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const clearEmailChangeError = () => {
    setEmailChangeError(null);
    setEmailChangeForbidden(false);
  };

  const initial = (user.full_name?.trim()?.[0] ?? user.email[0] ?? "?").toUpperCase();
  const usernameValid = username === "" || USERNAME_RE.test(username);
  const emailValid = EMAIL_RE.test(email);
  const avatarValid = avatarUrl === "" || avatarUrl.startsWith("http://") || avatarUrl.startsWith("https://");
  const emailChanged = email !== user.email;
  const hasPassword = user.has_password === true;
  // Phase 6: password holders confirm with their current password; everyone
  // else (passwordless, or unknown when older /auth/me omits the flag) gets
  // the fresh-Google-sign-in hint instead — never a password prompt.
  const showPasswordConfirm = emailChanged && hasPassword;
  const showGoogleHint = emailChanged && !hasPassword;
  // Phase 6: tolerate older /auth/me without the field — unknown hides pending UI.
  const pendingEmail = user.pending_email ?? null;
  const showConfirmation = emailChangeInfo !== null || pendingEmail !== null;
  const confirmationNew = emailChangeInfo?.newEmail ?? pendingEmail ?? "";
  const confirmationOld = emailChangeInfo?.oldEmail ?? user.email;
  const dirty =
    fullName !== (user.full_name ?? "") ||
    username !== (user.username ?? "") ||
    email !== user.email ||
    avatarUrl !== (user.avatar_url ?? "");
  const valid = usernameValid && emailValid && avatarValid;

  function save() {
    if (!user) return;
    setError(null);
    clearEmailChangeError();
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
    // Phase 6: local-with-password changers must confirm; the backend 422s
    // without it, so short-circuit with the same inline copy.
    if (showPasswordConfirm && currentPassword === "") {
      setEmailChangeError(EMAIL_PASSWORD_MISSING);
      return;
    }
    const requestedEmail = email;
    const oldEmail = user.email;
    update.mutate(
      {
        full_name: fullName.trim() || null,
        username: username.trim().toLowerCase() || null,
        ...(emailChanged
          ? { email, ...(hasPassword ? { current_password: currentPassword } : {}) }
          : {}),
        avatar_url: avatarUrl.trim() || null,
      },
      {
        onSuccess: () => {
          // Phase 6: the address does NOT flip until the new inbox confirms.
          if (emailChanged) {
            setEmailChangeInfo({ newEmail: requestedEmail, oldEmail });
            setCurrentPassword("");
            toast.success(`Verification sent to ${requestedEmail}`);
          } else {
            toast.success("Profile updated");
          }
        },
        onError: (e) => {
          if (!emailChanged) {
            setError(e.message.includes("409") ? "That email or username is already in use." : e.message);
            toast.error("Could not update profile");
            return;
          }
          const status = e instanceof ApiError ? e.status : null;
          if (status === 401) {
            setEmailChangeError(EMAIL_PASSWORD_WRONG);
          } else if (status === 422) {
            setEmailChangeError(EMAIL_PASSWORD_MISSING);
          } else if (status === 403) {
            // Passwordless changers need a fresh Google sign-in: surface the
            // server message verbatim alongside the re-auth hint.
            const data = e instanceof ApiError ? (e.data as { error?: { message?: unknown } }) : null;
            const serverMessage =
              typeof data?.error?.message === "string" && data.error.message
                ? data.error.message
                : parseApiError(e).message;
            setEmailChangeError(`${serverMessage} ${GOOGLE_REAUTH_HINT}`);
            setEmailChangeForbidden(true);
          } else if (status === 409 || e.message.includes("409")) {
            setEmailChangeError("That email or username is already in use.");
          } else {
            setEmailChangeError(parseApiError(e).message);
          }
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
          className="h-8 w-full sm:w-64 text-xs"
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
          className="h-8 w-full sm:w-64 font-mono text-xs"
          spellCheck={false}
        />
      </SettingItem>

      <SettingItem label="Email" description="Changing it deactivates verification until you confirm the new address.">
        <div className="flex flex-col items-end gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => {
              set({ email: e.target.value });
              clearEmailChangeError();
            }}
            aria-label="Email"
            data-testid="profile-email"
            className="h-8 w-full sm:w-64 text-xs"
            spellCheck={false}
          />
          {showPasswordConfirm && (
            <div className="flex flex-col items-end gap-1">
              <Input
                id="email-change-password"
                type="password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  clearEmailChangeError();
                }}
                placeholder="Current password"
                aria-label="Current password"
                autoComplete="current-password"
                data-testid="email-change-password"
                className="h-8 w-full sm:w-64 text-xs"
                spellCheck={false}
              />
              <p
                className="max-w-full sm:max-w-64 text-right text-[11px] text-zinc-500 dark:text-zinc-400"
                data-testid="email-change-password-hint"
              >
                {EMAIL_PASSWORD_REQUIRED}
              </p>
            </div>
          )}
          {showGoogleHint && (
            <div className="flex max-w-full sm:max-w-64 flex-col items-end gap-1">
              <p
                className="text-right text-[11px] text-zinc-500 dark:text-zinc-400"
                data-testid="email-change-google-hint"
              >
                {GOOGLE_FRESH_SIGNIN_HINT}
              </p>
              <button
                type="button"
                data-testid="email-change-google-reauth"
                onClick={() => {
                  window.location.href = googleLoginUrl();
                }}
                className="text-[11px] font-medium text-zinc-700 underline underline-offset-2 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
              >
                Sign in with Google again
              </button>
            </div>
          )}
        </div>
      </SettingItem>

      {showConfirmation && (
        <div
          role="status"
          data-testid="email-change-confirmation"
          className="mt-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100"
        >
          <p>
            Verification email sent to <span className="font-medium">{confirmationNew}</span> — check your
            inbox to confirm. A notice was also sent to your old address ({confirmationOld}).
          </p>
          {pendingEmail && (
            <p className="mt-1 font-medium text-amber-700 dark:text-amber-300" data-testid="email-change-pending">
              Pending verification for {pendingEmail}…
            </p>
          )}
        </div>
      )}

      <SettingItem label="Profile picture URL" description="Any public https image URL.">
        <Input
          value={avatarUrl}
          onChange={(e) => set({ avatarUrl: e.target.value })}
          placeholder="https://…"
          aria-label="Avatar URL"
          data-testid="profile-avatar-url"
          className="h-8 w-full sm:w-64 text-xs"
          spellCheck={false}
        />
      </SettingItem>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <UserRound className="size-3" />
          {dirty ? "Unsaved changes" : "Profile is up to date"}
        </p>
        <div className="flex items-center gap-2">
          {emailChangeError ? (
            <span className="text-right text-[11px] text-red-500 dark:text-red-400" data-testid="email-change-error">
              {emailChangeError}
              {emailChangeForbidden && (
                <>
                  {" "}
                  <button
                    type="button"
                    data-testid="email-change-forbidden-reauth"
                    onClick={() => {
                      window.location.href = googleLoginUrl();
                    }}
                    className="font-medium underline underline-offset-2"
                  >
                    Sign in with Google again
                  </button>
                </>
              )}
            </span>
          ) : (
            error && (
              <span className="text-[11px] text-red-500" data-testid="profile-error">
                {error}
              </span>
            )
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
