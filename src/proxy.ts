import { NextRequest, NextResponse } from "next/server";

/**
 * Optimistic authentication check for the authenticated app (PRD §7.1:
 * unauthenticated users cannot access /wepatent/app/**). This only checks cookie
 * presence for fast redirects; real verification happens server-side in
 * `src/lib/server/session.ts` on every request.
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get("wp_session")?.value);
  if (!hasSession) {
    const signIn = new URL("/wepatent/sign-in", request.url);
    signIn.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/wepatent/app/:path*"],
};
