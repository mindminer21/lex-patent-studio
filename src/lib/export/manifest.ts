import { createHash } from "node:crypto";
import { exportWatermark } from "@/lib/domain/review";
import {
  DEADLINE_DISCLAIMER,
  type ExportManifest,
  type ReviewDecisionRecord,
  type WorkProductDocument,
} from "@/lib/domain/schemas";

/**
 * Version-locked export manifests (FR-8, §9.2 acceptance criteria).
 *
 * A manifest locks to a specific document version and hash. Later edits
 * create NEW document versions and therefore new exports — an exported
 * artifact and its manifest are never mutated.
 */

export const EXPORT_DISCLAIMER =
  "Prepared by Lex Patent Studio under practitioner supervision. This export is work product for professional review; it is not legal advice, is not filed, and creates no attorney–client relationship. " +
  DEADLINE_DISCLAIMER;

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface BuildManifestInput {
  exportId: string;
  document: WorkProductDocument;
  decisions: ReviewDecisionRecord[];
  docxBuffer: Buffer;
  generatedBy: string;
  generatedAt: string;
}

export function buildExportManifest(input: BuildManifestInput): ExportManifest {
  const { document } = input;
  return {
    manifestVersion: 1,
    exportId: input.exportId,
    organizationId: document.organizationId,
    matterId: document.matterId,
    documentId: document.id,
    documentVersion: document.version,
    documentVersionHash: document.versionHash,
    title: document.title,
    deliverableType: document.deliverableType,
    tier: document.tier,
    reviewState: document.reviewState,
    verificationState: document.verificationState,
    // Watermark rule (§9.6.4): null ONLY when approved by a human reviewer.
    watermark: exportWatermark(document.reviewState),
    modelId: document.modelId,
    corpusRelease: document.corpusRelease,
    checksums: {
      docxSha256: sha256Hex(input.docxBuffer),
      sections: document.sections.map((s) => ({
        heading: s.heading,
        sha256: sha256Hex(s.body),
      })),
    },
    approvals: input.decisions.map((d) => ({
      decision: d.decision,
      actorUserId: d.actorUserId,
      actorRole: d.actorRole,
      decidedAt: d.decidedAt,
      documentVersionHash: d.documentVersionHash,
    })),
    generatedAt: input.generatedAt,
    generatedBy: input.generatedBy,
    disclaimer: EXPORT_DISCLAIMER,
  };
}

/** Stable file name for an export artifact. */
export function exportFileName(document: WorkProductDocument): string {
  const slug = document.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "document"}-v${document.version}.docx`;
}
