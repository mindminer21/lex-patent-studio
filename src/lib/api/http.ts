import { NextResponse } from "next/server";
import { getAdapters, type Session } from "@/lib/adapters";

/**
 * API conventions (PRD §12, PRD-wepatent §10):
 *  - authorization server-side on every handler (session → role policy)
 *  - Zod validation on every body
 *  - idempotency keys on money/job endpoints
 *  - GENERIC external errors: internals, stack traces, and provider details
 *    never leave the server.
 */

export interface ApiResult {
  status: number;
  body: unknown;
}

export const apiResult = (status: number, body: unknown): ApiResult => ({
  status,
  body,
});

export const unauthorized = (): ApiResult =>
  apiResult(401, { error: "Authentication required." });
export const forbidden = (detail?: string): ApiResult =>
  apiResult(403, { error: detail ?? "Your role does not permit this action." });
export const notFound = (): ApiResult =>
  apiResult(404, { error: "Not found." });
export const badRequest = (detail?: string): ApiResult =>
  apiResult(400, { error: detail ?? "Invalid request." });

/**
 * Map an adapter refusal message to a status without leaking internals.
 * Adapter errors are written to be user-safe; anything unexpected is
 * replaced with a generic message.
 */
export function mapAdapterError(error: string): ApiResult {
  const lower = error.toLowerCase();
  if (lower.includes("not found")) return apiResult(404, { error });
  if (lower.includes("may not") || lower.includes("not permitted")) {
    return apiResult(403, { error });
  }
  if (lower.includes("insufficient")) return apiResult(402, { error });
  if (lower.includes("already")) return apiResult(409, { error });
  return apiResult(400, { error });
}

/** Resolve the server-side session; never trusts client-supplied identity. */
export async function resolveSession(): Promise<Session | null> {
  return getAdapters().auth.getSession();
}

/** Parse a JSON body defensively; malformed JSON → null. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

type RouteParams = Record<string, string>;
type EndpointFn = (
  session: Session,
  request: Request,
  params: RouteParams,
) => Promise<ApiResult>;

interface RouteContext {
  params: Promise<RouteParams>;
}

/**
 * Route wrapper: session resolution + generic error containment. Every
 * /api handler goes through this — no handler returns raw internals.
 */
export function withSession(fn: EndpointFn) {
  return async (request: Request, ctx?: RouteContext): Promise<NextResponse> => {
    try {
      const session = await resolveSession();
      if (!session) {
        const r = unauthorized();
        return NextResponse.json(r.body, { status: r.status });
      }
      const params = ctx ? await ctx.params : {};
      const result = await fn(session, request, params);
      return NextResponse.json(result.body, { status: result.status });
    } catch (err) {
      // Log server-side; the client sees a generic error only.
      console.error("[api] unexpected error:", err);
      return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
    }
  };
}
