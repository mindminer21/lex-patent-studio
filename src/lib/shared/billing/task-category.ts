/**
 * THE EXHAUSTIVE TASK → BILLING CATEGORY TABLE (Jeff's directive, 2026-08-04).
 *
 * "Change the PRD to implement a 2x token cost rule for any task performed
 * that requires generation."
 *
 * The rule is by TASK TYPE, not by provider and not by output media. Every
 * billable model call in either product is named here exactly once with the
 * category that decides its retail multiplier:
 *
 *   generation → 2.0×   analysis → 1.5×
 *
 * HOW EXHAUSTIVENESS IS ENFORCED
 * ------------------------------
 * Every table below is a `Record<K, …>` over a closed literal union. Adding a
 * value to `JobKind`, `DraftWorkflow`, `WorkflowKey`, or `ModelTaskKind`
 * without adding a row here is a TYPE ERROR — `tsc --noEmit` fails, so `npm
 * run build` fails. `tests/task-category.test.ts` and
 * `src/lib/shared/billing/task-category.test.ts` additionally enumerate the
 * runtime const arrays, so a union that is widened to `string` somewhere
 * still cannot slip a category-less task through.
 *
 * A `null` category means "this task performs no billable model call at all"
 * — a deterministic composition, a virus scan, a PDF render. `null` is a
 * deliberate, reviewed statement, not a default: it is spelled out per row
 * for the same reason the categories are.
 */
import type { BillingCategory } from "./markup";
import { markupMultiplierFor } from "./markup";
import type { WorkflowKey } from "@/lib/domain/tiers";
import { WORKFLOW_KEYS } from "@/lib/domain/tiers";
import type { DraftWorkflow, JobKind } from "@/lib/server/adapters/types";

/** `null` = performs no billable model call. */
export type TaskBillingCategory = BillingCategory | null;

/* ------------------------------------------------------------------ */
/* Model-gateway task kinds (both lanes call through the same port)    */
/* ------------------------------------------------------------------ */

/**
 * One entry per `ModelGatewayPort` method that spends money, plus the two
 * new three-pass calls. Named by task, not by method, so the same table
 * reads the same way to a non-engineer.
 */
export const MODEL_TASK_KINDS = [
  "application_draft",
  "illustrations_brief",
  "draft_revision",
  "line_art",
  "diagram_plan_text",
  "source_interpretation",
  "record_distillation",
  "interview_question",
  "interview_answer_extraction",
  "transcription",
  "coverage_scoring",
  "reconciliation_check",
  "retrieval_grounding",
  "critique_verification",
  "routing",
] as const;
export type ModelTaskKind = (typeof MODEL_TASK_KINDS)[number];

export const MODEL_TASK_CATEGORY: Readonly<Record<ModelTaskKind, TaskBillingCategory>> = {
  /* -------------------------- generation (2.0×) ------------------------- */
  /** Pass 1 and Pass 2 both author the application itself. */
  application_draft: "generation",
  /** Pass 1's illustrations brief: authored figure list, views, numerals. */
  illustrations_brief: "generation",
  /** Pass 2's enablement re-draft against the actual figures. */
  draft_revision: "generation",
  /** Layer-1 patent line art (image generation). */
  line_art: "generation",
  /**
   * Deterministic-diagram planning that AUTHORS TEXT — figure titles, Brief
   * Description sentences, callout labels. The geometry is deterministic;
   * the prose that ships with it is newly authored work product.
   */
  diagram_plan_text: "generation",

  /* --------------------------- analysis (1.5×) -------------------------- */
  /** Reads an uploaded source and structures what is already in it. */
  source_interpretation: "analysis",
  /** Deduplicates and clusters existing problem/solution material. */
  record_distillation: "analysis",
  /** A conversational step, not a deliverable (Jeff's carve-out). */
  interview_question: "analysis",
  /** Pulls proposed facts out of an answer the user just gave. */
  interview_answer_extraction: "analysis",
  transcription: "analysis",
  /** §112(a) coverage scoring: measures the record, authors nothing. */
  coverage_scoring: "analysis",
  /** Two-way §608.02 prose ↔ drawings check: verification. */
  reconciliation_check: "analysis",
  /** Corpus/knowledge retrieval and grounding. */
  retrieval_grounding: "analysis",
  /** Second-model critique (Lex FR-6): checks, does not author. */
  critique_verification: "analysis",
  /** Picks which workflow/model handles a request. */
  routing: "analysis",
};

/* ------------------------------------------------------------------ */
/* wepatent: draft workflows                                           */
/* ------------------------------------------------------------------ */

export const WEPATENT_WORKFLOW_CATEGORY: Readonly<
  Record<DraftWorkflow, TaskBillingCategory>
> = {
  /**
   * The disclosure summary IS the deliverable prose in the counsel package.
   */
  invention_disclosure_summary: "generation",
  /**
   * BORDERLINE (flagged for Jeff). A list of questions to put to counsel is
   * authored text that ships in the export, so it bills as generation, even
   * though the *interview* question drafting inside a session is analysis.
   * The distinction is deliverable vs. conversational, per Jeff's carve-out.
   */
  counsel_question_list: "generation",
  /**
   * BORDERLINE (flagged for Jeff). Classified analysis: a gap analysis
   * measures the record against a coverage model and reports what is
   * missing. It scores; it does not author the application.
   */
  gap_analysis: "analysis",
};

/* ------------------------------------------------------------------ */
/* wepatent: durable job kinds                                         */
/* ------------------------------------------------------------------ */

export const WEPATENT_JOB_CATEGORY: Readonly<Record<JobKind, TaskBillingCategory>> = {
  /** Legacy single-shot generation (superseded by the two passes). */
  generation: "generation",
  /** Three-pass flow: Pass 1 authors draft + illustrations brief. */
  draft_pass_1: "generation",
  /** Three-pass flow: Pass 2 re-drafts against the produced figures. */
  draft_pass_2: "generation",
  /**
   * Runs the whole figure pipeline. MIXED by nature — deterministic-diagram
   * prose and line art at 2.0, the validation pass at 1.5 — and settles per
   * component. The headline category is generation because that is what the
   * job exists to produce and what the estimate is dominated by.
   */
  figure_plan: "generation",
  figure_generate: "generation",
  /** Deterministic sheet composition: no model call. */
  figure_compose: null,
  /** Deterministic rule checks: no model call. */
  figure_validate: null,
  /** ClamAV-style scan: no model call. */
  source_scan: null,
  /** OCR / text extraction from an upload. */
  source_extraction: "analysis",
  source_interpretation: "analysis",
  distillation: "analysis",
  /** Deterministic DOCX/PDF rendering: no model call. */
  export_render: null,
};

/* ------------------------------------------------------------------ */
/* Lex Patent Studio: workflow keys                                    */
/* ------------------------------------------------------------------ */

/**
 * Lex's drafting workflows are generation — this is the correction Jeff
 * called out. The earlier round left the whole Lex lane at 1.5 on the
 * reasoning that Lex had no image generation; the rule is by task type, so
 * Lex's drafting, claim, OA-response, memo, and search-report workflows are
 * generation and always were.
 */
export const LEX_WORKFLOW_CATEGORY: Readonly<Record<WorkflowKey, TaskBillingCategory>> = {
  /* -------------------------- generation (2.0×) ------------------------- */
  /** Specification sections — the three-pass drafting flow's Pass 1/Pass 2. */
  section_draft: "generation",
  claim_tree_draft: "generation",
  dependent_claim_draft: "generation",
  oa_response_draft: "generation",
  research_memo: "generation",
  search_report: "generation",
  declaration_132: "generation",
  /**
   * BORDERLINE (flagged for Jeff). Tier C decision support. Classified
   * generation: the deliverable is an authored options brief handed to the
   * practitioner, even though its subject matter is analysis.
   */
  response_path_options: "generation",
  /** BORDERLINE — same reasoning as response_path_options. */
  claim_scope_strategy: "generation",
  /** BORDERLINE — same reasoning as response_path_options. */
  filing_strategy_options: "generation",

  /* --------------------------- analysis (1.5×) -------------------------- */
  /** Reference extraction, citation classification, SB/08 field validation. */
  ids_packet: "analysis",
  /** Rule checks against a filing. */
  formalities_check: "analysis",
  /**
   * BORDERLINE (flagged for Jeff). Classified analysis: a status digest
   * summarises docket state that already exists rather than authoring new
   * work product.
   */
  status_digest: "analysis",
  /** Structured capture of a disclosure — extraction. */
  invention_intake: "analysis",
  fact_extraction: "analysis",
  /** Parses rejections into an evidence-linked matrix — classification. */
  oa_analysis: "analysis",
};

/* ------------------------------------------------------------------ */
/* Lex: run-pipeline stages                                            */
/* ------------------------------------------------------------------ */

/**
 * A Lex run walks QUEUED → INGESTING → RETRIEVING → GENERATING → VERIFYING
 * → RENDERING. Only GENERATING inherits the workflow's own category; the
 * surrounding stages are what they say they are.
 */
export const LEX_STAGE_CATEGORY = {
  QUEUED: null,
  INGESTING: "analysis",
  RETRIEVING: "analysis",
  /** Inherits the workflow category — resolve with `lexStageCategory`. */
  GENERATING: "generation",
  VERIFYING: "analysis",
  RENDERING: null,
  COMPLETED: null,
  FAILED: null,
  CANCELLED: null,
} as const satisfies Record<string, TaskBillingCategory>;

export type LexStage = keyof typeof LEX_STAGE_CATEGORY;

/**
 * The category a Lex run stage bills at. GENERATING defers to the workflow
 * so an analysis workflow (say `oa_analysis`) does not pay the generation
 * multiplier merely because its middle stage is called "GENERATING".
 */
export function lexStageCategory(
  stage: LexStage,
  workflow: WorkflowKey,
): TaskBillingCategory {
  if (stage === "GENERATING") return LEX_WORKFLOW_CATEGORY[workflow];
  return LEX_STAGE_CATEGORY[stage];
}

/* ------------------------------------------------------------------ */
/* Lookup helpers                                                      */
/* ------------------------------------------------------------------ */

export function categoryForModelTask(kind: ModelTaskKind): TaskBillingCategory {
  return MODEL_TASK_CATEGORY[kind];
}

export function categoryForWepatentWorkflow(workflow: DraftWorkflow): TaskBillingCategory {
  return WEPATENT_WORKFLOW_CATEGORY[workflow];
}

export function categoryForJob(kind: JobKind): TaskBillingCategory {
  return WEPATENT_JOB_CATEGORY[kind];
}

export function categoryForLexWorkflow(workflow: WorkflowKey): TaskBillingCategory {
  return LEX_WORKFLOW_CATEGORY[workflow];
}

/**
 * The multiplier for a task category. A `null` category (no model call)
 * resolves to 1 — nothing is marked up because nothing was spent.
 */
export function multiplierForTaskCategory(category: TaskBillingCategory): number {
  if (category === null) return 1;
  return markupMultiplierFor(category);
}

/** Every task name in every table, for the exhaustiveness tests. */
export function allCategorisedTasks(): Array<{
  table: string;
  task: string;
  category: TaskBillingCategory;
}> {
  const rows: Array<{ table: string; task: string; category: TaskBillingCategory }> = [];
  for (const [task, category] of Object.entries(MODEL_TASK_CATEGORY)) {
    rows.push({ table: "model_task", task, category });
  }
  for (const [task, category] of Object.entries(WEPATENT_WORKFLOW_CATEGORY)) {
    rows.push({ table: "wepatent_workflow", task, category });
  }
  for (const [task, category] of Object.entries(WEPATENT_JOB_CATEGORY)) {
    rows.push({ table: "wepatent_job", task, category });
  }
  for (const [task, category] of Object.entries(LEX_WORKFLOW_CATEGORY)) {
    rows.push({ table: "lex_workflow", task, category });
  }
  return rows;
}

/** The Lex workflow keys, re-exported so tests need one import. */
export { WORKFLOW_KEYS };
