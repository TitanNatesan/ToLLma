import type { HealthResponse } from "@/types";

// Server components resolve BACKEND_URL (service name); client components
// fall back to NEXT_PUBLIC_API_URL (host-mapped port for the browser).
function apiBase(): string {
  return process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export function getLiveness(): Promise<HealthResponse> {
  return get<HealthResponse>("/health");
}

export function getReadiness(): Promise<HealthResponse> {
  return get<HealthResponse>("/health/ready");
}
