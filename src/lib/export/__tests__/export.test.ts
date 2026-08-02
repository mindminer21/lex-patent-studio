import { beforeEach, describe, expect, it } from "vitest";
import { localAdapters, resetLocalStore, getLocalStore } from "@/lib/adapters/local";
import { DEMO_SESSION, ORG_ID } from "@/lib/adapters/local/seed";
import {
  planDocx,
  renderUsptoDocx,
  USPTO_FONT,
  USPTO_FONT_SIZE_HALF_POINTS,
  USPTO_LINE_DOUBLE,
  USPTO_MARGINS,
} from "@/lib/export/docx";
import { buildExportManifest, sha256Hex } from "@/lib/export/manifest";
import { layoutPdfPages, renderUsptoPdf } from "@/lib/export/pdf";
import { DRAFT_WATERMARK } from "@/lib/domain/schemas";

const PRACTITIONER = { userId: DEMO_SESSION.userId, role: DEMO_SESSION.role };

describe("USPTO DOCX formatting constants", () => {
  it("uses Times New Roman 12pt, double spacing, and a 1.5-inch left margin", () => {
    expect(USPTO_FONT).toBe("Times New Roman");
    expect(USPTO_FONT_SIZE_HALF_POINTS).toBe(24); // 12 pt in half-points
    expect(USPTO_LINE_DOUBLE).toBe(480); // double-spaced
    expect(USPTO_MARGINS.left).toBe(2160); // 1.5" in twips
    expect(USPTO_MARGINS.top).toBe(1440);
  });
});

describe("watermark rules (§9.6.4)", () => {
  beforeEach(() => resetLocalStore());

  it("plans the DRAFT — NOT REVIEWED watermark for any non-approved state", () => {
    const store = getLocalStore();
    const pending = store.documents.find((d) => d.id === "doc_t_sections")!;
    expect(pending.reviewState).toBe("pending_review");
    const plan = planDocx(pending);
    expect(plan.watermark).toBe(DRAFT_WATERMARK);
    expect(plan.headerLines).toContain(DRAFT_WATERMARK);
  });

  it("omits the watermark only when a human approved the document", () => {
    const store = getLocalStore();
    const approved = store.documents.find((d) => d.id === "doc_t_memo")!;
    expect(approved.reviewState).toBe("approved");
    const plan = planDocx(approved);
    expect(plan.watermark).toBeNull();
    expect(plan.headerLines).toHaveLength(0);
  });

  it("renders a real DOCX (ZIP container) for both states", async () => {
    const store = getLocalStore();
    for (const id of ["doc_t_sections", "doc_t_memo"]) {
      const doc = store.documents.find((d) => d.id === id)!;
      const buffer = await renderUsptoDocx(doc);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
    }
  });
});

describe("export manifests (FR-8)", () => {
  beforeEach(() => resetLocalStore());

  it("locks the manifest to the document version with SHA-256 checksums", async () => {
    const result = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { manifest } = result.record;
    const doc = (await localAdapters.data.getDocument(ORG_ID, "doc_t_sections"))!;

    expect(manifest.documentVersion).toBe(doc.version);
    expect(manifest.documentVersionHash).toBe(doc.versionHash);
    expect(manifest.watermark).toBe(DRAFT_WATERMARK);
    expect(manifest.checksums.docxSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.checksums.docxSha256).toBe(
      sha256Hex(Buffer.from(result.record.docxBase64, "base64")),
    );
    expect(manifest.checksums.sections).toHaveLength(doc.sections.length);
    expect(manifest.checksums.sections[0].sha256).toBe(
      sha256Hex(doc.sections[0].body),
    );
    expect(manifest.disclaimer).toContain("not a docketing system");
  });

  it("includes approval provenance for approved documents", async () => {
    // Approve the pending review item first (human decision).
    const decided = await localAdapters.data.decideReviewItem(
      ORG_ID,
      "rev_t_sections",
      "approve",
      { userId: DEMO_SESSION.userId, role: "practitioner" },
    );
    expect(decided.ok).toBe(true);

    const result = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.manifest.watermark).toBeNull();
    expect(result.record.manifest.approvals).toContainEqual(
      expect.objectContaining({
        decision: "approve",
        actorUserId: DEMO_SESSION.userId,
      }),
    );
  });

  it("is immutable: re-export of the same version returns the same artifact", async () => {
    const first = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    const second = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.docxSha256).toBe(first.record.docxSha256);
    expect(getLocalStore().exports).toHaveLength(1);
  });

  it("a later document version produces a NEW export, never mutating the old one", async () => {
    const first = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstSha = first.record.docxSha256;

    // Simulate a post-export edit: new version, new hash.
    const store = getLocalStore();
    const doc = store.documents.find((d) => d.id === "doc_t_sections")!;
    doc.version += 1;
    doc.sections[0] = { ...doc.sections[0], body: doc.sections[0].body + " Edited." };
    doc.versionHash = "ffffffffffffffff";

    const second = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(false);
    expect(second.record.id).not.toBe(first.record.id);
    expect(second.record.manifest.documentVersion).toBe(doc.version);

    // Original artifact untouched.
    const original = await localAdapters.data.getExport(ORG_ID, first.record.id);
    expect(original?.docxSha256).toBe(firstSha);
    expect(original?.manifest.documentVersion).toBe(doc.version - 1);
  });

  it("denies export to roles without export rights", async () => {
    const denied = await localAdapters.data.createExport(ORG_ID, "doc_t_sections", {
      userId: "user_demo_chen",
      role: "contributor",
    });
    expect(denied.ok).toBe(false);

    // Operators may export drafts but not approved work product.
    const operatorDraft = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      { userId: "user_demo_ortiz", role: "agent_operator" },
    );
    expect(operatorDraft.ok).toBe(true);

    const operatorApproved = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_memo", // seeded as approved
      { userId: "user_demo_ortiz", role: "agent_operator" },
    );
    expect(operatorApproved.ok).toBe(false);
  });

  it("manifest validates against its Zod schema", async () => {
    const { exportManifestSchema } = await import("@/lib/domain/schemas");
    const result = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => exportManifestSchema.parse(result.record.manifest)).not.toThrow();

    const built = buildExportManifest({
      exportId: "exp_test",
      document: (await localAdapters.data.getDocument(ORG_ID, "doc_t_memo"))!,
      decisions: [],
      docxBuffer: Buffer.from("test"),
      pdfBuffer: Buffer.from("test-pdf"),
      generatedBy: DEMO_SESSION.userId,
      generatedAt: new Date().toISOString(),
    });
    expect(() => exportManifestSchema.parse(built)).not.toThrow();
  });
});

describe("USPTO PDF rendering (FR-8)", () => {
  beforeEach(() => resetLocalStore());

  it("renders a valid PDF with the DRAFT watermark for unapproved documents", () => {
    const store = getLocalStore();
    const pending = store.documents.find((d) => d.id === "doc_t_sections")!;
    const buffer = renderUsptoPdf(pending);
    expect(buffer.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(buffer.toString("latin1")).toContain("%%EOF");
    // Watermark text appears in the (uncompressed) content stream.
    expect(buffer.toString("latin1")).toContain("DRAFT");
    // Times fonts with WinAnsi encoding.
    expect(buffer.toString("latin1")).toContain("/Times-Roman");
    expect(buffer.toString("latin1")).toContain("/Times-Bold");
  });

  it("omits the watermark for human-approved documents", () => {
    const store = getLocalStore();
    const approved = store.documents.find((d) => d.id === "doc_t_memo")!;
    expect(approved.reviewState).toBe("approved");
    const buffer = renderUsptoPdf(approved);
    expect(buffer.toString("latin1")).not.toContain("DRAFT");
  });

  it("is deterministic: identical input produces identical bytes", () => {
    const store = getLocalStore();
    const doc = store.documents.find((d) => d.id === "doc_t_sections")!;
    const a = sha256Hex(renderUsptoPdf(doc));
    const b = sha256Hex(renderUsptoPdf(doc));
    expect(a).toBe(b);
  });

  it("lays out multi-page output with footer chrome on every page", () => {
    const store = getLocalStore();
    const doc = structuredClone(
      store.documents.find((d) => d.id === "doc_t_sections")!,
    );
    // Force pagination with a long body.
    doc.sections = Array.from({ length: 12 }, (_, i) => ({
      heading: `Section ${i + 1}`,
      body: "Deterministic filler sentence for pagination testing. ".repeat(30),
      flags: [],
    }));
    const pages = layoutPdfPages(planDocx(doc));
    expect(pages.length).toBeGreaterThan(1);
    for (const [index, page] of pages.entries()) {
      const labels = page.map((line) => line.text);
      expect(labels).toContain(`Page ${index + 1} of ${pages.length}`);
      // Watermark chrome present on every page (pending review state).
      expect(labels[0]).toContain("DRAFT");
    }
  });

  it("createExport stores both artifacts with matching manifest checksums", async () => {
    const result = await localAdapters.data.createExport(
      ORG_ID,
      "doc_t_sections",
      PRACTITIONER,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { record } = result;
    expect(record.pdfFileName.endsWith(".pdf")).toBe(true);
    expect(record.manifest.checksums.pdfSha256).toBe(
      sha256Hex(Buffer.from(record.pdfBase64, "base64")),
    );
    expect(record.pdfSha256).toBe(record.manifest.checksums.pdfSha256);
  });
});
