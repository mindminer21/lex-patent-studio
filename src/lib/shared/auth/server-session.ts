import { decryptProviderToken, encryptProviderToken } from "./token-vault";

export type AssuranceLevel = "aal1" | "aal2";

export type StoredAuthSession = {
  id: string;
  appUserId: string;
  authUserId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  assuranceLevel: AssuranceLevel;
  ipHash: string | null;
  userAgentHash: string | null;
};

export type NewStoredAuthSession = Omit<StoredAuthSession, "id">;

export interface AuthSessionRepository {
  create(input: NewStoredAuthSession): Promise<StoredAuthSession>;
  findActive(id: string): Promise<StoredAuthSession | null>;
  updateTokens(
    id: string,
    input: Pick<
      StoredAuthSession,
      "accessToken" | "refreshToken" | "accessExpiresAt" | "assuranceLevel"
    >,
  ): Promise<void>;
  revoke(id: string): Promise<void>;
}

export type ActiveAuthSession = Omit<
  StoredAuthSession,
  "accessToken" | "refreshToken"
> & {
  accessToken: string;
  refreshToken: string;
};

export class ServerSessionService {
  constructor(
    private readonly repository: AuthSessionRepository,
    private readonly encryptionKey: string,
  ) {}

  async create(input: NewStoredAuthSession): Promise<StoredAuthSession> {
    return this.repository.create({
      ...input,
      accessToken: encryptProviderToken(input.accessToken, this.encryptionKey),
      refreshToken: encryptProviderToken(input.refreshToken, this.encryptionKey),
    });
  }

  async resolve(id: string): Promise<ActiveAuthSession | null> {
    const stored = await this.repository.findActive(id);
    if (!stored) return null;
    return {
      ...stored,
      accessToken: decryptProviderToken(stored.accessToken, this.encryptionKey),
      refreshToken: decryptProviderToken(stored.refreshToken, this.encryptionKey),
    };
  }

  async updateTokens(
    id: string,
    input: Pick<
      ActiveAuthSession,
      "accessToken" | "refreshToken" | "accessExpiresAt" | "assuranceLevel"
    >,
  ): Promise<void> {
    await this.repository.updateTokens(id, {
      ...input,
      accessToken: encryptProviderToken(input.accessToken, this.encryptionKey),
      refreshToken: encryptProviderToken(input.refreshToken, this.encryptionKey),
    });
  }

  async revoke(id: string): Promise<void> {
    await this.repository.revoke(id);
  }
}
