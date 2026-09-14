"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { ApiError, googleLoginUrl, signup } from "@/services/api";
import { useAuthStore } from "@/store/auth";

export default function SignupPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signup(email.trim(), password, fullName.trim() || undefined);
      setUser(res.user);
      router.push("/");
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setError("That email is already registered or invalid (password needs 8+ characters).");
      } else {
        setError("Signup failed. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4" data-testid="signup-page">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <img src="/tollma.png" alt="ToLLma" className="h-8 w-auto" />
          <h1 className="text-lg font-semibold">Create your account</h1>
        </div>
        <Input
          placeholder="Full name (optional)" autoComplete="name"
          value={fullName} onChange={(e) => setFullName(e.target.value)} data-testid="signup-name"
        />
        <Input
          type="email" required autoComplete="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} data-testid="signup-email"
        />
        <Input
          type="password" required autoComplete="new-password" placeholder="Password (8+ characters)"
          minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
          data-testid="signup-password"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400" data-testid="signup-error">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full" data-testid="signup-submit">
          {busy ? "Creating account…" : "Sign up"}
        </Button>
        <Button
          type="button" variant="outline" className="w-full"
          onClick={() => { window.location.href = googleLoginUrl(); }}
          data-testid="signup-google"
        >
          Sign up with Google
        </Button>
        <p className="text-center text-sm text-zinc-500">
          Have an account? <Link href="/login" className="underline">Log in</Link>
        </p>
      </form>
    </main>
  );
}
