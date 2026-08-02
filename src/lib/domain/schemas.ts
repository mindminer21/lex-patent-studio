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
});
export type RunRequest = z.infer<typeof runRequestSchema>;

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

export const verificationStateSchema = z.enum([
  "unverified",
  "verified",
  "failed",
]);

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
