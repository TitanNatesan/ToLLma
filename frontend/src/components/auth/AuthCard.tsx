"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Eye, EyeOff, KeyRound, Loader2, Lock, Mail, ShieldCheck, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Logo } from "@/components/ui/Logo";
import { ApiError, googleLoginUrl, login, signup } from "@/services/api";
import { toast } from "sonner";
import { useAuthStore } from "@/store/auth";

interface AuthCardProps {
  initialMode?: "login" | "signup";
}

export function AuthCard({ initialMode = "login" }: AuthCardProps) {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setAccessToken = useAuthStore((s) => s.setAccessToken);

  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const isFlipped = mode === "signup";

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [oauthNotice, setOauthNotice] = useState<string | null>(null);

  // OAuth denial UX (Phase 9): backend redirects denials to
  // /login?oauth_error=cancelled. Show friendly static copy once, then
  // consume the param so refresh doesn't persist it. Never render the raw
  // param value. Read via window.location to avoid a Suspense boundary.
  // Effect-to-state sync is intentional here: it keeps server prerender and
  // client hydration identical (both render null first), then reveals the
  // notice client-side only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("oauth_error");
    if (!oauthError) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOauthNotice(
      oauthError === "cancelled"
        ? "Google sign-in was cancelled. Try again or use email login."
        : "Google sign-in didn't complete. Try again or use email login.",
    );
    params.delete("oauth_error");
    const rest = params.toString();
    router.replace(
      rest ? `${window.location.pathname}?${rest}` : window.location.pathname,
    );
  }, [router]);

  // Signup form state
  const [signupFullName, setSignupFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupBusy, setSignupBusy] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  // Password strength (length + variety heuristic, client-side hint only —
  // the backend still enforces its own minimum).
  const signupStrength = (() => {
    if (signupPassword.length === 0) return 0;
    let s = 1;
    if (signupPassword.length >= 12) s += 1;
    if (/[A-Z]/.test(signupPassword) && /[0-9]/.test(signupPassword)) s += 1;
    if (/[^A-Za-z0-9]/.test(signupPassword)) s += 1;
    return Math.min(s, 4);
  })();

  const signupStrengthLabels = ["", "Weak", "Okay", "Strong", "Very strong"];
  const onCapsKey = (e: React.KeyboardEvent) => {
    try {
      setCapsOn(!!(e.getModifierState && e.getModifierState("CapsLock")));
    } catch {
      /* keyboards without modifier state */
    }
  };

  // Organization invite binding (Phase B): ?invite=<token>&email=<address>.
  // The email field is prefilled and locked; the token survives mode flips
  // and the signup→verify→login hop via sessionStorage, then lands on the
  // invitations page. Google buttons intentionally stay untouched.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    const email = params.get("email");
    if (invite) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInviteToken(invite);
      try {
        window.sessionStorage.setItem("tollma_invite_token", invite);
      } catch {
        /* storage blocked: token still works for this page view */
      }
    } else {
      try {
        const stored = window.sessionStorage.getItem("tollma_invite_token");
        if (stored) setInviteToken(stored);
      } catch {
        /* ignore */
      }
    }
    if (email && email.includes("@")) {
      setInviteEmail(email);
      setLoginEmail(email);
      setSignupEmail(email);
    }
  }, []);

  function consumeInviteToken(): string | null {
    if (inviteToken) {
      try {
        window.sessionStorage.removeItem("tollma_invite_token");
      } catch {
        /* ignore */
      }
      return inviteToken;
    }
    try {
      const stored = window.sessionStorage.getItem("tollma_invite_token");
      if (stored) {
        window.sessionStorage.removeItem("tollma_invite_token");
        return stored;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  function peekInviteToken(): string | null {
    if (inviteToken) return inviteToken;
    try {
      return window.sessionStorage.getItem("tollma_invite_token");
    } catch {
      return null;
    }
  }

  function afterAuth() {
    const token = consumeInviteToken();
    router.push(token ? `/organizations/invites?token=${encodeURIComponent(token)}` : "/");
  }

  const switchToSignup = (e: React.MouseEvent) => {
    e.preventDefault();
    setLoginError(null);
    setMode("signup");
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `/signup${window.location.search}`);
    }
  };

  const switchToLogin = (e: React.MouseEvent) => {
    e.preventDefault();
    setSignupError(null);
    setMode("login");
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", `/login${window.location.search}`);
    }
  };

  async function handleLogin(e: React.FormEvent) {
    if (loginBusy) return;
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      const res = await login(loginEmail.trim(), loginPassword);
      setUser(res.user);
      if (res.access_token) {
        setAccessToken(res.access_token);
      }
      afterAuth();
    } catch (err) {
      setLoginError(
        err instanceof ApiError && err.status === 401
          ? "Invalid email or password."
          : "Login failed. Please verify credentials.",
      );
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    if (signupBusy) return;
    e.preventDefault();
    setSignupError(null);
    setSignupBusy(true);
    try {
      const res = await signup(
        signupEmail.trim(),
        signupPassword,
        signupFullName.trim() || undefined,
      );
      setUser(res.user);
      if (res.access_token) {
        setAccessToken(res.access_token);
      }
      // Email verification gate: 2xx with verification_sent !== false
      // (absent on old backends, whose signup always initiates) means a
      // verification mail went out — toast and land on the login form,
      // preserving invite context. Flip the card explicitly as well: the
      // post-signup URL change may not remount this component (in-app mode
      // switches use history.pushState), which would leave the signup face
      // visible. Explicit false keeps legacy auto-login.
      if (
        (res as { verification_sent?: boolean }).verification_sent !== false
      ) {
        toast.success("Verification email sent — check your inbox to continue.");
        const invite = peekInviteToken();
        setMode("login");
        router.push(
          `/login${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`,
        );
        return;
      }
      afterAuth();
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 422
          ? "That email is already registered or password needs 8+ characters."
          : "Signup failed. Please try again.";
      setSignupError(message);
      toast.error(message);
    } finally {
      setSignupBusy(false);
    }
  }

  return (
    <main
      className="relative flex h-dvh w-full items-center justify-center overflow-hidden bg-zinc-950 px-4 py-4"
      data-testid={mode === "login" ? "login-page" : "signup-page"}
    >
      {/* Ambient background glow */}
      <div className="pointer-events-none absolute -top-40 -right-40 size-96 rounded-full bg-tollma-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 size-96 rounded-full bg-sky-500/15 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] opacity-30" />

      {/* 3D Flip Container — grid stacks both faces so the shell sizes to
          the taller card; no page or card scrolling needed. Short viewports
          scale the card down instead of scrolling. */}
      <div className="relative w-full max-w-md origin-center [perspective:1200px] [@media_(max-height:740px)]:scale-[0.94] [@media_(max-height:660px)]:scale-[0.88] [@media_(max-height:600px)]:scale-[0.82]">
        <motion.div
          className="relative grid w-full [transform-style:preserve-3d]"
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          {/* ==================== FRONT: LOGIN CARD ==================== */}
          <div
            className="relative col-start-1 row-start-1 w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 pt-7 shadow-2xl backdrop-blur-xl [backface-visibility:hidden] sm:p-7"
            style={{
              pointerEvents: isFlipped ? "none" : "auto",
            }}
          >
            <div aria-hidden className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-tollma-500/70 to-transparent" />
            {/* Header */}
            <div className="mb-4 flex flex-col items-center text-center">
              <Logo size="lg" className="mb-2" />
              <h1 className="text-xl font-bold tracking-tight text-white">
                Welcome back
              </h1>
              <p className="mt-1 text-xs text-zinc-400">
                Log in to access your models, gateways, and workspaces
              </p>
            </div>

            {/* Login Form */}
            {oauthNotice && (
              <div
                className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300"
                data-testid="oauth-cancelled-notice"
                role="status"
              >
                {oauthNotice}
              </div>
            )}
            <form onSubmit={handleLogin} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="login-email" className="text-xs font-medium text-zinc-300">Email</label>
                <div className="relative flex items-center">
                  <Mail className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="name@company.com"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    readOnly={inviteEmail !== null}
                    title={inviteEmail ? "Email is locked to your invitation" : undefined}
                    id="login-email"
                    data-testid="login-email"
                    className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 pl-9 pr-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-tollma-500 focus:outline-none focus:ring-1 focus:ring-tollma-500/50"
                  />
                </div>
                {inviteEmail && (
                  <p className="text-[11px] text-zinc-500" data-testid="login-invite-note">
                    Locked to your invitation email. After login you&apos;ll land on the invitation.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="login-password" className="text-xs font-medium text-zinc-300">Password</label>
                <div className="relative flex items-center">
                  <Lock className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyUp={onCapsKey}
                    id="login-password"
                    data-testid="login-password"
                    className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 pl-9 pr-10 text-sm text-white placeholder-zinc-500 transition-colors focus:border-tollma-500 focus:outline-none focus:ring-1 focus:ring-tollma-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    aria-label={ showLoginPassword ? "Hide password" : "Show password" }
                    aria-pressed={showLoginPassword}
                    className="absolute right-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showLoginPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                {capsOn && (
                  <p className="text-[11px] text-amber-400" role="status">Caps lock is on.</p>
                )}
                <div className="flex justify-end pt-1">
                  <Link
                    href="/auth/forgot-password"
                    data-testid="forgot-password-link"
                    className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    Forgot Password?
                  </Link>
                </div>
              </div>

              {loginError && (
                <div
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400"
                  role="alert"
                    data-testid="login-error"
                >
                  {loginError}
                </div>
              )}

              <Button
                type="submit"
                disabled={loginBusy}
                size="lg"
                className="w-full"
                data-testid="login-submit"
              >
                {loginBusy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Logging in…
                  </span>
                ) : (
                  "Log In"
                )}
              </Button>

              <div className="relative my-3 flex items-center justify-center">
                <div className="w-full border-t border-zinc-800" />
                <span className="absolute bg-zinc-900 px-2 text-[11px] text-zinc-500 uppercase">
                  or
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-10 w-full rounded-lg border-zinc-700 bg-zinc-800/60 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white"
                onClick={() => {
                  window.location.href = googleLoginUrl();
                }}
                data-testid="login-google"
              >
                <svg className="mr-2 size-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Sign in with Google
              </Button>
            </form>

            <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-zinc-500">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3 text-tollma-500" aria-hidden /> Encrypted credentials</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1"><KeyRound className="size-3 text-tollma-500" aria-hidden /> SSO via Google</span>
            </div>

            <div className="mt-2.5 text-center text-xs text-zinc-400">
              No account?{" "}
              <button
                type="button"
                onClick={switchToSignup}
                className="font-medium text-white underline underline-offset-4 hover:text-tollma-300 transition-colors cursor-pointer"
              >
                Sign up
              </button>
            </div>
          </div>

          {/* ==================== BACK: SIGNUP CARD ==================== */}
          <div
            className="relative col-start-1 row-start-1 w-full overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/90 p-6 pt-7 shadow-2xl backdrop-blur-xl [backface-visibility:hidden] [transform:rotateY(180deg)] sm:p-7"
            style={{
              pointerEvents: isFlipped ? "auto" : "none",
            }}
          >
            <div aria-hidden className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-tollma-500/70 to-transparent" />
            {/* Header */}
            <div className="mb-4 flex flex-col items-center text-center">
              <Logo size="lg" className="mb-2" />
              <h1 className="text-xl font-bold tracking-tight text-white">
                Create an account
              </h1>
              <p className="mt-1 text-xs text-zinc-400">
                Join ToLLma and start orchestrating your models & agents
              </p>
            </div>

            {/* Signup Form */}
            <form onSubmit={handleSignup} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="signup-name" className="text-xs font-medium text-zinc-300">
                  Full name <span className="text-zinc-500">(optional)</span>
                </label>
                <div className="relative flex items-center">
                  <UserIcon className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
                  <input
                    placeholder="Alex Rivera"
                    autoComplete="name"
                    value={signupFullName}
                    onChange={(e) => setSignupFullName(e.target.value)}
                    id="signup-name"
                    data-testid="signup-name"
                    className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 pl-9 pr-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-tollma-500 focus:outline-none focus:ring-1 focus:ring-tollma-500/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="signup-email" className="text-xs font-medium text-zinc-300">Email</label>
                <div className="relative flex items-center">
                  <Mail className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="name@company.com"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    readOnly={inviteEmail !== null}
                    title={inviteEmail ? "Email is locked to your invitation" : undefined}
                    id="signup-email"
                    data-testid="signup-email"
                    className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 pl-9 pr-3 text-sm text-white placeholder-zinc-500 transition-colors focus:border-tollma-500 focus:outline-none focus:ring-1 focus:ring-tollma-500/50"
                  />
                </div>
                {inviteEmail && (
                  <p className="text-[11px] text-zinc-500" data-testid="signup-invite-note">
                    Locked to your invitation email. After signup you&apos;ll land on the invitation.
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label htmlFor="signup-password" className="text-xs font-medium text-zinc-300">Password</label>
                <div className="relative flex items-center">
                  <Lock className="pointer-events-none absolute left-3 size-4 text-zinc-500" />
                  <input
                    type={showSignupPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    placeholder="8+ characters"
                    minLength={8}
                    value={signupPassword}
                    onChange={(e) => setSignupPassword(e.target.value)}
                    onKeyUp={onCapsKey}
                    id="signup-password"
                    data-testid="signup-password"
                    aria-describedby="signup-strength"
                    className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-800/80 pl-9 pr-10 text-sm text-white placeholder-zinc-500 transition-colors focus:border-tollma-500 focus:outline-none focus:ring-1 focus:ring-tollma-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword(!showSignupPassword)}
                    aria-label={ showSignupPassword ? "Hide password" : "Show password" }
                    aria-pressed={showSignupPassword}
                    className="absolute right-3 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showSignupPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {signupPassword.length > 0 && (
                <div className="flex items-center gap-1.5" id="signup-strength" aria-live="polite">
                  <div className="flex flex-1 gap-1" aria-hidden>
                    {[1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={`h-1 flex-1 rounded-full ${i <= signupStrength ? (signupStrength <= 1 ? "bg-red-500" : signupStrength === 2 ? "bg-amber-400" : "bg-tollma-500") : "bg-zinc-700"}`}
                      />
                    ))}
                  </div>
                  <span className="text-[10px] text-zinc-500">
                    {signupStrengthLabels[signupStrength]}
                  </span>
                </div>
              )}
              {capsOn && (
                <p className="text-[11px] text-amber-400" role="status">Caps lock is on.</p>
              )}
              {signupError && (
                <div
                  className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400"
                  role="alert"
                    data-testid="signup-error"
                >
                  {signupError}
                </div>
              )}

              <Button
                type="submit"
                disabled={signupBusy}
                size="lg"
                className="w-full"
                data-testid="signup-submit"
              >
                {signupBusy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="size-4 animate-spin" />
                    Creating account…
                  </span>
                ) : (
                  "Create Account"
                )}
              </Button>

              <div className="relative my-3 flex items-center justify-center">
                <div className="w-full border-t border-zinc-800" />
                <span className="absolute bg-zinc-900 px-2 text-[11px] text-zinc-500 uppercase">
                  or
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-10 w-full rounded-lg border-zinc-700 bg-zinc-800/60 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white"
                onClick={() => {
                  window.location.href = googleLoginUrl();
                }}
                data-testid="signup-google"
              >
                <svg className="mr-2 size-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Sign up with Google
              </Button>
            </form>

            <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-zinc-500">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3 text-tollma-500" aria-hidden /> Encrypted credentials</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1"><KeyRound className="size-3 text-tollma-500" aria-hidden /> SSO via Google</span>
            </div>

            <div className="mt-2.5 text-center text-xs text-zinc-400">
              Have an account?{" "}
              <button
                type="button"
                onClick={switchToLogin}
                className="font-medium text-white underline underline-offset-4 hover:text-tollma-300 transition-colors cursor-pointer"
              >
                Log in
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
