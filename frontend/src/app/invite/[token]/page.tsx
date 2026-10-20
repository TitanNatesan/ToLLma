"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Lock, LogIn, Mail, User as UserIcon, UserPlus, XCircle } from "lucide-react";
import { Badge, Button, Card, CardContent, EmptyState, LoadingState, PageHeader } from "@/components/ui";
import { ConfirmDialog } from "@/app/organizations/components/Dialogs";
import { ApiError } from "@/services/api";
import { useAcceptInviteNew, useInvitePreview, useRejectInviteNew } from "@/hooks/useOrgs";
import { parseApiError } from "@/lib/errors";
import { validatePassword } from "@/lib/password";
import { useAuthStore } from "@/store/auth";
import type { InviteAcceptNewResponse } from "@/services/orgs";
import type { InvitePreview } from "@/types/orgs";

function inviterLabel(p: InvitePreview): string | null {
  const by = p.invited_by;
  if (by && typeof by === "object") {
    return by.name || by.email || null;
  }
  if (typeof by === "string" && by) return by;
  if (p.inviter && typeof p.inviter === "object") {
    return p.inviter.name || p.inviter.email || null;
  }
  return p.invited_by_name || p.invited_by_email || null;
}

function setsOf(p: InvitePreview): Array<{ name: string; codes: string[] }> {
  const raw = p.permission_sets ?? p.sets ?? [];
  return raw.map((s) => ({
    name: s.name,
    codes: s.codes ?? s.permissions ?? [],
  }));
}

function expiryLabel(p: InvitePreview): string {
  if (!p.expires_at) return "—";
  try {
    return new Date(p.expires_at).toLocaleString();
  } catch {
    return String(p.expires_at);
  }
}

type Step = "review" | "profile" | "accepted" | "rejected";

/** 404/405 while the preview is valid = the *-new route hasn't landed yet. */
function isRouteMissing(err: unknown, previewValid: boolean): boolean {
  return previewValid && err instanceof ApiError && (err.status === 404 || err.status === 405);
}

/** Contract is top-level org_id; tolerate a nested org if the backend wraps it. */
function acceptNewOrgId(res: InviteAcceptNewResponse): string | null {
  if (res.org_id) return res.org_id;
  const nested = res as InviteAcceptNewResponse & {
    org?: { id?: string } | null;
    organization?: { id?: string } | null;
  };
  return nested.org?.id ?? nested.organization?.id ?? null;
}

export default function InviteLandingPage() {
  return (
    <Suspense>
      <InviteLandingInner />
    </Suspense>
  );
}

function InviteLandingInner() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const token = Array.isArray(params.token) ? params.token[0] : (params.token ?? "");
  const preview = useInvitePreview(token);
  const acceptNew = useAcceptInviteNew();
  const rejectNew = useRejectInviteNew();

  const [step, setStep] = useState<Step>("review");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectUnsupported, setRejectUnsupported] = useState(false);

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [accountExists, setAccountExists] = useState(false);

  const [acceptOrgId, setAcceptOrgId] = useState<string | null>(null);

  const data = preview.data ?? null;
  const loginHref = `/login?invite=${encodeURIComponent(token)}`;
  const signupHref = (email: string) =>
    `/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

  // Brief success beat, then enter the organization.
  useEffect(() => {
    if (step !== "accepted" || !acceptOrgId) return;
    const t = setTimeout(() => router.push(`/organizations/${acceptOrgId}`), 1000);
    return () => clearTimeout(t);
  }, [step, acceptOrgId, router]);

  async function submitProfile(e: FormEvent) {
    e.preventDefault();
    if (acceptNew.isPending || !data) return;
    setProfileError(null);
    setAccountExists(false);
    if (password !== confirm) {
      setProfileError("Passwords do not match.");
      return;
    }
    const policy = validatePassword(password);
    if (policy) {
      setProfileError(policy);
      return;
    }
    try {
      const res = await acceptNew.mutateAsync({
        token,
        full_name: fullName.trim(),
        password,
        email: data.email,
      });
      // Persist auth exactly like the login handler (AuthCard.handleLogin).
      setUser(res.user);
      if (res.access_token) {
        setAccessToken(res.access_token);
      }
      setAcceptOrgId(acceptNewOrgId(res));
      setStep("accepted");
    } catch (err) {
      // accept-new hasn't landed yet → legacy signup hop (AuthCard
      // ?invite=/?email= plumbing takes it from there).
      if (isRouteMissing(err, !!data)) {
        router.push(signupHref(data.email));
        return;
      }
      // INVITE_ACCOUNT_EXISTS: the address already has an account.
      if (err instanceof ApiError && err.status === 409) {
        setAccountExists(true);
        return;
      }
      if (err instanceof ApiError && err.status === 422) {
        setProfileError("That email is already registered or password needs 8+ characters.");
        return;
      }
      // Anything else: the invitation stays usable — form stays, retry allowed.
      setProfileError(parseApiError(err).message);
    }
  }

  // Reject path calls reject-new ONLY — never signup, so no account is created.
  async function confirmReject() {
    try {
      await rejectNew.mutateAsync(token);
      setStep("rejected");
    } catch (err) {
      // reject-new hasn't landed yet → legacy sign-in-to-decline panel.
      if (isRouteMissing(err, !!data)) {
        setRejectUnsupported(true);
        return;
      }
      throw err; // ConfirmDialog renders it inline and stays open.
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-y-auto bg-zinc-50 dark:bg-zinc-950" data-testid="invite-landing-page">
      <PageHeader title="Organization invitation" subtitle="Review before you accept." hideMenu />
      <div className="mx-auto w-full max-w-2xl flex-1 p-4">
        {preview.isLoading && <LoadingState message="Loading invitation…" />}
        {!preview.isLoading && (preview.isError || !preview.data) && (
          <EmptyState title="Invitation not found"
            description="It may have expired, been revoked, or the link is incorrect. No account or organization details are shown for invalid links."
            action={
              <Link href="/login">
                <Button size="sm" variant="outline">Back to login</Button>
              </Link>
            } />
        )}
        {data && step === "accepted" && (
          <Card data-testid="invite-accepted">
            <CardContent className="space-y-3 p-5 text-center">
              <CheckCircle2 className="mx-auto size-10 text-tollma-600 dark:text-tollma-400" aria-hidden />
              <h1 className="text-lg font-bold">You&apos;re in — welcome to {data.org_name}!</h1>
              <p className="text-xs text-zinc-500">
                Your account was created and you&apos;ve joined the organization. Redirecting…
              </p>
              {acceptOrgId && (
                <Link href={`/organizations/${acceptOrgId}`} data-testid="invite-accepted-continue">
                  <Button size="sm">Continue to {data.org_name}</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}
        {data && step === "rejected" && (
          <Card data-testid="invite-rejected">
            <CardContent className="space-y-3 p-5 text-center">
              <XCircle className="mx-auto size-10 text-zinc-400" aria-hidden />
              <h1 className="text-lg font-bold">Invitation rejected</h1>
              <p className="text-xs text-zinc-500">
                You declined the invitation to join {data.org_name}. No account was created —
                declining never creates one.
              </p>
              <Link href="/login">
                <Button size="sm" variant="outline">Back to login</Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {data && (step === "review" || step === "profile") && (
          <Card data-testid="invite-landing">
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-sm text-zinc-500">You&apos;re invited to join</p>
                <h1 className="mt-0.5 text-lg font-bold" data-testid="invite-org-name">
                  {data.org_name}
                  {data.org_slug ? (
                    <span className="ml-1.5 font-mono text-xs font-normal text-zinc-500">
                      /{data.org_slug}
                    </span>
                  ) : null}
                </h1>
                <p className="mt-1 text-xs text-zinc-500" data-testid="invite-email">
                  Invitation for <span className="font-semibold text-zinc-800 dark:text-zinc-200">{data.email}</span>
                </p>
                {inviterLabel(data) && (
                  <p className="mt-0.5 text-xs text-zinc-500" data-testid="invite-inviter">
                    Invited by <span className="font-medium">{inviterLabel(data)}</span>
                  </p>
                )}
                <p className="mt-0.5 font-mono text-[11px] text-zinc-400" data-testid="invite-expiry">
                  Expires {expiryLabel(data)}
                </p>
              </div>

              <div>
                <h2 className="text-xs font-bold">Permission sets</h2>
                {setsOf(data).length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-500" data-testid="invite-sets-empty">
                    No permission sets assigned yet — you&apos;ll join with default member access.
                  </p>
                ) : (
                  <ul className="mt-1.5 space-y-1.5" data-testid="invite-sets">
                    {setsOf(data).map((s) => (
                      <li key={s.name} data-testid={`invite-set-${s.name}`}
                        className="rounded-md border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
                        <p className="font-semibold">{s.name}</p>
                        {s.codes.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {s.codes.map((c) => (
                              <Badge key={c} variant="secondary" className="font-mono text-[10px]">{c}</Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-zinc-500">No extra permissions listed.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md bg-zinc-100 p-3 text-xs leading-relaxed text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                data-testid="invite-accept-means">
                <p className="font-semibold">What accepting means</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>You join <strong>{data.org_name}</strong> with the sets above.</li>
                  <li>The organization may see your membership and shared usage under its visibility policy.</li>
                  <li>Your personal account, personal assets, and other organizations are unaffected.</li>
                  <li>You can leave at any time unless you are the root owner.</li>
                </ul>
              </div>

              {step === "review" && (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" data-testid="invite-continue" onClick={() => setStep("profile")}>
                      <UserPlus className="size-3.5" aria-hidden /> Continue — set up profile
                    </Button>
                    <Button size="sm" variant="outline" data-testid="invite-accept-login"
                      onClick={() => router.push(loginHref)}>
                      <LogIn className="size-3.5" aria-hidden /> I have an account — log in
                    </Button>
                  </div>

                  {rejectUnsupported ? (
                    <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700"
                      data-testid="invite-decline">
                      <p className="font-semibold">Declining?</p>
                      <p className="mt-1 leading-relaxed">
                        Declining needs a sign-in so we know it&apos;s really you — the public link can&apos;t
                        decline on its own. Sign in and choose Reject on the invitations page.
                      </p>
                      <Link href={loginHref} data-testid="invite-decline-login"
                        className="mt-1.5 inline-block font-medium text-tollma-600 hover:underline dark:text-tollma-400">
                        Go to login to decline
                      </Link>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-zinc-300 p-3 text-xs text-zinc-500 dark:border-zinc-700">
                      <p className="font-semibold">Changed your mind?</p>
                      <p className="mt-1 leading-relaxed">
                        Rejecting declines the invitation without creating an account.
                      </p>
                      <Button size="sm" variant="outline" className="mt-2" data-testid="invite-reject-open"
                        onClick={() => setRejectOpen(true)}>
                        Reject invitation
                      </Button>
                    </div>
                  )}
                </>
              )}

              {step === "profile" && (
                <form onSubmit={(e) => void submitProfile(e)} className="space-y-3" data-testid="invite-profile-form">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Email</label>
                    <div className="relative flex items-center">
                      <Mail className="pointer-events-none absolute left-3 size-4 text-zinc-400" aria-hidden />
                      <input
                        type="email"
                        readOnly
                        value={data.email}
                        title="Email is locked to your invitation"
                        data-testid="invite-profile-email"
                        className="h-9 w-full rounded-md border border-zinc-200 bg-zinc-100 pl-9 pr-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
                      />
                    </div>
                    <p className="text-[11px] text-zinc-500" data-testid="invite-profile-email-note">
                      Locked to your invitation email — it can&apos;t be changed here.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium" htmlFor="invite-profile-name">
                      Full name <span className="text-zinc-400">(optional)</span>
                    </label>
                    <div className="relative flex items-center">
                      <UserIcon className="pointer-events-none absolute left-3 size-4 text-zinc-400" aria-hidden />
                      <input
                        id="invite-profile-name"
                        placeholder="Alex Rivera"
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        data-testid="invite-profile-name"
                        className="h-9 w-full rounded-md border border-zinc-300 bg-transparent pl-9 pr-3 text-xs placeholder-zinc-400 focus:border-tollma-500 focus:outline-none focus:ring-2 focus:ring-tollma-500/60 dark:border-zinc-700"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium" htmlFor="invite-profile-password">Password</label>
                    <div className="relative flex items-center">
                      <Lock className="pointer-events-none absolute left-3 size-4 text-zinc-400" aria-hidden />
                      <input
                        id="invite-profile-password"
                        type="password"
                        required
                        autoComplete="new-password"
                        placeholder="8+ characters"
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        data-testid="invite-profile-password"
                        className="h-9 w-full rounded-md border border-zinc-300 bg-transparent pl-9 pr-3 text-xs placeholder-zinc-400 focus:border-tollma-500 focus:outline-none focus:ring-2 focus:ring-tollma-500/60 dark:border-zinc-700"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium" htmlFor="invite-profile-confirm">Confirm password</label>
                    <div className="relative flex items-center">
                      <Lock className="pointer-events-none absolute left-3 size-4 text-zinc-400" aria-hidden />
                      <input
                        id="invite-profile-confirm"
                        type="password"
                        required
                        autoComplete="new-password"
                        placeholder="Repeat your password"
                        minLength={8}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        data-testid="invite-profile-confirm"
                        className="h-9 w-full rounded-md border border-zinc-300 bg-transparent pl-9 pr-3 text-xs placeholder-zinc-400 focus:border-tollma-500 focus:outline-none focus:ring-2 focus:ring-tollma-500/60 dark:border-zinc-700"
                      />
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Use 8+ characters with an uppercase, a lowercase and a number.
                    </p>
                  </div>

                  {/* No Google button here: /auth/google/login → /auth/callback
                      can't carry ?invite= through the OAuth round-trip
                      (fixed redirect, no state passthrough), so a Google
                      signup would orphan the invitation. Manual signup only. */}

                  {profileError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                      data-testid="invite-profile-error" role="alert">
                      {profileError}
                    </div>
                  )}

                  {accountExists && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                      data-testid="invite-exists-notice" role="alert">
                      An account with this email already exists — log in instead. Your invitation is still waiting.
                      <Link href={loginHref} data-testid="invite-exists-login"
                        className="mt-1 block font-medium underline underline-offset-2">
                        Go to login
                      </Link>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" size="sm" disabled={acceptNew.isPending} data-testid="invite-profile-submit">
                      {acceptNew.isPending ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Creating account…
                        </span>
                      ) : (
                        "Accept Invitation & Create Account"
                      )}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" data-testid="invite-profile-back"
                      onClick={() => { setProfileError(null); setAccountExists(false); setStep("review"); }}>
                      Back to invitation
                    </Button>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        )}
        {data && rejectOpen && (
          <ConfirmDialog
            open={rejectOpen}
            title="Reject invitation"
            testId="invite-reject-dialog"
            description={
              <>Reject the invitation to join <strong>{data.org_name}</strong>? No account will be created.</>
            }
            confirmLabel="Reject invitation"
            destructive
            busy={rejectNew.isPending}
            onConfirm={() => void confirmReject()}
            onClose={() => setRejectOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
