"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { googleLoginUrl, login } from "@/services/api";
import { useAuthStore } from "@/store/auth";
import { ApiError } from "@/services/api";

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await login(email.trim(), password);
      setUser(res.user);
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? "Invalid email or password." : "Login failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4" data-testid="login-page">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center gap-2">
          <img src="/tollma.png" alt="ToLLma" className="h-8 w-auto" />
          <h1 className="text-lg font-semibold">Log in to ToLLma</h1>
        </div>
        <Input
          type="email" required autoComplete="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email"
        />
        <Input
          type="password" required autoComplete="current-password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400" data-testid="login-error">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full" data-testid="login-submit">
          {busy ? "Logging in…" : "Log in"}
        </Button>
        <Button
          type="button" variant="outline" className="w-full"
          onClick={() => { window.location.href = googleLoginUrl(); }}
          data-testid="login-google"
        >
          Sign in with Google
        </Button>
        <p className="text-center text-sm text-zinc-500">
          No account? <Link href="/signup" className="underline">Sign up</Link>
        </p>
      </form>
    </main>
  );
}
