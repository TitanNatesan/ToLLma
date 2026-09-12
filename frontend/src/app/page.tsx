import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">ToLLms</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Local development foundation.</p>
      <nav className="flex gap-4">
        <Link className="underline" href="/health">
          Health
        </Link>
        <Link className="underline" href="/api-test">
          API connectivity test
        </Link>
      </nav>
    </main>
  );
}
