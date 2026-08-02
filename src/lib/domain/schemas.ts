import { z } from "zod";
import { FACT_PROVENANCE_STATES } from "./provenance";
import { REVIEW_DECISIONS, REVIEW_STATES } from "./review";
import { ROLES } from "./roles";
import { RUN_STATES } from "./run-state";
import { MODEL_TIERS } from "./pricing";
import { WORK_TIERS, WORKFLOW_KEYS } from "./tiers";

/**
 * Zod schemas for the core professional-lane entities (PRD §11, §12).
 * These are the validation contracts used at API/service boundaries and by
 * the local-mode store. Every tenant-owned entity carries organizationId.
 */

export const idSchema = z.string().min(1);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

export const roleSchema = z.enum(ROLES);
export const workTierSchema = z.enum(WORK_TIERS);
export const workflowKeySchema = z.enum(WORKFLOW_KEYS);
export const runStateSchema = z.enum(RUN_STATES);
export const factProvenanceSchema = z.enum(FACT_PROVENANCE_STATES);
export const reviewStateSchema = z.enum(REVIEW_STATES);
export const reviewDecisionSchema = z.enum(REVIEW_DECISIONS);
export const modelTierSchema = z.enum(MODEL_TIERS);

export const JURISDICTIONS = ["US"] as const;
export const jurisdictionSchema = z.enum(JURISDICTIONS);

export const matterLifecycleSchema = z.enum(["active", "closed", "purged"]);

export const matterSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterNumber: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  jurisdiction: jurisdictionSchema,
  technologyArea: z.string().min(1).max(200),
  styleProfileId: idSchema.optional(),
  lifecycle: matterLifecycleSchema,
  /** Tenant-side conflict hygiene only; never analyzed cross-tenant. */
  conflictTags: z.array(z.string().max(120)).default([]),
  /** All demo data must be synthetic (hard constraint). */
  synthetic: z.literal(true).or(z.boolean()),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Matter = z.infer<typeof matterSchema>;

export const factCategorySchema = z.enum([
  "problem",
  "solution",
  "component",
  "step",
  "alternative",
  "advantage",
  "contributor",
  "date",
]);

export const matterFactSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  category: factCategorySchema,
  text: z.string().min(1).max(4000),
  provenance: factProvenanceSchema,
  sourceIds: z.array(idSchema).default([]),
  contributedBy: z.string().min(1),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MatterFact = z.infer<typeof matterFactSchema>;

export const sourceKindSchema = z.enum([
  "disclosure_upload",
  "interview_transcript",
  "prior_art_patent",
  "office_action",
  "reference_document",
  "search_result",
]);

export const sourceExtractionStateSchema = z.enum([
  "uploaded",
  "scanning",
  "quarantined",
  "extracting",
  "extracted",
  "failed",
]);

export const matterSourceSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  kind: sourceKindSchema,
  title: z.string().min(1).max(300),
  fileName: z.string().max(255).optional(),
  extractionState: sourceExtractionStateSchema,
  pageCount: z.number().int().nonnegative().optional(),
  synthetic: z.boolean(),
  uploadedBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
});
export type MatterSource = z.infer<typeof matterSourceSchema>;

export const qualityControlsSchema = z.object({
  sourceRequired: z.boolean(),
  secondModelReview: z.boolean(),
  quoteVerification: z.boolean(),
});
export type QualityControls = z.infer<typeof qualityControlsSchema>;

export const workflowRunSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  workflowKey: workflowKeySchema,
  workflowVersion: z.string().min(1),
  tier: workTierSchema,
  state: runStateSchema,
  jurisdiction: jurisdictionSchema,
  asOfDate: isoDateSchema,
  modelId: z.string().min(1),
  modelTier: modelTierSchema,
  corpusRelease: z.string().min(1),
  styleProfileVersion: z.string().min(1).optional(),
  deliverableType: z.string().min(1),
  qualityControls: qualityControlsSchema,
  estimatedChargeLowUsd: z.number().nonnegative(),
  estimatedChargeHighUsd: z.number().nonnegative(),
  actualChargeUsd: z.number().nonnegative().optional(),
  requestedBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WorkflowRun = z.infer<typeof workflowRunSchema>;

/** Composer submission contract (PRD §8.3). Validated server-side. */
export const runRequestSchema = z.object({
  matterId: idSchema,
  workflowKey: workflowKeySchema,
  jurisdiction: jurisdictionSchema,
  asOfDate: isoDateSchema,
  modelId: z.string().min(1),
  deliverableType: z.string().min(1).max(120),
  qualityControls: qualityControlsSchema,
  factIds: z.array(idSchema).default([]),
  sourceIds: z.array(idSchema).default([]),
  /**
   * LOCAL MODE ONLY: deterministic failure injection for demonstrating and
   * testing the FR-7 failure path. Ignored (rejected) outside local mode.
   */
  simulate: z
    .object({
      failAtStage: z.enum([
        "INGESTING",
        "RETRIEVING",
        "GENERATING",
        "VERIFYING",
        "RENDERING",
      ]),
    })
    .optional(),
});
export type RunRequest = z.infer<typeof runRequestSchema>;

/** Matter creation input (PRD §9.1.3). */
export const matterCreateSchema = z.object({
  matterNumber: z.string().min(1).max(64),
  title: z.string().min(1).max(300),
  jurisdiction: jurisdictionSchema,
  technologyArea: z.string().min(1).max(200),
  conflictTags: z.array(z.string().max(120)).default([]),
});
export type MatterCreateInput = z.infer<typeof matterCreateSchema>;

/** Matter patch input (PATCH /api/matters/:id). */
export const matterPatchSchema = z
  .object({
    title: z.string().min(1).max(300),
    technologyArea: z.string().min(1).max(200),
    conflictTags: z.array(z.string().max(120)),
    lifecycle: matterLifecycleSchema,
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "Empty patch",
  });
export type MatterPatchInput = z.infer<typeof matterPatchSchema>;

/** Fact creation input (POST /api/matters/:id/facts). */
export const factCreateSchema = z.object({
  category: factCategorySchema,
  text: z.string().min(1).max(4000),
  sourceIds: z.array(idSchema).default([]),
});
export type FactCreateInput = z.infer<typeof factCreateSchema>;

/** Signed-upload request (POST /api/matters/:id/uploads/sign). */
export const uploadSignSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/, "Unsupported file name"),
  contentType: z.enum([
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024, "Uploads are limited to 50 MB"),
});
export type UploadSignInput = z.infer<typeof uploadSignSchema>;

/** Run estimate request (POST /api/matters/:id/runs/estimate). */
export const runEstimateSchema = z.object({
  workflowKey: workflowKeySchema,
  modelId: z.string().min(1),
});
export type RunEstimateInput = z.infer<typeof runEstimateSchema>;

export const verificationStateSchema = z.enum([
  "unverified",
  "verified",
  "failed",
]);

/** Fact ledger event (PRD §11 fact_events; FR-3 approval events). */
export const factEventTypeSchema = z.enum([
  "created",
  "provenance_changed",
  "approved",
]);

export const factEventSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  factId: idSchema,
  eventType: factEventTypeSchema,
  fromProvenance: factProvenanceSchema.optional(),
  toProvenance: factProvenanceSchema.optional(),
  actorUserId: z.string().min(1),
  actorRole: roleSchema,
  note: z.string().max(2000).optional(),
  createdAt: isoDateTimeSchema,
});
export type FactEvent = z.infer<typeof factEventSchema>;

/** Per-stage run checkpoint (PRD §11 run_stages; FR-7). */
export const runStageCheckpointSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  runId: idSchema,
  stage: runStateSchema,
  enteredAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.optional(),
  /** True for the stage that performs the (simulated) billable provider call. */
  billable: z.boolean(),
  /**
   * Billable-call outcome checkpoint. FR-7: retries never repeat a billable
   * call with unknown prior outcome — this field is what a retry consults.
   */
  billableOutcome: z.enum(["committed", "succeeded", "failed"]).optional(),
  detail: z.string().max(1000).optional(),
});
export type RunStageCheckpoint = z.infer<typeof runStageCheckpointSchema>;

/** Wallet reservation → settlement record (FR-9 reservation-before-run). */
export const walletReservationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  runId: idSchema,
  /** Amount held at run creation (high end of the disclosed estimate). */
  heldUsd: z.number().nonnegative(),
  state: z.enum(["held", "settled", "released"]),
  /** Actual settled charge; remainder of the hold is returned. */
  settledUsd: z.number().nonnegative().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WalletReservation = z.infer<typeof walletReservationSchema>;

/** Signed-upload target (FR-4). Local mode issues simulated targets only. */
export const uploadTargetSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  maxBytes: z.number().int().positive(),
  /** Local-mode pseudo-URL; production issues a short-lived signed URL. */
  uploadUrl: z.string().min(1),
  expiresAt: isoDateTimeSchema,
  createdBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
  /** Local mode never accepts real uploads; the target is simulated. */
  simulated: z.literal(true),
});
export type UploadTarget = z.infer<typeof uploadTargetSchema>;

/** Version-locked export manifest (FR-8, §9.2 acceptance criteria). */
export const exportManifestSchema = z.object({
  manifestVersion: z.literal(1),
  exportId: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  documentId: idSchema,
  /** The manifest locks to this document version; later edits create new
   *  versions and never mutate an exported artifact. */
  documentVersion: z.number().int().positive(),
  documentVersionHash: z.string().min(8),
  title: z.string().min(1),
  deliverableType: z.string().min(1),
  tier: workTierSchema,
  reviewState: reviewStateSchema,
  verificationState: verificationStateSchema.optional(),
  /** Null only when review state is approved (watermark rule, §9.6.4). */
  watermark: z.string().nullable(),
  modelId: z.string().min(1),
  corpusRelease: z.string().min(1),
  checksums: z.object({
    /** SHA-256 of the exported DOCX bytes. */
    docxSha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** SHA-256 per section body, in document order. */
    sections: z.array(
      z.object({
        heading: z.string(),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    ),
  }),
  /** Approval provenance included with every export (FR-8). */
  approvals: z.array(
    z.object({
      decision: reviewDecisionSchema,
      actorUserId: idSchema,
      actorRole: roleSchema,
      decidedAt: isoDateTimeSchema,
      documentVersionHash: z.string().min(8),
    }),
  ),
  generatedAt: isoDateTimeSchema,
  generatedBy: z.string().min(1),
  disclaimer: z.string().min(1),
});
export type ExportManifest = z.infer<typeof exportManifestSchema>;

/** Stored export artifact (immutable once created). */
export const exportRecordSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  documentId: idSchema,
  documentVersion: z.number().int().positive(),
  fileName: z.string().min(1).max(255),
  docxSha256: z.string().regex(/^[0-9a-f]{64}$/),
  manifest: exportManifestSchema,
  /** DOCX bytes, base64 (local mode keeps artifacts in memory). */
  docxBase64: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: isoDateTimeSchema,
});
export type ExportRecord = z.infer<typeof exportRecordSchema>;

/** Claim record (PRD §11 claims/claim_versions, §8.2 /claims). */
export const claimRecordSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  claimNumber: z.number().int().positive(),
  /** Full claim text; dependency structure is parsed deterministically. */
  text: z.string().min(1).max(8000),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ClaimRecord = z.infer<typeof claimRecordSchema>;

export const reviewItemSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  runId: idSchema.optional(),
  documentTitle: z.string().min(1).max(300),
  documentVersionHash: z.string().min(8),
  tier: workTierSchema,
  state: reviewStateSchema,
  verificationState: verificationStateSchema,
  criticReportSummary: z.string().max(4000).optional(),
  deterministicCheckFailures: z.number().int().nonnegative().default(0),
  unresolvedFlags: z.array(z.string().max(300)).default([]),
  dueDate: isoDateSchema.optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export const reviewDecisionRecordSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  reviewItemId: idSchema,
  decision: reviewDecisionSchema,
  note: z.string().max(4000).optional(),
  actorUserId: idSchema,
  actorRole: roleSchema,
  documentVersionHash: z.string().min(8),
  decidedAt: isoDateTimeSchema,
});
export type ReviewDecisionRecord = z.infer<typeof reviewDecisionRecordSchema>;

export const auditEventSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema.optional(),
  actorUserId: z.string().min(1),
  actorRole: roleSchema.optional(),
  action: z.string().min(1).max(200),
  subjectType: z.string().min(1).max(80),
  subjectId: idSchema,
  detail: z.string().max(4000).optional(),
  createdAt: isoDateTimeSchema,
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const deadlineObservationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  label: z.string().min(1).max(300),
  observedDate: isoDateSchema,
  windowKind: z.string().max(120),
  /** Mandatory: deadline surfaces always carry the disclaimer (Invariant 20). */
  disclaimerRequired: z.literal(true),
  createdAt: isoDateTimeSchema,
});
export type DeadlineObservation = z.infer<typeof deadlineObservationSchema>;

export const workProductDocumentSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  matterId: idSchema,
  runId: idSchema.optional(),
  title: z.string().min(1).max(300),
  deliverableType: z.string().min(1).max(120),
  tier: workTierSchema,
  reviewState: reviewStateSchema,
  verificationState: verificationStateSchema,
  modelId: z.string().min(1),
  corpusRelease: z.string().min(1),
  version: z.number().int().positive(),
  versionHash: z.string().min(8),
  /** Draft body sections (synthetic in local mode). */
  sections: z.array(
    z.object({
      heading: z.string().min(1).max(200),
      body: z.string().max(20000),
      /** Deterministic-check or verifier flags annotating this section. */
      flags: z.array(z.string().max(300)).default([]),
    }),
  ),
  actualChargeUsd: z.number().nonnegative().optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type WorkProductDocument = z.infer<typeof workProductDocumentSchema>;

/** The mandatory deadline disclaimer text (Invariant 20, §5.5). */
export const DEADLINE_DISCLAIMER =
  "Lex Patent Studio is not a docketing system — verify every date against your docket.";

/** The mandatory unreviewed-output watermark (Invariant 11 analog). */
export const DRAFT_WATERMARK = "DRAFT — NOT REVIEWED";
