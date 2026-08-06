import { NextResponse } from "next/server";
import { createConsumerAuthServices } from "@/lib/server/auth/consumer-auth";
import { getAdapters } from "@/lib/server/adapters";
import { createAuthenticatedSession } from "@/lib/server/session";
import { ensurePersonalOrganization } from "@/lib/server/services/orgs";

const allowedTypes = new Set(["email", "recovery", "invite"] as const);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash") ?? "";
  const rawType = url.searchParams.get("type") ?? "";
  if (!allowedTypes.has(rawType as "email" | "recovery" | "invite")) {
    return NextResponse.redirect(new URL("/wepatent/sign-in?error=verification_failed", url));
  }
  const authentication = await createConsumerAuthServices().passwordAuth.verifyOtp({
    tokenHash,
    type: rawType as "email" | "recovery" | "invite",
  });
  if (!authentication.ok) {
    return NextResponse.redirect(new URL("/wepatent/sign-in?error=verification_failed", url));
  }
  const displayName = authentication.identity.email.split("@")[0];
  const appUserId = await createAuthenticatedSession({
    authentication,
    displayName,
    linkMethod: rawType === "email" ? "created_identity" : "existing_identity",
  });
  const user = await getAdapters().data.getUserById(appUserId);
  if (!user) {
    return NextResponse.redirect(new URL("/wepatent/sign-in?error=verification_failed", url));
  }
  await ensurePersonalOrganization(user);
  return NextResponse.redirect(
    new URL(rawType === "recovery" ? "/wepatent/reset-password" : "/wepatent/app/terms", url),
  );
}
