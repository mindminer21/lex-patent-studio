import type { Role } from "@/lib/domain/roles";
import type {
  AuditEvent,
  ChatMessage,
  ChatPostInput,
  ClaimRecord,
  DeadlineObservation,
  ExportRecord,
  FactCreateInput,
  FactEvent,
  Matter,
  MatterCreateInput,
  MatterFact,
  MatterPatchInput,
  MatterSource,
  ReviewDecisionRecord,
  ReviewItem,
  RunRequest,
  RunStageCheckpoint,
  TeamMember,
  UploadSignInput,
  UploadTarget,
  WalletReservation,
  WorkflowRun,
  WorkProductDocument,
} from "@/lib/domain/schemas";
import type { ReviewDecision } from "@/lib/domain/review";
import type { ChargeEstimate, ModelCatalogEntry, TokenWorkload } from "@/lib/domain/pricing";
import type {
  PlaybookChainVerification,
  PlaybookEntry,
  PlaybookPublishInput,
  StyleProfile,
  StyleProfileCreateInput,
} from "@/lib/domain/styles";

/**
 * Typed adapter seams (Round 1 environment contract).
 *
 * Local mode implements every interface in-memory with synthetic data and no
 * credentials. Production implementations (Supabase / Stripe / provider
 * gateway) live in src/lib/adapters/production: the data layer is fully
 * implemented over Postgres and integration-tested; run execution, signed
 * uploads, Stripe activation, and provider calls refuse until their
 * approval gates clear — no code path in this repository calls a live paid
 * API, files, signs, or creates external accounts.
 */

export interface Session {
  userId: string;
  displayName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  role: Role;
  /** True when this is the synthetic local-mode session. */
  synthetic: boolean;
}

export interface AuthAdapter {
  /** Resolve the authenticated session, or null when signed out. */
  getSession(): Promise<Session | null>;
}

/** Actor context for mutations; always derived from the server session. */
export interface ActorContext {
  userId: string;
  role: Role;
  note?: string;
}

export type Result<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export interface DataAdapter {
  listMatters(organizationId: string): Promise<Matter[]>;
  getMatter(organizationId: string, matterId: string): Promise<Matter | null>;
  createMatter(
    organizationId: string,
    input: MatterCreateInput,
    actor: ActorContext,
  ): Promise<Result<{ matter: Matter }>>;
  updateMatter(
    organizationId: string,
    matterId: string,
    patch: MatterPatchInput,
    actor: ActorContext,
  ): Promise<Result<{ matter: Matter }>>;
  listFacts(organizationId: string, matterId: string): Promise<MatterFact[]>;
  createFact(
    organizationId: string,
    matterId: string,
    input: FactCreateInput,
    actor: ActorContext,
  ): Promise<Result<{ fact: MatterFact }>>;
  /** Human practitioner fact approval → counsel_reviewed + fact_event. */
  approveFact(
    organizationId: string,
    matterId: string,
    factId: string,
    actor: ActorContext,
  ): Promise<Result<{ fact: MatterFact; event: FactEvent }>>;
  listFactEvents(organizationId: string, matterId: string): Promise<FactEvent[]>;
  listSources(organizationId: string, matterId: string): Promise<MatterSource[]>;
  /** FR-4 signed-upload seam. Local mode issues SIMULATED targets only. */
  createUploadTarget(
    organizationId: string,
    matterId: string,
    input: UploadSignInput,
    actor: ActorContext,
  ): Promise<Result<{ target: UploadTarget }>>;
  listClaims(organizationId: string, matterId: string): Promise<ClaimRecord[]>;
  listRuns(organizationId: string, matterId?: string): Promise<WorkflowRun[]>;
  /** Run detail with per-stage checkpoints and the wallet reservation. */
  getRun(
    organizationId: string,
    runId: string,
  ): Promise<{
    run: WorkflowRun;
    stages: RunStageCheckpoint[];
    reservation: WalletReservation | null;
  } | null>;
  cancelRun(
    organizationId: string,
    runId: string,
    actor: ActorContext,
  ): Promise<Result<{ run: WorkflowRun }>>;
  createRun(
    organizationId: string,
    request: RunRequest,
    context: { requestedBy: string; role: Role },
  ): Promise<{ ok: true; run: WorkflowRun } | { ok: false; error: string }>;
  listReviewItems(
    organizationId: string,
    filter?: { matterId?: string; state?: ReviewItem["state"] },
  ): Promise<ReviewItem[]>;
  decideReviewItem(
    organizationId: string,
    reviewItemId: string,
    decision: ReviewDecision,
    actor: { userId: string; role: Role; note?: string },
  ): Promise<
    | { ok: true; item: ReviewItem; record: ReviewDecisionRecord }
    | { ok: false; error: string }
  >;
  listDocuments(
    organizationId: string,
    matterId?: string,
  ): Promise<WorkProductDocument[]>;
  getDocument(
    organizationId: string,
    documentId: string,
  ): Promise<WorkProductDocument | null>;
  /** Approval provenance for a document's export manifest (FR-8). */
  listDecisionsForDocument(
    organizationId: string,
    documentId: string,
  ): Promise<ReviewDecisionRecord[]>;
  /**
   * Create (or idempotently return) the version-locked export for a
   * document (FR-8). Immutable: re-export of the same document version
   * returns the existing artifact; edits create new versions.
   */
  createExport(
    organizationId: string,
    documentId: string,
    actor: ActorContext,
  ): Promise<Result<{ record: ExportRecord; reused: boolean }>>;
  listExports(organizationId: string, matterId?: string): Promise<ExportRecord[]>;
  getExport(organizationId: string, exportId: string): Promise<ExportRecord | null>;
  listDeadlines(organizationId: string): Promise<DeadlineObservation[]>;
  /** Reservation→settlement ledger view (FR-9; /usage surface). */
  listReservations(organizationId: string): Promise<WalletReservation[]>;
  /** Team roster (FR-2 seats/roles). Invitations are approval-gated. */
  listTeamMembers(organizationId: string): Promise<TeamMember[]>;
  /** Grounded chat (§8.2 /chat): matter-isolated, retrieval-grounded. */
  listChatMessages(organizationId: string, matterId: string): Promise<ChatMessage[]>;
  postChatMessage(
    organizationId: string,
    matterId: string,
    input: ChatPostInput,
    actor: ActorContext,
  ): Promise<Result<{ question: ChatMessage; reply: ChatMessage }>>;
  /** Style profiles (§5.4): tenant rulesets + the platform neutral default. */
  listStyleProfiles(organizationId: string): Promise<StyleProfile[]>;
  createStyleProfile(
    organizationId: string,
    input: StyleProfileCreateInput,
    actor: ActorContext,
  ): Promise<Result<{ profile: StyleProfile }>>;
  /**
   * Playbook entries (§5.4): tenant-isolated, hash-chained publications.
   * Returned in publication (chain) order with the chain verification.
   */
  listPlaybookEntries(organizationId: string): Promise<{
    entries: PlaybookEntry[];
    chain: PlaybookChainVerification;
  }>;
  publishPlaybookEntry(
    organizationId: string,
    input: PlaybookPublishInput,
    actor: ActorContext,
  ): Promise<Result<{ entry: PlaybookEntry }>>;
  listAuditEvents(
    organizationId: string,
    filter?: { matterId?: string; limit?: number },
  ): Promise<AuditEvent[]>;
}

export interface BillingAdapter {
  /** Current prepaid usage-wallet balance in USD. */
  getWalletBalanceUsd(organizationId: string): Promise<number>;
}

export interface ModelGatewayAdapter {
  listModels(): ModelCatalogEntry[];
  estimate(modelId: string, workload: TokenWorkload): ChargeEstimate;
  /**
   * Execute a generation stage. The local adapter simulates stage
   * progression with synthetic output; the production gateway stays
   * isLive()=false until provider keys AND recorded spend approval exist.
   */
  isLive(): boolean;
}

export interface Adapters {
  auth: AuthAdapter;
  data: DataAdapter;
  billing: BillingAdapter;
  modelGateway: ModelGatewayAdapter;
}
