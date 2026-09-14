import { cn } from "@/lib/utils";

interface StatusCardProps {
  title: string;
  status: string | null;
  detail?: string | null;
  loading: boolean;
}

export function StatusCard({ title, status, detail, loading }: StatusCardProps) {
  const ok = status === "ok";
  return (
    <div className={cn("rounded-lg border p-4", ok ? "border-tollma-500" : "border-red-500")}>
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm">{loading ? "checking…" : (status ?? "unknown")}</p>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
    </div>
  );
}
