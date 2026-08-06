import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("Auth session encryption requires a 32-byte base64 key.");
  }
  return key;
}

/** AES-256-GCM envelope for provider access and refresh tokens at rest. */
export function encryptProviderToken(token: string, encodedKey: string): string {
  const key = decodeKey(encodedKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptProviderToken(envelope: string, encodedKey: string): string {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = envelope.split(".");
    if (
      version !== VERSION ||
      !ivValue ||
      !tagValue ||
      !ciphertextValue ||
      extra !== undefined
    ) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeKey(encodedKey),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Unable to decrypt auth provider token.");
  }
}
