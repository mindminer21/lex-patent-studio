import { describe, expect, it } from "vitest";
import {
  allCategorisedTasks,
  categoryForJob,
  categoryForLexWorkflow,
  categoryForModelTask,
  categoryForWepatentWorkflow,
  LEX_STAGE_CATEGORY,
  LEX_WORKFLOW_CATEGORY,
  lexStageCategory,
  MODEL_TASK_CATEGORY,
  MODEL_TASK_KINDS,
  multiplierForTaskCategory,
  WEPATENT_JOB_CATEGORY,
  WEPATENT_WORKFLOW_CATEGORY,
  WORKFLOW_KEYS,
} from "@/lib/shared/billing/task-category";
import { BILLING_CATEGORIES, MARKUP_MULTIPLIERS } from "@/lib/shared/billing/markup";
import { RUN_STATES } from "@/lib/domain/run-state";

/**
 * CATEGORY EXHAUSTIVENESS (Jeff's directive, 2026-08-04).
 *
 * The `Record<K, …>` shape of every table already makes a missing category a
 * COMPILE error. These tests are the runtime half of the same guarantee, and
 * they are what fails the build if a union is ever widened to `string`.
 */

/** Every job kind the wepatent runtime knows about. */
const ALL_JOB_KINDS = [
  "generation",
  "draft_pass_1",
  "draft_pass_2",
  "source_scan",
  "source_extraction",
  "source_interpretation",
  "distillation",
  "export_render",
  "figure_plan",
  "figure_generate",
  "figure_compose",
  "figure_validate",
] as const;

const ALL_WEPATENT_WORKFLOWS = [
  "invention_disclosure_summary",
  "counsel_question_list",
  "gap_analysis",
] as const;

describe("every task has exactly one category", () => {
  it("categorises every wepatent draft workflow", () => {
    for (const workflow of ALL_WEPATENT_WORKFLOWS) {
      expect(
        Object.hasOwn(WEPATENT_WORKFLOW_CATEGORY, workflow),
        `wepatent workflow "${workflow}" has no billing category`,
      ).toBe(true);
    }
    expect(Object.keys(WEPATENT_WORKFLOW_CATEGORY).sort()).toEqual(
      [...ALL_WEPATENT_WORKFLOWS].sort(),
    );
  });

  it("categorises every wepatent job kind", () => {
    for (const kind of ALL_JOB_KINDS) {
      expect(
        Object.hasOwn(WEPATENT_JOB_CATEGORY, kind),
        `job kind "${kind}" has no billing category`,
      ).toBe(true);
    }
    expect(Object.keys(WEPATENT_JOB_CATEGORY).sort()).toEqual([...ALL_JOB_KINDS].sort());
  });

  it("categorises every Lex workflow key", () => {
    for (const key of WORKFLOW_KEYS) {
      expect(
        Object.hasOwn(LEX_WORKFLOW_CATEGORY, key),
        `Lex workflow "${key}" has no billing category`,
      ).toBe(true);
    }
    expect(Object.keys(LEX_WORKFLOW_CATEGORY).sort()).toEqual([...WORKFLOW_KEYS].sort());
  });

  it("categorises every model-gateway task kind", () => {
    for (const kind of MODEL_TASK_KINDS) {
      expect(Object.hasOwn(MODEL_TASK_CATEGORY, kind)).toBe(true);
    }
    expect(Object.keys(MODEL_TASK_CATEGORY).sort()).toEqual([...MODEL_TASK_KINDS].sort());
  });

  it("categorises every Lex run state", () => {
    for (const state of RUN_STATES) {
      expect(
        Object.hasOwn(LEX_STAGE_CATEGORY, state),
        `Lex run state "${state}" has no billing category`,
      ).toBe(true);
    }
  });

  it("only ever uses a category the markup catalog prices (or null)", () => {
    for (const row of allCategorisedTasks()) {
      if (row.category === null) continue;
      expect(
        BILLING_CATEGORIES,
        `${row.table}.${row.task} has unknown category ${row.category}`,
      ).toContain(row.category);
    }
  });

  it("has no task left uncategorised by omission (undefined is not null)", () => {
    for (const row of allCategorisedTasks()) {
      expect(row.category, `${row.table}.${row.task} is undefined`).not.toBe(undefined);
    }
  });
});

describe("the classification Jeff signed off on", () => {
  it("prices wepatent generation tasks at 2.0", () => {
    expect(categoryForWepatentWorkflow("invention_disclosure_summary")).toBe("generation");
    expect(categoryForJob("draft_pass_1")).toBe("generation");
    expect(categoryForJob("draft_pass_2")).toBe("generation");
    expect(categoryForJob("figure_plan")).toBe("generation");
    expect(categoryForModelTask("application_draft")).toBe("generation");
    expect(categoryForModelTask("illustrations_brief")).toBe("generation");
    expect(categoryForModelTask("draft_revision")).toBe("generation");
    expect(categoryForModelTask("line_art")).toBe("generation");
    expect(categoryForModelTask("diagram_plan_text")).toBe("generation");
  });

  it("prices wepatent analysis tasks at 1.5", () => {
    expect(categoryForJob("source_extraction")).toBe("analysis");
    expect(categoryForJob("source_interpretation")).toBe("analysis");
    expect(categoryForJob("distillation")).toBe("analysis");
    expect(categoryForModelTask("transcription")).toBe("analysis");
    expect(categoryForModelTask("interview_question")).toBe("analysis");
    expect(categoryForModelTask("interview_answer_extraction")).toBe("analysis");
    expect(categoryForModelTask("coverage_scoring")).toBe("analysis");
    expect(categoryForModelTask("reconciliation_check")).toBe("analysis");
    expect(categoryForModelTask("routing")).toBe("analysis");
  });

  it("charges nothing for the deterministic jobs", () => {
    for (const kind of ["figure_compose", "figure_validate", "source_scan", "export_render"] as const) {
      expect(categoryForJob(kind)).toBeNull();
      expect(multiplierForTaskCategory(categoryForJob(kind))).toBe(1);
    }
  });

  it("prices Lex drafting workflows at 2.0 — the correction to the earlier round", () => {
    for (const key of [
      "section_draft",
      "claim_tree_draft",
      "dependent_claim_draft",
      "oa_response_draft",
      "research_memo",
      "search_report",
      "declaration_132",
    ] as const) {
      expect(categoryForLexWorkflow(key), key).toBe("generation");
      expect(multiplierForTaskCategory(categoryForLexWorkflow(key))).toBe(2.0);
    }
  });

  it("prices Lex extraction/classification workflows at 1.5", () => {
    for (const key of [
      "ids_packet",
      "formalities_check",
      "status_digest",
      "invention_intake",
      "fact_extraction",
      "oa_analysis",
    ] as const) {
      expect(categoryForLexWorkflow(key), key).toBe("analysis");
      expect(multiplierForTaskCategory(categoryForLexWorkflow(key))).toBe(1.5);
    }
  });

  it("does not let the stage NAMED 'GENERATING' force the generation rate", () => {
    // An analysis workflow's middle stage is still analysis.
    expect(lexStageCategory("GENERATING", "oa_analysis")).toBe("analysis");
    expect(lexStageCategory("GENERATING", "section_draft")).toBe("generation");
    // Grounding and critique around it are always analysis.
    expect(lexStageCategory("RETRIEVING", "section_draft")).toBe("analysis");
    expect(lexStageCategory("VERIFYING", "section_draft")).toBe("analysis");
    expect(lexStageCategory("RENDERING", "section_draft")).toBeNull();
  });
});

describe("analysis math is unchanged by this directive", () => {
  it("keeps every analysis task at exactly the pre-change 1.5", () => {
    expect(MARKUP_MULTIPLIERS.analysis).toBe(1.5);
    for (const row of allCategorisedTasks()) {
      if (row.category !== "analysis") continue;
      expect(multiplierForTaskCategory(row.category), row.task).toBe(1.5);
    }
  });

  it("resolves a null category to a multiplier of 1 (nothing spent, nothing marked up)", () => {
    expect(multiplierForTaskCategory(null)).toBe(1);
  });
});
