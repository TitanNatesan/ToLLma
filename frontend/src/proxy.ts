import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/verify", "/invite", "/auth/callback", "/auth/forgot-password", "/auth/reset-password", "/share", "/health", "/legal", "/trust/disclosure", "/trust/subprocessors"];

// Presence-cookie gate (Next 16 proxy convention). The session itself lives
// in httpOnly cookies verified by the backend; this only routes navigation.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/") || pathname.includes(".")) {
    return NextResponse.next();
  }
  const hasSession = request.cookies.get("tollma_session")?.value === "1";
  if (!hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
