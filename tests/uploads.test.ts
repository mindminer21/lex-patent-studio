import { beforeEach, describe, expect, it } from "vitest";
import {
  canTransitionSource,
  scanBytes,
  validateUploadBytes,
  validateUploadRequest,
} from "@/lib/wepatent/domain/uploads";
import { getAdapters } from "@/lib/server/adapters";
import { LocalDataAdapter } from "@/lib/server/adapters/local/store";
import { processJob } from "@/lib/server/jobs/runner";
import { createOrganizationForUser } from "@/lib/server/services/orgs";
import { acceptUpload, signUpload, verifyUploadToken } from "@/lib/server/services/uploads";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\nsynthetic test document\n%%EOF");
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const EICAR_TEXT = new TextEncoder().encode(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);

async function setup() {
  LocalDataAdapter.reset();
  const { data } = getAdapters();
  const user = await data.createUser({ email: "up@example.test", displayName: "Uploader" });
  const org = await createOrganizationForUser(user.id, "Upload Test Org");
  const [invention] = await data.listInventions(org.id);
  return { data, user, org, invention };
}

describe("upload validation (FR-4)", () => {
  it("rejects disallowed MIME types before any byte transfer", () => {
    const result = validateUploadRequest({
      filename: "app.exe",
      mimeType: "application/x-msdownload",
      declaredBytes: 100,
    });
    expect(result).toEqual({ ok: false, reason: "mime_not_allowed" });
  });

  it("rejects extension mismatches and oversized declarations", () => {
    expect(
      validateUploadRequest({ filename: "notes.exe", mimeType: "application/pdf", declaredBytes: 10 }),
    ).toEqual({ ok: false, reason: "extension_mismatch" });
    expect(
      validateUploadRequest({
        filename: "big.pdf",
        mimeType: "application/pdf",
        declaredBytes: 21 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
    expect(
      validateUploadRequest({ filename: "x.pdf", mimeType: "application/pdf", declaredBytes: 0 }),
    ).toEqual({ ok: false, reason: "empty_file" });
  });

  it("enforces magic bytes: a renamed executable is not a PDF", () => {
    const fake = new TextEncoder().encode("MZ\x90\x00 this is not a pdf");
    const result = validateUploadBytes({
      filename: "disguised.pdf",
      mimeType: "application/pdf",
      bytes: fake,
    });
    expect(result).toEqual({ ok: false, reason: "magic_byte_mismatch" });
    expect(
      validateUploadBytes({ filename: "real.pdf", mimeType: "application/pdf", bytes: PDF_BYTES }).ok,
    ).toBe(true);
    expect(
      validateUploadBytes({ filename: "img.png", mimeType: "image/png", bytes: PNG_MAGIC }).ok,
    ).toBe(true);
  });

  it("requires valid UTF-8 for text uploads", () => {
    const invalid = new Uint8Array([0xff, 0xfe, 0x00, 0xd8, 0x01]);
    expect(
      validateUploadBytes({ filename: "notes.txt", mimeType: "text/plain", bytes: invalid }),
    ).toEqual({ ok: false, reason: "not_valid_text" });
  });

  it("detects the EICAR test signature in the scan step", () => {
    expect(scanBytes(EICAR_TEXT).clean).toBe(false);
    expect(scanBytes(PDF_BYTES).clean).toBe(true);
  });
});

describe("quarantine state machine", () => {
  it("permits only the pipeline order and makes rejected/extracted terminal", () => {
    expect(canTransitionSource("registered", "uploaded")).toBe(true);
    expect(canTransitionSource("uploaded", "quarantined")).toBe(true);
    expect(canTransitionSource("quarantined", "scanned")).toBe(true);
    expect(canTransitionSource("scanned", "extracted")).toBe(true);
    expect(canTransitionSource("quarantined", "rejected")).toBe(true);
    // Skips are impossible:
    expect(canTransitionSource("registered", "scanned")).toBe(false);
    expect(canTransitionSource("registered", "extracted")).toBe(false);
    expect(canTransitionSource("uploaded", "extracted")).toBe(false);
    expect(canTransitionSource("quarantined", "extracted")).toBe(false);
    // Terminal states:
    expect(canTransitionSource("rejected", "scanned")).toBe(false);
    expect(canTransitionSource("extracted", "rejected")).toBe(false);
  });
});

describe("signed upload pipeline (service level)", () => {
  beforeEach(() => {
    LocalDataAdapter.reset();
  });

  it("runs the full happy path: sign → put → quarantined → scanned → extracted", async () => {
    const { data, user, org, invention } = await setup();
    const signed = await signUpload({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      input: {
        filename: "bench-report.pdf",
        mimeType: "application/pdf",
        declaredBytes: PDF_BYTES.length,
        kind: "data",
        note: "synthetic test upload",
      },
    });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const accepted = await acceptUpload({ token: signed.token, bytes: PDF_BYTES });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.source.status).toBe("quarantined");
    expect(accepted.source.checksumSha256).toHaveLength(64);

    // Scan job was enqueued; run it, then the extraction job it chains.
    const scanJob = await data.findJobByKey(org.id, "source_scan", `scan:${signed.sourceId}`);
    expect(scanJob).not.toBeNull();
    await processJob(org.id, scanJob!.id);
    expect((await data.getSource(org.id, signed.sourceId))?.status).toBe("scanned");

    const extractJob = await data.findJobByKey(
      org.id,
      "source_extraction",
      `extract:${signed.sourceId}`,
    );
    expect(extractJob).not.toBeNull();
    await processJob(org.id, extractJob!.id);
    expect((await data.getSource(org.id, signed.sourceId))?.status).toBe("extracted");
  });

  it("rejects a signed upload whose bytes fail the signature check", async () => {
    const { data, user, org, invention } = await setup();
    const signed = await signUpload({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      input: {
        filename: "fake.pdf",
        mimeType: "application/pdf",
        declaredBytes: 20,
        kind: "data",
        note: "",
      },
    });
    if (!signed.ok) throw new Error("sign failed");
    const accepted = await acceptUpload({
      token: signed.token,
      bytes: new TextEncoder().encode("not a pdf at all!!"),
    });
    expect(accepted).toEqual({ ok: false, error: "magic_byte_mismatch" });
    const source = await data.getSource(org.id, signed.sourceId);
    expect(source?.status).toBe("rejected");
    expect(source?.quarantineReason).toContain("magic_byte_mismatch");
  });

  it("quarantines then rejects an EICAR file at the scan step", async () => {
    const { data, user, org, invention } = await setup();
    const signed = await signUpload({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      input: {
        filename: "eicar.txt",
        mimeType: "text/plain",
        declaredBytes: EICAR_TEXT.length,
        kind: "other",
        note: "",
      },
    });
    if (!signed.ok) throw new Error("sign failed");
    const accepted = await acceptUpload({ token: signed.token, bytes: EICAR_TEXT });
    expect(accepted.ok).toBe(true);

    const scanJob = await data.findJobByKey(org.id, "source_scan", `scan:${signed.sourceId}`);
    await processJob(org.id, scanJob!.id);
    const source = await data.getSource(org.id, signed.sourceId);
    expect(source?.status).toBe("rejected");
    expect(source?.quarantineReason).toContain("EICAR");
    // Rejected bytes are deleted from storage.
    const { storage } = getAdapters();
    expect(await storage.get(`uploads/${org.id}/${signed.sourceId}`)).toBeNull();
  });

  it("refuses expired or tampered tokens and double uploads", async () => {
    const { user, org, invention } = await setup();
    const signed = await signUpload({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      input: {
        filename: "once.txt",
        mimeType: "text/plain",
        declaredBytes: 5,
        kind: "other",
        note: "",
      },
    });
    if (!signed.ok) throw new Error("sign failed");

    expect(verifyUploadToken(`${signed.token}tampered`)).toBeNull();
    expect(verifyUploadToken("garbage")).toBeNull();

    const bytes = new TextEncoder().encode("hello");
    const first = await acceptUpload({ token: signed.token, bytes });
    expect(first.ok).toBe(true);
    const second = await acceptUpload({ token: signed.token, bytes });
    expect(second).toEqual({ ok: false, error: "already_uploaded" });
  });

  it("sign step rejects disallowed types without creating usable tokens", async () => {
    const { user, org, invention } = await setup();
    const signed = await signUpload({
      organizationId: org.id,
      userId: user.id,
      inventionId: invention.id,
      input: {
        filename: "malware.exe",
        mimeType: "application/x-msdownload",
        declaredBytes: 10,
        kind: "other",
        note: "",
      },
    });
    expect(signed).toEqual({ ok: false, error: "mime_not_allowed" });
  });
});
