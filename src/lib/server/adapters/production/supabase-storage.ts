import type { StoragePort } from "../types";

/**
 * Production private-blob storage (FR-4) over the Supabase Storage REST API.
 *
 * The bucket is PRIVATE: objects are only reachable server-side with the
 * service-role key; the browser never receives storage credentials or
 * long-lived URLs (uploads/downloads flow through the app's signed,
 * tenant-scoped endpoints). Implemented against an injected fetch so the
 * full adapter is unit-testable without a Supabase project; live activation
 * is approval-gated (PRD §17.1).
 */
export class SupabaseStorageError extends Error {
  readonly internalDetail: string;

  constructor(internalDetail: string) {
    super("storage_error");
    this.name = "SupabaseStorageError";
    this.internalDetail = internalDetail;
  }
}

export type SupabaseStorageAdapterOptions = {
  url: string;
  serviceRoleKey: string;
  /** Private bucket name; created by `supabase/wepatent/migrations` provisioning. */
  bucket?: string;
  fetchImpl?: typeof fetch;
};

export class SupabaseStorageAdapter implements StoragePort {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly bucket: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SupabaseStorageAdapterOptions) {
    this.baseUrl = options.url.replace(/\/$/, "");
    this.key = options.serviceRoleKey;
    this.bucket = options.bucket ?? "wepatent-private";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private objectUrl(path: string): string {
    const encoded = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `${this.baseUrl}/storage/v1/object/${this.bucket}/${encoded}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.key}`, apikey: this.key, ...extra };
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    const body = new Uint8Array(bytes).buffer as ArrayBuffer;
    const response = await this.fetchImpl(this.objectUrl(path), {
      method: "POST",
      headers: this.headers({
        "content-type": "application/octet-stream",
        "x-upsert": "true",
      }),
      body,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new SupabaseStorageError(`put ${path}: HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }
  }

  async get(path: string): Promise<Uint8Array | null> {
    const response = await this.fetchImpl(this.objectUrl(path), {
      method: "GET",
      headers: this.headers(),
    });
    if (response.status === 404 || response.status === 400) return null;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new SupabaseStorageError(`get ${path}: HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    const response = await this.fetchImpl(this.objectUrl(path), {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!response.ok && response.status !== 404) {
      const detail = await response.text().catch(() => "");
      throw new SupabaseStorageError(
        `delete ${path}: HTTP ${response.status}: ${detail.slice(0, 300)}`,
      );
    }
  }
}
