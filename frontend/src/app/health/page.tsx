import Link from "next/link";
import { StatusCard } from "@/components/StatusCard";
import { getLiveness } from "@/services/api";

export default async function HealthPage() {
  let status: string | null = null;
  let detail: string | null = null;
  try {
    status = (await getLiveness()).status;
  } catch (e) {
    detail = e instanceof Error ? e.message : "unknown error";
  }
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Frontend health</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <StatusCard title="Next.js app" status="ok" loading={false} />
        <StatusCard title="Backend (server-side)" status={status} detail={detail} loading={false} />
      </div>
      <Link className="underline" href="/">
        Home
      </Link>
    </main>
  );
}
