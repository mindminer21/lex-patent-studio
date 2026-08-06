import { NextRequest, NextResponse } from "next/server";

/**
 * Optimistic authentication check for the authenticated app (PRD §7.1:
 * unauthenticated users cannot access /wepatent/app/**). This only checks cookie
 * presence for fast redirects; real verification happens server-side in
 * `src/lib/server/session.ts` on every request.
 */
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/wepatent/app") && !request.cookies.get("wp_session")?.value) {
    const signIn = new URL("/wepatent/sign-in", request.url);
    signIn.searchParams.set("next", path);
    return NextResponse.redirect(signIn);
  }
  if (
    process.env.LEX_APP_MODE === "production" &&
    path.startsWith("/app") &&
    !request.cookies.get("lex_session")?.value
  ) {
    const signIn = new URL("/login", request.url);
    signIn.searchParams.set("next", path);
    return NextResponse.redirect(signIn);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/wepatent/app/:path*", "/app/:path*"],
};
