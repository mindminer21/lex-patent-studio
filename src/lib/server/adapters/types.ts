import type { Role } from "@/lib/domain/roles";
import type { AcknowledgementKey, UserAgentCategory } from "@/lib/domain/clickwrap";
import type {
  CounselRequestAction,
  CounselRequestState,
} from "@/lib/domain/counsel-request";
import type { FactActor, FactCategory, FactProvenance } from "@/lib/domain/facts";
import type { IntakeState } from "@/lib/domain/intake";
import type { Reservation } from "@/lib/domain/usage";

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

export type SourceStatus = "registered" | "quarantined" | "scanned" | "extracted";

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
  note: string;
  createdAt: string;
}

export type ReservationRecord = Reservation & {
  organizationId: Id;
  createdAt: string;
};

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

  // Drafts
  createDraft(input: Omit<DraftRecord, "id" | "createdAt">): Promise<DraftRecord>;
  listDrafts(organizationId: Id, inventionId: Id): Promise<DraftRecord[]>;
  getDraft(organizationId: Id, draftId: Id): Promise<DraftRecord | null>;
  createDraftVersion(
    input: Omit<DraftVersionRecord, "id" | "createdAt" | "version" | "label">,
  ): Promise<DraftVersionRecord>;
  listDraftVersions(organizationId: Id, draftId: Id): Promise<DraftVersionRecord[]>;
  getDraftVersion(organizationId: Id, versionId: Id): Promise<DraftVersionRecord | null>;

  // Exports
  createExport(
    input: Omit<ExportRecordEntry, "id" | "createdAt">,
  ): Promise<ExportRecordEntry>;
  listExports(organizationId: Id, inventionId: Id): Promise<ExportRecordEntry[]>;

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

  // Audit
  appendAuditEvent(input: Omit<AuditEventRecord, "id" | "createdAt">): Promise<AuditEventRecord>;
  listAuditEvents(organizationId: Id): Promise<AuditEventRecord[]>;
}

export interface ModelGenerationRequest {
  workflow: DraftWorkflow;
  modelId: string;
  invention: InventionRecord;
  facts: InventionFactRecord[];
  contributors: ContributorRecord[];
  sources: SourceRecord[];
  maxOutputTokens: number;
}

export interface ModelGenerationResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cost in cents (before markup). */
  providerCostCents: number;
}

export interface ModelGatewayPort {
  generate(request: ModelGenerationRequest): Promise<ModelGenerationResult>;
}

export interface BillingPort {
  /** Stripe Checkout/Portal seams — approval-gated, stubbed until Phase 3. */
  createCheckoutSession(organizationId: Id, planId: string): Promise<{ url: string }>;
  createPortalSession(organizationId: Id): Promise<{ url: string }>;
}

export interface Adapters {
  data: DataPort;
  modelGateway: ModelGatewayPort;
  billing: BillingPort;
}
