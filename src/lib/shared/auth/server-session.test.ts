import { describe, expect, it, vi } from "vitest";
import {
  ServerSessionService,
  type AuthSessionRepository,
  type StoredAuthSession,
} from "./server-session";

const encryptionKey = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";

function repository(): AuthSessionRepository & { rows: StoredAuthSession[] } {
  const rows: StoredAuthSession[] = [];
  return {
    rows,
    create: vi.fn(async (input) => {
      const row = { ...input, id: "3a1c4c8b-9e34-41d4-9ac1-6f79fe676a31" };
      rows.push(row);
      return row;
    }),
    findActive: vi.fn(async (id) => rows.find((row) => row.id === id) ?? null),
    updateTokens: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
  };
}

describe("shared server-side auth sessions", () => {
  it("encrypts provider tokens before persistence and decrypts them on resolve", async () => {
    const repo = repository();
    const sessions = new ServerSessionService(repo, encryptionKey);
    const created = await sessions.create({
      appUserId: "user-1",
      authUserId: "user-1",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      accessExpiresAt: "2033-05-18T03:33:20.000Z",
      assuranceLevel: "aal1",
      ipHash: "ip-hash",
      userAgentHash: "agent-hash",
    });

    expect(created.id).toBe("3a1c4c8b-9e34-41d4-9ac1-6f79fe676a31");
    expect(repo.rows[0].accessToken).not.toContain("access-secret");
    expect(repo.rows[0].refreshToken).not.toContain("refresh-secret");
    await expect(sessions.resolve(created.id)).resolves.toMatchObject({
      appUserId: "user-1",
      assuranceLevel: "aal1",
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
    });
  });

  it("refuses revoked and unknown sessions through the repository boundary", async () => {
    const repo = repository();
    const sessions = new ServerSessionService(repo, encryptionKey);
    await expect(sessions.resolve("missing")).resolves.toBeNull();
  });
});
