import { isUnresolved } from "@/lib/wepatent/domain/facts";
import { getModelTier, type ModelTier } from "../../model-registry";
import type {
  DistillationOutput,
  InterpretationOutput,
  ModelDistillationRequest,
  ModelDistillationResult,
  ModelGatewayPort,
  ModelGenerationRequest,
  ModelGenerationResult,
  ModelInterpretationRequest,
  ModelInterpretationResult,
} from "../types";

/**
 * Deterministic synthetic model gateway for credential-independent local
 * mode. Produces a clearly labeled working draft from the tenant's fact
 * record without calling any external provider.
 *
 * Boundary notes (PRD §5.9, §7.4): the gateway returns TEXT ONLY. It has no
 * access to mutate facts, approve drafts, or trigger actions — callers store
 * the content as an immutable draft version labeled "working_draft".
 */
export class LocalModelGateway implements ModelGatewayPort {
  async generate(request: ModelGenerationRequest): Promise<ModelGenerationResult> {
    const tier = [...(["standard", "advanced"] as const)]
      .map((id) => getModelTier(id))
      .find((t) => t?.modelId === request.modelId);
    if (!tier) {
      throw new Error("model_not_allowed");
    }

    const unresolved = request.facts.filter((fact) => isUnresolved(fact.provenance));
    const supported = request.facts.filter((fact) => fact.provenance === "source_supported");

    const lines: string[] = [];
    lines.push("WORKING DRAFT — COUNSEL REVIEW REQUIRED");
    lines.push(
      "This automated draft was generated from the facts recorded in your invention record. It is not legal advice, is not filing-ready, and must be reviewed and approved by qualified patent counsel before any consequential use.",
    );
    lines.push("");

    switch (request.workflow) {
      case "invention_disclosure_summary": {
        lines.push(`# Invention disclosure summary: ${request.invention.title}`);
        lines.push("");
        lines.push("## Problem addressed (as recorded by your team)");
        lines.push(request.invention.problem);
        lines.push("");
        lines.push("## Technical approach (as recorded by your team)");
        lines.push(request.invention.solution);
        lines.push("");
        lines.push("## Recorded technical facts");
        for (const fact of request.facts.filter((f) => f.category === "technical")) {
          lines.push(`- [${fact.provenance}] ${fact.statement}`);
        }
        lines.push("");
        lines.push("## Contributors of record");
        for (const contributor of request.contributors) {
          lines.push(`- ${contributor.name}: ${contributor.contribution}`);
        }
        break;
      }
      case "counsel_question_list": {
        lines.push(`# Questions to prepare for counsel: ${request.invention.title}`);
        lines.push("");
        lines.push(
          "These are organizational prompts derived from your record. They are not legal questions answered by the software, and counsel will decide what actually matters.",
        );
        lines.push("");
        for (const fact of unresolved) {
          lines.push(
            `- An unresolved ${fact.category} fact needs discussion: ${fact.statement}`,
          );
        }
        lines.push("- Which contributors meet the legal standard for inventorship? (Counsel determines this.)");
        lines.push("- Do any recorded disclosure events affect filing options or deadlines? (Counsel determines this.)");
        lines.push("- Are ownership and assignment documents complete for every contributor? (Counsel determines this.)");
        break;
      }
      case "gap_analysis": {
        lines.push(`# Documentation gap analysis: ${request.invention.title}`);
        lines.push("");
        lines.push(`Facts recorded: ${request.facts.length}`);
        lines.push(`Facts with source support: ${supported.length}`);
        lines.push(`Facts needing confirmation or disputed: ${unresolved.length}`);
        lines.push(`Sources organized: ${request.sources.length}`);
        lines.push("");
        lines.push("## Gaps flagged for your team (not legal conclusions)");
        for (const fact of unresolved) {
          lines.push(`- [${fact.provenance}] ${fact.statement}`);
        }
        if (request.sources.some((source) => source.status !== "extracted")) {
          lines.push("- Some sources are not yet extracted; their contents are not reflected in drafts.");
        }
        break;
      }
    }

    if (request.corpusSnippets.length > 0) {
      lines.push("");
      lines.push("## Public authority references (allowlisted corpus)");
      lines.push(
        "These citations are organizational reference points from the public corpus. They are not legal analysis; counsel decides what applies.",
      );
      for (const snippet of request.corpusSnippets) {
        lines.push(
          `- ${snippet.citation} — ${snippet.title} (current as of ${snippet.effectiveDate ?? "n/a"}): ${snippet.canonicalUrl}`,
        );
      }
    }

    lines.push("");
    lines.push("---");
    lines.push(
      `Generated by ${request.modelId} (synthetic local gateway). Unresolved facts at generation time: ${unresolved.length}.`,
    );
    lines.push("Status: working draft — counsel review required.");

    const content = lines.join("\n");

    // Deterministic simulated token accounting: ~4 chars per token.
    const inputChars =
      request.invention.summary.length +
      request.invention.problem.length +
      request.invention.solution.length +
      request.facts.reduce((sum, fact) => sum + fact.statement.length, 0);
    const inputTokens = Math.max(200, Math.ceil(inputChars / 4));
    const outputTokens = Math.min(request.maxOutputTokens, Math.ceil(content.length / 4));

    const providerCostCents =
      Math.ceil((inputTokens * tier.rate.inputCentsPerMillionTokens) / 1_000_000) +
      Math.ceil((outputTokens * tier.rate.outputCentsPerMillionTokens) / 1_000_000);

    return { content, inputTokens, outputTokens, providerCostCents };
  }

  /**
   * Deterministic synthetic source interpretation (Intake Studio §5.2).
   * Exercises the exact code path production uses — estimate, reservation,
   * artifact/component creation, settlement — without any provider call.
   *
   * Boundary note (invariant 16): file content is EVIDENCE. This function
   * only scans for candidate markers; instructions inside the text are
   * ordinary content and change nothing about engine behavior.
   */
  async interpret(request: ModelInterpretationRequest): Promise<ModelInterpretationResult> {
    const tier = this.requireTier(request.modelId);

    const output: InterpretationOutput = {
      summary: "",
      componentCandidates: [],
      problemCandidates: [],
      solutionCandidates: [],
    };

    if (request.interpretationClass === "image") {
      const bytes = request.imageBytes?.length ?? 0;
      output.summary = [
        `SYNTHETIC LOCAL INTERPRETATION (no external model) — image "${request.sourceName}" (${bytes} bytes, ${request.imageMimeType ?? "unknown type"}).`,
        "Local mode does not visually analyze pixels; production uses the vision-capable gateway model.",
      ].join(" ");
      output.componentCandidates.push({
        name: `Depicted assembly (${request.sourceName})`,
        description: `Figure candidate extracted from image upload ${request.sourceName}; production vision interpretation replaces this synthetic placeholder.`,
      });
    } else {
      const text = request.text ?? "";
      const lines = text.split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        const problem = line.match(/^problem\s*:\s*(.+)$/i);
        if (problem) output.problemCandidates.push(problem[1].trim());
        const solution = line.match(/^solution\s*:\s*(.+)$/i);
        if (solution) output.solutionCandidates.push(solution[1].trim());
        const component = line.match(/^component\s*:\s*(.+)$/i);
        if (component) {
          const [name, ...rest] = component[1].split(/\s+[—–-]\s+/);
          output.componentCandidates.push({
            name: name.trim(),
            description: rest.join(" — ").trim() || `Component named in ${request.sourceName}.`,
          });
        }
      }
      output.summary = [
        `SYNTHETIC LOCAL INTERPRETATION (no external model) — document "${request.sourceName}".`,
        `Text length: ${text.length} characters.`,
        "Uploaded file contents are untrusted evidence; any instructions inside them carry no authority (PRD §11).",
        text.trim().length > 0 ? `Leading excerpt: ${text.trim().slice(0, 400)}` : "The document is empty.",
      ].join("\n");
    }

    const inputChars =
      (request.text?.length ?? 0) + (request.imageBytes?.length ?? 0) / 40 + 200;
    const inputTokens = Math.max(150, Math.ceil(inputChars / 4));
    const outputTokens = Math.min(
      request.maxOutputTokens,
      Math.ceil(JSON.stringify(output).length / 4),
    );
    return { output, inputTokens, outputTokens, ...this.cost(tier, inputTokens, outputTokens) };
  }

  /**
   * Deterministic synthetic distillation (Intake Studio §5.3). Everything it
   * proposes lands downstream as `ai_proposed` — this gateway returns data
   * only and can never set a confirmed state (invariant 13).
   */
  async distill(request: ModelDistillationRequest): Promise<ModelDistillationResult> {
    const tier = this.requireTier(request.modelId);

    const problems: DistillationOutput["problems"] = [];
    const solutions: DistillationOutput["solutions"] = [];
    const componentNames = new Set<string>(request.componentNames);

    for (const artifact of request.artifacts) {
      for (const raw of artifact.content.split(/\r?\n/)) {
        const line = raw.trim();
        const problem = line.match(/^problem candidate\s*:\s*(.+)$/i);
        if (problem && !problems.some((p) => p.statement === problem[1].trim())) {
          problems.push({
            statement: problem[1].trim(),
            sourceAnchors: [`source:${artifact.sourceName}`],
          });
        }
        const solution = line.match(/^solution candidate\s*:\s*(.+)$/i);
        if (solution && !solutions.some((s) => s.statement === solution[1].trim())) {
          solutions.push({
            statement: solution[1].trim(),
            sourceAnchors: [`source:${artifact.sourceName}`],
            componentNames: [...componentNames],
          });
        }
      }
    }

    // Fall back to the record's own problem/solution statements so the
    // studio always produces a reviewable starting point.
    if (problems.length === 0 && request.invention.problem.trim()) {
      problems.push({
        statement: request.invention.problem.trim(),
        sourceAnchors: ["record:intake_problem"],
      });
    }
    if (solutions.length === 0 && request.invention.solution.trim()) {
      solutions.push({
        statement: request.invention.solution.trim(),
        sourceAnchors: ["record:intake_solution"],
        componentNames: [...componentNames],
      });
    }

    const pairings: DistillationOutput["pairings"] = [];
    for (let s = 0; s < solutions.length; s += 1) {
      if (problems.length > 0) {
        pairings.push({ problemIndex: Math.min(s, problems.length - 1), solutionIndex: s });
      }
    }

    const observations: string[] = [];
    if (solutions.length > 2) {
      observations.push(
        "This record may contain more than one independent inventive concept. This is an observation about the record's contents, not filing advice — counsel decides how to proceed.",
      );
    }

    const output: DistillationOutput = {
      workingTitle:
        request.invention.title.trim() ||
        solutions[0]?.statement.slice(0, 80) ||
        "Untitled invention (synthetic local distillation)",
      problems,
      solutions,
      pairings,
      observations,
    };

    const inputChars =
      request.artifacts.reduce((sum, a) => sum + a.content.length, 0) +
      request.facts.reduce((sum, f) => sum + f.statement.length, 0) +
      400;
    const inputTokens = Math.max(200, Math.ceil(inputChars / 4));
    const outputTokens = Math.min(
      request.maxOutputTokens,
      Math.ceil(JSON.stringify(output).length / 4),
    );
    return { output, inputTokens, outputTokens, ...this.cost(tier, inputTokens, outputTokens) };
  }

  private requireTier(modelId: string): ModelTier {
    const tier = [...(["standard", "advanced"] as const)]
      .map((id) => getModelTier(id))
      .find((t) => t?.modelId === modelId);
    if (!tier) throw new Error("model_not_allowed");
    return tier;
  }

  private cost(
    tier: ModelTier,
    inputTokens: number,
    outputTokens: number,
  ): { providerCostCents: number } {
    return {
      providerCostCents:
        Math.ceil((inputTokens * tier.rate.inputCentsPerMillionTokens) / 1_000_000) +
        Math.ceil((outputTokens * tier.rate.outputCentsPerMillionTokens) / 1_000_000),
    };
  }
}
