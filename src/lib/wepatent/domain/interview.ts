import type { CoverageDimension } from "./coverage";
import type { PsState } from "./ps-ledger";

/**
 * Adaptive invention interview — deterministic question engine
 * (Intake Studio PRD §6.2, FR-INT-6).
 *
 * The Slusky-derived methodology here (stage ordering, general→specific,
 * WHAT/HOW separation, far-fetched-alternative probe) is internally
 * authored heuristics — no licensed text is reproduced (invariant 15).
 *
 * Division of labor, encoded structurally:
 * - THIS MODULE (pure code, no model access) owns stage sequence, target
 *   selection, no-repeat accounting, stage gating, skip/unknown handling,
 *   and the advice-refusal classification. Nothing a model returns can
 *   change any of these decisions.
 * - The model (Advanced tier) only drafts the natural-language question
 *   text + optional grouped follow-ups FOR a target the engine chose.
 *   Local mode uses the deterministic templates below through the same
 *   gateway interface.
 */

/* ------------------------------- stages --------------------------------- */

export const INTERVIEW_STAGES = [
  "context_field",
  "problem",
  "solution_concept",
  "implementation",
  "alternatives_breadth",
  "subsidiary_problems",
  "boundaries_completeness",
] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

export const INTERVIEW_STAGE_LABELS: Record<InterviewStage, string> = {
  context_field: "Context & field",
  problem: "The problem",
  solution_concept: "The solution as concept (WHAT)",
  implementation: "Implementation (HOW)",
  alternatives_breadth: "Alternatives & breadth",
  subsidiary_problems: "Subsidiary problems",
  boundaries_completeness: "Boundaries & completeness",
};

export function isInterviewStage(value: string): value is InterviewStage {
  return (INTERVIEW_STAGES as readonly string[]).includes(value);
}

export function stageIndex(stage: InterviewStage): number {
  return INTERVIEW_STAGES.indexOf(stage);
}

/* ------------------------------- targets -------------------------------- */

/**
 * Every candidate question carries a machine-readable target: either a
 * stage topic (general fact-gathering) or an enablement-coverage gap on a
 * specific solution (§6.5 dimension). Refs are stable strings stored on
 * the turn row (`topic:<stage>:<topicId>` / `coverage:<solutionId>:<dim>`).
 */
export type StageTopic = {
  id: string;
  /** Purpose handed to the drafter — what the question must gather. */
  purpose: string;
  /** Optional grouped follow-up purposes (skippable, per §6.1). */
  followupPurposes: string[];
};

export const STAGE_TOPICS: Record<InterviewStage, readonly StageTopic[]> = {
  context_field: [
    {
      id: "field",
      purpose:
        "the technical field or area the invention belongs to, and what exists in that area today",
      followupPurposes: ["what products or methods are commonly used today"],
    },
    {
      id: "users",
      purpose: "who uses or would use this — the people or systems involved",
      followupPurposes: ["in what setting or environment it is used"],
    },
  ],
  problem: [
    {
      id: "deficiency",
      purpose:
        "the deficiency in the prior situation that prompted the work — what was going wrong or missing",
      followupPurposes: ["what consequences that deficiency causes", "who suffers from it"],
    },
    {
      id: "prior_attempts",
      purpose:
        "prior attempts to solve the problem and why each was inadequate",
      followupPurposes: ["what workarounds people use today"],
    },
  ],
  solution_concept: [
    {
      id: "core_insight",
      purpose:
        "the core insight stated as a concept — 'the problem of X is solved by Y' — at the WHAT level, not the implementation",
      followupPurposes: ["a one-sentence articulation of the concept"],
    },
    {
      id: "departure",
      purpose: "what departs from the prior approaches — the difference that matters",
      followupPurposes: [],
    },
  ],
  implementation: [
    {
      id: "structure",
      purpose:
        "the structure: the components, parts, or modules and how they interconnect",
      followupPurposes: ["materials or technologies each part uses"],
    },
    {
      id: "operation",
      purpose:
        "the operation: the steps, sequence, or process by which it works, end to end",
      followupPurposes: ["what happens first, next, and last in normal use"],
    },
    {
      id: "parameters",
      purpose:
        "quantitative parameters, materials, dimensions, or ranges someone would need to build it",
      followupPurposes: ["tolerances or ranges that still work"],
    },
    {
      id: "embodiment_walkthrough",
      purpose:
        "a walkthrough of the preferred embodiment complete enough that a colleague in the field could build it from the answers",
      followupPurposes: ["anything a builder would still have to figure out alone"],
    },
  ],
  alternatives_breadth: [
    {
      id: "alternatives",
      purpose:
        "other ways to implement each element of the solution — substitutable components or approaches",
      followupPurposes: ["which elements have known substitutes"],
    },
    {
      id: "far_fetched_probe",
      purpose:
        "a deliberately far-fetched alternative: an implausible or extreme way the same concept could still be realized — this probes how broad the underlying concept is",
      followupPurposes: [],
    },
    {
      id: "essential_vs_optional",
      purpose: "which parts are essential to the concept and which are optional refinements",
      followupPurposes: [],
    },
  ],
  subsidiary_problems: [
    {
      id: "feature_problems",
      purpose:
        "for each notable feature, the smaller problem that feature itself solves",
      followupPurposes: ["features that exist only to make another feature work"],
    },
  ],
  boundaries_completeness: [
    {
      id: "failure_modes",
      purpose: "known failure modes — conditions where it does not work or works poorly",
      followupPurposes: [],
    },
    {
      id: "operating_limits",
      purpose: "operating limits and the environment it is designed for",
      followupPurposes: [],
    },
    {
      id: "results_measurements",
      purpose: "results, measurements, or test data available that show it works",
      followupPurposes: [],
    },
    {
      id: "terminology",
      purpose:
        "the terms the inventor uses consistently for the key parts, so the record uses one vocabulary",
      followupPurposes: [],
    },
  ],
};

/** Coverage dimensions each stage is responsible for closing (§6.5). */
export const STAGE_COVERAGE_DIMENSIONS: Record<InterviewStage, readonly CoverageDimension[]> = {
  context_field: [],
  problem: ["problem_articulated"],
  solution_concept: ["concept_stated"],
  implementation: ["structure_captured", "operation_captured", "parameters_captured"],
  alternatives_breadth: ["alternatives_captured"],
  subsidiary_problems: [],
  boundaries_completeness: ["how_to_use_captured"],
};

export type QuestionTarget =
  | { kind: "stage_topic"; stage: InterviewStage; topic: StageTopic; ref: string }
  | {
      kind: "coverage_gap";
      stage: InterviewStage;
      solutionId: string;
      dimension: CoverageDimension;
      ref: string;
    };

export function topicRef(stage: InterviewStage, topicId: string): string {
  return `topic:${stage}:${topicId}`;
}

export function coverageRef(solutionId: string, dimension: CoverageDimension): string {
  return `coverage:${solutionId}:${dimension}`;
}

/* --------------------------- engine input/state ------------------------- */

export type EngineSolution = { id: string; statement: string; state: PsState };

export type EngineCoverageRow = {
  solutionId: string;
  dimension: CoverageDimension;
  status: "satisfied" | "gap";
};

export type EngineInput = {
  stage: InterviewStage;
  /** Target refs of turns the user actually answered (never re-asked). */
  answeredTargetRefs: readonly string[];
  /** Target refs the user explicitly skipped or marked unknown. */
  skippedTargetRefs: readonly string[];
  /** What the record already knows — used to pre-fill topics (no re-asking). */
  known: {
    problem: string;
    solution: string;
    businessContext: string;
    factStatements: readonly string[];
  };
  coverage: readonly EngineCoverageRow[];
  solutions: readonly EngineSolution[];
  /** Statements from rejected AI proposals — framings to steer away from. */
  rejectedStatements: readonly string[];
};

/**
 * Topics already answered by the existing record (confirmed facts, intake
 * fields, uploads). The engine never re-asks these (§6.2: "the engine never
 * re-asks what a confirmed fact already answers").
 */
export function prefilledTopicRefs(input: EngineInput): Set<string> {
  const filled = new Set<string>();
  if (input.known.businessContext.trim().length >= 20) {
    filled.add(topicRef("context_field", "field"));
  }
  if (input.known.problem.trim().length >= 20) {
    filled.add(topicRef("problem", "deficiency"));
  }
  if (
    input.known.solution.trim().length >= 20 ||
    input.coverage.some((row) => row.dimension === "concept_stated" && row.status === "satisfied")
  ) {
    filled.add(topicRef("solution_concept", "core_insight"));
  }
  return filled;
}

/**
 * Ordered candidate targets for one stage. Order IS the value ranking
 * (deterministic, most-general-first): the stage's general topics come
 * first in their authored order, then per-solution coverage gaps in
 * solution order then dimension order. Already-answered, skipped, and
 * pre-filled targets never reappear; coverage gaps only exist while the
 * deterministic §6.5 checklist still reports a gap.
 */
export function candidateTargets(stage: InterviewStage, input: EngineInput): QuestionTarget[] {
  const prefilled = prefilledTopicRefs(input);
  const consumed = new Set<string>([
    ...input.answeredTargetRefs,
    ...input.skippedTargetRefs,
    ...prefilled,
  ]);
  const targets: QuestionTarget[] = [];

  for (const topic of STAGE_TOPICS[stage]) {
    const ref = topicRef(stage, topic.id);
    if (!consumed.has(ref)) {
      targets.push({ kind: "stage_topic", stage, topic, ref });
    }
  }

  const solutionOrder = input.solutions.map((solution) => solution.id);
  const dims = STAGE_COVERAGE_DIMENSIONS[stage];
  for (const solutionId of solutionOrder) {
    for (const dimension of dims) {
      const row = input.coverage.find(
        (candidate) => candidate.solutionId === solutionId && candidate.dimension === dimension,
      );
      if (!row || row.status !== "gap") continue;
      const ref = coverageRef(solutionId, dimension);
      if (consumed.has(ref)) continue;
      targets.push({ kind: "coverage_gap", stage, solutionId, dimension, ref });
    }
  }
  return targets;
}

/**
 * Stage gate (§6.2): a stage is complete when every candidate target is
 * answered, skipped, or pre-filled — i.e. minimum coverage reached or the
 * user explicitly declined the rest. Pure code; no model discretion.
 */
export function isStageComplete(stage: InterviewStage, input: EngineInput): boolean {
  return candidateTargets(stage, input).length === 0;
}

export type NextSelection =
  | { done: true }
  | { done: false; stage: InterviewStage; target: QuestionTarget };

/**
 * Deterministic selection: from the current stage forward, the first stage
 * with an unfilled target yields its highest-ranked (most general) target.
 * Same input always selects the same target.
 */
export function selectNextTarget(input: EngineInput): NextSelection {
  const startIndex = Math.max(0, stageIndex(input.stage));
  for (let index = startIndex; index < INTERVIEW_STAGES.length; index += 1) {
    const stage = INTERVIEW_STAGES[index];
    const targets = candidateTargets(stage, { ...input, stage });
    if (targets.length > 0) {
      return { done: false, stage, target: targets[0] };
    }
  }
  return { done: true };
}

/** Refs to mark skipped when the user explicitly skips the whole stage. */
export function stageSkipRefs(stage: InterviewStage, input: EngineInput): string[] {
  return candidateTargets(stage, input).map((target) => target.ref);
}

/* -------------------- deterministic question templates ------------------ */

/**
 * Local-mode question drafter (deterministic, exercises the same gateway
 * interface production uses). Production replaces the wording with an
 * Advanced-tier model draft — but ONLY the wording: target, stage, and
 * follow-up topics come from the engine either way.
 */
export function deterministicQuestionText(target: QuestionTarget): {
  questionText: string;
  followups: string[];
} {
  if (target.kind === "stage_topic") {
    return {
      questionText: `Please describe ${target.topic.purpose}.`,
      followups: target.topic.followupPurposes.map(
        (purpose) => `If it helps, also cover ${purpose}.`,
      ),
    };
  }
  const dimensionAsk: Record<CoverageDimension, string> = {
    problem_articulated: "What problem does this solution address?",
    concept_stated: "State this solution as a concept: the problem of X is solved by Y.",
    structure_captured:
      "What components or parts implement this solution, and how are they connected?",
    operation_captured: "How does this solution operate, step by step?",
    alternatives_captured:
      "What other ways could this solution be implemented? Include at least one far-fetched alternative.",
    parameters_captured:
      "What parameters, materials, dimensions, or ranges would someone need to build this?",
    how_to_use_captured: "How does someone actually use this in practice?",
  };
  return {
    questionText: `About the solution on your ledger: ${dimensionAsk[target.dimension]}`,
    followups: [],
  };
}

/* ------------------- UPL rails: advice-seeking classifier ---------------- */

/**
 * FIXED counsel-referral template (§6.4). The response to an advice-seeking
 * turn is ALWAYS this exact text — never model-generated. Changing this
 * wording is approval-gated (feature PRD §15.5).
 */
export const COUNSEL_REFERRAL_TEMPLATE = [
  "wepatent collects facts about your invention; it does not give legal advice.",
  "Whether to file, what is patentable, how broad protection could be, and similar questions are legal judgments only qualified patent counsel can make for your situation.",
  "You can request a counsel introduction anytime from your workspace (Counsel requests).",
  "When you're ready, the interview will continue with the same fact question.",
].join(" ");

/**
 * Deterministic advice-seeking classifier (§6.4). Pattern layer is code; a
 * cheap model assist MAY be added later but the response stays the fixed
 * template either way. Patterns are anchored on first/second-person legal
 * decision-seeking so ordinary factual answers do not trip them.
 */
const ADVICE_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  {
    id: "should_i_file",
    pattern:
      /\bshould\s+(i|we)\b[\s\S]{0,120}?\b(file|patent|provisional|disclose|publish|submit|claim|wait|trade\s*secret)\b/i,
  },
  {
    id: "when_to_file",
    pattern: /\bwhen\s+(should|do|must)\s+(i|we)\b[\s\S]{0,80}?\bfil(e|ing)\b/i,
  },
  { id: "patentable", pattern: /\bpatentab(le|ility)\b/i },
  {
    id: "get_a_patent",
    pattern: /\b(can|could|will|would|do)\s+(i|we)\s+(get|obtain|win|be\s+granted)\s+a\s+patent\b/i,
  },
  { id: "claim_breadth", pattern: /\bhow\s+broad(ly)?\b[\s\S]{0,80}?\bclaims?\b/i },
  { id: "claim_scope", pattern: /\bclaim\s+scope\b/i },
  { id: "what_to_claim", pattern: /\bwhat\s+should\s+(i|we)\s+claim\b/i },
  { id: "legal_advice", pattern: /\blegal\s+(advice|opinion)\b/i },
  {
    id: "infringement",
    pattern: /\b(am\s+i|are\s+we|do\s+(i|we)|would\s+(i|we))\b[\s\S]{0,60}?\binfring\w*\b/i,
  },
  { id: "freedom_to_operate", pattern: /\bfreedom\s+to\s+operate\b/i },
  {
    id: "prior_art_opinion",
    pattern: /\b(is|does)\s+(this|it|that)\b[\s\S]{0,60}?\b(novel|obvious|prior\s+art)\b/i,
  },
  {
    id: "need_lawyer",
    pattern: /\bdo\s+(i|we)\s+(really\s+)?need\s+(a\s+)?(lawyer|attorney|counsel|patent)\b/i,
  },
];

export type AdviceClassification = { adviceSeeking: boolean; matchedRule: string | null };

export function classifyAdviceSeeking(text: string): AdviceClassification {
  const normalized = text.normalize("NFKC");
  for (const rule of ADVICE_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return { adviceSeeking: true, matchedRule: rule.id };
    }
  }
  return { adviceSeeking: false, matchedRule: null };
}

/* ----------------------------- turn kinds -------------------------------- */

export const ANSWER_KINDS = ["answer", "skip", "unknown", "advice_referral"] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export const SESSION_STATUSES = ["active", "paused", "completed"] as const;
export type InterviewSessionStatus = (typeof SESSION_STATUSES)[number];

/** Fact category for the deterministic answer-of-record by stage. */
export function factCategoryForStage(stage: InterviewStage): "technical" | "business" {
  return stage === "context_field" ? "business" : "technical";
}

/**
 * Honest progress (§6.1): stage position + coverage, never a fake percent.
 */
export type InterviewProgress = {
  stage: InterviewStage;
  stageLabel: string;
  stageNumber: number;
  stageCount: number;
  coverageSatisfied: number;
  coverageTotal: number;
};

export function interviewProgress(
  stage: InterviewStage,
  coverage: { satisfied: number; total: number },
): InterviewProgress {
  return {
    stage,
    stageLabel: INTERVIEW_STAGE_LABELS[stage],
    stageNumber: stageIndex(stage) + 1,
    stageCount: INTERVIEW_STAGES.length,
    coverageSatisfied: coverage.satisfied,
    coverageTotal: coverage.total,
  };
}

/* ------------------- components-panel gating (M4 chat) ------------------- */

/**
 * The interview's right-hand components panel is GATED: it does not render
 * at all until the record carries enough information to distill components
 * (Jeff's direction, 2026-08-05 — "invention components should populate in
 * a box on the right side that appears only after there is enough
 * information to distill components"). Before that, the interview is one
 * thread and nothing else; no box of zeros greets a user who has not
 * answered a question yet.
 *
 * ONE predicate decides this, and both the server render and the live
 * client update call it, so the two can never disagree.
 *
 * The signal is real extraction output, never a turn counter on its own:
 *
 *  - `componentCount` — components the extraction pass actually produced
 *    (or the user added). One is enough: there is something to show.
 *  - `substantiveAnswerCount` — turns answered with real text. Skips,
 *    "I don't know", and advice referrals do not count; they produce no
 *    extraction input.
 *  - `extractedItemCount` — problem/solution items the interview's own
 *    extraction produced. Non-zero means extraction is finding structure
 *    in this record even though it has not named a discrete part yet.
 *
 * The second arm exists so a record whose answers are prose-heavy still
 * gets the panel once extraction is demonstrably working on it; it needs
 * BOTH enough substantive answers AND real extracted items, so it can
 * never fire on turn count alone.
 */
export const COMPONENTS_PANEL_MIN_SUBSTANTIVE_ANSWERS = 3;

export type ComponentsPanelSignal = {
  /** Components on the record right now (any state). */
  componentCount: number;
  /** Turns answered with substantive text (not skip/unknown/referral). */
  substantiveAnswerCount: number;
  /** P/S ledger items this interview's extraction produced. */
  extractedItemCount: number;
};

export function shouldShowComponentsPanel(signal: ComponentsPanelSignal): boolean {
  if (signal.componentCount >= 1) return true;
  return (
    signal.substantiveAnswerCount >= COMPONENTS_PANEL_MIN_SUBSTANTIVE_ANSWERS &&
    signal.extractedItemCount >= 1
  );
}
