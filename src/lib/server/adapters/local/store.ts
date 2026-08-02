import { randomUUID } from "node:crypto";
import type { CounselRequestState } from "@/lib/domain/counsel-request";
import type { FactProvenance } from "@/lib/domain/facts";
import type {
  AuditEventRecord,
  BillingOutboxRecord,
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
  StripeEventRecord,
  TermsAcceptanceRecord,
  UsageEventRecord,
  UserRecord,
  WalletRecord,
} from "../types";

/**
 * Credential-independent in-memory data adapter (PRD Phase 0).
 *
 * Holds SYNTHETIC data only. State lives on `globalThis` so it survives
 * Next.js dev-server module reloads within one process. It is intentionally
 * NOT durable — restarting the process resets the workspace.
 */
type Tables = {
  users: Map<Id, UserRecord>;
  organizations: Map<Id, OrganizationRecord>;
  memberships: MembershipRecord[];
  termsAcceptances: TermsAcceptanceRecord[];
  intakeSessions: Map<Id, IntakeSessionRecord>;
  inventions: Map<Id, InventionRecord>;
  facts: Map<Id, InventionFactRecord>;
  contributors: Map<Id, ContributorRecord>;
  disclosureEvents: Map<Id, DisclosureEventRecord>;
  sources: Map<Id, SourceRecord>;
  drafts: Map<Id, DraftRecord>;
  draftVersions: Map<Id, DraftVersionRecord>;
  exports: Map<Id, ExportRecordEntry>;
  counselRequests: Map<Id, CounselRequestRecord>;
  counselRequestEvents: CounselRequestEventRecord[];
  wallets: Map<Id, WalletRecord>;
  ledgerEntries: LedgerEntryRecord[];
  reservations: Map<Id, ReservationRecord>;
  usageEvents: UsageEventRecord[];
  auditEvents: AuditEventRecord[];
  jobs: Map<Id, JobRecord>;
  invitations: Map<Id, InvitationRecord>;
  engagements: Map<Id, EngagementRecord>;
  legalMatters: Map<Id, LegalMatterRecord>;
  filingPackages: Map<Id, FilingPackageRecord>;
  counselAssignments: Map<Id, CounselAssignmentRecord>;
  counselAuditEvents: CounselAuditEventRecord[];
  exportArtifacts: ExportArtifactRecord[];
  draftCitations: DraftCitationRecord[];
  stripeEvents: Map<string, StripeEventRecord>;
  billingOutbox: Map<Id, BillingOutboxRecord>;
  stripeCustomers: Map<Id, string>;
};

function emptyTables(): Tables {
  return {
    users: new Map(),
    organizations: new Map(),
    memberships: [],
    termsAcceptances: [],
    intakeSessions: new Map(),
    inventions: new Map(),
    facts: new Map(),
    contributors: new Map(),
    disclosureEvents: new Map(),
    sources: new Map(),
    drafts: new Map(),
    draftVersions: new Map(),
    exports: new Map(),
    counselRequests: new Map(),
    counselRequestEvents: [],
    wallets: new Map(),
    ledgerEntries: [],
    reservations: new Map(),
    usageEvents: [],
    auditEvents: [],
    jobs: new Map(),
    invitations: new Map(),
    engagements: new Map(),
    legalMatters: new Map(),
    filingPackages: new Map(),
    counselAssignments: new Map(),
    counselAuditEvents: [],
    exportArtifacts: [],
    draftCitations: [],
    stripeEvents: new Map(),
    billingOutbox: new Map(),
    stripeCustomers: new Map(),
  };
}

const GLOBAL_KEY = "__wepatent_local_store__";

function tables(): Tables {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Tables };
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = emptyTables();
  }
  return holder[GLOBAL_KEY];
}

function now(): string {
  return new Date().toISOString();
}

export class LocalDataAdapter implements DataPort {
  /** Test hook: wipe all in-memory state. */
  static reset(): void {
    const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Tables };
    holder[GLOBAL_KEY] = emptyTables();
  }

  async getUserById(id: Id): Promise<UserRecord | null> {
    return tables().users.get(id) ?? null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of tables().users.values()) {
      if (user.email === normalized) return user;
    }
    return null;
  }

  async createUser(input: { email: string; displayName: string }): Promise<UserRecord> {
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName,
      createdAt: now(),
    };
    tables().users.set(user.id, user);
    return user;
  }

  async createOrganization(input: {
    name: string;
    ownerUserId: Id;
  }): Promise<OrganizationRecord> {
    const org: OrganizationRecord = {
      id: randomUUID(),
      name: input.name,
      retentionDays: 365,
      createdAt: now(),
      deletedAt: null,
    };
    tables().organizations.set(org.id, org);
    tables().memberships.push({
      id: randomUUID(),
      organizationId: org.id,
      userId: input.ownerUserId,
      role: "owner",
      createdAt: now(),
    });
    return org;
  }

  async getOrganizationById(id: Id): Promise<OrganizationRecord | null> {
    return tables().organizations.get(id) ?? null;
  }

  async getMembershipsForUser(userId: Id): Promise<MembershipRecord[]> {
    return tables().memberships.filter((m) => m.userId === userId);
  }

  async getMembershipsForOrganization(organizationId: Id): Promise<MembershipRecord[]> {
    return tables().memberships.filter((m) => m.organizationId === organizationId);
  }

  async recordTermsAcceptance(
    input: Omit<TermsAcceptanceRecord, "id" | "acceptedAt">,
  ): Promise<TermsAcceptanceRecord> {
    const record: TermsAcceptanceRecord = { ...input, id: randomUUID(), acceptedAt: now() };
    tables().termsAcceptances.push(record);
    return record;
  }

  async getLatestAcceptance(
    organizationId: Id,
    userId: Id,
  ): Promise<TermsAcceptanceRecord | null> {
    const matches = tables().termsAcceptances.filter(
      (a) => a.organizationId === organizationId && a.userId === userId,
    );
    return matches.length > 0 ? matches[matches.length - 1] : null;
  }

  async getIntakeSession(organizationId: Id, userId: Id): Promise<IntakeSessionRecord | null> {
    for (const session of tables().intakeSessions.values()) {
      if (
        session.organizationId === organizationId &&
        session.userId === userId &&
        session.submittedInventionId === null
      ) {
        return session;
      }
    }
    return null;
  }

  async saveIntakeSession(
    input: Omit<IntakeSessionRecord, "id" | "updatedAt"> & { id?: Id },
  ): Promise<IntakeSessionRecord> {
    const id = input.id ?? randomUUID();
    const record: IntakeSessionRecord = {
      id,
      organizationId: input.organizationId,
      userId: input.userId,
      state: input.state,
      submittedInventionId: input.submittedInventionId,
      updatedAt: now(),
    };
    tables().intakeSessions.set(id, record);
    return record;
  }

  async createInvention(
    input: Omit<InventionRecord, "id" | "createdAt" | "updatedAt" | "status">,
  ): Promise<InventionRecord> {
    const record: InventionRecord = {
      ...input,
      id: randomUUID(),
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    };
    tables().inventions.set(record.id, record);
    return record;
  }

  async getInvention(organizationId: Id, inventionId: Id): Promise<InventionRecord | null> {
    const record = tables().inventions.get(inventionId);
    // Tenant scoping enforced at the adapter boundary as well as callers.
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async listInventions(organizationId: Id): Promise<InventionRecord[]> {
    return [...tables().inventions.values()].filter(
      (i) => i.organizationId === organizationId && i.status === "active",
    );
  }

  async softDeleteInvention(organizationId: Id, inventionId: Id): Promise<void> {
    const record = await this.getInvention(organizationId, inventionId);
    if (record) {
      record.status = "soft_deleted";
      record.updatedAt = now();
    }
  }

  async listSoftDeletedInventions(organizationId: Id): Promise<InventionRecord[]> {
    return [...tables().inventions.values()].filter(
      (i) => i.organizationId === organizationId && i.status === "soft_deleted",
    );
  }

  async hardDeleteInvention(organizationId: Id, inventionId: Id): Promise<void> {
    const t = tables();
    const invention = t.inventions.get(inventionId);
    if (!invention || invention.organizationId !== organizationId) return;

    const draftIds = new Set(
      [...t.drafts.values()]
        .filter((d) => d.organizationId === organizationId && d.inventionId === inventionId)
        .map((d) => d.id),
    );
    const exportIds = new Set(
      [...t.exports.values()]
        .filter((e) => e.organizationId === organizationId && e.inventionId === inventionId)
        .map((e) => e.id),
    );

    for (const [id, fact] of t.facts) {
      if (fact.inventionId === inventionId) t.facts.delete(id);
    }
    for (const [id, contributor] of t.contributors) {
      if (contributor.inventionId === inventionId) t.contributors.delete(id);
    }
    for (const [id, event] of t.disclosureEvents) {
      if (event.inventionId === inventionId) t.disclosureEvents.delete(id);
    }
    for (const [id, source] of t.sources) {
      if (source.inventionId === inventionId) t.sources.delete(id);
    }
    const versionIds = new Set(
      [...t.draftVersions.values()].filter((v) => draftIds.has(v.draftId)).map((v) => v.id),
    );
    for (const id of versionIds) t.draftVersions.delete(id);
    t.draftCitations = t.draftCitations.filter((c) => !versionIds.has(c.draftVersionId));
    for (const id of draftIds) t.drafts.delete(id);
    t.exportArtifacts = t.exportArtifacts.filter((a) => !exportIds.has(a.exportId));
    for (const id of exportIds) t.exports.delete(id);
    t.inventions.delete(inventionId);
  }

  async updateOrganizationRetention(
    organizationId: Id,
    retentionDays: number,
  ): Promise<OrganizationRecord | null> {
    const organization = tables().organizations.get(organizationId) ?? null;
    if (!organization) return null;
    organization.retentionDays = retentionDays;
    return organization;
  }

  async createFact(
    input: Omit<InventionFactRecord, "id" | "updatedAt">,
  ): Promise<InventionFactRecord> {
    const record: InventionFactRecord = { ...input, id: randomUUID(), updatedAt: now() };
    tables().facts.set(record.id, record);
    return record;
  }

  async listFacts(organizationId: Id, inventionId: Id): Promise<InventionFactRecord[]> {
    return [...tables().facts.values()].filter(
      (f) => f.organizationId === organizationId && f.inventionId === inventionId,
    );
  }

  async updateFactProvenance(
    organizationId: Id,
    factId: Id,
    provenance: FactProvenance,
  ): Promise<InventionFactRecord | null> {
    const record = tables().facts.get(factId);
    if (!record || record.organizationId !== organizationId) return null;
    record.provenance = provenance;
    record.updatedAt = now();
    return record;
  }

  async createContributor(input: Omit<ContributorRecord, "id">): Promise<ContributorRecord> {
    const record: ContributorRecord = { ...input, id: randomUUID() };
    tables().contributors.set(record.id, record);
    return record;
  }

  async listContributors(organizationId: Id, inventionId: Id): Promise<ContributorRecord[]> {
    return [...tables().contributors.values()].filter(
      (c) => c.organizationId === organizationId && c.inventionId === inventionId,
    );
  }

  async createDisclosureEvent(
    input: Omit<DisclosureEventRecord, "id">,
  ): Promise<DisclosureEventRecord> {
    const record: DisclosureEventRecord = { ...input, id: randomUUID() };
    tables().disclosureEvents.set(record.id, record);
    return record;
  }

  async listDisclosureEvents(
    organizationId: Id,
    inventionId: Id,
  ): Promise<DisclosureEventRecord[]> {
    return [...tables().disclosureEvents.values()]
      .filter((d) => d.organizationId === organizationId && d.inventionId === inventionId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async createSource(input: Omit<SourceRecord, "id" | "createdAt">): Promise<SourceRecord> {
    const record: SourceRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().sources.set(record.id, record);
    return record;
  }

  async listSources(organizationId: Id, inventionId: Id): Promise<SourceRecord[]> {
    return [...tables().sources.values()].filter(
      (s) => s.organizationId === organizationId && s.inventionId === inventionId,
    );
  }

  async getSource(organizationId: Id, sourceId: Id): Promise<SourceRecord | null> {
    const record = tables().sources.get(sourceId);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
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
    const record = tables().sources.get(sourceId);
    if (!record || record.organizationId !== organizationId) return null;
    Object.assign(record, patch);
    return record;
  }

  async createDraft(input: Omit<DraftRecord, "id" | "createdAt">): Promise<DraftRecord> {
    const record: DraftRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().drafts.set(record.id, record);
    return record;
  }

  async listDrafts(organizationId: Id, inventionId: Id): Promise<DraftRecord[]> {
    return [...tables().drafts.values()].filter(
      (d) => d.organizationId === organizationId && d.inventionId === inventionId,
    );
  }

  async getDraft(organizationId: Id, draftId: Id): Promise<DraftRecord | null> {
    const record = tables().drafts.get(draftId);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async createDraftVersion(
    input: Omit<DraftVersionRecord, "id" | "createdAt" | "version" | "label">,
  ): Promise<DraftVersionRecord> {
    const siblings = [...tables().draftVersions.values()].filter(
      (v) => v.draftId === input.draftId,
    );
    const record: DraftVersionRecord = {
      ...input,
      id: randomUUID(),
      version: siblings.length + 1,
      label: "working_draft",
      createdAt: now(),
    };
    tables().draftVersions.set(record.id, record);
    return record;
  }

  async listDraftVersions(organizationId: Id, draftId: Id): Promise<DraftVersionRecord[]> {
    return [...tables().draftVersions.values()]
      .filter((v) => v.organizationId === organizationId && v.draftId === draftId)
      .sort((a, b) => a.version - b.version);
  }

  async getDraftVersion(organizationId: Id, versionId: Id): Promise<DraftVersionRecord | null> {
    const record = tables().draftVersions.get(versionId);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async createDraftCitation(
    input: Omit<DraftCitationRecord, "id" | "createdAt">,
  ): Promise<DraftCitationRecord> {
    const record: DraftCitationRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().draftCitations.push(record);
    return record;
  }

  async listDraftCitations(
    organizationId: Id,
    draftVersionId: Id,
  ): Promise<DraftCitationRecord[]> {
    return tables().draftCitations.filter(
      (c) => c.organizationId === organizationId && c.draftVersionId === draftVersionId,
    );
  }

  async createExport(
    input: Omit<ExportRecordEntry, "id" | "createdAt">,
  ): Promise<ExportRecordEntry> {
    const record: ExportRecordEntry = { ...input, id: randomUUID(), createdAt: now() };
    tables().exports.set(record.id, record);
    return record;
  }

  async listExports(organizationId: Id, inventionId: Id): Promise<ExportRecordEntry[]> {
    return [...tables().exports.values()].filter(
      (e) => e.organizationId === organizationId && e.inventionId === inventionId,
    );
  }

  async getExport(organizationId: Id, exportId: Id): Promise<ExportRecordEntry | null> {
    const record = tables().exports.get(exportId);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async appendExportArtifact(
    input: Omit<ExportArtifactRecord, "id" | "createdAt">,
  ): Promise<ExportArtifactRecord> {
    const record: ExportArtifactRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().exportArtifacts.push(record);
    return record;
  }

  async listExportArtifacts(
    organizationId: Id,
    exportId: Id,
  ): Promise<ExportArtifactRecord[]> {
    return tables().exportArtifacts.filter(
      (a) => a.organizationId === organizationId && a.exportId === exportId,
    );
  }

  // ------------------------------------------------------------------
  // Durable jobs
  // ------------------------------------------------------------------
  async createJob(
    input: Pick<JobRecord, "organizationId" | "kind" | "idempotencyKey" | "payload">,
  ): Promise<JobRecord> {
    const record: JobRecord = {
      ...input,
      id: randomUUID(),
      status: "queued",
      result: {},
      errorSummary: null,
      attempts: 0,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
    };
    tables().jobs.set(record.id, record);
    return record;
  }

  async getJob(organizationId: Id, jobId: Id): Promise<JobRecord | null> {
    const record = tables().jobs.get(jobId);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async findJobByKey(
    organizationId: Id,
    kind: JobKind,
    idempotencyKey: string,
  ): Promise<JobRecord | null> {
    for (const job of tables().jobs.values()) {
      if (
        job.organizationId === organizationId &&
        job.kind === kind &&
        job.idempotencyKey === idempotencyKey
      ) {
        return job;
      }
    }
    return null;
  }

  async updateJob(
    organizationId: Id,
    jobId: Id,
    patch: Partial<
      Pick<JobRecord, "status" | "result" | "errorSummary" | "attempts" | "startedAt" | "finishedAt">
    >,
  ): Promise<JobRecord | null> {
    const record = tables().jobs.get(jobId);
    if (!record || record.organizationId !== organizationId) return null;
    Object.assign(record, patch);
    return record;
  }

  async listJobs(organizationId: Id): Promise<JobRecord[]> {
    return [...tables().jobs.values()].filter((j) => j.organizationId === organizationId);
  }

  // ------------------------------------------------------------------
  // Invitations
  // ------------------------------------------------------------------
  async createInvitation(
    input: Omit<InvitationRecord, "id" | "createdAt" | "acceptedAt" | "acceptedBy" | "revokedAt">,
  ): Promise<InvitationRecord> {
    const record: InvitationRecord = {
      ...input,
      id: randomUUID(),
      acceptedAt: null,
      acceptedBy: null,
      revokedAt: null,
      createdAt: now(),
    };
    tables().invitations.set(record.id, record);
    return record;
  }

  async listInvitations(organizationId: Id): Promise<InvitationRecord[]> {
    return [...tables().invitations.values()].filter(
      (i) => i.organizationId === organizationId,
    );
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    for (const invitation of tables().invitations.values()) {
      if (invitation.tokenHash === tokenHash) return invitation;
    }
    return null;
  }

  async updateInvitation(
    invitationId: Id,
    patch: Partial<Pick<InvitationRecord, "acceptedAt" | "acceptedBy" | "revokedAt">>,
  ): Promise<InvitationRecord | null> {
    const record = tables().invitations.get(invitationId);
    if (!record) return null;
    Object.assign(record, patch);
    return record;
  }

  async createMembership(
    input: Omit<MembershipRecord, "id" | "createdAt">,
  ): Promise<MembershipRecord> {
    const record: MembershipRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().memberships.push(record);
    return record;
  }

  async createCounselRequest(
    input: Omit<CounselRequestRecord, "id" | "state" | "createdAt" | "updatedAt">,
  ): Promise<CounselRequestRecord> {
    const record: CounselRequestRecord = {
      ...input,
      id: randomUUID(),
      state: "draft",
      createdAt: now(),
      updatedAt: now(),
    };
    tables().counselRequests.set(record.id, record);
    return record;
  }

  async getCounselRequest(
    organizationId: Id,
    requestId: Id,
  ): Promise<CounselRequestRecord | null> {
    const record = tables().counselRequests.get(requestId);
    if (!record || record.organizationId !== organizationId) return null;
    return record;
  }

  async listCounselRequests(organizationId: Id): Promise<CounselRequestRecord[]> {
    return [...tables().counselRequests.values()].filter(
      (r) => r.organizationId === organizationId,
    );
  }

  async updateCounselRequestState(
    organizationId: Id,
    requestId: Id,
    state: CounselRequestState,
  ): Promise<CounselRequestRecord | null> {
    const record = await this.getCounselRequest(organizationId, requestId);
    if (!record) return null;
    record.state = state;
    record.updatedAt = now();
    return record;
  }

  async appendCounselRequestEvent(
    input: Omit<CounselRequestEventRecord, "id" | "createdAt">,
  ): Promise<CounselRequestEventRecord> {
    const record: CounselRequestEventRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().counselRequestEvents.push(record);
    return record;
  }

  async listCounselRequestEvents(
    organizationId: Id,
    requestId: Id,
  ): Promise<CounselRequestEventRecord[]> {
    return tables().counselRequestEvents.filter(
      (e) => e.organizationId === organizationId && e.requestId === requestId,
    );
  }

  // ------------------------------------------------------------------
  // Connected-counsel administration lane (PRD §6.3)
  // ------------------------------------------------------------------
  async getCounselAssignment(userId: Id): Promise<CounselAssignmentRecord | null> {
    return tables().counselAssignments.get(userId) ?? null;
  }

  async setCounselAssignment(
    record: CounselAssignmentRecord,
  ): Promise<CounselAssignmentRecord> {
    tables().counselAssignments.set(record.userId, { ...record });
    return record;
  }

  async listCounselRequestsAllOrgs(): Promise<CounselRequestRecord[]> {
    return [...tables().counselRequests.values()];
  }

  async getCounselRequestAnyOrg(requestId: Id): Promise<CounselRequestRecord | null> {
    return tables().counselRequests.get(requestId) ?? null;
  }

  async createEngagement(
    input: Omit<EngagementRecord, "id" | "offeredAt">,
  ): Promise<EngagementRecord> {
    const record: EngagementRecord = { ...input, id: randomUUID(), offeredAt: now() };
    tables().engagements.set(record.id, record);
    return record;
  }

  async getEngagement(engagementId: Id): Promise<EngagementRecord | null> {
    return tables().engagements.get(engagementId) ?? null;
  }

  async getEngagementByRequest(requestId: Id): Promise<EngagementRecord | null> {
    for (const engagement of tables().engagements.values()) {
      if (engagement.requestId === requestId) return engagement;
    }
    return null;
  }

  async updateEngagement(
    engagementId: Id,
    patch: Partial<Pick<EngagementRecord, "signedDocumentRef" | "signedAt">>,
  ): Promise<EngagementRecord | null> {
    const record = tables().engagements.get(engagementId);
    if (!record) return null;
    Object.assign(record, patch);
    return record;
  }

  async createLegalMatter(
    input: Omit<LegalMatterRecord, "id" | "openedAt">,
  ): Promise<LegalMatterRecord> {
    const record: LegalMatterRecord = { ...input, id: randomUUID(), openedAt: now() };
    tables().legalMatters.set(record.id, record);
    return record;
  }

  async getLegalMatter(matterId: Id): Promise<LegalMatterRecord | null> {
    return tables().legalMatters.get(matterId) ?? null;
  }

  async getLegalMatterByEngagement(engagementId: Id): Promise<LegalMatterRecord | null> {
    for (const matter of tables().legalMatters.values()) {
      if (matter.engagementId === engagementId) return matter;
    }
    return null;
  }

  async createFilingPackage(
    input: Omit<FilingPackageRecord, "id" | "createdAt">,
  ): Promise<FilingPackageRecord> {
    const record: FilingPackageRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().filingPackages.set(record.id, record);
    return record;
  }

  async listFilingPackages(matterId: Id): Promise<FilingPackageRecord[]> {
    return [...tables().filingPackages.values()].filter((p) => p.matterId === matterId);
  }

  async updateFilingPackageStatus(
    packageId: Id,
    status: FilingPackageRecord["status"],
  ): Promise<FilingPackageRecord | null> {
    const record = tables().filingPackages.get(packageId);
    if (!record) return null;
    record.status = status;
    return record;
  }

  async appendCounselAuditEvent(
    input: Omit<CounselAuditEventRecord, "id" | "createdAt">,
  ): Promise<CounselAuditEventRecord> {
    const record: CounselAuditEventRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().counselAuditEvents.push(record);
    return record;
  }

  async listCounselAuditEvents(): Promise<CounselAuditEventRecord[]> {
    return [...tables().counselAuditEvents];
  }

  async getWallet(organizationId: Id): Promise<WalletRecord | null> {
    return tables().wallets.get(organizationId) ?? null;
  }

  async saveWallet(wallet: WalletRecord): Promise<WalletRecord> {
    tables().wallets.set(wallet.organizationId, { ...wallet });
    return wallet;
  }

  async appendLedgerEntry(
    input: Omit<LedgerEntryRecord, "id" | "createdAt">,
  ): Promise<LedgerEntryRecord> {
    const record: LedgerEntryRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().ledgerEntries.push(record);
    return record;
  }

  async listLedgerEntries(organizationId: Id): Promise<LedgerEntryRecord[]> {
    return tables().ledgerEntries.filter((e) => e.organizationId === organizationId);
  }

  async listReservations(organizationId: Id): Promise<ReservationRecord[]> {
    return [...tables().reservations.values()].filter(
      (r) => r.organizationId === organizationId,
    );
  }

  async saveReservation(reservation: ReservationRecord): Promise<ReservationRecord> {
    tables().reservations.set(reservation.id, { ...reservation });
    return reservation;
  }

  async appendUsageEvent(
    input: Omit<UsageEventRecord, "id" | "createdAt">,
  ): Promise<UsageEventRecord> {
    const record: UsageEventRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().usageEvents.push(record);
    return record;
  }

  async listUsageEvents(organizationId: Id): Promise<UsageEventRecord[]> {
    return tables().usageEvents.filter((e) => e.organizationId === organizationId);
  }

  async insertStripeEvent(
    input: Omit<StripeEventRecord, "processedAt" | "receivedAt">,
  ): Promise<{ record: StripeEventRecord; created: boolean }> {
    const existing = tables().stripeEvents.get(input.id);
    if (existing) return { record: existing, created: false };
    const record: StripeEventRecord = {
      ...input,
      processedAt: null,
      receivedAt: now(),
    };
    tables().stripeEvents.set(record.id, record);
    return { record, created: true };
  }

  async markStripeEventProcessed(id: string): Promise<void> {
    const record = tables().stripeEvents.get(id);
    if (record) record.processedAt = now();
  }

  async appendBillingOutbox(
    input: Omit<BillingOutboxRecord, "id" | "createdAt" | "processedAt" | "attempts" | "status">,
  ): Promise<BillingOutboxRecord> {
    const record: BillingOutboxRecord = {
      ...input,
      id: randomUUID(),
      status: "pending",
      attempts: 0,
      createdAt: now(),
      processedAt: null,
    };
    tables().billingOutbox.set(record.id, record);
    return record;
  }

  async listPendingBillingOutbox(): Promise<BillingOutboxRecord[]> {
    return [...tables().billingOutbox.values()]
      .filter((entry) => entry.status === "pending")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateBillingOutbox(
    id: Id,
    patch: Partial<Pick<BillingOutboxRecord, "status" | "attempts" | "processedAt">>,
  ): Promise<BillingOutboxRecord | null> {
    const record = tables().billingOutbox.get(id);
    if (!record) return null;
    Object.assign(record, patch);
    return record;
  }

  async getStripeCustomerId(organizationId: Id): Promise<string | null> {
    return tables().stripeCustomers.get(organizationId) ?? null;
  }

  async setStripeCustomerId(organizationId: Id, stripeCustomerId: string): Promise<void> {
    tables().stripeCustomers.set(organizationId, stripeCustomerId);
  }

  async appendAuditEvent(
    input: Omit<AuditEventRecord, "id" | "createdAt">,
  ): Promise<AuditEventRecord> {
    const record: AuditEventRecord = { ...input, id: randomUUID(), createdAt: now() };
    tables().auditEvents.push(record);
    return record;
  }

  async listAuditEvents(organizationId: Id): Promise<AuditEventRecord[]> {
    return tables().auditEvents.filter((e) => e.organizationId === organizationId);
  }
}
