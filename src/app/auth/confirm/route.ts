import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { getPool } from "@/lib/adapters/production/db";
import {
  createLexAuthServices,
  establishLexSession,
} from "@/lib/adapters/production/lex-auth-session";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const type = url.searchParams.get("type");
  if (type !== "recovery" && type !== "invite" && type !== "email") {
    return NextResponse.redirect(new URL("/login?error=invalid_credentials", url));
  }
  const env = getEnv();
  if (env.LEX_APP_MODE !== "production") {
    return NextResponse.redirect(new URL("/app", url));
  }
  const pool = getPool(env.LEX_DATABASE_URL!);
  const authentication = await createLexAuthServices(pool).passwordAuth.verifyOtp({
    tokenHash,
    type,
  });
  if (!authentication.ok) {
    return NextResponse.redirect(new URL("/login?error=invalid_credentials", url));
  }
  const established = await establishLexSession(pool, authentication);
  if (!established.ok) {
    return NextResponse.redirect(new URL("/login?error=not_invited", url));
  }
  const needsPassword = type === "recovery" || type === "invite";
  return NextResponse.redirect(new URL(needsPassword ? "/reset-password" : "/app", url));
}
