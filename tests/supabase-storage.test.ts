import { describe, expect, it } from "vitest";
import {
  SupabaseStorageAdapter,
  SupabaseStorageError,
} from "@/lib/server/adapters/production/supabase-storage";

/** FR-4 production storage seam — unit-tested with injected fetch only. */

const KEY = "service-role-key-synthetic";

type Call = { url: string; init: RequestInit };

function fetchStub(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { impl, calls };
}

function adapter(impl: typeof fetch) {
  return new SupabaseStorageAdapter({
    url: "https://project.supabase.co/",
    serviceRoleKey: KEY,
    fetchImpl: impl,
  });
}

describe("SupabaseStorageAdapter (FR-4 seam)", () => {
  it("puts objects into the private bucket with upsert and service auth", async () => {
    const { impl, calls } = fetchStub(() => new Response("{}", { status: 200 }));
    await adapter(impl).put("org-1/sources/file.pdf", new Uint8Array([1, 2, 3]));
    expect(calls[0].url).toBe(
      "https://project.supabase.co/storage/v1/object/wepatent-private/org-1/sources/file.pdf",
    );
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers["x-upsert"]).toBe("true");
  });

  it("encodes path segments so tenant prefixes cannot be escaped", async () => {
    const { impl, calls } = fetchStub(() => new Response("{}", { status: 200 }));
    await adapter(impl).put("org-1/we ird?.bin", new Uint8Array([0]));
    expect(calls[0].url).toContain("/org-1/we%20ird%3F.bin");
  });

  it("gets object bytes and returns null for missing objects", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const { impl } = fetchStub((call) =>
      call.url.endsWith("/exists.bin")
        ? new Response(bytes, { status: 200 })
        : new Response("not found", { status: 404 }),
    );
    const found = await adapter(impl).get("org-1/exists.bin");
    expect([...(found ?? [])]).toEqual([9, 8, 7]);
    expect(await adapter(impl).get("org-1/missing.bin")).toBeNull();
  });

  it("deletes objects and tolerates already-deleted 404s", async () => {
    const { impl, calls } = fetchStub(() => new Response("gone", { status: 404 }));
    await adapter(impl).delete("org-1/old.bin");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("maps failures to a safe error keeping raw detail internal", async () => {
    const { impl } = fetchStub(
      () => new Response('{"message":"internal supabase secret detail"}', { status: 500 }),
    );
    const error: unknown = await adapter(impl)
      .put("org-1/x.bin", new Uint8Array([1]))
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SupabaseStorageError);
    const storageError = error as SupabaseStorageError;
    expect(storageError.message).toBe("storage_error");
    expect(storageError.message).not.toContain("secret detail");
    expect(storageError.internalDetail).toContain("HTTP 500");
  });
});
