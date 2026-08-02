import type { Role } from "@/lib/domain/roles";
import type {
  AuditEvent,
  ClaimRecord,
  DeadlineObservation,
  Matter,
  MatterFact,
  MatterSource,
  ReviewDecisionRecord,
  ReviewItem,
  RunRequest,
  WorkflowRun,
  WorkProductDocument,
} from "@/lib/domain/schemas";
import type { ReviewDecision } from "@/lib/domain/review";
import type { ChargeEstimate, ModelCatalogEntry, TokenWorkload } from "@/lib/domain/pricing";

/**
 * Typed adapter seams (Round 1 environment contract).
 *
 * Local mode implements every interface in-memory with synthetic data and no
 * credentials. Production implementations (Supabase / Stripe / provider
 * gateway) are stubbed with TODO seams and refuse to operate — no code path
 * in this repository calls a live paid API, files, signs, or creates
 * external accounts.
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

export interface DataAdapter {
  listMatters(organizationId: string): Promise<Matter[]>;
  getMatter(organizationId: string, matterId: string): Promise<Matter | null>;
  listFacts(organizationId: string, matterId: string): Promise<MatterFact[]>;
  listSources(organizationId: string, matterId: string): Promise<MatterSource[]>;
  listClaims(organizationId: string, matterId: string): Promise<ClaimRecord[]>;
  listRuns(organizationId: string, matterId?: string): Promise<WorkflowRun[]>;
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
  listDeadlines(organizationId: string): Promise<DeadlineObservation[]>;
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
   * progression with synthetic output; production adapters are TODO seams
   * and MUST NOT be reachable until provider enablement is approved.
   */
  isLive(): boolean;
}

export interface Adapters {
  auth: AuthAdapter;
  data: DataAdapter;
  billing: BillingAdapter;
  modelGateway: ModelGatewayAdapter;
}
