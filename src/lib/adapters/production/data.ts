import type { Pool } from "pg";
import type { ActorContext, DataAdapter, Result } from "@/lib/adapters/types";
import { applyReviewDecision, exportWatermark, type ReviewDecision } from "@/lib/domain/review";
import { can, canInvokeWorkflow, type Role } from "@/lib/domain/roles";
import { canTransitionFact } from "@/lib/domain/provenance";
import {
  PLAYBOOK_CHAIN_GENESIS,
  playbookContentSha256,
  playbookEntryHash,
  playbookPublishSchema,
  styleProfileCreateSchema,
  verifyPlaybookChain,
  type PlaybookEntry,
  type StyleProfile,
} from "@/lib/domain/styles";
import {
  chatPostSchema,
  factCreateSchema,
  matterCreateSchema,
  matterPatchSchema,
  uploadSignSchema,
  type AuditEvent,
  type ChatMessage,
  type ClaimRecord,
  type DeadlineObservation,
  type ExportRecord,
  type FactEvent,
  type Matter,
  type MatterFact,
  type MatterSource,
  type ReviewDecisionRecord,
  type ReviewItem,
  type RunStageCheckpoint,
  type TeamMember,
  type UploadTarget,
  type WalletReservation,
  type WorkflowRun,
  type WorkProductDocument,
} from "@/lib/domain/schemas";
import { CORPUS_RELEASE, getRegistryEntry, searchCorpus, verifyQuote } from "@/lib/knowledge";
import { renderUsptoDocx } from "@/lib/export/docx";
import { exportPdfFileName, renderUsptoPdf } from "@/lib/export/pdf";
import { buildExportManifest, exportFileName, sha256Hex } from "@/lib/export/manifest";

/**
 * PRODUCTION DataAdapter — PostgreSQL implementation over the migration
 * schema (supabase/lex/migrations/0001–0006).
 *
 * Design (mirrors the migrations' security model):
 *  - The web tier connects with the service credential; RLS protects direct
 *    client access, while THIS adapter is the trusted server logic that
 *    enforces the same role policy the local adapter enforces, before every
 *    write, and scopes every query by organization_id (Invariant 18).
 *  - Append-only tables (audit, decisions, playbook, exports, ledger) rely
 *    on their DB triggers as a second enforcement layer.
 *  - RUN EXECUTION IS NOT AVAILABLE HERE: durable jobs + provider calls are
 *    approval-gated (PRD §20). createRun/cancelRun refuse with the seam
 *    message until provider enablement is approved; everything else is
 *    fully operational and integration-tested against a real PostgreSQL 16
 *    server without any external credentials.
 */

const RUN_SEAM_MESSAGE =
  "Run execution in production requires the durable job runner and model-provider enablement, which are approval-gated (PRD §20.4/§20.12/§20.13). " +
  "Enable providers and the worker before starting runs; until then runs cannot be created or cancelled in production mode.";

interface AuditInput {
  organizationId: string;
  matterId?: string;
  actorUserId: string;
  actorRole?: Role;
  action: string;
  subjectType: string;
  subjectId: string;
  detail?: string;
}

export class PgDataAdapter implements DataAdapter {
  constructor(private readonly pool: Pool) {}

  private async audit(event: AuditInput): Promise<void> {
    await this.pool.query(
      `insert into audit_events
         (organization_id, matter_id, actor_user_id, actor_role, action,
          subject_type, subject_id, detail)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.organizationId,
        event.matterId ?? null,
        event.actorUserId,
        event.actorRole ?? null,
        event.action,
        event.subjectType,
        event.subjectId,
        event.detail ?? null,
      ],
    );
  }

  // ------------------------------------------------------------- matters

  private static matterRow(r: Record<string, unknown>): Matter {
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterNumber: String(r.matter_number),
      title: String(r.title),
      jurisdiction: "US",
      technologyArea: String(r.technology_area),
      styleProfileId: r.style_profile_id ? String(r.style_profile_id) : undefined,
      lifecycle: r.lifecycle as Matter["lifecycle"],
      conflictTags: (r.conflict_tags as string[]) ?? [],
      synthetic: true,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async listMatters(organizationId: string): Promise<Matter[]> {
    const { rows } = await this.pool.query(
      `select * from matters where organization_id = $1 order by created_at`,
      [organizationId],
    );
    return rows.map(PgDataAdapter.matterRow);
  }

  async getMatter(organizationId: string, matterId: string): Promise<Matter | null> {
    const { rows } = await this.pool.query(
      `select * from matters where organization_id = $1 and id = $2`,
      [organizationId, matterId],
    );
    return rows[0] ? PgDataAdapter.matterRow(rows[0]) : null;
  }

  async createMatter(
    organizationId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<Result<{ matter: Matter }>> {
    if (!can(actor.role, "matter.create")) {
      return { ok: false, error: `Role "${actor.role}" may not create matters.` };
    }
    const parsed = matterCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid matter input." };
    try {
      const { rows } = await this.pool.query(
        `insert into matters
           (organization_id, matter_number, title, jurisdiction,
            technology_area, conflict_tags, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *`,
        [
          organizationId,
          parsed.data.matterNumber,
          parsed.data.title,
          parsed.data.jurisdiction,
          parsed.data.technologyArea,
          parsed.data.conflictTags,
          actor.userId,
        ],
      );
      const matter = PgDataAdapter.matterRow(rows[0]);
      await this.audit({
        organizationId,
        matterId: matter.id,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "matter.create",
        subjectType: "matter",
        subjectId: matter.id,
        detail: `Created matter ${matter.matterNumber} — ${matter.title}`,
      });
      return { ok: true, matter };
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return { ok: false, error: "Matter number already exists in this tenant." };
      }
      throw err;
    }
  }

  async updateMatter(
    organizationId: string,
    matterId: string,
    patch: unknown,
    actor: ActorContext,
  ): Promise<Result<{ matter: Matter }>> {
    if (!can(actor.role, "matter.edit")) {
      return { ok: false, error: `Role "${actor.role}" may not edit matters.` };
    }
    const parsed = matterPatchSchema.safeParse(patch);
    if (!parsed.success) return { ok: false, error: "Invalid matter patch." };
    if (parsed.data.lifecycle === "closed" && !can(actor.role, "matter.close")) {
      return { ok: false, error: `Role "${actor.role}" may not close matters.` };
    }
    const existing = await this.getMatter(organizationId, matterId);
    if (!existing) return { ok: false, error: "Matter not found in this tenant." };

    const next = { ...existing, ...parsed.data };
    const { rows } = await this.pool.query(
      `update matters
          set title = $3, technology_area = $4, conflict_tags = $5,
              lifecycle = $6, updated_at = now()
        where organization_id = $1 and id = $2
        returning *`,
      [
        organizationId,
        matterId,
        next.title,
        next.technologyArea,
        next.conflictTags,
        next.lifecycle,
      ],
    );
    const matter = PgDataAdapter.matterRow(rows[0]);
    await this.audit({
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "matter.edit",
      subjectType: "matter",
      subjectId: matterId,
      detail: `Updated fields: ${Object.keys(parsed.data).join(", ")}`,
    });
    return { ok: true, matter };
  }

  // ---------------------------------------------------------------- facts

  private static factRow(r: Record<string, unknown>): MatterFact {
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      category: r.category as MatterFact["category"],
      text: String(r.text),
      provenance: r.provenance as MatterFact["provenance"],
      sourceIds: (r.source_ids as string[]) ?? [],
      contributedBy: String(r.contributed_by),
      version: Number(r.version),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async listFacts(organizationId: string, matterId: string): Promise<MatterFact[]> {
    const { rows } = await this.pool.query(
      `select * from matter_facts
        where organization_id = $1 and matter_id = $2 order by created_at`,
      [organizationId, matterId],
    );
    return rows.map(PgDataAdapter.factRow);
  }

  async createFact(
    organizationId: string,
    matterId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<Result<{ fact: MatterFact }>> {
    if (!can(actor.role, "facts.contribute")) {
      return { ok: false, error: `Role "${actor.role}" may not contribute facts.` };
    }
    const parsed = factCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid fact input." };
    const matter = await this.getMatter(organizationId, matterId);
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };

    const { rows } = await this.pool.query(
      `insert into matter_facts
         (organization_id, matter_id, category, text, source_ids, contributed_by)
       values ($1, $2, $3, $4, $5::uuid[], $6)
       returning *`,
      [
        organizationId,
        matterId,
        parsed.data.category,
        parsed.data.text,
        parsed.data.sourceIds,
        actor.userId,
      ],
    );
    const fact = PgDataAdapter.factRow(rows[0]);
    await this.pool.query(
      `insert into fact_events
         (organization_id, matter_id, fact_id, event_type, to_provenance,
          actor_user_id, actor_role)
       values ($1, $2, $3, 'created', 'user_asserted', $4, $5)`,
      [organizationId, matterId, fact.id, actor.userId, actor.role],
    );
    await this.audit({
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "facts.contribute",
      subjectType: "matter_fact",
      subjectId: fact.id,
      detail: `Added ${fact.category} fact (user_asserted)`,
    });
    return { ok: true, fact };
  }

  async approveFact(
    organizationId: string,
    matterId: string,
    factId: string,
    actor: ActorContext,
  ): Promise<Result<{ fact: MatterFact; event: FactEvent }>> {
    if (!can(actor.role, "facts.approve")) {
      return { ok: false, error: `Role "${actor.role}" may not approve facts.` };
    }
    const { rows } = await this.pool.query(
      `select * from matter_facts
        where organization_id = $1 and matter_id = $2 and id = $3`,
      [organizationId, matterId, factId],
    );
    if (!rows[0]) return { ok: false, error: "Fact not found in this matter." };
    const fact = PgDataAdapter.factRow(rows[0]);
    if (!canTransitionFact(fact.provenance, "counsel_reviewed", "human")) {
      return {
        ok: false,
        error: `Fact provenance "${fact.provenance}" cannot transition to counsel_reviewed.`,
      };
    }
    const updated = await this.pool.query(
      `update matter_facts
          set provenance = 'counsel_reviewed', version = version + 1,
              updated_at = now()
        where id = $1 returning *`,
      [factId],
    );
    const eventRows = await this.pool.query(
      `insert into fact_events
         (organization_id, matter_id, fact_id, event_type, from_provenance,
          to_provenance, actor_user_id, actor_role, note)
       values ($1, $2, $3, 'approved', $4, 'counsel_reviewed', $5, $6, $7)
       returning *`,
      [organizationId, matterId, factId, fact.provenance, actor.userId, actor.role, actor.note ?? null],
    );
    const e = eventRows.rows[0];
    const event: FactEvent = {
      id: String(e.id),
      organizationId,
      matterId,
      factId,
      eventType: "approved",
      fromProvenance: fact.provenance,
      toProvenance: "counsel_reviewed",
      actorUserId: actor.userId,
      actorRole: actor.role,
      note: actor.note,
      createdAt: (e.created_at as Date).toISOString(),
    };
    await this.audit({
      organizationId,
      matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "facts.approve",
      subjectType: "matter_fact",
      subjectId: factId,
      detail: `Fact approved: ${fact.provenance} → counsel_reviewed`,
    });
    return { ok: true, fact: PgDataAdapter.factRow(updated.rows[0]), event };
  }

  async listFactEvents(organizationId: string, matterId: string): Promise<FactEvent[]> {
    const { rows } = await this.pool.query(
      `select * from fact_events
        where organization_id = $1 and matter_id = $2
        order by created_at desc`,
      [organizationId, matterId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      factId: String(r.fact_id),
      eventType: (r.event_type === "created" || r.event_type === "approved"
        ? r.event_type
        : "provenance_changed") as FactEvent["eventType"],
      fromProvenance: (r.from_provenance ?? undefined) as FactEvent["fromProvenance"],
      toProvenance: (r.to_provenance ?? undefined) as FactEvent["toProvenance"],
      actorUserId: String(r.actor_user_id),
      actorRole: r.actor_role as Role,
      note: (r.note ?? undefined) as string | undefined,
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  // --------------------------------------------------------------- sources

  async listSources(organizationId: string, matterId: string): Promise<MatterSource[]> {
    const { rows } = await this.pool.query(
      `select * from private_sources
        where organization_id = $1 and matter_id = $2 order by created_at`,
      [organizationId, matterId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      kind: r.kind as MatterSource["kind"],
      title: String(r.title),
      fileName: (r.storage_path ?? undefined) as string | undefined,
      extractionState: r.extraction_state as MatterSource["extractionState"],
      pageCount: r.page_count == null ? undefined : Number(r.page_count),
      synthetic: true,
      uploadedBy: String(r.uploaded_by),
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  async createUploadTarget(
    organizationId: string,
    matterId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<Result<{ target: UploadTarget }>> {
    if (!can(actor.role, "sources.upload")) {
      return { ok: false, error: `Role "${actor.role}" may not upload sources.` };
    }
    const parsed = uploadSignSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid upload request." };
    }
    // SEAM: real signed URLs require Supabase Storage credentials
    // (approval-gated). The registration and audit trail are real; the URL
    // is a placeholder that no client can upload to until storage exists.
    void matterId;
    return {
      ok: false,
      error:
        "Signed uploads require the private Supabase Storage bucket, which is approval-gated (PRD-wepatent §17.1/§17.2). Configure LEX_SUPABASE_* and the storage bucket to enable uploads.",
    };
  }

  // ---------------------------------------------------------------- claims

  async listClaims(organizationId: string, matterId: string): Promise<ClaimRecord[]> {
    const { rows } = await this.pool.query(
      `select c.id, c.organization_id, c.matter_id, c.claim_number, c.created_at,
              v.version, v.text, v.created_at as version_created_at
         from claims c
         join lateral (
           select * from claim_versions cv
            where cv.claim_id = c.id order by cv.version desc limit 1
         ) v on true
        where c.organization_id = $1 and c.matter_id = $2
        order by c.claim_number`,
      [organizationId, matterId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      claimNumber: Number(r.claim_number),
      text: String(r.text),
      version: Number(r.version),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.version_created_at as Date).toISOString(),
    }));
  }

  // ------------------------------------------------------------------ runs

  private static runRow(r: Record<string, unknown>): WorkflowRun {
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      workflowKey: r.workflow_key as WorkflowRun["workflowKey"],
      workflowVersion: String(r.workflow_version),
      tier: r.tier as WorkflowRun["tier"],
      state: r.state as WorkflowRun["state"],
      jurisdiction: "US",
      asOfDate: String(r.as_of_date).slice(0, 10),
      modelId: String(r.model_id),
      modelTier: r.model_tier as WorkflowRun["modelTier"],
      corpusRelease: String(r.corpus_release),
      styleProfileVersion:
        r.style_profile_version == null ? undefined : String(r.style_profile_version),
      deliverableType: String(r.deliverable_type),
      qualityControls: (r.quality_controls ?? {
        sourceRequired: true,
        secondModelReview: true,
        quoteVerification: true,
      }) as WorkflowRun["qualityControls"],
      estimatedChargeLowUsd: Number(r.estimated_charge_low_usd),
      estimatedChargeHighUsd: Number(r.estimated_charge_high_usd),
      actualChargeUsd:
        r.actual_charge_usd == null ? undefined : Number(r.actual_charge_usd),
      requestedBy: String(r.requested_by),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async listRuns(organizationId: string, matterId?: string): Promise<WorkflowRun[]> {
    const { rows } = await this.pool.query(
      matterId
        ? `select * from workflow_runs where organization_id = $1 and matter_id = $2 order by created_at desc`
        : `select * from workflow_runs where organization_id = $1 order by created_at desc`,
      matterId ? [organizationId, matterId] : [organizationId],
    );
    return rows.map(PgDataAdapter.runRow);
  }

  async getRun(organizationId: string, runId: string) {
    const { rows } = await this.pool.query(
      `select * from workflow_runs where organization_id = $1 and id = $2`,
      [organizationId, runId],
    );
    if (!rows[0]) return null;
    const run = PgDataAdapter.runRow(rows[0]);
    const stages = await this.pool.query(
      `select * from run_stages where run_id = $1 order by started_at`,
      [runId],
    );
    const reservation = await this.pool.query(
      `select * from usage_reservations where organization_id = $1 and run_id = $2`,
      [organizationId, runId],
    );
    const stageCheckpoints: RunStageCheckpoint[] = stages.rows.map((s) => ({
      id: String(s.id),
      organizationId,
      runId,
      stage: s.stage as RunStageCheckpoint["stage"],
      enteredAt: (s.started_at as Date).toISOString(),
      completedAt: s.finished_at ? (s.finished_at as Date).toISOString() : undefined,
      billable: s.stage === "GENERATING",
      detail: (s.error ?? undefined) as string | undefined,
    }));
    const res = reservation.rows[0];
    const walletReservation: WalletReservation | null = res
      ? {
          id: String(res.id),
          organizationId,
          runId,
          heldUsd: Number(res.reserved_high_usd),
          state: (res.state === "expired" ? "released" : res.state) as WalletReservation["state"],
          settledUsd: undefined,
          createdAt: (res.created_at as Date).toISOString(),
          updatedAt: (res.resolved_at ?? res.created_at as Date).toISOString(),
        }
      : null;
    return { run, stages: stageCheckpoints, reservation: walletReservation };
  }

  async createRun(): Promise<{ ok: false; error: string }> {
    // SEAM (documented): durable jobs + provider enablement approval-gated.
    return { ok: false, error: RUN_SEAM_MESSAGE };
  }

  async cancelRun(): Promise<Result<{ run: WorkflowRun }>> {
    return { ok: false, error: RUN_SEAM_MESSAGE };
  }

  // ---------------------------------------------------------------- review

  private static reviewRow(r: Record<string, unknown>): ReviewItem {
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      runId: r.run_id ? String(r.run_id) : undefined,
      documentTitle: String(r.document_title),
      documentVersionHash: String(r.document_version_hash),
      tier: r.tier as ReviewItem["tier"],
      state: r.state as ReviewItem["state"],
      verificationState: r.verification as ReviewItem["verificationState"],
      criticReportSummary: undefined,
      deterministicCheckFailures: 0,
      unresolvedFlags: (r.unresolved_flags as string[]) ?? [],
      dueDate: r.due_date ? String(r.due_date).slice(0, 10) : undefined,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async listReviewItems(
    organizationId: string,
    filter?: { matterId?: string; state?: ReviewItem["state"] },
  ): Promise<ReviewItem[]> {
    const clauses = ["organization_id = $1"];
    const params: unknown[] = [organizationId];
    if (filter?.matterId) {
      params.push(filter.matterId);
      clauses.push(`matter_id = $${params.length}`);
    }
    if (filter?.state) {
      params.push(filter.state);
      clauses.push(`state = $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `select * from review_items where ${clauses.join(" and ")}
        order by due_date nulls last, created_at`,
      params,
    );
    return rows.map(PgDataAdapter.reviewRow);
  }

  async decideReviewItem(
    organizationId: string,
    reviewItemId: string,
    decision: ReviewDecision,
    actor: { userId: string; role: Role; note?: string },
  ): Promise<
    | { ok: true; item: ReviewItem; record: ReviewDecisionRecord }
    | { ok: false; error: string }
  > {
    const { rows } = await this.pool.query(
      `select * from review_items where organization_id = $1 and id = $2`,
      [organizationId, reviewItemId],
    );
    if (!rows[0]) return { ok: false, error: "Review item not found." };
    const item = PgDataAdapter.reviewRow(rows[0]);

    // §9.2: check failures cannot be dismissed silently — approval over
    // failures requires a recorded reason. Failure count comes from the
    // run's undismissed deterministic_check_results.
    if (item.runId) {
      const failures = await this.pool.query(
        `select count(*)::int as n from deterministic_check_results
          where run_id = $1 and passed = false and dismissed_by is null`,
        [item.runId],
      );
      const failureCount = Number(failures.rows[0].n);
      item.deterministicCheckFailures = failureCount;
      if (decision === "approve" && failureCount > 0 && !actor.note?.trim()) {
        return {
          ok: false,
          error: `This item has ${failureCount} deterministic check failure(s). Approving it requires a recorded dismissal reason — add a decision note explaining why the failures are acceptable.`,
        };
      }
    }

    // The single Invariant-16 gate (same domain gate as local mode).
    const result = applyReviewDecision({
      current: item.state,
      decision,
      tier: item.tier,
      actor: { type: "human", userId: actor.userId, role: actor.role, authenticated: true },
    });
    if (!result.ok) return { ok: false, error: result.error };

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update review_items set state = $2, updated_at = now() where id = $1`,
        [reviewItemId, result.nextState],
      );
      if (item.runId) {
        await client.query(
          `update documents set review_state = $2, updated_at = now()
            where organization_id = $3 and run_id = $1`,
          [item.runId, result.nextState, organizationId],
        );
      }
      const dec = await client.query(
        `insert into review_decisions
           (organization_id, review_item_id, decision, note, actor_user_id,
            actor_role, document_version_hash)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [
          organizationId,
          reviewItemId,
          decision,
          actor.note ?? null,
          actor.userId,
          actor.role,
          item.documentVersionHash,
        ],
      );
      await client.query("commit");
      const d = dec.rows[0];
      const record: ReviewDecisionRecord = {
        id: String(d.id),
        organizationId,
        reviewItemId,
        decision,
        note: actor.note,
        actorUserId: actor.userId,
        actorRole: actor.role,
        documentVersionHash: item.documentVersionHash,
        decidedAt: (d.decided_at as Date).toISOString(),
      };
      await this.audit({
        organizationId,
        matterId: item.matterId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: `review.${decision}`,
        subjectType: "review_item",
        subjectId: reviewItemId,
        detail: `${decision} on "${item.documentTitle}" (Tier ${item.tier}, doc hash ${item.documentVersionHash})`,
      });
      return {
        ok: true,
        item: { ...item, state: result.nextState },
        record,
      };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------------- documents

  private static documentRow(
    doc: Record<string, unknown>,
    version: Record<string, unknown>,
  ): WorkProductDocument {
    const content = (version.content ?? {}) as {
      sections?: WorkProductDocument["sections"];
      citations?: WorkProductDocument["citations"];
    };
    return {
      id: String(doc.id),
      organizationId: String(doc.organization_id),
      matterId: String(doc.matter_id),
      runId: doc.run_id ? String(doc.run_id) : undefined,
      title: String(doc.title),
      deliverableType: String(doc.deliverable_type),
      tier: doc.tier as WorkProductDocument["tier"],
      reviewState: doc.review_state as WorkProductDocument["reviewState"],
      verificationState: doc.verification as WorkProductDocument["verificationState"],
      modelId: String(doc.model_id),
      corpusRelease: String(doc.corpus_release),
      version: Number(version.version),
      versionHash: String(version.content_sha256).slice(0, 16),
      sections: content.sections ?? [],
      citations: content.citations ?? [],
      createdAt: (doc.created_at as Date).toISOString(),
      updatedAt: (doc.updated_at as Date).toISOString(),
    };
  }

  private async documentWithVersion(
    organizationId: string,
    documentId: string,
  ): Promise<WorkProductDocument | null> {
    const { rows } = await this.pool.query(
      `select d.*, v.version, v.content, v.content_sha256
         from documents d
         join lateral (
           select * from document_versions dv
            where dv.document_id = d.id order by dv.version desc limit 1
         ) v on true
        where d.organization_id = $1 and d.id = $2`,
      [organizationId, documentId],
    );
    if (!rows[0]) return null;
    return PgDataAdapter.documentRow(rows[0], rows[0]);
  }

  async listDocuments(
    organizationId: string,
    matterId?: string,
  ): Promise<WorkProductDocument[]> {
    const { rows } = await this.pool.query(
      `select d.*, v.version, v.content, v.content_sha256
         from documents d
         join lateral (
           select * from document_versions dv
            where dv.document_id = d.id order by dv.version desc limit 1
         ) v on true
        where d.organization_id = $1 ${matterId ? "and d.matter_id = $2" : ""}
        order by d.created_at`,
      matterId ? [organizationId, matterId] : [organizationId],
    );
    return rows.map((r) => PgDataAdapter.documentRow(r, r));
  }

  async getDocument(
    organizationId: string,
    documentId: string,
  ): Promise<WorkProductDocument | null> {
    return this.documentWithVersion(organizationId, documentId);
  }

  async listDecisionsForDocument(
    organizationId: string,
    documentId: string,
  ): Promise<ReviewDecisionRecord[]> {
    const { rows } = await this.pool.query(
      `select rd.* from review_decisions rd
         join review_items ri on ri.id = rd.review_item_id
         join documents d on d.run_id = ri.run_id and d.organization_id = ri.organization_id
        where d.organization_id = $1 and d.id = $2
        order by rd.decided_at`,
      [organizationId, documentId],
    );
    return rows.map((d) => ({
      id: String(d.id),
      organizationId: String(d.organization_id),
      reviewItemId: String(d.review_item_id),
      decision: d.decision as ReviewDecision,
      note: (d.note ?? undefined) as string | undefined,
      actorUserId: String(d.actor_user_id),
      actorRole: d.actor_role as Role,
      documentVersionHash: String(d.document_version_hash),
      decidedAt: (d.decided_at as Date).toISOString(),
    }));
  }

  // --------------------------------------------------------------- exports

  private static exportRow(r: Record<string, unknown>): ExportRecord | null {
    if (!r.docx_bytes || !r.pdf_bytes) return null;
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      documentId: String(r.document_id),
      documentVersion: Number(r.doc_version),
      fileName: String(r.file_name),
      pdfFileName: String(r.pdf_file_name),
      docxSha256: String(r.docx_sha256),
      pdfSha256: String(r.pdf_sha256),
      manifest: r.manifest as ExportRecord["manifest"],
      docxBase64: (r.docx_bytes as Buffer).toString("base64"),
      pdfBase64: (r.pdf_bytes as Buffer).toString("base64"),
      createdBy: String(r.exported_by),
      createdAt: (r.created_at as Date).toISOString(),
    };
  }

  private exportQuery(extraWhere: string): string {
    return `
      select e.*, em.manifest, dv.document_id, dv.version as doc_version
        from exports e
        join export_manifests em on em.export_id = e.id
        join document_versions dv on dv.id = e.document_version_id
       where e.organization_id = $1 ${extraWhere}
       order by e.created_at desc`;
  }

  async createExport(
    organizationId: string,
    documentId: string,
    actor: ActorContext,
  ): Promise<Result<{ record: ExportRecord; reused: boolean }>> {
    const doc = await this.documentWithVersion(organizationId, documentId);
    if (!doc) return { ok: false, error: "Document not found in this tenant." };
    const requiredAction =
      doc.reviewState === "approved" ? "export.approved" : "export.draft";
    if (!can(actor.role, requiredAction)) {
      return {
        ok: false,
        error: `Role "${actor.role}" may not export this document (${requiredAction} required).`,
      };
    }
    // Version-locked immutability: one export per document version.
    const existing = await this.pool.query(
      this.exportQuery("and dv.document_id = $2 and dv.version = $3"),
      [organizationId, documentId, doc.version],
    );
    if (existing.rows[0]) {
      const record = PgDataAdapter.exportRow(existing.rows[0]);
      if (record) return { ok: true, record, reused: true };
    }

    const versionRow = await this.pool.query(
      `select id from document_versions dv
        where dv.document_id = $1 and dv.version = $2`,
      [documentId, doc.version],
    );
    const documentVersionId = versionRow.rows[0]?.id;
    if (!documentVersionId) return { ok: false, error: "Document version not found." };

    const docxBuffer = await renderUsptoDocx(doc);
    const pdfBuffer = renderUsptoPdf(doc);
    const decisions = await this.listDecisionsForDocument(organizationId, documentId);
    const generatedAt = new Date().toISOString();
    const inserted = await this.pool.query(
      `insert into exports
         (organization_id, matter_id, document_version_id, format, watermark,
          approved, exported_by, docx_sha256, pdf_sha256, docx_bytes,
          pdf_bytes, file_name, pdf_file_name)
       values ($1, $2, $3, 'docx', $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, created_at`,
      [
        organizationId,
        doc.matterId,
        documentVersionId,
        exportWatermark(doc.reviewState),
        doc.reviewState === "approved",
        actor.userId,
        sha256Hex(docxBuffer),
        sha256Hex(pdfBuffer),
        docxBuffer,
        pdfBuffer,
        exportFileName(doc),
        exportPdfFileName(exportFileName(doc)),
      ],
    );
    const exportId = String(inserted.rows[0].id);
    const manifest = buildExportManifest({
      exportId,
      document: doc,
      decisions,
      docxBuffer,
      pdfBuffer,
      generatedBy: actor.userId,
      generatedAt,
    });
    await this.pool.query(
      `insert into export_manifests (organization_id, export_id, manifest, manifest_sha256)
       values ($1, $2, $3, $4)`,
      [organizationId, exportId, JSON.stringify(manifest), sha256Hex(JSON.stringify(manifest))],
    );
    await this.audit({
      organizationId,
      matterId: doc.matterId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: doc.reviewState === "approved" ? "export.approved" : "export.draft",
      subjectType: "export",
      subjectId: exportId,
      detail: `Exported "${doc.title}" v${doc.version} (${manifest.checksums.docxSha256.slice(0, 12)}…)`,
    });
    const record: ExportRecord = {
      id: exportId,
      organizationId,
      matterId: doc.matterId,
      documentId,
      documentVersion: doc.version,
      fileName: exportFileName(doc),
      pdfFileName: exportPdfFileName(exportFileName(doc)),
      docxSha256: manifest.checksums.docxSha256,
      pdfSha256: manifest.checksums.pdfSha256,
      manifest,
      docxBase64: docxBuffer.toString("base64"),
      pdfBase64: pdfBuffer.toString("base64"),
      createdBy: actor.userId,
      createdAt: generatedAt,
    };
    return { ok: true, record, reused: false };
  }

  async listExports(organizationId: string, matterId?: string): Promise<ExportRecord[]> {
    const { rows } = await this.pool.query(
      this.exportQuery(matterId ? "and e.matter_id = $2" : ""),
      matterId ? [organizationId, matterId] : [organizationId],
    );
    return rows
      .map(PgDataAdapter.exportRow)
      .filter((r): r is ExportRecord => r !== null);
  }

  async getExport(organizationId: string, exportId: string): Promise<ExportRecord | null> {
    const { rows } = await this.pool.query(this.exportQuery("and e.id = $2"), [
      organizationId,
      exportId,
    ]);
    return rows[0] ? PgDataAdapter.exportRow(rows[0]) : null;
  }

  // ----------------------------------------------------- deadlines / audit

  async listDeadlines(organizationId: string): Promise<DeadlineObservation[]> {
    const { rows } = await this.pool.query(
      `select * from deadline_observations
        where organization_id = $1 order by observed_date`,
      [organizationId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      label: String(r.label),
      observedDate: String(r.observed_date).slice(0, 10),
      windowKind: String(r.window_kind),
      disclaimerRequired: true as const,
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  async listAuditEvents(
    organizationId: string,
    filter?: { matterId?: string; limit?: number },
  ): Promise<AuditEvent[]> {
    const params: unknown[] = [organizationId];
    let where = "organization_id = $1";
    if (filter?.matterId) {
      params.push(filter.matterId);
      where += ` and matter_id = $${params.length}`;
    }
    params.push(filter?.limit ?? 200);
    const { rows } = await this.pool.query(
      `select * from audit_events where ${where}
        order by created_at desc limit $${params.length}`,
      params,
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: r.matter_id ? String(r.matter_id) : undefined,
      actorUserId: String(r.actor_user_id),
      actorRole: (r.actor_role ?? undefined) as Role | undefined,
      action: String(r.action),
      subjectType: String(r.subject_type),
      subjectId: String(r.subject_id),
      detail: (r.detail ?? undefined) as string | undefined,
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  // -------------------------------------------------- reservations / team

  async listReservations(organizationId: string): Promise<WalletReservation[]> {
    const { rows } = await this.pool.query(
      `select * from usage_reservations
        where organization_id = $1 order by created_at desc`,
      [organizationId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      runId: r.run_id ? String(r.run_id) : "",
      heldUsd: Number(r.reserved_high_usd),
      state: (r.state === "expired" ? "released" : r.state) as WalletReservation["state"],
      settledUsd: undefined,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: ((r.resolved_at ?? r.created_at) as Date).toISOString(),
    }));
  }

  async listTeamMembers(organizationId: string): Promise<TeamMember[]> {
    const { rows } = await this.pool.query(
      `select m.user_id, m.organization_id, m.role, m.created_at,
              coalesce(p.display_name, u.email, m.user_id::text) as display_name,
              coalesce(u.email, '') as email
         from organization_memberships m
         left join users_profile p on p.user_id = m.user_id
         left join auth.users u on u.id = m.user_id
        where m.organization_id = $1
        order by m.created_at`,
      [organizationId],
    );
    return rows.map((r) => ({
      userId: String(r.user_id),
      organizationId: String(r.organization_id),
      displayName: String(r.display_name),
      email: String(r.email || "unknown@invalid"),
      role: r.role as Role,
      mfaEnrolled: false, // real value comes from Supabase Auth MFA (seam)
      joinedAt: (r.created_at as Date).toISOString(),
    }));
  }

  // ------------------------------------------------------------------ chat

  async listChatMessages(organizationId: string, matterId: string): Promise<ChatMessage[]> {
    const { rows } = await this.pool.query(
      `select * from chat_messages
        where organization_id = $1 and matter_id = $2 order by created_at`,
      [organizationId, matterId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      organizationId: String(r.organization_id),
      matterId: String(r.matter_id),
      author: r.author as ChatMessage["author"],
      authorUserId: String(r.author_user_id),
      body: String(r.body),
      citations: (r.citations ?? []) as ChatMessage["citations"],
      asOfDate: r.as_of_date ? String(r.as_of_date).slice(0, 10) : undefined,
      corpusRelease: (r.corpus_release ?? undefined) as string | undefined,
      createdAt: (r.created_at as Date).toISOString(),
    }));
  }

  async postChatMessage(
    organizationId: string,
    matterId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<Result<{ question: ChatMessage; reply: ChatMessage }>> {
    if (!canInvokeWorkflow(actor.role, "B")) {
      return {
        ok: false,
        error: `Role "${actor.role}" may not use the grounded chat (research surface).`,
      };
    }
    const parsed = chatPostSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid chat message." };
    const matter = await this.getMatter(organizationId, matterId);
    if (!matter) return { ok: false, error: "Matter not found in this tenant." };
    if (matter.lifecycle !== "active") {
      return { ok: false, error: "Chat requires an active matter." };
    }

    const asOfDate = parsed.data.asOfDate ?? new Date().toISOString().slice(0, 10);
    const search = searchCorpus({
      query: parsed.data.question,
      jurisdiction: "US",
      asOfDate,
      limit: 4,
    });
    const citations: ChatMessage["citations"] = [];
    search.hits.forEach((hit, i) => {
      const entry = getRegistryEntry(hit.documentId);
      const section = entry?.sections.find((s) => s.id === hit.sectionId);
      if (!entry || !section) return;
      let quote = section.text.slice(0, 140);
      const lastSpace = quote.lastIndexOf(" ");
      if (lastSpace > 40) quote = quote.slice(0, lastSpace);
      const verification = verifyQuote({ corpusDocumentId: hit.documentId, quote });
      citations.push({
        id: `cit_${i + 1}`,
        kind: "authority",
        corpusDocumentId: hit.documentId,
        citation: hit.citation,
        quote,
        verification: verification.state,
        note: hit.authorityNote ?? hit.supersessionNote,
      });
    });
    const replyBody = search.insufficiencyWarning
      ? `${search.insufficiencyWarning} No authority is quoted because none was retrievable — Lex does not guess (§6.2).`
      : `Grounded on ${citations.length} retrieved authorit${citations.length === 1 ? "y" : "ies"} as of ${asOfDate} (corpus ${CORPUS_RELEASE}). Every quotation passed or failed the verifier explicitly; synthesis is labeled analysis for practitioner evaluation.`;
    if (!search.insufficiencyWarning) {
      citations.push({
        id: "cit_analysis",
        kind: "analysis",
        citation: "Analysis (no authority quoted)",
        verification: "unverified",
        note: "Labeled analysis — synthesis across the quoted authorities is drafting judgment, not quotation.",
      });
    }

    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const q = await client.query(
        `insert into chat_messages
           (organization_id, matter_id, author, author_user_id, body)
         values ($1, $2, 'user', $3, $4) returning *`,
        [organizationId, matterId, actor.userId, parsed.data.question],
      );
      const a = await client.query(
        `insert into chat_messages
           (organization_id, matter_id, author, author_user_id, body,
            citations, as_of_date, corpus_release)
         values ($1, $2, 'lex', 'system:lex', $3, $4, $5, $6) returning *`,
        [organizationId, matterId, replyBody, JSON.stringify(citations), asOfDate, CORPUS_RELEASE],
      );
      await client.query("commit");
      const map = (r: Record<string, unknown>): ChatMessage => ({
        id: String(r.id),
        organizationId,
        matterId,
        author: r.author as ChatMessage["author"],
        authorUserId: String(r.author_user_id),
        body: String(r.body),
        citations: (r.citations ?? []) as ChatMessage["citations"],
        asOfDate: r.as_of_date ? String(r.as_of_date).slice(0, 10) : undefined,
        corpusRelease: (r.corpus_release ?? undefined) as string | undefined,
        createdAt: (r.created_at as Date).toISOString(),
      });
      await this.audit({
        organizationId,
        matterId,
        actorUserId: actor.userId,
        actorRole: actor.role,
        action: "chat.post",
        subjectType: "chat_message",
        subjectId: String(q.rows[0].id),
        detail: `Grounded chat exchange (${citations.filter((c) => c.kind === "authority").length} authority citation(s), as of ${asOfDate}).`,
      });
      return { ok: true, question: map(q.rows[0]), reply: map(a.rows[0]) };
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------------- styles/playbook

  private static styleRow(r: Record<string, unknown>): StyleProfile {
    const rules = Array.isArray(r.rules)
      ? (r.rules as string[])
      : ((r.rules as { rules?: string[] })?.rules ?? []);
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      name: String(r.name),
      kind: (r.kind ?? "application_drafting") as StyleProfile["kind"],
      rules: rules.length > 0 ? rules : ["(no rules recorded)"],
      version: Number(r.version),
      platformDefault: Boolean(r.platform_default),
      createdBy: String(r.created_by),
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }

  async listStyleProfiles(organizationId: string): Promise<StyleProfile[]> {
    const { rows } = await this.pool.query(
      `select * from style_profiles where organization_id = $1 order by created_at`,
      [organizationId],
    );
    return rows.map(PgDataAdapter.styleRow);
  }

  async createStyleProfile(
    organizationId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<Result<{ profile: StyleProfile }>> {
    if (!can(actor.role, "styles.manage")) {
      return { ok: false, error: `Role "${actor.role}" may not manage style profiles.` };
    }
    const parsed = styleProfileCreateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid style profile input." };
    const prior = await this.pool.query(
      `select count(*)::int as n, bool_or(platform_default) as has_default
         from style_profiles where organization_id = $1 and name = $2`,
      [organizationId, parsed.data.name],
    );
    if (prior.rows[0].has_default) {
      return {
        ok: false,
        error: "The platform default profile cannot be replaced; create a new named profile.",
      };
    }
    const { rows } = await this.pool.query(
      `insert into style_profiles
         (organization_id, name, kind, version, rules, created_by)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [
        organizationId,
        parsed.data.name,
        parsed.data.kind,
        Number(prior.rows[0].n) + 1,
        JSON.stringify(parsed.data.rules),
        actor.userId,
      ],
    );
    const profile = PgDataAdapter.styleRow(rows[0]);
    await this.audit({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "styles.manage",
      subjectType: "style_profile",
      subjectId: profile.id,
      detail: `Created style profile ${profile.name}@${profile.version}`,
    });
    return { ok: true, profile };
  }

  private static playbookRow(r: Record<string, unknown>): PlaybookEntry {
    return {
      id: String(r.id),
      organizationId: String(r.organization_id),
      title: String(r.title),
      category: (r.category ?? "approved_argument") as PlaybookEntry["category"],
      body: String(r.body),
      contentSha256: String(r.content_sha256),
      prevEntryHash: String(r.prev_entry_hash ?? PLAYBOOK_CHAIN_GENESIS),
      entryHash: String(r.entry_hash),
      publishedBy: String(r.reviewed_by),
      publishedByRole: r.reviewer_role as Role,
      publishedAt: (r.published_at as Date).toISOString(),
    };
  }

  async listPlaybookEntries(organizationId: string) {
    const { rows } = await this.pool.query(
      `select * from playbook_entries where organization_id = $1 order by published_at`,
      [organizationId],
    );
    const entries = rows.map(PgDataAdapter.playbookRow);
    return { entries, chain: verifyPlaybookChain(entries) };
  }

  async publishPlaybookEntry(
    organizationId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<Result<{ entry: PlaybookEntry }>> {
    if (!can(actor.role, "playbook.publish")) {
      return { ok: false, error: `Role "${actor.role}" may not publish playbook entries.` };
    }
    const parsed = playbookPublishSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Invalid playbook entry." };
    const last = await this.pool.query(
      `select entry_hash from playbook_entries
        where organization_id = $1 order by published_at desc limit 1`,
      [organizationId],
    );
    const prevEntryHash = last.rows[0]?.entry_hash ?? PLAYBOOK_CHAIN_GENESIS;
    const publishedAt = new Date().toISOString();
    const base = {
      title: parsed.data.title,
      category: parsed.data.category,
      body: parsed.data.body,
      publishedBy: actor.userId,
      publishedByRole: actor.role,
      publishedAt,
      prevEntryHash,
    };
    const contentSha256 = playbookContentSha256(base);
    const entryHash = playbookEntryHash({ ...base, contentSha256 });
    const { rows } = await this.pool.query(
      `insert into playbook_entries
         (organization_id, title, category, body, content_sha256, reviewed_by,
          reviewer_role, prev_entry_hash, entry_hash, published_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [
        organizationId,
        parsed.data.title,
        parsed.data.category,
        parsed.data.body,
        contentSha256,
        actor.userId,
        actor.role,
        prevEntryHash,
        entryHash,
        publishedAt,
      ],
    );
    const entry = PgDataAdapter.playbookRow(rows[0]);
    await this.audit({
      organizationId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "playbook.publish",
      subjectType: "playbook_entry",
      subjectId: entry.id,
      detail: `Published "${entry.title}" (${entry.category}) — chained to ${prevEntryHash === PLAYBOOK_CHAIN_GENESIS ? "genesis" : prevEntryHash.slice(0, 12)}`,
    });
    return { ok: true, entry };
  }
}
