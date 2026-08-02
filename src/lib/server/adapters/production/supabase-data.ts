import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@/lib/domain/roles";
import type { CounselRequestState } from "@/lib/domain/counsel-request";
import type { FactProvenance } from "@/lib/domain/facts";
import type { IntakeState } from "@/lib/domain/intake";
import type {
  AuditEventRecord,
  ContributorRecord,
  CounselAssignmentRecord,
  CounselAuditEventRecord,
  CounselRequestEventRecord,
  CounselRequestRecord,
  DataPort,
  DisclosureEventRecord,
  DraftRecord,
  DraftVersionRecord,
  EngagementRecord,
  ExportArtifactRecord,
  ExportRecordEntry,
  FilingPackageRecord,
  Id,
  IntakeSessionRecord,
  InvitationRecord,
  InventionFactRecord,
  InventionRecord,
  JobKind,
  JobRecord,
  LedgerEntryRecord,
  LegalMatterRecord,
  MembershipRecord,
  OrganizationRecord,
  ReservationRecord,
  SourceRecord,
  TermsAcceptanceRecord,
  UsageEventRecord,
  UserRecord,
  WalletRecord,
} from "../types";

/**
 * SupabaseDataAdapter — DataPort against the PRIVATE application project
 * (supabase/migrations/0001–0006).
 *
 * Trust model (PRD §5.6, §11):
 * - This adapter runs with the service-role key inside trusted server logic
 *   only. RLS remains the defense-in-depth layer for any path that ever
 *   uses a user-scoped client; the adapter ALSO filters every tenant query
 *   by organization_id derived from the authenticated session, so a
 *   client-supplied tenant id alone can never widen access.
 * - Append-only tables (terms_acceptances, ledger, usage/audit events,
 *   draft_versions, exports) are protected by database triggers even
 *   against this service role — see supabase/tests/03_immutability.sql.
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
}
