import "server-only";

import { NextResponse } from "next/server";
import { getSessionContext, type SessionContext } from "./session";

/**
 * Route-handler authentication/authorization helpers (PRD §10). External
 * errors are generic; details go to structured internal logs only.
 */
export type AuthedContext = SessionContext & {
  membership: NonNullable<SessionContext["membership"]>;
  organization: NonNullable<SessionContext["organization"]>;
};

export async function requireApiOrgContext(): Promise<
  { ok: true; context: AuthedContext } | { ok: false; response: NextResponse }
> {
  const context = await getSessionContext();
  if (!context) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  if (!context.membership || !context.organization) {
    return {
      ok: false,
      response: NextResponse.json({ error: "no_organization" }, { status: 403 }),
    };
  }
  return { ok: true, context: context as AuthedContext };
}

export function genericError(status = 400): NextResponse {
  return NextResponse.json({ error: "request_failed" }, { status });
}

/** Request-size guard for JSON bodies (PRD §10). */
export async function readJsonBody(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<unknown | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
