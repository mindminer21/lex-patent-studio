import { describe, expect, it } from "vitest";
import { decryptProviderToken, encryptProviderToken } from "./token-vault";

describe("auth provider token vault", () => {
  const key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

  it("round-trips a provider token without storing plaintext", () => {
    const encrypted = encryptProviderToken("provider-secret-token", key);
    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("provider-secret-token");
    expect(decryptProviderToken(encrypted, key)).toBe("provider-secret-token");
  });

  it("refuses ciphertext modified after encryption", () => {
    const encrypted = encryptProviderToken("provider-secret-token", key);
    expect(() => decryptProviderToken(`${encrypted.slice(0, -1)}x`, key)).toThrow(
      /decrypt/i,
    );
  });

  it("requires a 32-byte base64 encryption key", () => {
    expect(() => encryptProviderToken("token", "not-a-key")).toThrow(/32-byte/);
  });
});
