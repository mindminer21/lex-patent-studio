import { z } from "zod";

/**
 * Staged invention intake (PRD §7.3).
 *
 * Eight ordered stages. Users can save and resume any stage; a stage is only
 * marked complete when its data validates. Submission requires stages 1–7
 * complete plus the review confirmation. The intake collects facts and labels
 * unresolved issues — it never auto-populates legal conclusions.
 */
export const INTAKE_STAGES = [
  { key: "identity", title: "Identity and business context" },
  { key: "problem_solution", title: "Problem and technical solution" },
  { key: "components", title: "Components, steps, alternatives, and advantages" },
  { key: "contributors", title: "Contributors and contribution facts" },
  { key: "timeline", title: "Disclosure and commercialization timeline" },
  { key: "ownership", title: "Ownership and assignment fact collection" },
  { key: "sources", title: "Source upload and extraction" },
  { key: "review", title: "Review and submission" },
] as const;

export type IntakeStageKey = (typeof INTAKE_STAGES)[number]["key"];

export const INTAKE_STAGE_KEYS: readonly IntakeStageKey[] = INTAKE_STAGES.map((s) => s.key);

const TEXT_LIMIT = 8_000;
const shortText = z.string().trim().min(1).max(400);

export const identitySchema = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(10).max(TEXT_LIMIT),
  businessContext: z.string().trim().max(TEXT_LIMIT).optional().default(""),
});

export const problemSolutionSchema = z.object({
  problem: z.string().trim().min(10).max(TEXT_LIMIT),
  solution: z.string().trim().min(10).max(TEXT_LIMIT),
});

export const componentSchema = z.object({
  name: shortText,
  description: z.string().trim().max(TEXT_LIMIT).optional().default(""),
});

export const componentsSchema = z.object({
  components: z.array(componentSchema).min(1).max(100),
  steps: z.array(shortText).max(100).optional().default([]),
  alternatives: z.string().trim().max(TEXT_LIMIT).optional().default(""),
  advantages: z.string().trim().max(TEXT_LIMIT).optional().default(""),
});

export const contributorSchema = z.object({
  name: shortText,
  email: z.email().optional(),
  contribution: z.string().trim().min(3).max(TEXT_LIMIT),
});

export const contributorsSchema = z.object({
  contributors: z.array(contributorSchema).min(1).max(50),
});

export const DISCLOSURE_EVENT_KINDS = [
  "disclosure",
  "publication",
  "sale_or_offer",
  "public_use_or_demo",
  "funding_or_diligence",
  "other",
] as const;

export const timelineEventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  kind: z.enum(DISCLOSURE_EVENT_KINDS),
  description: z.string().trim().min(3).max(TEXT_LIMIT),
  underNda: z.boolean().optional().default(false),
});

export const timelineSchema = z
  .object({
    events: z.array(timelineEventSchema).max(200),
    noEventsConfirmed: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.events.length === 0 && !value.noEventsConfirmed) {
      ctx.addIssue({
        code: "custom",
        path: ["events"],
        message: "Add at least one event, or confirm there are no disclosure events yet.",
      });
    }
  });

export const ownershipSchema = z.object({
  // Fact collection only — the machine records answers and open questions;
  // it never concludes who owns the invention.
  employmentAgreementsExist: z.enum(["yes", "no", "unsure"]),
  assignmentsExecuted: z.enum(["yes", "no", "unsure"]),
  thirdPartyObligations: z.string().trim().max(TEXT_LIMIT).optional().default(""),
  openQuestions: z.string().trim().max(TEXT_LIMIT).optional().default(""),
});

export const sourceEntrySchema = z.object({
  name: shortText,
  kind: z.enum(["lab_notebook", "design_doc", "code", "presentation", "data", "image", "other"]),
  note: z.string().trim().max(1000).optional().default(""),
});

export const sourcesSchema = z
  .object({
    sources: z.array(sourceEntrySchema).max(100),
    noSourcesConfirmed: z.boolean().optional().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.sources.length === 0 && !value.noSourcesConfirmed) {
      ctx.addIssue({
        code: "custom",
        path: ["sources"],
        message: "List at least one source, or confirm you have none to register yet.",
      });
    }
  });

export const reviewSchema = z.object({
  confirmAccuracy: z.literal(true),
});

export const STAGE_SCHEMAS: Record<IntakeStageKey, z.ZodTypeAny> = {
  identity: identitySchema,
  problem_solution: problemSolutionSchema,
  components: componentsSchema,
  contributors: contributorsSchema,
  timeline: timelineSchema,
  ownership: ownershipSchema,
  sources: sourcesSchema,
  review: reviewSchema,
};

export type IntakeState = {
  /** Raw (possibly partial/invalid) saved data for resume. */
  stageData: Partial<Record<IntakeStageKey, unknown>>;
  /** Stages whose data has passed validation. */
  completed: IntakeStageKey[];
};

export function emptyIntakeState(): IntakeState {
  return { stageData: {}, completed: [] };
}

export function stageIndex(stage: IntakeStageKey): number {
  return INTAKE_STAGE_KEYS.indexOf(stage);
}

/** A stage is enterable when every earlier stage is complete. */
export function canEnterStage(state: IntakeState, stage: IntakeStageKey): boolean {
  const idx = stageIndex(stage);
  return INTAKE_STAGE_KEYS.slice(0, idx).every((key) => state.completed.includes(key));
}

export function firstIncompleteStage(state: IntakeState): IntakeStageKey {
  return INTAKE_STAGE_KEYS.find((key) => !state.completed.includes(key)) ?? "review";
}

/** Save raw stage data without validation (save & resume). */
export function saveStageDraft(
  state: IntakeState,
  stage: IntakeStageKey,
  data: unknown,
): IntakeState {
  return {
    stageData: { ...state.stageData, [stage]: data },
    // Editing a stage invalidates its completed status until revalidated.
    completed: state.completed.filter((key) => key !== stage),
  };
}

export type StageCompletionResult =
  | { ok: true; state: IntakeState; data: unknown }
  | { ok: false; error: "stage_locked" | "validation_failed"; issues?: string[] };

/** Validate stage data and mark the stage complete. */
export function completeStage(
  state: IntakeState,
  stage: IntakeStageKey,
  data: unknown,
): StageCompletionResult {
  if (!canEnterStage(state, stage)) {
    return { ok: false, error: "stage_locked" };
  }
  const parsed = STAGE_SCHEMAS[stage].safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation_failed",
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    };
  }
  const completed = state.completed.includes(stage)
    ? state.completed
    : [...state.completed, stage];
  return {
    ok: true,
    data: parsed.data,
    state: { stageData: { ...state.stageData, [stage]: parsed.data }, completed },
  };
}

/** Submission requires every stage, including review, to be complete. */
export function canSubmit(state: IntakeState): boolean {
  return INTAKE_STAGE_KEYS.every((key) => state.completed.includes(key));
}

/* ------------------------------------------------------------------ */
/* Line-format parsing helpers for keyboard-friendly server-rendered   */
/* list entry. Formats are documented next to each textarea.           */
/* ------------------------------------------------------------------ */

export function parseComponentLines(text: string): Array<z.infer<typeof componentSchema>> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(" — ");
      return { name: (name ?? "").trim(), description: rest.join(" — ").trim() };
    });
}

export function parseContributorLines(text: string): Array<{
  name: string;
  email?: string;
  contribution: string;
}> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [who, ...rest] = line.split(" — ");
      const contribution = rest.join(" — ").trim();
      const emailMatch = /<([^>]+)>/.exec(who ?? "");
      const name = (who ?? "").replace(/<[^>]*>/, "").trim();
      return emailMatch
        ? { name, email: emailMatch[1].trim(), contribution }
        : { name, contribution };
    });
}

export function parseTimelineLines(text: string): Array<{
  date: string;
  kind: string;
  description: string;
  underNda: boolean;
}> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, kind, ...rest] = line.split("|").map((part) => part.trim());
      const description = rest.join(" | ");
      const underNda = /\(nda\)/i.test(description);
      return {
        date: date ?? "",
        kind: kind ?? "",
        description: description.replace(/\(nda\)/i, "").trim(),
        underNda,
      };
    });
}

export function parseSourceLines(text: string): Array<{
  name: string;
  kind: string;
  note: string;
}> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, kind, ...rest] = line.split("|").map((part) => part.trim());
      return { name: name ?? "", kind: kind ?? "other", note: rest.join(" | ") };
    });
}
