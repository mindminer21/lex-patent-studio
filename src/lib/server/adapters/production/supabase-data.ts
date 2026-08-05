import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/wepatent/domain/roles";
import type { CounselRequestState } from "@/lib/wepatent/domain/counsel-request";
import type { FactProvenance } from "@/lib/wepatent/domain/facts";
import {
  DEFAULT_MARKUP_MULTIPLIER,
  markupBasisPoints,
} from "@/lib/wepatent/domain/markup";
import type { IntakeState } from "@/lib/wepatent/domain/intake";
import { normalizeRegion } from "@/lib/wepatent/domain/evidence";
import type {
  AssociationRecord,
  AuditEventRecord,
  BillingOutboxRecord,
  ComponentRecord,
  ContributorRecord,
  CounselAssignmentRecord,
  CounselAuditEventRecord,
  CounselRequestEventRecord,
  CounselRequestRecord,
  DataPort,
  DisclosureEventRecord,
  DraftCitationRecord,
  DraftRecord,
  DraftVersionRecord,
  EnablementCoverageRecord,
  EngagementRecord,
  ExportArtifactRecord,
  ExportRecordEntry,
  ExtractionArtifactRecord,
  FigureAnnotationRecord,
  FigureAiState,
  FigureNumeralRecord,
  FigureRecord,
  DraftSetRecord,
  DraftSetStageValue,
  DraftSetStateValue,
  DraftSetTransitionRecord,
  FigureSetRecord,
  FigureSetStateValue,
  FigureSheetRecord,
  FigureStateValue,
  FigureValidationRecord,
  FilingPackageRecord,
  Id,
  IntakeSessionRecord,
  InterviewSessionRecord,
  InterviewTurnRecord,
  InvitationRecord,
  InventionFactRecord,
  InventionRecord,
  JobKind,
  JobRecord,
  LedgerEntryRecord,
  LegalMatterRecord,
  MembershipRecord,
  OrganizationRecord,
  PsEventRecord,
  PsLinkRecord,
  PsPairRecord,
  ReservationRecord,
  SourceRecord,
  StripeEventRecord,
  TermsAcceptanceRecord,
  UsageEventRecord,
  UserRecord,
  WalletRecord,
  WorkingTitleRecord,
} from "../types";

/**
 * SupabaseDataAdapter — DataPort against the PRIVATE application project
 * (supabase/wepatent/migrations/0001–0006).
 *
 * Trust model (PRD §5.6, §11):
 * - This adapter runs with the service-role key inside trusted server logic
 *   only. RLS remains the defense-in-depth layer for any path that ever
 *   uses a user-scoped client; the adapter ALSO filters every tenant query
 *   by organization_id derived from the authenticated session, so a
 *   client-supplied tenant id alone can never widen access.
 * - Append-only tables (terms_acceptances, ledger, usage/audit events,
 *   draft_versions, exports) are protected by database triggers even
 *   against this service role — see supabase/wepatent/tests/03_immutability.sql.
 *
 * Activation is approval-gated (PRD §17): APP_MODE=production plus real
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Local mode never loads it.
 */

type Row = Record<string, unknown>;

function s(row: Row, key: string): string {
  return String(row[key] ?? "");
}
function sOrNull(row: Row, key: string): string | null {
  return row[key] === null || row[key] === undefined ? null : String(row[key]);
}
function n(row: Row, key: string): number {
  return Number(row[key] ?? 0);
}
function nOrNull(row: Row, key: string): number | null {
  return row[key] === null || row[key] === undefined ? null : Number(row[key]);
}
function b(row: Row, key: string): boolean {
  return Boolean(row[key]);
}
function meta(row: Row, key: string): Record<string, string | number | boolean | null> {
  const value = row[key];
  return value && typeof value === "object"
    ? (value as Record<string, string | number | boolean | null>)
    : {};
}

function must<T>(value: T | null, context: string): T {
  if (value === null) throw new Error(`supabase_adapter:${context}:not_found_after_write`);
  return value;
}

async function one<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  context: string,
): Promise<T | null> {
  const { data, error } = await query;
  if (error) throw new Error(`supabase_adapter:${context}:${error.message}`);
  return data && data.length > 0 ? data[0] : null;
}

async function many<T>(
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  context: string,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) throw new Error(`supabase_adapter:${context}:${error.message}`);
  return data ?? [];
}

const mapOrganization = (row: Row): OrganizationRecord => ({
  id: s(row, "id"),
  name: s(row, "name"),
  retentionDays: n(row, "retention_days"),
  createdAt: s(row, "created_at"),
  deletedAt: sOrNull(row, "deleted_at"),
});

const mapMembership = (row: Row): MembershipRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  userId: s(row, "user_id"),
  role: s(row, "role") as Role,
  createdAt: s(row, "created_at"),
});

const mapInvention = (row: Row): InventionRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  title: s(row, "title"),
  summary: s(row, "summary"),
  businessContext: s(row, "business_context"),
  problem: s(row, "problem"),
  solution: s(row, "solution"),
  status: s(row, "status") as InventionRecord["status"],
  synthetic: b(row, "synthetic"),
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapFact = (row: Row): InventionFactRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  category: s(row, "category") as InventionFactRecord["category"],
  statement: s(row, "statement"),
  provenance: s(row, "provenance") as FactProvenance,
  createdBy: s(row, "created_by_actor") as InventionFactRecord["createdBy"],
  originRef: sOrNull(row, "origin_ref"),
  updatedAt: s(row, "updated_at"),
});

const mapSource = (row: Row): SourceRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  name: s(row, "name"),
  kind: s(row, "kind"),
  note: s(row, "note"),
  status: s(row, "status") as SourceRecord["status"],
  synthetic: b(row, "synthetic"),
  createdAt: s(row, "created_at"),
  originalFilename: sOrNull(row, "original_filename"),
  mimeType: sOrNull(row, "mime_type"),
  byteSize: nOrNull(row, "byte_size"),
  storagePath: sOrNull(row, "storage_path"),
  checksumSha256: sOrNull(row, "checksum_sha256"),
  quarantineReason: sOrNull(row, "quarantine_reason"),
  interpretationStatus: sOrNull(
    row,
    "interpretation_status",
  ) as SourceRecord["interpretationStatus"],
  derivedFromSourceId: sOrNull(row, "derived_from_source_id"),
});

const mapDraftVersion = (row: Row): DraftVersionRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  draftId: s(row, "draft_id"),
  version: n(row, "version"),
  content: s(row, "content"),
  modelId: s(row, "model_id"),
  rateVersion: s(row, "rate_version"),
  estimateCustomerHighCents: n(row, "estimate_customer_high_cents"),
  actualProviderCostCents: n(row, "actual_provider_cost_cents"),
  actualCustomerChargeCents: n(row, "actual_customer_charge_cents"),
  unresolvedFactCount: n(row, "unresolved_fact_count"),
  sourceStatusSummary: s(row, "source_status_summary"),
  reservationId: sOrNull(row, "reservation_id"),
  label: "working_draft",
  createdAt: s(row, "created_at"),
});

const mapCounselRequest = (row: Row): CounselRequestRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  createdByUserId: s(row, "created_by"),
  state: s(row, "state") as CounselRequestState,
  inventionId: sOrNull(row, "invention_id"),
  requestSummary: s(row, "request_summary"),
  adverseParties: s(row, "adverse_parties"),
  jurisdiction: s(row, "jurisdiction"),
  contactEmail: s(row, "contact_email"),
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapJob = (row: Row): JobRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  kind: s(row, "kind") as JobKind,
  status: s(row, "status") as JobRecord["status"],
  idempotencyKey: s(row, "idempotency_key"),
  payload: meta(row, "payload"),
  result: meta(row, "result"),
  errorSummary: sOrNull(row, "error_summary"),
  attempts: n(row, "attempts"),
  createdAt: s(row, "created_at"),
  startedAt: sOrNull(row, "started_at"),
  finishedAt: sOrNull(row, "finished_at"),
});

const mapInvitation = (row: Row): InvitationRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  email: s(row, "email"),
  role: s(row, "role") as Role,
  tokenHash: s(row, "token_hash"),
  invitedBy: s(row, "invited_by"),
  expiresAt: s(row, "expires_at"),
  acceptedAt: sOrNull(row, "accepted_at"),
  acceptedBy: sOrNull(row, "accepted_by"),
  revokedAt: sOrNull(row, "revoked_at"),
  createdAt: s(row, "created_at"),
});

const mapEngagement = (row: Row): EngagementRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  requestId: s(row, "request_id"),
  lawFirmName: s(row, "law_firm_name"),
  scopeSummary: s(row, "scope_summary"),
  signedDocumentRef: sOrNull(row, "signed_document_ref"),
  offeredAt: s(row, "offered_at"),
  signedAt: sOrNull(row, "signed_at"),
});

export class SupabaseDataAdapter implements DataPort {
  private readonly client: SupabaseClient;

  constructor(config: { url: string; serviceRoleKey: string }) {
    this.client = createClient(config.url, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private from(table: string) {
    return this.client.from(table);
  }

  // ------------------------------------------------------------------
  // Users (Supabase Auth is the identity source; users_profile holds
  // display data)
  // ------------------------------------------------------------------
  async getUserById(id: Id): Promise<UserRecord | null> {
    const { data, error } = await this.client.auth.admin.getUserById(id);
    if (error || !data.user) return null;
    const profile = await one<Row>(
      this.from("users_profile").select("*").eq("id", id).limit(1),
      "users_profile.get",
    );
    return {
      id: data.user.id,
      email: data.user.email ?? "",
      displayName: profile ? s(profile, "display_name") : (data.user.email ?? ""),
      createdAt: data.user.created_at,
    };
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    // Supabase Auth admin lookup by email (paginated defensive scan is not
    // acceptable at scale; listUsers supports server-side filtering).
    const { data, error } = await this.client.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) throw new Error(`supabase_adapter:auth.listUsers:${error.message}`);
    const match = data.users.find((user) => (user.email ?? "").toLowerCase() === normalized);
    if (!match) return null;
    return this.getUserById(match.id);
  }

  async createUser(input: { email: string; displayName: string }): Promise<UserRecord> {
    const { data, error } = await this.client.auth.admin.createUser({
      email: input.email.trim().toLowerCase(),
      email_confirm: false,
    });
    if (error || !data.user) {
      throw new Error(`supabase_adapter:auth.createUser:${error?.message ?? "no_user"}`);
    }
    await this.from("users_profile").upsert({
      id: data.user.id,
      display_name: input.displayName,
    });
    return {
      id: data.user.id,
      email: data.user.email ?? "",
      displayName: input.displayName,
      createdAt: data.user.created_at,
    };
  }

  // ------------------------------------------------------------------
  // Organizations and memberships
  // ------------------------------------------------------------------
  async createOrganization(input: { name: string; ownerUserId: Id }): Promise<OrganizationRecord> {
    const org = must(
      await one<Row>(
        this.from("organizations").insert({ name: input.name }).select(),
        "organizations.insert",
      ),
      "organizations.insert",
    );
    const { error } = await this.from("organization_memberships").insert({
      organization_id: s(org, "id"),
      user_id: input.ownerUserId,
      role: "owner",
    });
    if (error) {
      // Best-effort rollback of the orphan org; production path should use a
      // database function for true single-transaction semantics (PRD §7.1).
      await this.from("organizations").delete().eq("id", s(org, "id"));
      throw new Error(`supabase_adapter:memberships.insert:${error.message}`);
    }
    return mapOrganization(org);
  }

  async getOrganizationById(id: Id): Promise<OrganizationRecord | null> {
    const row = await one<Row>(
      this.from("organizations").select("*").eq("id", id).limit(1),
      "organizations.get",
    );
    return row ? mapOrganization(row) : null;
  }

  async getMembershipsForUser(userId: Id): Promise<MembershipRecord[]> {
    const rows = await many<Row>(
      this.from("organization_memberships").select("*").eq("user_id", userId),
      "memberships.forUser",
    );
    return rows.map(mapMembership);
  }

  async getMembershipsForOrganization(organizationId: Id): Promise<MembershipRecord[]> {
    const rows = await many<Row>(
      this.from("organization_memberships").select("*").eq("organization_id", organizationId),
      "memberships.forOrg",
    );
    return rows.map(mapMembership);
  }

  async createMembership(
    input: Omit<MembershipRecord, "id" | "createdAt">,
  ): Promise<MembershipRecord> {
    const row = must(
      await one<Row>(
        this.from("organization_memberships")
          .insert({
            organization_id: input.organizationId,
            user_id: input.userId,
            role: input.role,
          })
          .select(),
        "memberships.insert",
      ),
      "memberships.insert",
    );
    return mapMembership(row);
  }

  // ------------------------------------------------------------------
  // Terms acceptances
  // ------------------------------------------------------------------
  async recordTermsAcceptance(
    input: Omit<TermsAcceptanceRecord, "id" | "acceptedAt">,
  ): Promise<TermsAcceptanceRecord> {
    const row = must(
      await one<Row>(
        this.from("terms_acceptances")
          .insert({
            organization_id: input.organizationId,
            user_id: input.userId,
            terms_version: input.termsVersion,
            acknowledged_keys: input.acknowledgedKeys,
            ip_hash: input.ipHash,
            user_agent_category: input.userAgentCategory,
          })
          .select(),
        "terms_acceptances.insert",
      ),
      "terms_acceptances.insert",
    );
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      userId: s(row, "user_id"),
      termsVersion: s(row, "terms_version"),
      acknowledgedKeys: (row.acknowledged_keys as TermsAcceptanceRecord["acknowledgedKeys"]) ?? [],
      acceptedAt: s(row, "accepted_at"),
      ipHash: s(row, "ip_hash"),
      userAgentCategory: s(row, "user_agent_category") as TermsAcceptanceRecord["userAgentCategory"],
    };
  }

  async getLatestAcceptance(
    organizationId: Id,
    userId: Id,
  ): Promise<TermsAcceptanceRecord | null> {
    const row = await one<Row>(
      this.from("terms_acceptances")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .order("accepted_at", { ascending: false })
        .limit(1),
      "terms_acceptances.latest",
    );
    if (!row) return null;
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      userId: s(row, "user_id"),
      termsVersion: s(row, "terms_version"),
      acknowledgedKeys: (row.acknowledged_keys as TermsAcceptanceRecord["acknowledgedKeys"]) ?? [],
      acceptedAt: s(row, "accepted_at"),
      ipHash: s(row, "ip_hash"),
      userAgentCategory: s(row, "user_agent_category") as TermsAcceptanceRecord["userAgentCategory"],
    };
  }

  // ------------------------------------------------------------------
  // Intake sessions
  // ------------------------------------------------------------------
  async getIntakeSession(organizationId: Id, userId: Id): Promise<IntakeSessionRecord | null> {
    const row = await one<Row>(
      this.from("intake_sessions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .is("submitted_invention_id", null)
        .order("updated_at", { ascending: false })
        .limit(1),
      "intake_sessions.get",
    );
    if (!row) return null;
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      userId: s(row, "user_id"),
      state: row.state as IntakeState,
      updatedAt: s(row, "updated_at"),
      submittedInventionId: sOrNull(row, "submitted_invention_id"),
    };
  }

  async saveIntakeSession(
    input: Omit<IntakeSessionRecord, "id" | "updatedAt"> & { id?: Id },
  ): Promise<IntakeSessionRecord> {
    const payload = {
      organization_id: input.organizationId,
      user_id: input.userId,
      state: input.state,
      submitted_invention_id: input.submittedInventionId,
      updated_at: new Date().toISOString(),
    };
    const query = input.id
      ? this.from("intake_sessions").update(payload).eq("id", input.id).select()
      : this.from("intake_sessions").insert(payload).select();
    const row = must(await one<Row>(query, "intake_sessions.save"), "intake_sessions.save");
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      userId: s(row, "user_id"),
      state: row.state as IntakeState,
      updatedAt: s(row, "updated_at"),
      submittedInventionId: sOrNull(row, "submitted_invention_id"),
    };
  }

  // ------------------------------------------------------------------
  // Inventions and facts
  // ------------------------------------------------------------------
  async createInvention(
    input: Omit<InventionRecord, "id" | "createdAt" | "updatedAt" | "status">,
  ): Promise<InventionRecord> {
    const row = must(
      await one<Row>(
        this.from("inventions")
          .insert({
            organization_id: input.organizationId,
            title: input.title,
            summary: input.summary,
            business_context: input.businessContext,
            problem: input.problem,
            solution: input.solution,
            synthetic: input.synthetic,
          })
          .select(),
        "inventions.insert",
      ),
      "inventions.insert",
    );
    return mapInvention(row);
  }

  async getInvention(organizationId: Id, inventionId: Id): Promise<InventionRecord | null> {
    const row = await one<Row>(
      this.from("inventions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", inventionId)
        .limit(1),
      "inventions.get",
    );
    return row ? mapInvention(row) : null;
  }

  async updateInventionTitle(
    organizationId: Id,
    inventionId: Id,
    title: string,
  ): Promise<InventionRecord | null> {
    const row = await one<Row>(
      this.from("inventions")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("id", inventionId)
        .select(),
      "inventions.updateTitle",
    );
    return row ? mapInvention(row) : null;
  }

  async listInventions(organizationId: Id): Promise<InventionRecord[]> {
    const rows = await many<Row>(
      this.from("inventions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "active"),
      "inventions.list",
    );
    return rows.map(mapInvention);
  }

  async softDeleteInvention(organizationId: Id, inventionId: Id): Promise<void> {
    const { error } = await this.from("inventions")
      .update({ status: "soft_deleted", deleted_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", inventionId);
    if (error) throw new Error(`supabase_adapter:inventions.softDelete:${error.message}`);
  }

  async listSoftDeletedInventions(organizationId: Id): Promise<InventionRecord[]> {
    const rows = await many<Row>(
      this.from("inventions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "soft_deleted"),
      "inventions.listSoftDeleted",
    );
    return rows.map(mapInvention);
  }

  async hardDeleteInvention(organizationId: Id, inventionId: Id): Promise<void> {
    // Child rows (facts, contributors, events, sources, extractions,
    // drafts, versions, citations, exports, artifacts) are removed by the
    // ON DELETE CASCADE constraints in supabase/wepatent/migrations/0003+0006.
    const { error } = await this.from("inventions")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", inventionId);
    if (error) throw new Error(`supabase_adapter:inventions.hardDelete:${error.message}`);
  }

  async updateOrganizationRetention(
    organizationId: Id,
    retentionDays: number,
  ): Promise<OrganizationRecord | null> {
    const row = await one<Row>(
      this.from("organizations")
        .update({ retention_days: retentionDays })
        .eq("id", organizationId)
        .select(),
      "organizations.updateRetention",
    );
    return row ? mapOrganization(row) : null;
  }

  async updateOrganizationName(
    organizationId: Id,
    name: string,
  ): Promise<OrganizationRecord | null> {
    const row = await one<Row>(
      this.from("organizations").update({ name }).eq("id", organizationId).select(),
      "organizations.updateName",
    );
    return row ? mapOrganization(row) : null;
  }

  async createFact(
    input: Omit<InventionFactRecord, "id" | "updatedAt">,
  ): Promise<InventionFactRecord> {
    const row = must(
      await one<Row>(
        this.from("invention_facts")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            category: input.category,
            statement: input.statement,
            provenance: input.provenance,
            created_by_actor: input.createdBy,
            origin_ref: input.originRef ?? null,
          })
          .select(),
        "facts.insert",
      ),
      "facts.insert",
    );
    return mapFact(row);
  }

  async listFacts(organizationId: Id, inventionId: Id): Promise<InventionFactRecord[]> {
    const rows = await many<Row>(
      this.from("invention_facts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "facts.list",
    );
    return rows.map(mapFact);
  }

  async updateFactProvenance(
    organizationId: Id,
    factId: Id,
    provenance: FactProvenance,
  ): Promise<InventionFactRecord | null> {
    const row = await one<Row>(
      this.from("invention_facts")
        .update({ provenance, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("id", factId)
        .select(),
      "facts.updateProvenance",
    );
    return row ? mapFact(row) : null;
  }

  // ------------------------------------------------------------------
  // Contributors, disclosure events, sources
  // ------------------------------------------------------------------
  async createContributor(input: Omit<ContributorRecord, "id">): Promise<ContributorRecord> {
    const row = must(
      await one<Row>(
        this.from("contributors")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            name: input.name,
            email: input.email,
          })
          .select(),
        "contributors.insert",
      ),
      "contributors.insert",
    );
    if (input.contribution) {
      await this.from("contribution_facts").insert({
        organization_id: input.organizationId,
        contributor_id: s(row, "id"),
        description: input.contribution,
      });
    }
    return { ...input, id: s(row, "id") };
  }

  async listContributors(organizationId: Id, inventionId: Id): Promise<ContributorRecord[]> {
    const rows = await many<Row>(
      this.from("contributors")
        .select("*, contribution_facts(description)")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "contributors.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      name: s(row, "name"),
      email: sOrNull(row, "email"),
      contribution: Array.isArray(row.contribution_facts)
        ? (row.contribution_facts as Row[]).map((f) => s(f, "description")).join("; ")
        : "",
    }));
  }

  async createDisclosureEvent(
    input: Omit<DisclosureEventRecord, "id">,
  ): Promise<DisclosureEventRecord> {
    const row = must(
      await one<Row>(
        this.from("disclosure_events")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            event_date: input.date,
            kind: input.kind,
            description: input.description,
            under_nda: input.underNda,
          })
          .select(),
        "disclosure_events.insert",
      ),
      "disclosure_events.insert",
    );
    return { ...input, id: s(row, "id") };
  }

  async listDisclosureEvents(
    organizationId: Id,
    inventionId: Id,
  ): Promise<DisclosureEventRecord[]> {
    const rows = await many<Row>(
      this.from("disclosure_events")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("event_date", { ascending: true }),
      "disclosure_events.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      date: s(row, "event_date"),
      kind: s(row, "kind"),
      description: s(row, "description"),
      underNda: b(row, "under_nda"),
    }));
  }

  async createSource(input: Omit<SourceRecord, "id" | "createdAt">): Promise<SourceRecord> {
    const row = must(
      await one<Row>(
        this.from("private_sources")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            name: input.name,
            kind: input.kind,
            note: input.note,
            status: input.status,
            synthetic: input.synthetic,
            original_filename: input.originalFilename,
            mime_type: input.mimeType,
            byte_size: input.byteSize,
            storage_path: input.storagePath,
            checksum_sha256: input.checksumSha256,
            quarantine_reason: input.quarantineReason,
            interpretation_status: input.interpretationStatus,
            derived_from_source_id: input.derivedFromSourceId,
          })
          .select(),
        "sources.insert",
      ),
      "sources.insert",
    );
    return mapSource(row);
  }

  async listSources(organizationId: Id, inventionId: Id): Promise<SourceRecord[]> {
    const rows = await many<Row>(
      this.from("private_sources")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "sources.list",
    );
    return rows.map(mapSource);
  }

  async getSource(organizationId: Id, sourceId: Id): Promise<SourceRecord | null> {
    const row = await one<Row>(
      this.from("private_sources")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", sourceId)
        .limit(1),
      "sources.get",
    );
    return row ? mapSource(row) : null;
  }

  async updateSource(
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
  ): Promise<SourceRecord | null> {
    const payload: Row = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.originalFilename !== undefined) payload.original_filename = patch.originalFilename;
    if (patch.mimeType !== undefined) payload.mime_type = patch.mimeType;
    if (patch.byteSize !== undefined) payload.byte_size = patch.byteSize;
    if (patch.storagePath !== undefined) payload.storage_path = patch.storagePath;
    if (patch.checksumSha256 !== undefined) payload.checksum_sha256 = patch.checksumSha256;
    if (patch.quarantineReason !== undefined) payload.quarantine_reason = patch.quarantineReason;
    if (patch.interpretationStatus !== undefined)
      payload.interpretation_status = patch.interpretationStatus;
    const row = await one<Row>(
      this.from("private_sources")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", sourceId)
        .select(),
      "sources.update",
    );
    return row ? mapSource(row) : null;
  }

  // ------------------------------------------------------------------
  // Drafts
  // ------------------------------------------------------------------
  async createDraft(input: Omit<DraftRecord, "id" | "createdAt">): Promise<DraftRecord> {
    const row = must(
      await one<Row>(
        this.from("drafts")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            workflow: input.workflow,
            title: input.title,
          })
          .select(),
        "drafts.insert",
      ),
      "drafts.insert",
    );
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      workflow: s(row, "workflow") as DraftRecord["workflow"],
      title: s(row, "title"),
      createdAt: s(row, "created_at"),
    };
  }

  async listDrafts(organizationId: Id, inventionId: Id): Promise<DraftRecord[]> {
    const rows = await many<Row>(
      this.from("drafts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "drafts.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      workflow: s(row, "workflow") as DraftRecord["workflow"],
      title: s(row, "title"),
      createdAt: s(row, "created_at"),
    }));
  }

  async getDraft(organizationId: Id, draftId: Id): Promise<DraftRecord | null> {
    const row = await one<Row>(
      this.from("drafts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", draftId)
        .limit(1),
      "drafts.get",
    );
    if (!row) return null;
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      workflow: s(row, "workflow") as DraftRecord["workflow"],
      title: s(row, "title"),
      createdAt: s(row, "created_at"),
    };
  }

  async createDraftVersion(
    input: Omit<DraftVersionRecord, "id" | "createdAt" | "version" | "label">,
  ): Promise<DraftVersionRecord> {
    const siblings = await many<Row>(
      this.from("draft_versions")
        .select("version")
        .eq("organization_id", input.organizationId)
        .eq("draft_id", input.draftId)
        .order("version", { ascending: false })
        .limit(1),
      "draft_versions.maxVersion",
    );
    const nextVersion = siblings.length > 0 ? n(siblings[0], "version") + 1 : 1;
    const row = must(
      await one<Row>(
        this.from("draft_versions")
          .insert({
            organization_id: input.organizationId,
            draft_id: input.draftId,
            version: nextVersion,
            content: input.content,
            model_id: input.modelId,
            rate_version: input.rateVersion,
            estimate_customer_high_cents: input.estimateCustomerHighCents,
            actual_provider_cost_cents: input.actualProviderCostCents,
            actual_customer_charge_cents: input.actualCustomerChargeCents,
            unresolved_fact_count: input.unresolvedFactCount,
            source_status_summary: input.sourceStatusSummary,
            reservation_id: input.reservationId,
          })
          .select(),
        "draft_versions.insert",
      ),
      "draft_versions.insert",
    );
    return mapDraftVersion(row);
  }

  async listDraftVersions(organizationId: Id, draftId: Id): Promise<DraftVersionRecord[]> {
    const rows = await many<Row>(
      this.from("draft_versions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("draft_id", draftId)
        .order("version", { ascending: true }),
      "draft_versions.list",
    );
    return rows.map(mapDraftVersion);
  }

  async getDraftVersion(organizationId: Id, versionId: Id): Promise<DraftVersionRecord | null> {
    const row = await one<Row>(
      this.from("draft_versions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", versionId)
        .limit(1),
      "draft_versions.get",
    );
    return row ? mapDraftVersion(row) : null;
  }

  async createDraftCitation(
    input: Omit<DraftCitationRecord, "id" | "createdAt">,
  ): Promise<DraftCitationRecord> {
    const row = must(
      await one<Row>(
        this.from("draft_citations")
          .insert({
            organization_id: input.organizationId,
            draft_version_id: input.draftVersionId,
            source_id: input.sourceId,
            fact_id: input.factId,
            locator: input.locator,
          })
          .select(),
        "draft_citations.insert",
      ),
      "draft_citations.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listDraftCitations(
    organizationId: Id,
    draftVersionId: Id,
  ): Promise<DraftCitationRecord[]> {
    const rows = await many<Row>(
      this.from("draft_citations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("draft_version_id", draftVersionId)
        .order("created_at", { ascending: true }),
      "draft_citations.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      draftVersionId: s(row, "draft_version_id"),
      sourceId: sOrNull(row, "source_id"),
      factId: sOrNull(row, "fact_id"),
      locator: s(row, "locator"),
      createdAt: s(row, "created_at"),
    }));
  }

  // ------------------------------------------------------------------
  // Exports
  // ------------------------------------------------------------------
  async createExport(
    input: Omit<ExportRecordEntry, "id" | "createdAt">,
  ): Promise<ExportRecordEntry> {
    const row = must(
      await one<Row>(
        this.from("exports")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            draft_version_id: input.draftVersionId,
            figure_set_id: input.figureSetId ?? null,
            checksum: input.checksum,
          })
          .select(),
        "exports.insert",
      ),
      "exports.insert",
    );
    await this.from("export_manifests").insert({
      organization_id: input.organizationId,
      export_id: s(row, "id"),
      manifest: input.manifest,
    });
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listExports(organizationId: Id, inventionId: Id): Promise<ExportRecordEntry[]> {
    const rows = await many<Row>(
      this.from("exports")
        .select("*, export_manifests(manifest)")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "exports.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      draftVersionId: sOrNull(row, "draft_version_id"),
      manifest: Array.isArray(row.export_manifests)
        ? ((row.export_manifests as Row[])[0]?.manifest as ExportRecordEntry["manifest"])
        : ((row.export_manifests as Row | null)?.manifest as ExportRecordEntry["manifest"]),
      checksum: s(row, "checksum"),
      createdAt: s(row, "created_at"),
    }));
  }

  async getExport(organizationId: Id, exportId: Id): Promise<ExportRecordEntry | null> {
    const rows = await many<Row>(
      this.from("exports")
        .select("*, export_manifests(manifest)")
        .eq("organization_id", organizationId)
        .eq("id", exportId)
        .limit(1),
      "exports.get",
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      draftVersionId: sOrNull(row, "draft_version_id"),
      manifest: Array.isArray(row.export_manifests)
        ? ((row.export_manifests as Row[])[0]?.manifest as ExportRecordEntry["manifest"])
        : ((row.export_manifests as Row | null)?.manifest as ExportRecordEntry["manifest"]),
      checksum: s(row, "checksum"),
      createdAt: s(row, "created_at"),
    };
  }

  async appendExportArtifact(
    input: Omit<ExportArtifactRecord, "id" | "createdAt">,
  ): Promise<ExportArtifactRecord> {
    const row = must(
      await one<Row>(
        this.from("export_artifacts")
          .insert({
            organization_id: input.organizationId,
            export_id: input.exportId,
            name: input.name,
            content_type: input.contentType,
            byte_size: input.byteSize,
            sha256: input.sha256,
            storage_path: input.storagePath,
          })
          .select(),
        "export_artifacts.insert",
      ),
      "export_artifacts.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listExportArtifacts(
    organizationId: Id,
    exportId: Id,
  ): Promise<ExportArtifactRecord[]> {
    const rows = await many<Row>(
      this.from("export_artifacts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("export_id", exportId),
      "export_artifacts.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      exportId: s(row, "export_id"),
      name: s(row, "name"),
      contentType: s(row, "content_type"),
      byteSize: n(row, "byte_size"),
      sha256: s(row, "sha256"),
      storagePath: s(row, "storage_path"),
      createdAt: s(row, "created_at"),
    }));
  }

  // ------------------------------------------------------------------
  // Durable jobs
  // ------------------------------------------------------------------
  async createJob(
    input: Pick<JobRecord, "organizationId" | "kind" | "idempotencyKey" | "payload">,
  ): Promise<JobRecord> {
    const row = must(
      await one<Row>(
        this.from("app_jobs")
          .insert({
            organization_id: input.organizationId,
            kind: input.kind,
            idempotency_key: input.idempotencyKey,
            payload: input.payload,
          })
          .select(),
        "jobs.insert",
      ),
      "jobs.insert",
    );
    return mapJob(row);
  }

  async getJob(organizationId: Id, jobId: Id): Promise<JobRecord | null> {
    const row = await one<Row>(
      this.from("app_jobs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", jobId)
        .limit(1),
      "jobs.get",
    );
    return row ? mapJob(row) : null;
  }

  async findJobByKey(
    organizationId: Id,
    kind: JobKind,
    idempotencyKey: string,
  ): Promise<JobRecord | null> {
    const row = await one<Row>(
      this.from("app_jobs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("kind", kind)
        .eq("idempotency_key", idempotencyKey)
        .limit(1),
      "jobs.findByKey",
    );
    return row ? mapJob(row) : null;
  }

  async updateJob(
    organizationId: Id,
    jobId: Id,
    patch: Partial<
      Pick<JobRecord, "status" | "result" | "errorSummary" | "attempts" | "startedAt" | "finishedAt">
    >,
  ): Promise<JobRecord | null> {
    const payload: Row = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.result !== undefined) payload.result = patch.result;
    if (patch.errorSummary !== undefined) payload.error_summary = patch.errorSummary;
    if (patch.attempts !== undefined) payload.attempts = patch.attempts;
    if (patch.startedAt !== undefined) payload.started_at = patch.startedAt;
    if (patch.finishedAt !== undefined) payload.finished_at = patch.finishedAt;
    const row = await one<Row>(
      this.from("app_jobs")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", jobId)
        .select(),
      "jobs.update",
    );
    return row ? mapJob(row) : null;
  }

  async listJobs(organizationId: Id): Promise<JobRecord[]> {
    const rows = await many<Row>(
      this.from("app_jobs").select("*").eq("organization_id", organizationId),
      "jobs.list",
    );
    return rows.map(mapJob);
  }

  // ------------------------------------------------------------------
  // Invitations
  // ------------------------------------------------------------------
  async createInvitation(
    input: Omit<InvitationRecord, "id" | "createdAt" | "acceptedAt" | "acceptedBy" | "revokedAt">,
  ): Promise<InvitationRecord> {
    const row = must(
      await one<Row>(
        this.from("invitations")
          .insert({
            organization_id: input.organizationId,
            email: input.email,
            role: input.role,
            token_hash: input.tokenHash,
            invited_by: input.invitedBy,
            expires_at: input.expiresAt,
          })
          .select(),
        "invitations.insert",
      ),
      "invitations.insert",
    );
    return mapInvitation(row);
  }

  async listInvitations(organizationId: Id): Promise<InvitationRecord[]> {
    const rows = await many<Row>(
      this.from("invitations").select("*").eq("organization_id", organizationId),
      "invitations.list",
    );
    return rows.map(mapInvitation);
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    const row = await one<Row>(
      this.from("invitations").select("*").eq("token_hash", tokenHash).limit(1),
      "invitations.getByToken",
    );
    return row ? mapInvitation(row) : null;
  }

  async updateInvitation(
    invitationId: Id,
    patch: Partial<Pick<InvitationRecord, "acceptedAt" | "acceptedBy" | "revokedAt">>,
  ): Promise<InvitationRecord | null> {
    const payload: Row = {};
    if (patch.acceptedAt !== undefined) payload.accepted_at = patch.acceptedAt;
    if (patch.acceptedBy !== undefined) payload.accepted_by = patch.acceptedBy;
    if (patch.revokedAt !== undefined) payload.revoked_at = patch.revokedAt;
    const row = await one<Row>(
      this.from("invitations").update(payload).eq("id", invitationId).select(),
      "invitations.update",
    );
    return row ? mapInvitation(row) : null;
  }

  // ------------------------------------------------------------------
  // Counsel requests (tenant lane)
  // ------------------------------------------------------------------
  async createCounselRequest(
    input: Omit<CounselRequestRecord, "id" | "state" | "createdAt" | "updatedAt">,
  ): Promise<CounselRequestRecord> {
    const row = must(
      await one<Row>(
        this.from("counsel_requests")
          .insert({
            organization_id: input.organizationId,
            created_by: input.createdByUserId,
            invention_id: input.inventionId,
            request_summary: input.requestSummary,
            adverse_parties: input.adverseParties,
            jurisdiction: input.jurisdiction,
            contact_email: input.contactEmail,
          })
          .select(),
        "counsel_requests.insert",
      ),
      "counsel_requests.insert",
    );
    return mapCounselRequest(row);
  }

  async getCounselRequest(
    organizationId: Id,
    requestId: Id,
  ): Promise<CounselRequestRecord | null> {
    const row = await one<Row>(
      this.from("counsel_requests")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", requestId)
        .limit(1),
      "counsel_requests.get",
    );
    return row ? mapCounselRequest(row) : null;
  }

  async listCounselRequests(organizationId: Id): Promise<CounselRequestRecord[]> {
    const rows = await many<Row>(
      this.from("counsel_requests").select("*").eq("organization_id", organizationId),
      "counsel_requests.list",
    );
    return rows.map(mapCounselRequest);
  }

  async updateCounselRequestState(
    organizationId: Id,
    requestId: Id,
    state: CounselRequestState,
  ): Promise<CounselRequestRecord | null> {
    // The database transition trigger enforces adjacency and the signed-
    // engagement evidence rule as defense in depth behind the application
    // state machine.
    const row = await one<Row>(
      this.from("counsel_requests")
        .update({ state, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("id", requestId)
        .select(),
      "counsel_requests.updateState",
    );
    return row ? mapCounselRequest(row) : null;
  }

  async appendCounselRequestEvent(
    input: Omit<CounselRequestEventRecord, "id" | "createdAt">,
  ): Promise<CounselRequestEventRecord> {
    const row = must(
      await one<Row>(
        this.from("counsel_request_events")
          .insert({
            organization_id: input.organizationId,
            request_id: input.requestId,
            from_state: input.fromState,
            to_state: input.toState,
            action: input.action,
            actor_role: input.actorRole,
            evidence_ref: input.evidenceRef,
          })
          .select(),
        "counsel_request_events.insert",
      ),
      "counsel_request_events.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listCounselRequestEvents(
    organizationId: Id,
    requestId: Id,
  ): Promise<CounselRequestEventRecord[]> {
    const rows = await many<Row>(
      this.from("counsel_request_events")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("request_id", requestId)
        .order("created_at", { ascending: true }),
      "counsel_request_events.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      requestId: s(row, "request_id"),
      fromState: s(row, "from_state") as CounselRequestState,
      toState: s(row, "to_state") as CounselRequestState,
      action: s(row, "action") as CounselRequestEventRecord["action"],
      actorRole: s(row, "actor_role") as Role,
      evidenceRef: sOrNull(row, "evidence_ref"),
      createdAt: s(row, "created_at"),
    }));
  }

  // ------------------------------------------------------------------
  // Connected-counsel administration lane
  // ------------------------------------------------------------------
  async getCounselAssignment(userId: Id): Promise<CounselAssignmentRecord | null> {
    const row = await one<Row>(
      this.from("counsel_assignments").select("*").eq("user_id", userId).limit(1),
      "counsel_assignments.get",
    );
    if (!row) return null;
    return {
      userId: s(row, "user_id"),
      role: s(row, "role") as CounselAssignmentRecord["role"],
      lawFirmName: s(row, "law_firm_name"),
      mfaEnrolled: b(row, "mfa_enrolled"),
      createdAt: s(row, "created_at"),
    };
  }

  async setCounselAssignment(
    record: CounselAssignmentRecord,
  ): Promise<CounselAssignmentRecord> {
    const { error } = await this.from("counsel_assignments").upsert({
      user_id: record.userId,
      role: record.role,
      law_firm_name: record.lawFirmName,
      mfa_enrolled: record.mfaEnrolled,
    });
    if (error) throw new Error(`supabase_adapter:counsel_assignments.set:${error.message}`);
    return record;
  }

  async listCounselRequestsAllOrgs(): Promise<CounselRequestRecord[]> {
    const rows = await many<Row>(
      this.from("counsel_requests").select("*").order("created_at", { ascending: false }),
      "counsel_requests.listAll",
    );
    return rows.map(mapCounselRequest);
  }

  async getCounselRequestAnyOrg(requestId: Id): Promise<CounselRequestRecord | null> {
    const row = await one<Row>(
      this.from("counsel_requests").select("*").eq("id", requestId).limit(1),
      "counsel_requests.getAny",
    );
    return row ? mapCounselRequest(row) : null;
  }

  async createEngagement(
    input: Omit<EngagementRecord, "id" | "offeredAt">,
  ): Promise<EngagementRecord> {
    const row = must(
      await one<Row>(
        this.from("engagements")
          .insert({
            organization_id: input.organizationId,
            request_id: input.requestId,
            law_firm_name: input.lawFirmName,
            scope_summary: input.scopeSummary,
            signed_document_ref: input.signedDocumentRef,
            signed_at: input.signedAt,
          })
          .select(),
        "engagements.insert",
      ),
      "engagements.insert",
    );
    return mapEngagement(row);
  }

  async getEngagement(engagementId: Id): Promise<EngagementRecord | null> {
    const row = await one<Row>(
      this.from("engagements").select("*").eq("id", engagementId).limit(1),
      "engagements.get",
    );
    return row ? mapEngagement(row) : null;
  }

  async getEngagementByRequest(requestId: Id): Promise<EngagementRecord | null> {
    const row = await one<Row>(
      this.from("engagements").select("*").eq("request_id", requestId).limit(1),
      "engagements.getByRequest",
    );
    return row ? mapEngagement(row) : null;
  }

  async updateEngagement(
    engagementId: Id,
    patch: Partial<Pick<EngagementRecord, "signedDocumentRef" | "signedAt">>,
  ): Promise<EngagementRecord | null> {
    const payload: Row = {};
    if (patch.signedDocumentRef !== undefined) payload.signed_document_ref = patch.signedDocumentRef;
    if (patch.signedAt !== undefined) payload.signed_at = patch.signedAt;
    const row = await one<Row>(
      this.from("engagements").update(payload).eq("id", engagementId).select(),
      "engagements.update",
    );
    return row ? mapEngagement(row) : null;
  }

  async createLegalMatter(
    input: Omit<LegalMatterRecord, "id" | "openedAt">,
  ): Promise<LegalMatterRecord> {
    const row = must(
      await one<Row>(
        this.from("legal_matters")
          .insert({
            organization_id: input.organizationId,
            engagement_id: input.engagementId,
            matter_reference: input.matterReference,
          })
          .select(),
        "legal_matters.insert",
      ),
      "legal_matters.insert",
    );
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      engagementId: s(row, "engagement_id"),
      matterReference: s(row, "matter_reference"),
      openedAt: s(row, "opened_at"),
    };
  }

  async getLegalMatter(matterId: Id): Promise<LegalMatterRecord | null> {
    const row = await one<Row>(
      this.from("legal_matters").select("*").eq("id", matterId).limit(1),
      "legal_matters.get",
    );
    if (!row) return null;
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      engagementId: s(row, "engagement_id"),
      matterReference: s(row, "matter_reference"),
      openedAt: s(row, "opened_at"),
    };
  }

  async getLegalMatterByEngagement(engagementId: Id): Promise<LegalMatterRecord | null> {
    const row = await one<Row>(
      this.from("legal_matters").select("*").eq("engagement_id", engagementId).limit(1),
      "legal_matters.getByEngagement",
    );
    if (!row) return null;
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      engagementId: s(row, "engagement_id"),
      matterReference: s(row, "matter_reference"),
      openedAt: s(row, "opened_at"),
    };
  }

  async createFilingPackage(
    input: Omit<FilingPackageRecord, "id" | "createdAt">,
  ): Promise<FilingPackageRecord> {
    const row = must(
      await one<Row>(
        this.from("filing_packages")
          .insert({
            organization_id: input.organizationId,
            matter_id: input.matterId,
            description: input.description,
            status: input.status,
          })
          .select(),
        "filing_packages.insert",
      ),
      "filing_packages.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listFilingPackages(matterId: Id): Promise<FilingPackageRecord[]> {
    const rows = await many<Row>(
      this.from("filing_packages").select("*").eq("matter_id", matterId),
      "filing_packages.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      matterId: s(row, "matter_id"),
      description: s(row, "description"),
      status: s(row, "status") as FilingPackageRecord["status"],
      createdAt: s(row, "created_at"),
    }));
  }

  async updateFilingPackageStatus(
    packageId: Id,
    status: FilingPackageRecord["status"],
  ): Promise<FilingPackageRecord | null> {
    const row = await one<Row>(
      this.from("filing_packages").update({ status }).eq("id", packageId).select(),
      "filing_packages.updateStatus",
    );
    if (!row) return null;
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      matterId: s(row, "matter_id"),
      description: s(row, "description"),
      status: s(row, "status") as FilingPackageRecord["status"],
      createdAt: s(row, "created_at"),
    };
  }

  async appendCounselAuditEvent(
    input: Omit<CounselAuditEventRecord, "id" | "createdAt">,
  ): Promise<CounselAuditEventRecord> {
    const row = must(
      await one<Row>(
        this.from("counsel_audit_events")
          .insert({
            counsel_user_id: input.counselUserId,
            organization_id: input.organizationId,
            request_id: input.requestId,
            action: input.action,
            meta: input.meta,
          })
          .select(),
        "counsel_audit_events.insert",
      ),
      "counsel_audit_events.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listCounselAuditEvents(): Promise<CounselAuditEventRecord[]> {
    const rows = await many<Row>(
      this.from("counsel_audit_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      "counsel_audit_events.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      counselUserId: s(row, "counsel_user_id"),
      organizationId: sOrNull(row, "organization_id"),
      requestId: sOrNull(row, "request_id"),
      action: s(row, "action"),
      meta: meta(row, "meta"),
      createdAt: s(row, "created_at"),
    }));
  }

  // ------------------------------------------------------------------
  // Wallet, reservations, usage, audit
  // ------------------------------------------------------------------
  async getWallet(organizationId: Id): Promise<WalletRecord | null> {
    const row = await one<Row>(
      this.from("wallet_accounts").select("*").eq("organization_id", organizationId).limit(1),
      "wallet.get",
    );
    if (!row) return null;
    return {
      organizationId: s(row, "organization_id"),
      balanceCents: n(row, "balance_cents"),
      reservedCents: n(row, "reserved_cents"),
    };
  }

  async saveWallet(wallet: WalletRecord): Promise<WalletRecord> {
    const { error } = await this.from("wallet_accounts").upsert({
      organization_id: wallet.organizationId,
      balance_cents: wallet.balanceCents,
      reserved_cents: wallet.reservedCents,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(`supabase_adapter:wallet.save:${error.message}`);
    return wallet;
  }

  async appendLedgerEntry(
    input: Omit<LedgerEntryRecord, "id" | "createdAt">,
  ): Promise<LedgerEntryRecord> {
    const row = must(
      await one<Row>(
        this.from("wallet_ledger_entries")
          .insert({
            organization_id: input.organizationId,
            kind: input.kind,
            amount_cents: input.amountCents,
            reservation_id: input.reservationId,
            stripe_reference: input.stripeReference ?? null,
            note: input.note,
          })
          .select(),
        "ledger.insert",
      ),
      "ledger.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listLedgerEntries(organizationId: Id): Promise<LedgerEntryRecord[]> {
    const rows = await many<Row>(
      this.from("wallet_ledger_entries")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      "ledger.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      kind: s(row, "kind") as LedgerEntryRecord["kind"],
      amountCents: n(row, "amount_cents"),
      reservationId: sOrNull(row, "reservation_id"),
      stripeReference: sOrNull(row, "stripe_reference"),
      note: s(row, "note"),
      createdAt: s(row, "created_at"),
    }));
  }

  async listReservations(organizationId: Id): Promise<ReservationRecord[]> {
    const rows = await many<Row>(
      this.from("usage_reservations").select("*").eq("organization_id", organizationId),
      "reservations.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      idempotencyKey: s(row, "idempotency_key"),
      amountCents: n(row, "amount_cents"),
      rateVersion: s(row, "rate_version"),
      status: s(row, "status") as ReservationRecord["status"],
      settledProviderCostCents: nOrNull(row, "settled_provider_cost_cents") ?? undefined,
      settledCustomerChargeCents: nOrNull(row, "settled_customer_charge_cents") ?? undefined,
      createdAt: s(row, "created_at"),
    }));
  }

  async saveReservation(reservation: ReservationRecord): Promise<ReservationRecord> {
    const { error } = await this.from("usage_reservations").upsert({
      id: reservation.id,
      organization_id: reservation.organizationId,
      idempotency_key: reservation.idempotencyKey,
      amount_cents: reservation.amountCents,
      rate_version: reservation.rateVersion,
      status: reservation.status,
      markup_multiplier_bp: markupBasisPoints(
        reservation.markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER,
      ),
      settled_provider_cost_cents: reservation.settledProviderCostCents ?? null,
      settled_customer_charge_cents: reservation.settledCustomerChargeCents ?? null,
    });
    if (error) throw new Error(`supabase_adapter:reservations.save:${error.message}`);
    return reservation;
  }

  async appendUsageEvent(
    input: Omit<UsageEventRecord, "id" | "createdAt">,
  ): Promise<UsageEventRecord> {
    const row = must(
      await one<Row>(
        this.from("usage_events")
          .insert({
            organization_id: input.organizationId,
            reservation_id: input.reservationId,
            model_id: input.modelId,
            rate_version: input.rateVersion,
            provider_cost_cents: input.providerCostCents,
            customer_charge_cents: input.customerChargeCents,
            // Basis points: the database CHECK re-derives the charge from
            // this, so an event can never claim a multiplier it did not use.
            markup_multiplier_bp: markupBasisPoints(
              input.markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER,
            ),
            input_tokens: input.inputTokens,
            output_tokens: input.outputTokens,
          })
          .select(),
        "usage_events.insert",
      ),
      "usage_events.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listUsageEvents(organizationId: Id): Promise<UsageEventRecord[]> {
    const rows = await many<Row>(
      this.from("usage_events")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      "usage_events.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      reservationId: s(row, "reservation_id"),
      modelId: s(row, "model_id"),
      rateVersion: s(row, "rate_version"),
      providerCostCents: n(row, "provider_cost_cents"),
      customerChargeCents: n(row, "customer_charge_cents"),
      inputTokens: n(row, "input_tokens"),
      outputTokens: n(row, "output_tokens"),
      createdAt: s(row, "created_at"),
    }));
  }

  // ------------------------------------------------------------------
  // Stripe webhook events, billing outbox, customer mapping (FR-6)
  // ------------------------------------------------------------------
  async insertStripeEvent(
    input: Omit<StripeEventRecord, "processedAt" | "receivedAt">,
  ): Promise<{ record: StripeEventRecord; created: boolean }> {
    // Primary-key conflict = redelivery: return the stored event untouched.
    const { data, error } = await this.from("stripe_events")
      .insert({
        id: input.id,
        type: input.type,
        payload: input.payload,
        signature_verified: input.signatureVerified,
      })
      .select();
    if (error) {
      if (error.code === "23505") {
        const existing = must(
          await one<Row>(
            this.from("stripe_events").select("*").eq("id", input.id).limit(1),
            "stripe_events.get",
          ),
          "stripe_events.get",
        );
        return { record: this.mapStripeEvent(existing), created: false };
      }
      throw new Error(`supabase_adapter:stripe_events.insert:${error.message}`);
    }
    const row = must((data as Row[] | null)?.[0] ?? null, "stripe_events.insert");
    return { record: this.mapStripeEvent(row), created: true };
  }

  private mapStripeEvent(row: Row): StripeEventRecord {
    return {
      id: s(row, "id"),
      type: s(row, "type"),
      payload: (row.payload ?? {}) as Record<string, unknown>,
      signatureVerified: b(row, "signature_verified"),
      processedAt: sOrNull(row, "processed_at"),
      receivedAt: s(row, "received_at"),
    };
  }

  async markStripeEventProcessed(id: string): Promise<void> {
    const { error } = await this.from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`supabase_adapter:stripe_events.mark:${error.message}`);
  }

  async appendBillingOutbox(
    input: Omit<BillingOutboxRecord, "id" | "createdAt" | "processedAt" | "attempts" | "status">,
  ): Promise<BillingOutboxRecord> {
    const row = must(
      await one<Row>(
        this.from("billing_outbox")
          .insert({
            organization_id: input.organizationId,
            stripe_event_id: input.stripeEventId,
            action: input.action,
            payload: input.payload,
          })
          .select(),
        "billing_outbox.insert",
      ),
      "billing_outbox.insert",
    );
    return this.mapOutbox(row);
  }

  private mapOutbox(row: Row): BillingOutboxRecord {
    return {
      id: s(row, "id"),
      organizationId: sOrNull(row, "organization_id"),
      stripeEventId: sOrNull(row, "stripe_event_id"),
      action: s(row, "action"),
      payload: meta(row, "payload"),
      status: s(row, "status") as BillingOutboxRecord["status"],
      attempts: n(row, "attempts"),
      createdAt: s(row, "created_at"),
      processedAt: sOrNull(row, "processed_at"),
    };
  }

  async listPendingBillingOutbox(): Promise<BillingOutboxRecord[]> {
    const rows = await many<Row>(
      this.from("billing_outbox")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      "billing_outbox.list",
    );
    return rows.map((row) => this.mapOutbox(row));
  }

  async updateBillingOutbox(
    id: Id,
    patch: Partial<Pick<BillingOutboxRecord, "status" | "attempts" | "processedAt">>,
  ): Promise<BillingOutboxRecord | null> {
    const update: Record<string, unknown> = {};
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.attempts !== undefined) update.attempts = patch.attempts;
    if (patch.processedAt !== undefined) update.processed_at = patch.processedAt;
    const row = await one<Row>(
      this.from("billing_outbox").update(update).eq("id", id).select(),
      "billing_outbox.update",
    );
    return row ? this.mapOutbox(row) : null;
  }

  async getStripeCustomerId(organizationId: Id): Promise<string | null> {
    const row = await one<Row>(
      this.from("wallet_accounts")
        .select("stripe_customer_id")
        .eq("organization_id", organizationId)
        .limit(1),
      "wallet.customer.get",
    );
    return row ? sOrNull(row, "stripe_customer_id") : null;
  }

  async setStripeCustomerId(organizationId: Id, stripeCustomerId: string): Promise<void> {
    const { error } = await this.from("wallet_accounts").upsert({
      organization_id: organizationId,
      stripe_customer_id: stripeCustomerId,
    });
    if (error) throw new Error(`supabase_adapter:wallet.customer.set:${error.message}`);
  }

  /* --------------------- three-pass drafting ------------------------ */

  async createDraftSet(
    input: Omit<DraftSetRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<DraftSetRecord> {
    const row = must(
      await one<Row>(
        this.from("draft_sets")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            state: toDbPassState(input.state),
            interrupted_stage: input.interruptedStage
              ? toDbPassState(input.interruptedStage)
              : null,
            pass_1_version_id: input.passOneVersionId,
            pass_2_version_id: input.passTwoVersionId,
            figure_set_id: input.figureSetId,
            illustrations_brief: input.illustrationsBrief ?? {},
            brief_version: input.briefVersion,
            reconciliation: input.reconciliation ?? null,
            reconciled: input.reconciled,
            reconciliation_version: input.reconciliationVersion,
            status_detail: input.statusDetail,
            // accepted_by / accepted_at are deliberately NOT written here:
            // the platform can never accept on a person's behalf. They are
            // set only by the explicit acceptance path (invariant 1).
            pass_1_reservation_id: input.passOneReservationId,
            pass_2_reservation_id: input.passTwoReservationId,
            pass_1_charge_cents: input.passOneChargeCents,
            pass_2_charge_cents: input.passTwoChargeCents,
          })
          .select(),
        "draft_sets.insert",
      ),
      "draft_sets.insert",
    );
    return mapDraftSet(row);
  }

  async getDraftSet(organizationId: Id, draftSetId: Id): Promise<DraftSetRecord | null> {
    const row = await one<Row>(
      this.from("draft_sets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", draftSetId)
        .limit(1),
      "draft_sets.get",
    );
    return row ? mapDraftSet(row) : null;
  }

  async listDraftSets(organizationId: Id, inventionId: Id): Promise<DraftSetRecord[]> {
    const rows = await many<Row>(
      this.from("draft_sets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "draft_sets.list",
    );
    return rows.map(mapDraftSet);
  }

  /** Mirrors the partial unique index: at most one non-terminal set. */
  async getActiveDraftSet(
    organizationId: Id,
    inventionId: Id,
  ): Promise<DraftSetRecord | null> {
    const rows = await many<Row>(
      this.from("draft_sets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .not("state", "in", "(ready_for_review,failed)")
        .order("created_at", { ascending: false })
        .limit(1),
      "draft_sets.active",
    );
    return rows[0] ? mapDraftSet(rows[0]) : null;
  }

  async updateDraftSet(
    organizationId: Id,
    draftSetId: Id,
    patch: Partial<DraftSetRecord>,
  ): Promise<DraftSetRecord | null> {
    const update: Record<string, unknown> = {};
    if (patch.state !== undefined) update.state = toDbPassState(patch.state);
    if (patch.interruptedStage !== undefined) {
      update.interrupted_stage = patch.interruptedStage
        ? toDbPassState(patch.interruptedStage)
        : null;
    }
    if (patch.passOneVersionId !== undefined) update.pass_1_version_id = patch.passOneVersionId;
    if (patch.passTwoVersionId !== undefined) update.pass_2_version_id = patch.passTwoVersionId;
    if (patch.figureSetId !== undefined) update.figure_set_id = patch.figureSetId;
    if (patch.illustrationsBrief !== undefined) {
      update.illustrations_brief = patch.illustrationsBrief ?? {};
    }
    if (patch.briefVersion !== undefined) update.brief_version = patch.briefVersion;
    if (patch.reconciliation !== undefined) update.reconciliation = patch.reconciliation ?? null;
    if (patch.reconciled !== undefined) update.reconciled = patch.reconciled;
    if (patch.reconciliationVersion !== undefined) {
      update.reconciliation_version = patch.reconciliationVersion;
    }
    if (patch.statusDetail !== undefined) update.status_detail = patch.statusDetail;
    if (patch.acceptedByUserId !== undefined) update.accepted_by = patch.acceptedByUserId;
    if (patch.acceptedAt !== undefined) update.accepted_at = patch.acceptedAt;
    if (patch.passOneReservationId !== undefined) {
      update.pass_1_reservation_id = patch.passOneReservationId;
    }
    if (patch.passTwoReservationId !== undefined) {
      update.pass_2_reservation_id = patch.passTwoReservationId;
    }
    if (patch.passOneChargeCents !== undefined) {
      update.pass_1_charge_cents = patch.passOneChargeCents;
    }
    if (patch.passTwoChargeCents !== undefined) {
      update.pass_2_charge_cents = patch.passTwoChargeCents;
    }
    update.updated_at = new Date().toISOString();

    const row = await one<Row>(
      this.from("draft_sets")
        .update(update)
        .eq("organization_id", organizationId)
        .eq("id", draftSetId)
        .select(),
      "draft_sets.update",
    );
    return row ? mapDraftSet(row) : null;
  }

  async appendDraftSetTransition(
    input: Omit<DraftSetTransitionRecord, "id" | "createdAt">,
  ): Promise<DraftSetTransitionRecord> {
    const row = must(
      await one<Row>(
        this.from("draft_set_transitions")
          .insert({
            organization_id: input.organizationId,
            draft_set_id: input.draftSetId,
            from_state: input.fromState ? toDbPassState(input.fromState) : null,
            to_state: toDbPassState(input.toState),
            actor: input.actor,
            reason: input.reason,
          })
          .select(),
        "draft_set_transitions.insert",
      ),
      "draft_set_transitions.insert",
    );
    return mapDraftSetTransition(row);
  }

  async listDraftSetTransitions(
    organizationId: Id,
    draftSetId: Id,
  ): Promise<DraftSetTransitionRecord[]> {
    const rows = await many<Row>(
      this.from("draft_set_transitions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("draft_set_id", draftSetId)
        .order("created_at", { ascending: true }),
      "draft_set_transitions.list",
    );
    return rows.map(mapDraftSetTransition);
  }

  /* ------------------------- patent figures ------------------------- */

  async createFigureSet(
    input: Omit<FigureSetRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<FigureSetRecord> {
    const row = must(
      await one<Row>(
        this.from("figure_sets")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            draft_version_id: input.draftVersionId,
            state: input.state,
            sheet_size: input.sheetSize,
            orientation_policy: input.orientationPolicy,
            rules_version: input.rulesVersion,
            planner_version: input.plannerVersion,
            composer_version: input.composerVersion,
            model_id: input.modelId,
            prompt_template_version: input.promptTemplateVersion,
            input_hash: input.inputHash,
            total_cost_cents: input.totalCostCents,
            total_provider_cost_cents: input.totalProviderCostCents,
            // ai_state is left at its ai_proposed default on purpose: the
            // platform can never write a confirmed state (invariant 1).
            status_detail: input.statusDetail,
          })
          .select(),
        "figure_sets.insert",
      ),
      "figure_sets.insert",
    );
    return mapFigureSet(row);
  }

  async getFigureSet(organizationId: Id, figureSetId: Id): Promise<FigureSetRecord | null> {
    const row = await one<Row>(
      this.from("figure_sets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", figureSetId),
      "figure_sets.get",
    );
    return row ? mapFigureSet(row) : null;
  }

  async listFigureSets(organizationId: Id, inventionId: Id): Promise<FigureSetRecord[]> {
    const rows = await many<Row>(
      this.from("figure_sets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "figure_sets.list",
    );
    return rows.map(mapFigureSet);
  }

  async updateFigureSet(
    organizationId: Id,
    figureSetId: Id,
    patch: Partial<FigureSetRecord>,
  ): Promise<FigureSetRecord | null> {
    const update: Row = { updated_at: new Date().toISOString() };
    if (patch.state !== undefined) update.state = patch.state;
    if (patch.aiState !== undefined) update.ai_state = patch.aiState;
    if (patch.statusDetail !== undefined) update.status_detail = patch.statusDetail;
    if (patch.totalCostCents !== undefined) update.total_cost_cents = patch.totalCostCents;
    if (patch.totalProviderCostCents !== undefined) {
      update.total_provider_cost_cents = patch.totalProviderCostCents;
    }
    if (patch.composerVersion !== undefined) update.composer_version = patch.composerVersion;
    if (patch.modelId !== undefined) update.model_id = patch.modelId;
    if (patch.promptTemplateVersion !== undefined) {
      update.prompt_template_version = patch.promptTemplateVersion;
    }
    const row = await one<Row>(
      this.from("figure_sets")
        .update(update)
        .eq("organization_id", organizationId)
        .eq("id", figureSetId)
        .select(),
      "figure_sets.update",
    );
    return row ? mapFigureSet(row) : null;
  }

  async createFigure(
    input: Omit<FigureRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<FigureRecord> {
    const row = must(
      await one<Row>(
        this.from("figures")
          .insert({
            organization_id: input.organizationId,
            figure_set_id: input.figureSetId,
            figure_number: input.figureNumber,
            partial_suffix: input.partialSuffix,
            view_type: input.viewType,
            title: input.title,
            is_prior_art: input.isPriorArt,
            subject_ref: input.subjectRef,
            source_kind: input.sourceKind,
            generation_prompt: input.generationPrompt,
            brief_description: input.briefDescription,
            section_of: input.sectionOf,
            state: input.state,
            needs_input_question: input.needsInputQuestion,
            needs_input_missing: input.needsInputMissing,
          })
          .select(),
        "figures.insert",
      ),
      "figures.insert",
    );
    return mapFigure(row);
  }

  async listFigures(organizationId: Id, figureSetId: Id): Promise<FigureRecord[]> {
    const rows = await many<Row>(
      this.from("figures")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("figure_set_id", figureSetId)
        .order("figure_number", { ascending: true }),
      "figures.list",
    );
    return rows.map(mapFigure);
  }

  async getFigure(organizationId: Id, figureId: Id): Promise<FigureRecord | null> {
    const row = await one<Row>(
      this.from("figures").select("*").eq("organization_id", organizationId).eq("id", figureId),
      "figures.get",
    );
    return row ? mapFigure(row) : null;
  }

  async updateFigure(
    organizationId: Id,
    figureId: Id,
    patch: Partial<FigureRecord>,
  ): Promise<FigureRecord | null> {
    const update: Row = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.state !== undefined) update.state = patch.state;
    if (patch.aiState !== undefined) update.ai_state = patch.aiState;
    if (patch.isPriorArt !== undefined) update.is_prior_art = patch.isPriorArt;
    const row = await one<Row>(
      this.from("figures")
        .update(update)
        .eq("organization_id", organizationId)
        .eq("id", figureId)
        .select(),
      "figures.update",
    );
    return row ? mapFigure(row) : null;
  }

  async createFigureNumeral(
    input: Omit<FigureNumeralRecord, "id" | "createdAt">,
  ): Promise<FigureNumeralRecord> {
    // Upsert on (figure_set_id, numeral): the registry's uniqueness is what
    // makes cross-view consistency mechanical, so a repeat write must
    // resolve to the same row rather than fail the whole pipeline.
    const row = must(
      await one<Row>(
        this.from("figure_reference_numerals")
          .upsert(
            {
              organization_id: input.organizationId,
              figure_set_id: input.figureSetId,
              numeral: input.numeral,
              part_label: input.partLabel,
              component_id: input.componentId,
              first_assigned_figure_id: input.firstAssignedFigureId,
            },
            { onConflict: "figure_set_id,numeral" },
          )
          .select(),
        "figure_numerals.upsert",
      ),
      "figure_numerals.upsert",
    );
    return mapFigureNumeral(row);
  }

  async listFigureNumerals(
    organizationId: Id,
    figureSetId: Id,
  ): Promise<FigureNumeralRecord[]> {
    const rows = await many<Row>(
      this.from("figure_reference_numerals")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("figure_set_id", figureSetId)
        .order("created_at", { ascending: true }),
      "figure_numerals.list",
    );
    return rows.map(mapFigureNumeral);
  }

  async updateFigureNumeralLabel(
    organizationId: Id,
    numeralId: Id,
    partLabel: string,
  ): Promise<FigureNumeralRecord | null> {
    const row = await one<Row>(
      this.from("figure_reference_numerals")
        .update({ part_label: partLabel })
        .eq("organization_id", organizationId)
        .eq("id", numeralId)
        .select(),
      "figure_numerals.rename",
    );
    return row ? mapFigureNumeral(row) : null;
  }

  async replaceFigureAnnotations(
    organizationId: Id,
    figureId: Id,
    annotations: Array<Omit<FigureAnnotationRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<FigureAnnotationRecord[]> {
    const { error } = await this.from("figure_annotations")
      .delete()
      .eq("organization_id", organizationId)
      .eq("figure_id", figureId);
    if (error) throw new Error(`supabase_adapter:figure_annotations.clear:${error.message}`);
    if (annotations.length === 0) return [];
    const rows = await many<Row>(
      this.from("figure_annotations")
        .insert(
          annotations.map((annotation) => ({
            organization_id: annotation.organizationId,
            figure_id: annotation.figureId,
            numeral: annotation.numeral,
            anchor_x: annotation.anchorX,
            anchor_y: annotation.anchorY,
            label_x: annotation.labelX,
            label_y: annotation.labelY,
            lead_line_path: annotation.leadLinePath,
            underlined: annotation.underlined,
            placed_by: annotation.placedBy,
          })),
        )
        .select(),
      "figure_annotations.insert",
    );
    return rows.map(mapFigureAnnotation);
  }

  async listFigureAnnotations(
    organizationId: Id,
    figureId: Id,
  ): Promise<FigureAnnotationRecord[]> {
    const rows = await many<Row>(
      this.from("figure_annotations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("figure_id", figureId),
      "figure_annotations.list",
    );
    return rows.map(mapFigureAnnotation);
  }

  async appendFigureSheet(
    input: Omit<FigureSheetRecord, "id" | "createdAt">,
  ): Promise<FigureSheetRecord> {
    const row = must(
      await one<Row>(
        this.from("figure_sheets")
          .insert({
            organization_id: input.organizationId,
            figure_set_id: input.figureSetId,
            sheet_number: input.sheetNumber,
            total_sheets: input.totalSheets,
            orientation: input.orientation,
            content_type: input.contentType,
            storage_path: input.storagePath,
            checksum_sha256: input.checksumSha256,
            byte_size: input.byteSize,
          })
          .select(),
        "figure_sheets.insert",
      ),
      "figure_sheets.insert",
    );
    return mapFigureSheet(row);
  }

  async listFigureSheets(organizationId: Id, figureSetId: Id): Promise<FigureSheetRecord[]> {
    const rows = await many<Row>(
      this.from("figure_sheets")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("figure_set_id", figureSetId)
        .order("sheet_number", { ascending: true }),
      "figure_sheets.list",
    );
    return rows.map(mapFigureSheet);
  }

  async appendFigureValidations(
    rows: Array<Omit<FigureValidationRecord, "id" | "createdAt">>,
  ): Promise<FigureValidationRecord[]> {
    if (rows.length === 0) return [];
    const written = await many<Row>(
      this.from("figure_validations")
        .insert(
          rows.map((row) => ({
            organization_id: row.organizationId,
            figure_set_id: row.figureSetId,
            figure_id: row.figureId,
            rule_id: row.ruleId,
            status: row.status,
            detail: row.detail,
            rules_version: row.rulesVersion,
          })),
        )
        .select(),
      "figure_validations.insert",
    );
    return written.map(mapFigureValidation);
  }

  async listFigureValidations(
    organizationId: Id,
    figureSetId: Id,
  ): Promise<FigureValidationRecord[]> {
    const rows = await many<Row>(
      this.from("figure_validations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("figure_set_id", figureSetId)
        .order("created_at", { ascending: true }),
      "figure_validations.list",
    );
    return rows.map(mapFigureValidation);
  }

  async appendAuditEvent(
    input: Omit<AuditEventRecord, "id" | "createdAt">,
  ): Promise<AuditEventRecord> {
    const row = must(
      await one<Row>(
        this.from("audit_events")
          .insert({
            organization_id: input.organizationId,
            actor: input.actor,
            action: input.action,
            target: input.target,
            meta: input.meta,
          })
          .select(),
        "audit_events.insert",
      ),
      "audit_events.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listAuditEvents(organizationId: Id): Promise<AuditEventRecord[]> {
    const rows = await many<Row>(
      this.from("audit_events")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      "audit_events.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: sOrNull(row, "organization_id"),
      actor: s(row, "actor"),
      action: s(row, "action"),
      target: s(row, "target"),
      meta: meta(row, "meta"),
      createdAt: s(row, "created_at"),
    }));
  }

  /* ------------- Intake Studio (feature PRD §8, migration 0009) ---------- */

  async createPsPair(
    input: Omit<PsPairRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<PsPairRecord> {
    const row = must(
      await one<Row>(
        this.from("ps_pairs")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            kind: input.kind,
            statement: input.statement,
            state: input.state,
            origin: input.origin,
            created_by_actor: input.createdByActor,
            source_anchors: input.sourceAnchors,
          })
          .select(),
        "ps_pairs.insert",
      ),
      "ps_pairs.insert",
    );
    return mapPsPair(row);
  }

  async getPsPair(organizationId: Id, pairId: Id): Promise<PsPairRecord | null> {
    const row = await one<Row>(
      this.from("ps_pairs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", pairId),
      "ps_pairs.get",
    );
    return row ? mapPsPair(row) : null;
  }

  async listPsPairs(organizationId: Id, inventionId: Id): Promise<PsPairRecord[]> {
    const rows = await many<Row>(
      this.from("ps_pairs")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "ps_pairs.list",
    );
    return rows.map(mapPsPair);
  }

  async updatePsPair(
    organizationId: Id,
    pairId: Id,
    patch: Partial<Pick<PsPairRecord, "statement" | "state" | "sourceAnchors">>,
  ): Promise<PsPairRecord | null> {
    const payload: Row = { updated_at: new Date().toISOString() };
    if (patch.statement !== undefined) payload.statement = patch.statement;
    if (patch.state !== undefined) payload.state = patch.state;
    if (patch.sourceAnchors !== undefined) payload.source_anchors = patch.sourceAnchors;
    const row = await one<Row>(
      this.from("ps_pairs")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", pairId)
        .select(),
      "ps_pairs.update",
    );
    return row ? mapPsPair(row) : null;
  }

  async deletePsPair(organizationId: Id, pairId: Id): Promise<void> {
    // Links/associations cascade in the schema (0009).
    const { error } = await this.from("ps_pairs")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", pairId);
    if (error) throw new Error(`supabase_adapter:ps_pairs.delete:${error.message}`);
  }

  async createPsLink(input: Omit<PsLinkRecord, "id" | "createdAt">): Promise<PsLinkRecord> {
    const row = must(
      await one<Row>(
        this.from("ps_links")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            problem_id: input.problemId,
            solution_id: input.solutionId,
            state: input.state,
          })
          .select(),
        "ps_links.insert",
      ),
      "ps_links.insert",
    );
    return {
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      problemId: s(row, "problem_id"),
      solutionId: s(row, "solution_id"),
      state: s(row, "state") as PsLinkRecord["state"],
      createdAt: s(row, "created_at"),
    };
  }

  async listPsLinks(organizationId: Id, inventionId: Id): Promise<PsLinkRecord[]> {
    const rows = await many<Row>(
      this.from("ps_links")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "ps_links.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      problemId: s(row, "problem_id"),
      solutionId: s(row, "solution_id"),
      state: s(row, "state") as PsLinkRecord["state"],
      createdAt: s(row, "created_at"),
    }));
  }

  async deletePsLink(organizationId: Id, linkId: Id): Promise<void> {
    const { error } = await this.from("ps_links")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", linkId);
    if (error) throw new Error(`supabase_adapter:ps_links.delete:${error.message}`);
  }

  async appendPsEvent(input: Omit<PsEventRecord, "id" | "createdAt">): Promise<PsEventRecord> {
    const row = must(
      await one<Row>(
        this.from("ps_events")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            pair_id: input.pairId,
            kind: input.kind,
            actor: input.actor,
            detail: input.detail,
          })
          .select(),
        "ps_events.insert",
      ),
      "ps_events.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listPsEvents(organizationId: Id, inventionId: Id): Promise<PsEventRecord[]> {
    const rows = await many<Row>(
      this.from("ps_events")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "ps_events.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      pairId: sOrNull(row, "pair_id"),
      kind: s(row, "kind") as PsEventRecord["kind"],
      actor: s(row, "actor"),
      detail: s(row, "detail"),
      createdAt: s(row, "created_at"),
    }));
  }

  async createWorkingTitle(
    input: Omit<WorkingTitleRecord, "id" | "createdAt">,
  ): Promise<WorkingTitleRecord> {
    const row = must(
      await one<Row>(
        this.from("working_titles")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            text: input.text,
            state: input.state,
            created_by_actor: input.createdByActor,
          })
          .select(),
        "working_titles.insert",
      ),
      "working_titles.insert",
    );
    return { ...input, id: s(row, "id"), createdAt: s(row, "created_at") };
  }

  async listWorkingTitles(organizationId: Id, inventionId: Id): Promise<WorkingTitleRecord[]> {
    const rows = await many<Row>(
      this.from("working_titles")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "working_titles.list",
    );
    return rows.map((row) => ({
      id: s(row, "id"),
      organizationId: s(row, "organization_id"),
      inventionId: s(row, "invention_id"),
      text: s(row, "text"),
      state: s(row, "state") as WorkingTitleRecord["state"],
      createdByActor: s(row, "created_by_actor") as WorkingTitleRecord["createdByActor"],
      createdAt: s(row, "created_at"),
    }));
  }

  async createComponent(
    input: Omit<ComponentRecord, "id" | "createdAt">,
  ): Promise<ComponentRecord> {
    const row = must(
      await one<Row>(
        this.from("components")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            name: input.name,
            description: input.description,
            state: input.state,
            source_anchors: input.sourceAnchors,
          })
          .select(),
        "components.insert",
      ),
      "components.insert",
    );
    return mapComponent(row);
  }

  async listComponents(organizationId: Id, inventionId: Id): Promise<ComponentRecord[]> {
    const rows = await many<Row>(
      this.from("components")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "components.list",
    );
    return rows.map(mapComponent);
  }

  async getComponent(organizationId: Id, componentId: Id): Promise<ComponentRecord | null> {
    const row = await one<Row>(
      this.from("components")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", componentId),
      "components.get",
    );
    return row ? mapComponent(row) : null;
  }

  async updateComponent(
    organizationId: Id,
    componentId: Id,
    patch: Partial<Pick<ComponentRecord, "name" | "description" | "state">>,
  ): Promise<ComponentRecord | null> {
    const payload: Row = {};
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.description !== undefined) payload.description = patch.description;
    if (patch.state !== undefined) payload.state = patch.state;
    if (Object.keys(payload).length === 0) return this.getComponent(organizationId, componentId);
    const row = await one<Row>(
      this.from("components")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", componentId)
        .select(),
      "components.update",
    );
    return row ? mapComponent(row) : null;
  }

  async deleteComponent(organizationId: Id, componentId: Id): Promise<void> {
    // Associations referencing the component cascade in the schema (0009).
    const { error } = await this.from("components")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", componentId);
    if (error) throw new Error(`supabase_adapter:components.delete:${error.message}`);
  }

  async createAssociation(
    input: Omit<AssociationRecord, "id" | "createdAt">,
  ): Promise<AssociationRecord> {
    const row = must(
      await one<Row>(
        this.from("associations")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            solution_id: input.solutionId,
            component_id: input.componentId,
            extraction_artifact_id: input.extractionArtifactId,
            source_id: input.sourceId,
            region: input.region,
            interview_turn_id: input.interviewTurnId,
            created_by_actor: input.createdByActor,
            state: input.state,
          })
          .select(),
        "associations.insert",
      ),
      "associations.insert",
    );
    return mapAssociation(row);
  }

  async listAssociations(organizationId: Id, inventionId: Id): Promise<AssociationRecord[]> {
    const rows = await many<Row>(
      this.from("associations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId),
      "associations.list",
    );
    return rows.map(mapAssociation);
  }

  async getAssociation(organizationId: Id, associationId: Id): Promise<AssociationRecord | null> {
    const row = await one<Row>(
      this.from("associations")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", associationId),
      "associations.get",
    );
    return row ? mapAssociation(row) : null;
  }

  async updateAssociation(
    organizationId: Id,
    associationId: Id,
    patch: Partial<Pick<AssociationRecord, "region" | "state">>,
  ): Promise<AssociationRecord | null> {
    const payload: Row = {};
    if (patch.region !== undefined) payload.region = patch.region;
    if (patch.state !== undefined) payload.state = patch.state;
    const row = await one<Row>(
      this.from("associations")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", associationId)
        .select(),
      "associations.update",
    );
    return row ? mapAssociation(row) : null;
  }

  async deleteAssociation(organizationId: Id, associationId: Id): Promise<void> {
    const { error } = await this.from("associations")
      .delete()
      .eq("organization_id", organizationId)
      .eq("id", associationId);
    if (error) throw new Error(`supabase_adapter:associations.delete:${error.message}`);
  }

  async createExtractionArtifact(
    input: Omit<ExtractionArtifactRecord, "id" | "createdAt">,
  ): Promise<ExtractionArtifactRecord> {
    const row = must(
      await one<Row>(
        this.from("extraction_artifacts")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            source_id: input.sourceId,
            type: input.type,
            content: input.content,
            model_id: input.modelId,
            cost_reservation_id: input.costReservationId,
          })
          .select(),
        "extraction_artifacts.insert",
      ),
      "extraction_artifacts.insert",
    );
    return mapExtractionArtifact(row);
  }

  async listExtractionArtifacts(
    organizationId: Id,
    inventionId: Id,
  ): Promise<ExtractionArtifactRecord[]> {
    const rows = await many<Row>(
      this.from("extraction_artifacts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "extraction_artifacts.list",
    );
    return rows.map(mapExtractionArtifact);
  }

  async listExtractionArtifactsForSource(
    organizationId: Id,
    sourceId: Id,
  ): Promise<ExtractionArtifactRecord[]> {
    const rows = await many<Row>(
      this.from("extraction_artifacts")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("source_id", sourceId)
        .order("created_at", { ascending: true }),
      "extraction_artifacts.list_for_source",
    );
    return rows.map(mapExtractionArtifact);
  }

  async appendEnablementCoverage(
    rows: Array<Omit<EnablementCoverageRecord, "id" | "computedAt">>,
  ): Promise<EnablementCoverageRecord[]> {
    if (rows.length === 0) return [];
    const inserted = await many<Row>(
      this.from("enablement_coverage")
        .insert(
          rows.map((row) => ({
            organization_id: row.organizationId,
            invention_id: row.inventionId,
            solution_id: row.solutionId,
            dimension: row.dimension,
            status: row.status,
            evidence: row.evidence,
            coverage_version: row.coverageVersion,
          })),
        )
        .select(),
      "enablement_coverage.insert",
    );
    return inserted.map(mapCoverage);
  }

  async listLatestEnablementCoverage(
    organizationId: Id,
    inventionId: Id,
  ): Promise<EnablementCoverageRecord[]> {
    const rows = await many<Row>(
      this.from("enablement_coverage")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("computed_at", { ascending: true }),
      "enablement_coverage.list",
    );
    const latest = new Map<string, EnablementCoverageRecord>();
    for (const row of rows.map(mapCoverage)) {
      latest.set(`${row.solutionId}:${row.dimension}`, row);
    }
    return [...latest.values()];
  }

  /* ------- Intake Studio M2: interview sessions/turns (0009 + 0010) ------ */

  async createInterviewSession(
    input: Omit<InterviewSessionRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<InterviewSessionRecord> {
    const row = must(
      await one<Row>(
        this.from("interview_sessions")
          .insert({
            organization_id: input.organizationId,
            invention_id: input.inventionId,
            user_id: input.userId,
            stage: input.stage,
            status: input.status,
            session_spend_cap_cents: input.sessionSpendCapCents,
            spent_cents: input.spentCents,
          })
          .select(),
        "interview_sessions.insert",
      ),
      "interview_sessions.insert",
    );
    return mapInterviewSession(row);
  }

  async getInterviewSession(
    organizationId: Id,
    sessionId: Id,
  ): Promise<InterviewSessionRecord | null> {
    const row = await one<Row>(
      this.from("interview_sessions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", sessionId),
      "interview_sessions.get",
    );
    return row ? mapInterviewSession(row) : null;
  }

  async listInterviewSessions(
    organizationId: Id,
    inventionId: Id,
  ): Promise<InterviewSessionRecord[]> {
    const rows = await many<Row>(
      this.from("interview_sessions")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("invention_id", inventionId)
        .order("created_at", { ascending: true }),
      "interview_sessions.list",
    );
    return rows.map(mapInterviewSession);
  }

  async updateInterviewSession(
    organizationId: Id,
    sessionId: Id,
    patch: Partial<
      Pick<InterviewSessionRecord, "stage" | "status" | "sessionSpendCapCents" | "spentCents">
    >,
  ): Promise<InterviewSessionRecord | null> {
    const payload: Row = { updated_at: new Date().toISOString() };
    if (patch.stage !== undefined) payload.stage = patch.stage;
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.sessionSpendCapCents !== undefined) {
      payload.session_spend_cap_cents = patch.sessionSpendCapCents;
    }
    if (patch.spentCents !== undefined) payload.spent_cents = patch.spentCents;
    const row = await one<Row>(
      this.from("interview_sessions")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", sessionId)
        .select(),
      "interview_sessions.update",
    );
    return row ? mapInterviewSession(row) : null;
  }

  async createInterviewTurn(
    input: Omit<InterviewTurnRecord, "id" | "createdAt">,
  ): Promise<InterviewTurnRecord> {
    const row = must(
      await one<Row>(
        this.from("interview_turns")
          .insert({
            organization_id: input.organizationId,
            session_id: input.sessionId,
            turn_index: input.turnIndex,
            stage: input.stage,
            question: input.question,
            followups: input.followups,
            target_ref: input.targetRef,
            answer_text: input.answerText,
            answer_kind: input.answerKind,
            skipped: input.skipped,
            attachment_source_ids: input.attachmentSourceIds,
            extraction_job_id: input.extractionJobId,
          })
          .select(),
        "interview_turns.insert",
      ),
      "interview_turns.insert",
    );
    return mapInterviewTurn(row);
  }

  async getInterviewTurn(organizationId: Id, turnId: Id): Promise<InterviewTurnRecord | null> {
    const row = await one<Row>(
      this.from("interview_turns")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("id", turnId),
      "interview_turns.get",
    );
    return row ? mapInterviewTurn(row) : null;
  }

  async listInterviewTurns(organizationId: Id, sessionId: Id): Promise<InterviewTurnRecord[]> {
    const rows = await many<Row>(
      this.from("interview_turns")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("session_id", sessionId)
        .order("turn_index", { ascending: true }),
      "interview_turns.list",
    );
    return rows.map(mapInterviewTurn);
  }

  async updateInterviewTurn(
    organizationId: Id,
    turnId: Id,
    patch: Partial<
      Pick<
        InterviewTurnRecord,
        "answerText" | "answerKind" | "skipped" | "attachmentSourceIds" | "extractionJobId"
      >
    >,
  ): Promise<InterviewTurnRecord | null> {
    const payload: Row = {};
    if (patch.answerText !== undefined) payload.answer_text = patch.answerText;
    if (patch.answerKind !== undefined) payload.answer_kind = patch.answerKind;
    if (patch.skipped !== undefined) payload.skipped = patch.skipped;
    if (patch.attachmentSourceIds !== undefined) {
      payload.attachment_source_ids = patch.attachmentSourceIds;
    }
    if (patch.extractionJobId !== undefined) payload.extraction_job_id = patch.extractionJobId;
    const row = await one<Row>(
      this.from("interview_turns")
        .update(payload)
        .eq("organization_id", organizationId)
        .eq("id", turnId)
        .select(),
      "interview_turns.update",
    );
    return row ? mapInterviewTurn(row) : null;
  }
}

function stringArray(row: Row, key: string): string[] {
  const value = row[key];
  return Array.isArray(value) ? value.map(String) : [];
}

const mapInterviewSession = (row: Row): InterviewSessionRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  userId: s(row, "user_id"),
  stage: s(row, "stage") as InterviewSessionRecord["stage"],
  status: s(row, "status") as InterviewSessionRecord["status"],
  // Legacy pre-0010 rows may carry a null cap; the env default is 500¢.
  sessionSpendCapCents: nOrNull(row, "session_spend_cap_cents") ?? 500,
  spentCents: n(row, "spent_cents"),
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapInterviewTurn = (row: Row): InterviewTurnRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  sessionId: s(row, "session_id"),
  turnIndex: n(row, "turn_index"),
  stage: s(row, "stage") as InterviewTurnRecord["stage"],
  question: s(row, "question"),
  followups: stringArray(row, "followups"),
  targetRef: sOrNull(row, "target_ref"),
  answerText: sOrNull(row, "answer_text"),
  answerKind: sOrNull(row, "answer_kind") as InterviewTurnRecord["answerKind"],
  skipped: b(row, "skipped"),
  attachmentSourceIds: stringArray(row, "attachment_source_ids"),
  extractionJobId: sOrNull(row, "extraction_job_id"),
  createdAt: s(row, "created_at"),
});

const mapPsPair = (row: Row): PsPairRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  kind: s(row, "kind") as PsPairRecord["kind"],
  statement: s(row, "statement"),
  state: s(row, "state") as PsPairRecord["state"],
  origin: s(row, "origin") as PsPairRecord["origin"],
  createdByActor: s(row, "created_by_actor") as PsPairRecord["createdByActor"],
  sourceAnchors: stringArray(row, "source_anchors"),
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

/**
 * The database enum is lower_snake (`pass_1_drafting`); the shared domain
 * uses SCREAMING_SNAKE (`PASS_1_DRAFTING`). These two functions are the ONLY
 * place the two representations meet, so a rename in either direction is a
 * one-line change with a compiler check behind it.
 */
function toDbPassState(state: string): string {
  return state.toLowerCase();
}

function fromDbPassState(value: string): DraftSetStateValue {
  return value.toUpperCase() as DraftSetStateValue;
}

const mapDraftSet = (row: Row): DraftSetRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  state: fromDbPassState(s(row, "state")),
  interruptedStage: (() => {
    const raw = sOrNull(row, "interrupted_stage");
    return raw ? (fromDbPassState(raw) as DraftSetStageValue) : null;
  })(),
  passOneVersionId: sOrNull(row, "pass_1_version_id"),
  passTwoVersionId: sOrNull(row, "pass_2_version_id"),
  figureSetId: sOrNull(row, "figure_set_id"),
  illustrationsBrief: row.illustrations_brief ?? {},
  briefVersion: s(row, "brief_version"),
  reconciliation: row.reconciliation ?? null,
  reconciled: b(row, "reconciled"),
  reconciliationVersion: s(row, "reconciliation_version"),
  statusDetail: s(row, "status_detail"),
  acceptedByUserId: sOrNull(row, "accepted_by"),
  acceptedAt: sOrNull(row, "accepted_at"),
  passOneReservationId: sOrNull(row, "pass_1_reservation_id"),
  passTwoReservationId: sOrNull(row, "pass_2_reservation_id"),
  passOneChargeCents: n(row, "pass_1_charge_cents"),
  passTwoChargeCents: n(row, "pass_2_charge_cents"),
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapDraftSetTransition = (row: Row): DraftSetTransitionRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  draftSetId: s(row, "draft_set_id"),
  fromState: (() => {
    const raw = sOrNull(row, "from_state");
    return raw ? fromDbPassState(raw) : null;
  })(),
  toState: fromDbPassState(s(row, "to_state")),
  actor: s(row, "actor"),
  reason: s(row, "reason"),
  createdAt: s(row, "created_at"),
});

const mapFigureSet = (row: Row): FigureSetRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  draftVersionId: sOrNull(row, "draft_version_id"),
  state: s(row, "state") as FigureSetStateValue,
  sheetSize: s(row, "sheet_size") === "letter" ? "letter" : "a4",
  orientationPolicy:
    s(row, "orientation_policy") === "landscape_allowed"
      ? "landscape_allowed"
      : "portrait_preferred",
  rulesVersion: s(row, "rules_version"),
  plannerVersion: s(row, "planner_version"),
  composerVersion: s(row, "composer_version"),
  modelId: sOrNull(row, "model_id"),
  promptTemplateVersion: sOrNull(row, "prompt_template_version"),
  inputHash: s(row, "input_hash"),
  totalCostCents: n(row, "total_cost_cents"),
  totalProviderCostCents: n(row, "total_provider_cost_cents"),
  aiState: s(row, "ai_state") as FigureAiState,
  statusDetail: s(row, "status_detail"),
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapFigure = (row: Row): FigureRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  figureSetId: s(row, "figure_set_id"),
  figureNumber: n(row, "figure_number"),
  partialSuffix: sOrNull(row, "partial_suffix"),
  viewType: s(row, "view_type"),
  title: s(row, "title"),
  isPriorArt: b(row, "is_prior_art"),
  subjectRef: s(row, "subject_ref"),
  sourceKind: s(row, "source_kind"),
  generationPrompt: sOrNull(row, "generation_prompt"),
  briefDescription: s(row, "brief_description"),
  sectionOf: nOrNull(row, "section_of"),
  state: s(row, "state") as FigureStateValue,
  needsInputQuestion: sOrNull(row, "needs_input_question"),
  needsInputMissing: sOrNull(row, "needs_input_missing"),
  aiState: s(row, "ai_state") as FigureAiState,
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapFigureNumeral = (row: Row): FigureNumeralRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  figureSetId: s(row, "figure_set_id"),
  numeral: s(row, "numeral"),
  partLabel: s(row, "part_label"),
  componentId: sOrNull(row, "component_id"),
  firstAssignedFigureId: sOrNull(row, "first_assigned_figure_id"),
  createdAt: s(row, "created_at"),
});

const mapFigureAnnotation = (row: Row): FigureAnnotationRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  figureId: s(row, "figure_id"),
  numeral: s(row, "numeral"),
  anchorX: n(row, "anchor_x"),
  anchorY: n(row, "anchor_y"),
  labelX: n(row, "label_x"),
  labelY: n(row, "label_y"),
  leadLinePath: Array.isArray(row.lead_line_path)
    ? (row.lead_line_path as Array<{ x: number; y: number }>)
    : [],
  underlined: b(row, "underlined"),
  placedBy: s(row, "placed_by") === "user" ? "user" : "auto",
  createdAt: s(row, "created_at"),
  updatedAt: s(row, "updated_at"),
});

const mapFigureSheet = (row: Row): FigureSheetRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  figureSetId: s(row, "figure_set_id"),
  sheetNumber: n(row, "sheet_number"),
  totalSheets: n(row, "total_sheets"),
  orientation: s(row, "orientation") === "landscape" ? "landscape" : "portrait",
  contentType: s(row, "content_type"),
  storagePath: s(row, "storage_path"),
  checksumSha256: s(row, "checksum_sha256"),
  byteSize: n(row, "byte_size"),
  createdAt: s(row, "created_at"),
});

const mapFigureValidation = (row: Row): FigureValidationRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  figureSetId: s(row, "figure_set_id"),
  figureId: sOrNull(row, "figure_id"),
  ruleId: s(row, "rule_id"),
  status: s(row, "status") as FigureValidationRecord["status"],
  detail: s(row, "detail"),
  rulesVersion: s(row, "rules_version"),
  createdAt: s(row, "created_at"),
});

const mapComponent = (row: Row): ComponentRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  name: s(row, "name"),
  description: s(row, "description"),
  state: s(row, "state") as ComponentRecord["state"],
  sourceAnchors: stringArray(row, "source_anchors"),
  createdAt: s(row, "created_at"),
});

const mapAssociation = (row: Row): AssociationRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  solutionId: s(row, "solution_id"),
  componentId: sOrNull(row, "component_id"),
  extractionArtifactId: sOrNull(row, "extraction_artifact_id"),
  sourceId: sOrNull(row, "source_id"),
  region: normalizeRegion(row["region"]),
  interviewTurnId: sOrNull(row, "interview_turn_id"),
  createdByActor: s(row, "created_by_actor") as AssociationRecord["createdByActor"],
  state: s(row, "state") as AssociationRecord["state"],
  createdAt: s(row, "created_at"),
});

const mapExtractionArtifact = (row: Row): ExtractionArtifactRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  sourceId: s(row, "source_id"),
  type: s(row, "type") as ExtractionArtifactRecord["type"],
  content: s(row, "content"),
  modelId: sOrNull(row, "model_id"),
  costReservationId: sOrNull(row, "cost_reservation_id"),
  createdAt: s(row, "created_at"),
});

const mapCoverage = (row: Row): EnablementCoverageRecord => ({
  id: s(row, "id"),
  organizationId: s(row, "organization_id"),
  inventionId: s(row, "invention_id"),
  solutionId: s(row, "solution_id"),
  dimension: s(row, "dimension") as EnablementCoverageRecord["dimension"],
  status: s(row, "status") as EnablementCoverageRecord["status"],
  evidence: sOrNull(row, "evidence"),
  coverageVersion: s(row, "coverage_version"),
  computedAt: s(row, "computed_at"),
});
