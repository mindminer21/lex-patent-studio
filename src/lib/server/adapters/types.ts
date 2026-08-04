import type { Role } from "@/lib/wepatent/domain/roles";
import type { AcknowledgementKey, UserAgentCategory } from "@/lib/wepatent/domain/clickwrap";
import type {
  CounselRequestAction,
  CounselRequestState,
} from "@/lib/wepatent/domain/counsel-request";
import type { FactActor, FactCategory, FactProvenance } from "@/lib/wepatent/domain/facts";
import type { IntakeState } from "@/lib/wepatent/domain/intake";
import type {
  PsActor,
  PsEventKind,
  PsOrigin,
  PsPairKind,
  PsState,
} from "@/lib/wepatent/domain/ps-ledger";
import type { CoverageDimension, CoverageStatus } from "@/lib/wepatent/domain/coverage";
import type {
  AnswerKind,
  InterviewSessionStatus,
  InterviewStage,
} from "@/lib/wepatent/domain/interview";
import type { InterpretationStatus } from "@/lib/wepatent/domain/uploads";
import type { RegionAnchor } from "@/lib/wepatent/domain/evidence";
import type { Reservation } from "@/lib/wepatent/domain/usage";

/**
 * Typed adapter contracts (PRD Phase 0, §18).
 *
 * Every external dependency sits behind one of these ports. Local mode uses
 * the in-memory implementations in `./local`; production adapters (Supabase,
 * Stripe, provider gateway) are stubbed seams in `./production`.
 */

export type Id = string;

export interface UserRecord {
  id: Id;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface OrganizationRecord {
  id: Id;
  name: string;
  retentionDays: number;
  createdAt: string;
  deletedAt: string | null;
}

export interface MembershipRecord {
  id: Id;
  organizationId: Id;
  userId: Id;
  role: Role;
  createdAt: string;
}

export interface TermsAcceptanceRecord {
  id: Id;
  organizationId: Id;
  userId: Id;
  termsVersion: string;
  acknowledgedKeys: AcknowledgementKey[];
  acceptedAt: string;
  ipHash: string;
  userAgentCategory: UserAgentCategory;
}

export interface IntakeSessionRecord {
  id: Id;
  organizationId: Id;
  userId: Id;
  state: IntakeState;
  updatedAt: string;
  submittedInventionId: Id | null;
}

export interface InventionRecord {
  id: Id;
  organizationId: Id;
  title: string;
  summary: string;
  businessContext: string;
  problem: string;
  solution: string;
  status: "active" | "soft_deleted";
  /** True for seeded demonstration data; shown conspicuously in UI. */
  synthetic: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventionFactRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  category: FactCategory;
  statement: string;
  provenance: FactProvenance;
  createdBy: FactActor;
  /**
   * Provenance origin ref (Intake Studio §8): traces a fact to an upload
   * or interview turn, e.g. "turn:<interview_turn_id>". Optional/additive.
   */
  originRef?: string | null;
  updatedAt: string;
}

export interface ContributorRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  name: string;
  email: string | null;
  contribution: string;
}

export interface DisclosureEventRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  date: string;
  kind: string;
  description: string;
  underNda: boolean;
}

export type SourceStatus =
  | "registered"
  | "uploaded"
  | "quarantined"
  | "scanned"
  | "extracted"
  | "rejected";

export interface SourceRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  name: string;
  kind: string;
  note: string;
  status: SourceStatus;
  synthetic: boolean;
  createdAt: string;
  /** FR-4 upload pipeline metadata; null for metadata-only registrations. */
  originalFilename: string | null;
  mimeType: string | null;
  byteSize: number | null;
  storagePath: string | null;
  checksumSha256: string | null;
  quarantineReason: string | null;
  /**
   * Intake Studio interpretation outcome (PRD §5.2). Null on legacy rows is
   * equivalent to "not_interpreted". `stored_uninterpreted` is honest and
   * first-class — never a silent skip or a fake interpretation.
   */
  interpretationStatus: InterpretationStatus | null;
  /**
   * M3 render-to-vision: set on image sources captured as canonical
   * snapshot views of a parent 3D source (browser-rendered, user-triggered).
   */
  derivedFromSourceId: Id | null;
}

export type DraftWorkflow =
  | "invention_disclosure_summary"
  | "counsel_question_list"
  | "gap_analysis";

export interface DraftRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  workflow: DraftWorkflow;
  title: string;
  createdAt: string;
}

export interface DraftVersionRecord {
  id: Id;
  organizationId: Id;
  draftId: Id;
  version: number;
  content: string;
  modelId: string;
  rateVersion: string;
  estimateCustomerHighCents: number;
  actualProviderCostCents: number;
  actualCustomerChargeCents: number;
  unresolvedFactCount: number;
  sourceStatusSummary: string;
  /**
   * Reservation this version settled against — makes retry deduplication
   * exact: the same idempotency key maps to the same reservation, which
   * maps to at most one stored version (PRD §7.4).
   */
  reservationId: Id | null;
  /** Always "working_draft" — the platform can never mark a draft approved. */
  label: "working_draft";
  createdAt: string;
}

export interface ExportRecordEntry {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  draftVersionId: Id | null;
  manifest: ExportManifest;
  checksum: string;
  createdAt: string;
}

export interface ExportManifest {
  inventionId: Id;
  inventionTitle: string;
  sections: string[];
  draftVersionId: Id | null;
  draftLabel: string;
  factCount: number;
  unresolvedFactCount: number;
  contributorCount: number;
  disclosureEventCount: number;
  sourceCount: number;
  generatedAt: string;
  notice: string;
  /** Intake Studio M1 additions (optional for pre-M1 exports). */
  psProblemCount?: number;
  psSolutionCount?: number;
  psConfirmedCount?: number;
  coverageSatisfied?: number;
  coverageTotal?: number;
  coverageVersion?: string;
  /** Intake Studio M3 additions (optional for pre-M3 exports). */
  psAssociationCount?: number;
  psRegionAnchorCount?: number;
}

export interface CounselRequestRecord {
  id: Id;
  organizationId: Id;
  createdByUserId: Id;
  state: CounselRequestState;
  inventionId: Id | null;
  /** Limited conflict-intake fields only (PRD §7.6). */
  requestSummary: string;
  adverseParties: string;
  jurisdiction: string;
  contactEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface CounselRequestEventRecord {
  id: Id;
  organizationId: Id;
  requestId: Id;
  fromState: CounselRequestState;
  toState: CounselRequestState;
  action: CounselRequestAction;
  actorRole: Role;
  evidenceRef: string | null;
  createdAt: string;
}

export interface WalletRecord {
  organizationId: Id;
  balanceCents: number;
  reservedCents: number;
}

export type LedgerEntryKind =
  | "promo_credit"
  | "top_up"
  | "settlement"
  | "release"
  | "adjustment";

export interface LedgerEntryRecord {
  id: Id;
  organizationId: Id;
  kind: LedgerEntryKind;
  /** Signed cents. Credits positive, charges negative. */
  amountCents: number;
  reservationId: Id | null;
  /**
   * Stripe event/session reference for money that arrived via Stripe.
   * Used to make webhook-driven credits idempotent (FR-6).
   */
  stripeReference?: string | null;
  note: string;
  createdAt: string;
}

export type ReservationRecord = Reservation & {
  organizationId: Id;
  createdAt: string;
};

/**
 * Verified Stripe webhook events (FR-6). The Stripe event id is the primary
 * key, which makes webhook redelivery idempotent by construction.
 */
export interface StripeEventRecord {
  /** Stripe event id, e.g. "evt_...". */
  id: string;
  type: string;
  payload: Record<string, unknown>;
  signatureVerified: boolean;
  processedAt: string | null;
  receivedAt: string;
}

export type BillingOutboxStatus = "pending" | "processing" | "done" | "failed";

/** Billing outbox (FR-6): webhook effects applied through a durable queue. */
export interface BillingOutboxRecord {
  id: Id;
  organizationId: Id | null;
  stripeEventId: string | null;
  action: string;
  payload: Record<string, string | number | boolean | null>;
  status: BillingOutboxStatus;
  attempts: number;
  createdAt: string;
  processedAt: string | null;
}

export interface UsageEventRecord {
  id: Id;
  organizationId: Id;
  reservationId: Id;
  modelId: string;
  rateVersion: string;
  providerCostCents: number;
  customerChargeCents: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Round 2 records: jobs, invitations, counsel lane, export artifacts   */
/* ------------------------------------------------------------------ */

export type JobKind =
  | "generation"
  | "source_scan"
  | "source_extraction"
  | "source_interpretation"
  | "distillation"
  | "export_render";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface JobRecord {
  id: Id;
  organizationId: Id;
  kind: JobKind;
  status: JobStatus;
  idempotencyKey: string;
  payload: Record<string, string | number | boolean | null>;
  result: Record<string, string | number | boolean | null>;
  errorSummary: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface InvitationRecord {
  id: Id;
  organizationId: Id;
  email: string;
  /** Ordinary org roles only — counsel roles can never be invited (FR-2). */
  role: Role;
  tokenHash: string;
  invitedBy: Id;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: Id | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface EngagementRecord {
  id: Id;
  organizationId: Id;
  requestId: Id;
  lawFirmName: string;
  scopeSummary: string;
  signedDocumentRef: string | null;
  offeredAt: string;
  signedAt: string | null;
}

export interface LegalMatterRecord {
  id: Id;
  organizationId: Id;
  engagementId: Id;
  matterReference: string;
  openedAt: string;
}

export type FilingPackageStatus = "in_preparation" | "counsel_review" | "counsel_approved";

export interface FilingPackageRecord {
  id: Id;
  organizationId: Id;
  matterId: Id;
  description: string;
  /** No "submitted" status exists — wepatent never files (PRD §5.5). */
  status: FilingPackageStatus;
  createdAt: string;
}

export type CounselRole = "counsel_intake" | "counsel_attorney";

export interface CounselAssignmentRecord {
  userId: Id;
  role: CounselRole;
  lawFirmName: string;
  /**
   * FR-1: MFA is REQUIRED for counsel administrators. Production sets this
   * from Supabase Auth MFA enrollment (AAL2); `requireCounsel` refuses
   * unenrolled counsel sessions in production mode.
   */
  mfaEnrolled: boolean;
  createdAt: string;
}

export interface CounselAuditEventRecord {
  id: Id;
  counselUserId: Id;
  organizationId: Id | null;
  requestId: Id | null;
  action: string;
  meta: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface ExportArtifactRecord {
  id: Id;
  organizationId: Id;
  exportId: Id;
  name: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
  createdAt: string;
}

export interface AuditEventRecord {
  id: Id;
  organizationId: Id | null;
  actor: string;
  action: string;
  target: string;
  meta: Record<string, string | number | boolean | null>;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Intake Studio records (feature PRD §8)                               */
/* ------------------------------------------------------------------ */

/** Problem or solution ledger item. AI writes arrive only as `ai_proposed`. */
export interface PsPairRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  kind: PsPairKind;
  statement: string;
  state: PsState;
  origin: PsOrigin;
  createdByActor: PsActor;
  /** Human-readable source anchors, e.g. "source:memo.pdf" or "artifact:<id>". */
  sourceAnchors: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PsLinkRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  problemId: Id;
  solutionId: Id;
  state: PsState;
  createdAt: string;
}

/** Append-only ledger mutation log, including AI-proposal rejections. */
export interface PsEventRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  pairId: Id | null;
  kind: PsEventKind;
  actor: string;
  detail: string;
  createdAt: string;
}

/** Working-title proposal history: append-only; the newest row is current. */
export interface WorkingTitleRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  text: string;
  state: PsState;
  createdByActor: PsActor;
  createdAt: string;
}

export interface ComponentRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  name: string;
  description: string;
  state: PsState;
  sourceAnchors: string[];
  createdAt: string;
}

/**
 * Solution → evidence association (feature PRD §7/§8, FR-INT-9). Evidence
 * may be a component, an extraction artifact, a REGION ANCHOR drawn on a
 * source (page/image/3D-view rectangle, normalized coordinates), and/or an
 * interview turn. AI-proposed anchors stay `ai_proposed` until a human
 * confirms or redraws them (invariant 13).
 */
export interface AssociationRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  solutionId: Id;
  componentId: Id | null;
  extractionArtifactId: Id | null;
  /** Source the region anchor was drawn on (M3). */
  sourceId: Id | null;
  /** Normalized region rectangle (M3, domain/evidence.ts). */
  region: RegionAnchor | null;
  /** Interview-turn evidence link (M3). */
  interviewTurnId: Id | null;
  createdByActor: PsActor;
  state: PsState;
  createdAt: string;
}

export type ExtractionArtifactType =
  | "interpretation_summary"
  | "text_excerpt"
  | "status_note"
  /** Deterministic non-model 3D geometry parse (M2 STL hardening). */
  | "geometry_summary"
  /** Audio transcription output (M3 A/V ingestion, §5.1 Phase 2). */
  | "transcript";

/** Per-source interpretation output with model + cost provenance. */
export interface ExtractionArtifactRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  sourceId: Id;
  type: ExtractionArtifactType;
  content: string;
  modelId: string | null;
  /** Reservation the producing model run settled against (cost provenance). */
  costReservationId: Id | null;
  createdAt: string;
}

/**
 * Adaptive interview session (feature PRD §6, FR-INT-6). Stage/status are
 * engine-owned; `spentCents` is the settled model spend attributed to this
 * session (question drafting + per-turn extraction), maintained by trusted
 * server logic only (FR-INT-10).
 */
export interface InterviewSessionRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  userId: Id;
  stage: InterviewStage;
  status: InterviewSessionStatus;
  sessionSpendCapCents: number;
  spentCents: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One interview turn: an engine-targeted question and (once submitted) its
 * answer. `targetRef` is the machine-readable target the engine selected
 * (`topic:<stage>:<id>` or `coverage:<solutionId>:<dimension>`).
 */
export interface InterviewTurnRecord {
  id: Id;
  organizationId: Id;
  sessionId: Id;
  turnIndex: number;
  stage: InterviewStage;
  question: string;
  followups: string[];
  targetRef: string | null;
  answerText: string | null;
  /** Null while the question is pending an answer. */
  answerKind: AnswerKind | null;
  skipped: boolean;
  attachmentSourceIds: string[];
  extractionJobId: Id | null;
  createdAt: string;
}

/** Deterministic coverage snapshot rows; history kept (append-only). */
export interface EnablementCoverageRecord {
  id: Id;
  organizationId: Id;
  inventionId: Id;
  solutionId: Id;
  dimension: CoverageDimension;
  status: CoverageStatus;
  evidence: string | null;
  coverageVersion: string;
  computedAt: string;
}

/* ------------------------------------------------------------------ */
/* Ports                                                                */
/* ------------------------------------------------------------------ */

export interface DataPort {
  // Users and auth-adjacent lookups
  getUserById(id: Id): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createUser(input: { email: string; displayName: string }): Promise<UserRecord>;

  // Organizations and memberships
  createOrganization(input: { name: string; ownerUserId: Id }): Promise<OrganizationRecord>;
  getOrganizationById(id: Id): Promise<OrganizationRecord | null>;
  getMembershipsForUser(userId: Id): Promise<MembershipRecord[]>;
  getMembershipsForOrganization(organizationId: Id): Promise<MembershipRecord[]>;

  // Terms acceptances (immutable, append-only)
  recordTermsAcceptance(
    input: Omit<TermsAcceptanceRecord, "id" | "acceptedAt">,
  ): Promise<TermsAcceptanceRecord>;
  getLatestAcceptance(organizationId: Id, userId: Id): Promise<TermsAcceptanceRecord | null>;

  // Intake sessions (save/resume)
  getIntakeSession(organizationId: Id, userId: Id): Promise<IntakeSessionRecord | null>;
  saveIntakeSession(
    input: Omit<IntakeSessionRecord, "id" | "updatedAt"> & { id?: Id },
  ): Promise<IntakeSessionRecord>;

  // Inventions and the canonical fact record
  createInvention(
    input: Omit<InventionRecord, "id" | "createdAt" | "updatedAt" | "status">,
  ): Promise<InventionRecord>;
  getInvention(organizationId: Id, inventionId: Id): Promise<InventionRecord | null>;
  listInventions(organizationId: Id): Promise<InventionRecord[]>;
  softDeleteInvention(organizationId: Id, inventionId: Id): Promise<void>;
  /** FR-3 retention: soft-deleted records awaiting the purge window. */
  listSoftDeletedInventions(organizationId: Id): Promise<InventionRecord[]>;
  /**
   * FR-3 retention purge: permanently removes the invention and all its
   * content rows (facts, contributors, events, sources, drafts, versions,
   * exports/artifacts). Audit events are retained as purge evidence.
   */
  hardDeleteInvention(organizationId: Id, inventionId: Id): Promise<void>;
  /** FR-3: owner-adjustable retention window (30–3650 days). */
  updateOrganizationRetention(
    organizationId: Id,
    retentionDays: number,
  ): Promise<OrganizationRecord | null>;

  createFact(
    input: Omit<InventionFactRecord, "id" | "updatedAt">,
  ): Promise<InventionFactRecord>;
  listFacts(organizationId: Id, inventionId: Id): Promise<InventionFactRecord[]>;
  updateFactProvenance(
    organizationId: Id,
    factId: Id,
    provenance: FactProvenance,
  ): Promise<InventionFactRecord | null>;

  createContributor(input: Omit<ContributorRecord, "id">): Promise<ContributorRecord>;
  listContributors(organizationId: Id, inventionId: Id): Promise<ContributorRecord[]>;

  createDisclosureEvent(
    input: Omit<DisclosureEventRecord, "id">,
  ): Promise<DisclosureEventRecord>;
  listDisclosureEvents(organizationId: Id, inventionId: Id): Promise<DisclosureEventRecord[]>;

  createSource(input: Omit<SourceRecord, "id" | "createdAt">): Promise<SourceRecord>;
  listSources(organizationId: Id, inventionId: Id): Promise<SourceRecord[]>;
  getSource(organizationId: Id, sourceId: Id): Promise<SourceRecord | null>;
  updateSource(
    organizationId: Id,
    sourceId: Id,
    patch: Partial<
      Pick<
        SourceRecord,
        | "status"
        | "originalFilename"
        | "mimeType"
        | "byteSize"
        | "storagePath"
        | "checksumSha256"
        | "quarantineReason"
        | "interpretationStatus"
      >
    >,
  ): Promise<SourceRecord | null>;

  // Intake Studio: Problem/Solution ledger (feature PRD §8, FR-INT-5).
  createPsPair(input: Omit<PsPairRecord, "id" | "createdAt" | "updatedAt">): Promise<PsPairRecord>;
  getPsPair(organizationId: Id, pairId: Id): Promise<PsPairRecord | null>;
  listPsPairs(organizationId: Id, inventionId: Id): Promise<PsPairRecord[]>;
  updatePsPair(
    organizationId: Id,
    pairId: Id,
    patch: Partial<Pick<PsPairRecord, "statement" | "state" | "sourceAnchors">>,
  ): Promise<PsPairRecord | null>;
  deletePsPair(organizationId: Id, pairId: Id): Promise<void>;
  createPsLink(input: Omit<PsLinkRecord, "id" | "createdAt">): Promise<PsLinkRecord>;
  listPsLinks(organizationId: Id, inventionId: Id): Promise<PsLinkRecord[]>;
  deletePsLink(organizationId: Id, linkId: Id): Promise<void>;
  appendPsEvent(input: Omit<PsEventRecord, "id" | "createdAt">): Promise<PsEventRecord>;
  listPsEvents(organizationId: Id, inventionId: Id): Promise<PsEventRecord[]>;
  createWorkingTitle(
    input: Omit<WorkingTitleRecord, "id" | "createdAt">,
  ): Promise<WorkingTitleRecord>;
  listWorkingTitles(organizationId: Id, inventionId: Id): Promise<WorkingTitleRecord[]>;

  // Intake Studio: components, associations, extraction artifacts, coverage.
  createComponent(input: Omit<ComponentRecord, "id" | "createdAt">): Promise<ComponentRecord>;
  listComponents(organizationId: Id, inventionId: Id): Promise<ComponentRecord[]>;
  createAssociation(
    input: Omit<AssociationRecord, "id" | "createdAt">,
  ): Promise<AssociationRecord>;
  listAssociations(organizationId: Id, inventionId: Id): Promise<AssociationRecord[]>;
  getAssociation(organizationId: Id, associationId: Id): Promise<AssociationRecord | null>;
  /** M3 (FR-INT-9): user-lane redraw/confirm of anchors via the state guard. */
  updateAssociation(
    organizationId: Id,
    associationId: Id,
    patch: Partial<Pick<AssociationRecord, "region" | "state">>,
  ): Promise<AssociationRecord | null>;
  deleteAssociation(organizationId: Id, associationId: Id): Promise<void>;
  createExtractionArtifact(
    input: Omit<ExtractionArtifactRecord, "id" | "createdAt">,
  ): Promise<ExtractionArtifactRecord>;
  listExtractionArtifacts(
    organizationId: Id,
    inventionId: Id,
  ): Promise<ExtractionArtifactRecord[]>;
  listExtractionArtifactsForSource(
    organizationId: Id,
    sourceId: Id,
  ): Promise<ExtractionArtifactRecord[]>;
  appendEnablementCoverage(
    rows: Array<Omit<EnablementCoverageRecord, "id" | "computedAt">>,
  ): Promise<EnablementCoverageRecord[]>;
  /** Latest snapshot only (newest computedAt per solution+dimension). */
  listLatestEnablementCoverage(
    organizationId: Id,
    inventionId: Id,
  ): Promise<EnablementCoverageRecord[]>;

  // Intake Studio M2: adaptive interview sessions/turns (FR-INT-6/7).
  createInterviewSession(
    input: Omit<InterviewSessionRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<InterviewSessionRecord>;
  getInterviewSession(
    organizationId: Id,
    sessionId: Id,
  ): Promise<InterviewSessionRecord | null>;
  listInterviewSessions(
    organizationId: Id,
    inventionId: Id,
  ): Promise<InterviewSessionRecord[]>;
  updateInterviewSession(
    organizationId: Id,
    sessionId: Id,
    patch: Partial<
      Pick<InterviewSessionRecord, "stage" | "status" | "sessionSpendCapCents" | "spentCents">
    >,
  ): Promise<InterviewSessionRecord | null>;
  createInterviewTurn(
    input: Omit<InterviewTurnRecord, "id" | "createdAt">,
  ): Promise<InterviewTurnRecord>;
  getInterviewTurn(organizationId: Id, turnId: Id): Promise<InterviewTurnRecord | null>;
  listInterviewTurns(organizationId: Id, sessionId: Id): Promise<InterviewTurnRecord[]>;
  updateInterviewTurn(
    organizationId: Id,
    turnId: Id,
    patch: Partial<
      Pick<
        InterviewTurnRecord,
        "answerText" | "answerKind" | "skipped" | "attachmentSourceIds" | "extractionJobId"
      >
    >,
  ): Promise<InterviewTurnRecord | null>;

  // Drafts
  createDraft(input: Omit<DraftRecord, "id" | "createdAt">): Promise<DraftRecord>;
  listDrafts(organizationId: Id, inventionId: Id): Promise<DraftRecord[]>;
  getDraft(organizationId: Id, draftId: Id): Promise<DraftRecord | null>;
  createDraftVersion(
    input: Omit<DraftVersionRecord, "id" | "createdAt" | "version" | "label">,
  ): Promise<DraftVersionRecord>;
  listDraftVersions(organizationId: Id, draftId: Id): Promise<DraftVersionRecord[]>;
  getDraftVersion(organizationId: Id, versionId: Id): Promise<DraftVersionRecord | null>;
  createDraftCitation(
    input: Omit<DraftCitationRecord, "id" | "createdAt">,
  ): Promise<DraftCitationRecord>;
  listDraftCitations(organizationId: Id, draftVersionId: Id): Promise<DraftCitationRecord[]>;

  // Exports
  createExport(
    input: Omit<ExportRecordEntry, "id" | "createdAt">,
  ): Promise<ExportRecordEntry>;
  listExports(organizationId: Id, inventionId: Id): Promise<ExportRecordEntry[]>;
  getExport(organizationId: Id, exportId: Id): Promise<ExportRecordEntry | null>;
  appendExportArtifact(
    input: Omit<ExportArtifactRecord, "id" | "createdAt">,
  ): Promise<ExportArtifactRecord>;
  listExportArtifacts(organizationId: Id, exportId: Id): Promise<ExportArtifactRecord[]>;

  // Durable jobs (PRD §14): queued/running/succeeded/failed/cancelled.
  createJob(
    input: Pick<JobRecord, "organizationId" | "kind" | "idempotencyKey" | "payload">,
  ): Promise<JobRecord>;
  getJob(organizationId: Id, jobId: Id): Promise<JobRecord | null>;
  findJobByKey(organizationId: Id, kind: JobKind, idempotencyKey: string): Promise<JobRecord | null>;
  updateJob(
    organizationId: Id,
    jobId: Id,
    patch: Partial<
      Pick<JobRecord, "status" | "result" | "errorSummary" | "attempts" | "startedAt" | "finishedAt">
    >,
  ): Promise<JobRecord | null>;
  listJobs(organizationId: Id): Promise<JobRecord[]>;

  // Invitations (PRD §7.1): idempotent, expiring.
  createInvitation(
    input: Omit<InvitationRecord, "id" | "createdAt" | "acceptedAt" | "acceptedBy" | "revokedAt">,
  ): Promise<InvitationRecord>;
  listInvitations(organizationId: Id): Promise<InvitationRecord[]>;
  getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  updateInvitation(
    invitationId: Id,
    patch: Partial<Pick<InvitationRecord, "acceptedAt" | "acceptedBy" | "revokedAt">>,
  ): Promise<InvitationRecord | null>;
  createMembership(input: Omit<MembershipRecord, "id" | "createdAt">): Promise<MembershipRecord>;

  // Counsel requests
  createCounselRequest(
    input: Omit<CounselRequestRecord, "id" | "state" | "createdAt" | "updatedAt">,
  ): Promise<CounselRequestRecord>;
  getCounselRequest(organizationId: Id, requestId: Id): Promise<CounselRequestRecord | null>;
  listCounselRequests(organizationId: Id): Promise<CounselRequestRecord[]>;
  updateCounselRequestState(
    organizationId: Id,
    requestId: Id,
    state: CounselRequestState,
  ): Promise<CounselRequestRecord | null>;
  appendCounselRequestEvent(
    input: Omit<CounselRequestEventRecord, "id" | "createdAt">,
  ): Promise<CounselRequestEventRecord>;
  listCounselRequestEvents(
    organizationId: Id,
    requestId: Id,
  ): Promise<CounselRequestEventRecord[]>;

  // Connected-counsel administration lane (PRD §6.3). These cross-org
  // reads are restricted to counsel-role callers at the service boundary;
  // in production the counsel lane runs on its own audit policy.
  getCounselAssignment(userId: Id): Promise<CounselAssignmentRecord | null>;
  setCounselAssignment(record: CounselAssignmentRecord): Promise<CounselAssignmentRecord>;
  listCounselRequestsAllOrgs(): Promise<CounselRequestRecord[]>;
  getCounselRequestAnyOrg(requestId: Id): Promise<CounselRequestRecord | null>;
  createEngagement(input: Omit<EngagementRecord, "id" | "offeredAt">): Promise<EngagementRecord>;
  getEngagement(engagementId: Id): Promise<EngagementRecord | null>;
  getEngagementByRequest(requestId: Id): Promise<EngagementRecord | null>;
  updateEngagement(
    engagementId: Id,
    patch: Partial<Pick<EngagementRecord, "signedDocumentRef" | "signedAt">>,
  ): Promise<EngagementRecord | null>;
  createLegalMatter(input: Omit<LegalMatterRecord, "id" | "openedAt">): Promise<LegalMatterRecord>;
  getLegalMatter(matterId: Id): Promise<LegalMatterRecord | null>;
  getLegalMatterByEngagement(engagementId: Id): Promise<LegalMatterRecord | null>;
  createFilingPackage(
    input: Omit<FilingPackageRecord, "id" | "createdAt">,
  ): Promise<FilingPackageRecord>;
  listFilingPackages(matterId: Id): Promise<FilingPackageRecord[]>;
  updateFilingPackageStatus(
    packageId: Id,
    status: FilingPackageStatus,
  ): Promise<FilingPackageRecord | null>;
  appendCounselAuditEvent(
    input: Omit<CounselAuditEventRecord, "id" | "createdAt">,
  ): Promise<CounselAuditEventRecord>;
  listCounselAuditEvents(): Promise<CounselAuditEventRecord[]>;

  // Wallet, reservations, usage
  getWallet(organizationId: Id): Promise<WalletRecord | null>;
  saveWallet(wallet: WalletRecord): Promise<WalletRecord>;
  appendLedgerEntry(
    input: Omit<LedgerEntryRecord, "id" | "createdAt">,
  ): Promise<LedgerEntryRecord>;
  listLedgerEntries(organizationId: Id): Promise<LedgerEntryRecord[]>;
  listReservations(organizationId: Id): Promise<ReservationRecord[]>;
  saveReservation(reservation: ReservationRecord): Promise<ReservationRecord>;
  appendUsageEvent(
    input: Omit<UsageEventRecord, "id" | "createdAt">,
  ): Promise<UsageEventRecord>;
  listUsageEvents(organizationId: Id): Promise<UsageEventRecord[]>;

  // Stripe webhook events + billing outbox (FR-6). insertStripeEvent is the
  // idempotency gate: `created: false` means the event id was seen before.
  insertStripeEvent(
    input: Omit<StripeEventRecord, "processedAt" | "receivedAt">,
  ): Promise<{ record: StripeEventRecord; created: boolean }>;
  markStripeEventProcessed(id: string): Promise<void>;
  appendBillingOutbox(
    input: Omit<BillingOutboxRecord, "id" | "createdAt" | "processedAt" | "attempts" | "status">,
  ): Promise<BillingOutboxRecord>;
  listPendingBillingOutbox(): Promise<BillingOutboxRecord[]>;
  updateBillingOutbox(
    id: Id,
    patch: Partial<Pick<BillingOutboxRecord, "status" | "attempts" | "processedAt">>,
  ): Promise<BillingOutboxRecord | null>;

  // Stripe customer mapping (FR-6): set from checkout.session.completed and
  // required by the Customer Portal seam.
  getStripeCustomerId(organizationId: Id): Promise<string | null>;
  setStripeCustomerId(organizationId: Id, stripeCustomerId: string): Promise<void>;

  // Audit
  appendAuditEvent(input: Omit<AuditEventRecord, "id" | "createdAt">): Promise<AuditEventRecord>;
  listAuditEvents(organizationId: Id): Promise<AuditEventRecord[]>;
}

/**
 * Allowlisted public-corpus material (§7.4 step 4). Snippets come from the
 * SEPARATE public-corpus Supabase project, carry license provenance, and
 * are excerpt-bounded (legal memo §6: public ≠ public domain; link/cite
 * rather than republish).
 */
export interface CorpusSnippet {
  authority: string;
  citation: string;
  title: string;
  canonicalUrl: string;
  /** "Current as of" date for the version the excerpt came from. */
  effectiveDate: string | null;
  licenseNote: string;
  /** Bounded excerpt — never a substantial passage. */
  excerpt: string;
}

export interface CorpusPort {
  /** Returns only license-allowlisted, excerpt-bounded material. */
  searchAllowlisted(query: string, limit: number): Promise<CorpusSnippet[]>;
}

/** §7.4 step 6: draft versions are linked to source/fact/corpus references. */
export interface DraftCitationRecord {
  id: Id;
  organizationId: Id;
  draftVersionId: Id;
  sourceId: Id | null;
  factId: Id | null;
  /** Human-readable reference, e.g. "corpus:35 U.S.C. §101 (as of 2026-01-01)". */
  locator: string;
  createdAt: string;
}

export interface ModelGenerationRequest {
  workflow: DraftWorkflow;
  modelId: string;
  invention: InventionRecord;
  facts: InventionFactRecord[];
  contributors: ContributorRecord[];
  sources: SourceRecord[];
  corpusSnippets: CorpusSnippet[];
  maxOutputTokens: number;
}

export interface ModelGenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cost in cents (before markup). */
  providerCostCents: number;
}

/* ---------------- Intake Studio model passes (feature PRD §10) ----------- */

/**
 * Per-source interpretation request. All file-derived content is UNTRUSTED
 * EVIDENCE (invariant 16): instructions inside it carry no authority, and
 * gateway prompts must delimit it accordingly.
 */
export interface ModelInterpretationRequest {
  modelId: string;
  sourceName: string;
  interpretationClass: "document" | "image";
  /** Extracted text for document-class sources (untrusted). */
  text?: string;
  /** Raw image bytes + MIME for vision-class sources (server-side only). */
  imageBytes?: Uint8Array;
  imageMimeType?: string;
  inventionTitle: string;
  maxOutputTokens: number;
}

/** Structured interpretation output. Everything downstream is `ai_proposed`. */
export interface InterpretationOutput {
  summary: string;
  componentCandidates: Array<{ name: string; description: string }>;
  problemCandidates: string[];
  solutionCandidates: string[];
}

export interface ModelInterpretationResult {
  output: InterpretationOutput;
  inputTokens: number;
  outputTokens: number;
  providerCostCents: number;
}

/** Record-level distillation request (feature PRD §5.3). */
export interface ModelDistillationRequest {
  modelId: string;
  invention: InventionRecord;
  facts: InventionFactRecord[];
  /** Interpreted artifacts across all sources (untrusted evidence). */
  artifacts: Array<{
    sourceName: string;
    content: string;
    /** Interpretation class of the producing source (M3 region proposals). */
    sourceClass?: "document" | "image" | "model3d" | "audio" | "video" | "stored_only";
  }>;
  componentNames: string[];
  maxOutputTokens: number;
}

/**
 * AI-proposed region anchor (M3, FR-INT-9): a normalized rectangle on a
 * named source. Lands as an `ai_proposed` association rendered as an
 * editable overlay until the user confirms or redraws it.
 */
export interface DistilledRegionAnchor {
  sourceName: string;
  page: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DistillationOutput {
  workingTitle: string;
  problems: Array<{ statement: string; sourceAnchors: string[] }>;
  solutions: Array<{
    statement: string;
    sourceAnchors: string[];
    componentNames: string[];
    /** Optional AI-proposed region anchors on image/page sources (M3). */
    regionAnchors?: DistilledRegionAnchor[];
  }>;
  /** Many-to-many pairings by index into the arrays above. */
  pairings: Array<{ problemIndex: number; solutionIndex: number }>;
  /** Observations only (e.g. possible multi-invention record) — never advice. */
  observations: string[];
}

export interface ModelDistillationResult {
  output: DistillationOutput;
  inputTokens: number;
  outputTokens: number;
  providerCostCents: number;
}

/* -------------- Intake Studio M2: interview model passes ----------------- */

/**
 * Question-drafting request (FR-INT-6). The engine picked the target;
 * the model ONLY words the question. `knownSummary` and `avoidStatements`
 * are untrusted user-derived data and must be delimited accordingly.
 */
export interface ModelQuestionDraftRequest {
  modelId: string;
  stage: string;
  targetRef: string;
  /** Engine-authored purpose: what the question must gather. */
  targetPurpose: string;
  /** Engine-authored follow-up purposes to group under the question. */
  followupPurposes: string[];
  /** Solution statement excerpt for coverage-gap targets (untrusted). */
  solutionStatement: string | null;
  /** Brief summary of what is already known (untrusted). */
  knownSummary: string;
  /** Rejected AI framings to steer away from (untrusted). */
  avoidStatements: string[];
  maxOutputTokens: number;
}

export interface ModelQuestionDraftResult {
  questionText: string;
  followups: string[];
  inputTokens: number;
  outputTokens: number;
  providerCostCents: number;
}

/**
 * Post-answer extraction request (FR-INT-7, Fast tier). The answer is
 * untrusted EVIDENCE: instructions inside it carry no authority. Output is
 * proposals only — new items land `ai_proposed`; edits to confirmed/edited
 * items are proposed-edit objects, never mutations.
 */
export interface ModelTurnExtractionRequest {
  modelId: string;
  stage: string;
  question: string;
  /** The inventor's answer (untrusted evidence). */
  answerText: string;
  existingPairs: Array<{ id: Id; kind: PsPairKind; statement: string; state: PsState }>;
  componentNames: string[];
  maxOutputTokens: number;
}

export interface TurnExtractionOutput {
  problems: Array<{ statement: string }>;
  solutions: Array<{ statement: string }>;
  /** Proposed edits to existing pairs — NEVER applied silently. */
  proposedEdits: Array<{ pairId: string; proposedStatement: string }>;
  components: Array<{ name: string; description: string }>;
}

export interface ModelTurnExtractionResult {
  output: TurnExtractionOutput;
  inputTokens: number;
  outputTokens: number;
  providerCostCents: number;
}

/* ---------------- Intake Studio M3: audio transcription ------------------ */

/**
 * Audio transcription request (M3 A/V ingestion, §5.1 Phase 2). The audio
 * is untrusted EVIDENCE: spoken instructions carry no authority, and the
 * transcript is delimited exactly like uploaded document text downstream.
 */
export interface ModelTranscriptionRequest {
  sourceName: string;
  audioBytes: Uint8Array;
  audioMimeType: string;
}

export interface ModelTranscriptionResult {
  text: string;
  /** Provider-reported (or deterministically estimated) audio duration. */
  durationSeconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cost in cents (per-minute transcription rate). */
  providerCostCents: number;
}

export interface ModelGatewayPort {
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResult>;
  /** Intake Studio per-source interpretation pass (FR-INT-3). */
  interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationResult>;
  /** Intake Studio record-level distillation pass (FR-INT-4). */
  distill(request: ModelDistillationRequest): Promise<ModelDistillationResult>;
  /** Interview question drafting for an engine-chosen target (FR-INT-6). */
  draftInterviewQuestion(request: ModelQuestionDraftRequest): Promise<ModelQuestionDraftResult>;
  /** Post-answer live extraction — proposals only (FR-INT-7). */
  extractInterviewAnswer(
    request: ModelTurnExtractionRequest,
  ): Promise<ModelTurnExtractionResult>;
  /** Audio transcription through the server-side gateway (M3, metered). */
  transcribe(request: ModelTranscriptionRequest): Promise<ModelTranscriptionResult>;
}

export type CheckoutRequest =
  | { kind: "wallet_top_up"; amountCents: number }
  | { kind: "subscription"; planId: string };

export interface BillingPort {
  /**
   * Stripe Checkout/Portal (FR-6). The production adapter is implemented
   * against the Stripe REST API; *live activation* is approval-gated
   * (PRD §17.4) behind the Stripe credentials.
   */
  createCheckoutSession(
    organizationId: Id,
    request: CheckoutRequest,
  ): Promise<{ url: string }>;
  createPortalSession(organizationId: Id): Promise<{ url: string }>;
}

/**
 * Private blob storage seam (FR-4). Local mode writes under a gitignored
 * `.local-storage/` directory; production is Supabase Storage (private
 * bucket, signed URLs) behind the same interface.
 */
export interface StoragePort {
  put(path: string, bytes: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<void>;
}

export interface Adapters {
  data: DataPort;
  modelGateway: ModelGatewayPort;
  billing: BillingPort;
  storage: StoragePort;
  corpus: CorpusPort;
}
