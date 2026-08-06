import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const passwordSchema = z.string().min(12).max(512);

export const passwordCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: passwordSchema,
});

export type AuthBrand = "consumer" | "lex";

function sessionMac(input: {
  sessionId: string;
  brand: AuthBrand;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(`auth-session:v1:${input.brand}:${input.sessionId}`)
    .digest("base64url");
}

/** The browser receives only a database session id plus a brand-bound MAC. */
export function createOpaqueSessionToken(input: {
  sessionId: string;
  brand: AuthBrand;
  secret: string;
}): string {
  if (!z.uuid().safeParse(input.sessionId).success) {
    throw new Error("Opaque auth sessions require a UUID session id.");
  }
  if (input.secret.length < 16) {
    throw new Error("Opaque auth sessions require a strong signing secret.");
  }
  return `${input.sessionId}.${sessionMac(input)}`;
}

export function openOpaqueSessionToken(input: {
  token: string | undefined;
  brand: AuthBrand;
  secret: string;
}): string | null {
  if (!input.token || input.secret.length < 16) return null;
  const separator = input.token.lastIndexOf(".");
  if (separator <= 0) return null;
  const sessionId = input.token.slice(0, separator);
  if (!z.uuid().safeParse(sessionId).success) return null;
  const supplied = input.token.slice(separator + 1);
  const expected = sessionMac({
    sessionId,
    brand: input.brand,
    secret: input.secret,
  });
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    return null;
  }
  return sessionId;
}
